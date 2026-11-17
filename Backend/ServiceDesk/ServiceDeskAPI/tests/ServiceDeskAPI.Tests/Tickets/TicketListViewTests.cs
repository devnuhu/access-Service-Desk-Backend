using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
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
    /// <summary>Step 6b-3: the unit head's list (first response, escalation flag), waitingToStart and sort.</summary>
    public class TicketListViewTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketListViewTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid DepartmentId, Guid UnitId, string HeadName, string MemberName, Guid CategoryId);

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
            var name = "test.tl" + Guid.NewGuid().ToString("N").Substring(0, 8);
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
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "T" + tag, name = "List lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "List unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "List category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(department.Id, unit.Id, head.Name, member.Name, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("List test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        [Fact]
        public async Task The_head_sees_waiting_tickets_and_first_response_after_the_assignee_acknowledges()
        {
            var lab = await NewLabAsync();
            var ticket = await RaiseAsync(lab.CategoryId);
            var head = await As(lab.HeadName);
            var url = $"/api/tickets?view=department&departmentId={lab.DepartmentId}&unitId={lab.UnitId}";

            var waiting = await Ok<TicketPageDto>(await head.GetAsync(url + "&waitingToStart=true"));
            var row = Assert.Single(waiting.Items);
            Assert.Equal(ticket.Id, row.Id);
            Assert.Null(row.FirstRespondedAt);
            Assert.NotNull(row.Assignee);

            await Ok<MessageDto>(await (await As(lab.MemberName)).PostAsync($"/api/tickets/{ticket.Id}/acknowledge", null));

            var after = await Ok<TicketPageDto>(await head.GetAsync(url + "&waitingToStart=true"));
            Assert.Empty(after.Items);
            var all = await Ok<TicketPageDto>(await head.GetAsync(url + "&sort=assignedAt"));
            Assert.NotNull(Assert.Single(all.Items).FirstRespondedAt);
        }

        [Fact]
        public async Task The_escalation_flag_shows_in_the_heads_list_but_never_in_the_requesters()
        {
            var lab = await NewLabAsync();
            var ticket = await RaiseAsync(lab.CategoryId);
            await Ok<MessageDto>(await (await As(lab.MemberName)).PostAsJsonAsync($"/api/tickets/{ticket.Id}/escalate", new { reason = "This needs the head to decide." }));

            var asHead = await Ok<TicketPageDto>(await (await As(lab.HeadName)).GetAsync($"/api/tickets?view=department&departmentId={lab.DepartmentId}&unitId={lab.UnitId}"));
            Assert.NotNull(Assert.Single(asHead.Items).EscalatedToHeadAt);

            var asRequester = await Ok<TicketPageDto>(await (await As("test.requester")).GetAsync("/api/tickets?view=mine&sort=assignedAt_desc"));
            Assert.All(asRequester.Items, i => Assert.Null(i.EscalatedToHeadAt));
        }
    }
}