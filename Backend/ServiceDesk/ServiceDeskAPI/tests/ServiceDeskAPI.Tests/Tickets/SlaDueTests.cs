using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The ticket due date: business-hours maths, and who sees it.</summary>
    public class SlaDueTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public SlaDueTests(ServiceDeskApiFactory factory) => _factory = factory;

        private static BusinessClock Clock() => new BusinessClock(1, 8, 17,
            new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday }, Array.Empty<DateOnly>());

        // Lagos is one hour ahead of UTC. November 2026: Monday 16th ... Friday 20th.
        private static DateTime Lagos(int day, int hour) => new DateTime(2026, 11, day, hour, 0, 0, DateTimeKind.Utc).AddHours(-1);

        [Fact]
        public void Twenty_four_working_hours_from_Monday_morning_end_on_Wednesday_afternoon()
        {
            var due = SlaDue.Compute(Clock(), Lagos(16, 8), 24, Array.Empty<(TicketStatus, DateTime)>());
            Assert.Equal(Lagos(18, 14), due);
        }

        [Fact]
        public void Time_spent_pending_is_added_back()
        {
            var changes = new[] { (TicketStatus.Pending, Lagos(16, 12)), (TicketStatus.InProgress, Lagos(17, 12)) };   // 9 working hours
            var due = SlaDue.Compute(Clock(), Lagos(16, 8), 24, changes);
            Assert.Equal(Lagos(19, 14), due);
        }

        [Fact]
        public void A_ticket_raised_on_Friday_afternoon_runs_over_the_weekend()
        {
            var due = SlaDue.Compute(Clock(), Lagos(20, 16), 24, Array.Empty<(TicketStatus, DateTime)>());
            Assert.Equal(Lagos(25, 13), due);   // 1h Friday, 9h Monday, 9h Tuesday, 5h Wednesday
        }

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<Guid> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.sd" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        [Fact]
        public async Task Staff_see_the_due_date_and_the_requester_does_not()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "D" + tag, name = "Due lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Due unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Due category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Due date test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var requester = await As("test.requester");
            var created = await Ok<CreatedTicketDto>(await requester.PostAsync("/api/tickets", form));

            var asStaff = await Ok<TicketDetailDto>(await admin.GetAsync($"/api/tickets/{created.Id}"));
            Assert.NotNull(asStaff.SlaDueAt);
            Assert.True(asStaff.SlaDueAt > asStaff.CreatedAt);

            var page = await Ok<TicketPageDto>(await admin.GetAsync($"/api/tickets?view=department&departmentId={department.Id}"));
            Assert.NotNull(Assert.Single(page.Items, i => i.Id == created.Id).SlaDueAt);

            var asRequester = await Ok<TicketDetailDto>(await requester.GetAsync($"/api/tickets/{created.Id}"));
            Assert.Null(asRequester.SlaDueAt);
        }
    }
}
