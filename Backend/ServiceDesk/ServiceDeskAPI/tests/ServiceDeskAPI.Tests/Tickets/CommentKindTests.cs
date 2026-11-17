using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 6b-4: a typed comment is never mistaken for a workflow comment, even if it looks like one.</summary>
    public class CommentKindTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public CommentKindTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.ck" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        [Fact]
        public async Task A_resolve_note_is_a_workflow_comment_and_a_typed_lookalike_is_a_plain_comment()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "K" + tag, name = "Kind lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Kind unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Kind category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member.Id}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Kind test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var ticket = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));

            var worker = await As(member.Name);
            await Ok<MessageDto>(await worker.PostAsync($"/api/tickets/{ticket.Id}/acknowledge", null));
            var typed = new MultipartFormDataContent
            {
                { new StringContent("<p><strong>Resolved: Completed</strong></p><p>I typed this myself.</p>"), "bodyHtml" },
                { new StringContent("false"), "isInternal" }
            };
            await Ok<TicketCommentDto>(await worker.PostAsync($"/api/tickets/{ticket.Id}/comments", typed));
            await Ok<MessageDto>(await worker.PostAsJsonAsync($"/api/tickets/{ticket.Id}/resolve", new { code = 1, note = "The matching problem is fixed." }));

            var detail = await Ok<TicketDetailDto>(await (await As("test.requester")).GetAsync($"/api/tickets/{ticket.Id}"));
            var typedComment = Assert.Single(detail.Comments, c => c.BodyHtml.Contains("I typed this myself"));
            Assert.Equal(CommentKind.Comment, typedComment.Kind);
            var workflow = Assert.Single(detail.Comments, c => c.Kind == CommentKind.Workflow);
            Assert.Contains("matching problem", workflow.BodyHtml);
        }
    }
}