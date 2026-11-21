using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The unit dashboard: pool, team, categories and cover, and who may see it.</summary>
    public class UnitDashboardTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public UnitDashboardTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.ud" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private sealed record Lab(Guid DepartmentId, Guid UnitId, (Guid Id, string Name) Head, List<(Guid Id, string Name)> Members, Guid MappedCategoryId, Guid UnmappedCategoryId);

        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "D" + tag, name = "Dash Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Dash Unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var people = new List<(Guid Id, string Name)>();
            for (var i = 0; i < 2; i++)
            {
                var person = await NewUserAsync();
                await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = person.Id }));
                people.Add(person);
            }
            var mapped = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories", new { unitId = unit.Id, name = "Mapped " + tag, timelineHours = 24, defaultPriority = 2 }));
            var unmapped = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories", new { unitId = unit.Id, name = "Unmapped " + tag, timelineHours = 24, defaultPriority = 2 }));
            foreach (var person in people)
                await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{person.Id}", new { categoryIds = new[] { mapped.Id } }));
            return new Lab(department.Id, unit.Id, head, people, mapped.Id, unmapped.Id);
        }

        private async Task RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Dashboard test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        [Fact]
        public async Task The_head_sees_the_pool_the_team_with_leave_and_the_categories_with_cover()
        {
            var lab = await NewLabAsync();
            await RaiseAsync(lab.MappedCategoryId);   // goes to one of the two members
            await RaiseAsync(lab.UnmappedCategoryId); // nobody can take it: waits in the pool
            DateOnly today;
            using (var scope = _factory.Services.CreateScope())
                today = scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
            var head = await As(lab.Head.Name);
            await Ok<AbsenceDto>(await head.PostAsJsonAsync("/api/availability/absences", new { userId = lab.Members[0].Id, kind = 1, startDate = today, endDate = today.AddDays(1) }));

            var dash = await Ok<UnitDashboardDto>(await head.GetAsync($"/api/dashboard/unit/{lab.UnitId}"));

            Assert.Equal(lab.UnitId, dash.UnitId);
            Assert.Equal(2, dash.Counts.Open);
            Assert.Equal(1, dash.Counts.Unassigned);
            var waiting = Assert.Single(dash.Pool);
            Assert.Equal(lab.UnmappedCategoryId, waiting.CategoryId);
            Assert.Equal(1, waiting.Waiting);

            Assert.Equal(3, dash.Team.Count);
            Assert.True(dash.Team[0].IsHead);
            Assert.Equal(1, dash.Team.Sum(m => m.OpenTickets));
            var away = Assert.Single(dash.Team, m => m.OnLeave);
            Assert.Equal(lab.Members[0].Id, away.UserId);
            Assert.Equal(today.AddDays(1), away.LeaveUntil);

            var mapped = Assert.Single(dash.Categories, c => c.CategoryId == lab.MappedCategoryId);
            Assert.Equal(2, mapped.EligibleCount);
            Assert.False(mapped.NeedsCover);
            var unmapped = Assert.Single(dash.Categories, c => c.CategoryId == lab.UnmappedCategoryId);
            Assert.Equal(0, unmapped.EligibleCount);
            Assert.True(unmapped.NeedsCover);
            Assert.Equal(1, unmapped.OpenTickets);
        }

        [Fact]
        public async Task Only_the_unit_head_the_HOD_and_a_Super_Admin_may_see_it()
        {
            var lab = await NewLabAsync();
            var admin = await As("test.superadmin");
            var otherUnit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/units", new { code = "U2", name = "Other Unit " + Guid.NewGuid().ToString("N").Substring(0, 4) }));
            var otherHead = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{otherUnit.Id}/head", new { userId = otherHead.Id }));
            var hod = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/hod", new { userId = hod.Id }));
            var url = $"/api/dashboard/unit/{lab.UnitId}";

            Assert.Equal(HttpStatusCode.OK, (await (await As(lab.Head.Name)).GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As(hod.Name)).GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As(otherHead.Name)).GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As(lab.Members[0].Name)).GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.GetAsync($"/api/dashboard/unit/{Guid.NewGuid()}")).StatusCode);
        }
    }
}