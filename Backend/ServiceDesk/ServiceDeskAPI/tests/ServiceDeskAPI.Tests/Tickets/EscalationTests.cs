using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 6b-2: the assignee asks the unit's head for help.</summary>
    public class EscalationTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public EscalationTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid HeadId, string HeadName, Guid MemberId, string MemberName, Guid CategoryId);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<(Guid Id, string Name)> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.es" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return (user.Id, name);
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "E" + tag, name = "Escalation lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Escalation unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Escalation category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(unit.Id, head.Id, head.Name, member.Id, member.Name, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Escalation test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private async Task<bool> NotifiedAsync(Guid userId, Guid ticketId, string titleStart)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().InAppNotifications
                .AnyAsync(n => n.RecipientUserId == userId && n.RelatedEntityId == ticketId && n.Title.StartsWith(titleStart));
        }

        [Fact]
        public async Task The_assignee_escalates_to_the_head_who_is_told_and_sees_it_but_the_requester_does_not()
        {
            var lab = await NewLabAsync();
            var ticket = await RaiseAsync(lab.CategoryId);
            var member = await As(lab.MemberName);

            var actions = await Ok<TicketActionsDto>(await member.GetAsync($"/api/tickets/{ticket.Id}/actions"));
            Assert.True(actions.CanEscalate);

            await Ok<MessageDto>(await member.PostAsJsonAsync($"/api/tickets/{ticket.Id}/escalate", new { reason = "I do not have access to this system." }));
            Assert.True(await NotifiedAsync(lab.HeadId, ticket.Id, "Ticket " + ticket.Reference + " escalated to you"));

            var asHead = await Ok<TicketDetailDto>(await (await As(lab.HeadName)).GetAsync($"/api/tickets/{ticket.Id}"));
            Assert.NotNull(asHead.EscalatedToHeadAt);
            Assert.Contains("access", asHead.EscalatedToHeadReason);

            var asRequester = await Ok<TicketDetailDto>(await (await As("test.requester")).GetAsync($"/api/tickets/{ticket.Id}"));
            Assert.Null(asRequester.EscalatedToHeadAt);
            Assert.Null(asRequester.EscalatedToHeadReason);

            var again = await Ok<TicketActionsDto>(await member.GetAsync($"/api/tickets/{ticket.Id}/actions"));
            Assert.False(again.CanEscalate);
        }

        [Fact]
        public async Task A_second_escalation_the_requester_and_a_missing_reason_are_refused()
        {
            var lab = await NewLabAsync();
            var ticket = await RaiseAsync(lab.CategoryId);
            var member = await As(lab.MemberName);

            var noReason = await member.PostAsJsonAsync($"/api/tickets/{ticket.Id}/escalate", new { reason = "" });
            Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);

            var requester = await (await As("test.requester")).PostAsJsonAsync($"/api/tickets/{ticket.Id}/escalate", new { reason = "Please escalate this one" });
            Assert.Equal(HttpStatusCode.Forbidden, requester.StatusCode);

            await Ok<MessageDto>(await member.PostAsJsonAsync($"/api/tickets/{ticket.Id}/escalate", new { reason = "Needs a decision from the head." }));
            var second = await member.PostAsJsonAsync($"/api/tickets/{ticket.Id}/escalate", new { reason = "Needs a decision from the head." });
            Assert.Equal(HttpStatusCode.BadRequest, second.StatusCode);
        }
    }
}