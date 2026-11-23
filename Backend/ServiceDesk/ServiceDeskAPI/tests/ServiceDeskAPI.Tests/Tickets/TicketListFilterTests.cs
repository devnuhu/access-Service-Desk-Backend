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
    /// <summary>The ticket list can be narrowed by priority and by how long ago it was raised, with the same age bands as the unit performance chart.</summary>
    public class TicketListFilterTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketListFilterTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.lf" + Guid.NewGuid().ToString("N").Substring(0, 8);
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
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "F" + tag, name = "Filter lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Filter unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Filter category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(department.Id, unit.Id, head.Name, member.Name, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId, int priority)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent(priority.ToString()), "priority" },
                { new StringContent("Filter test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private async Task BackdateAsync(Guid ticketId, double days)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ticket = await db.Tickets.FindAsync(ticketId);
            Assert.NotNull(ticket);
            db.Entry(ticket!).Property(t => t.CreatedAt).CurrentValue = DateTime.UtcNow.AddDays(-days);
            await db.SaveChangesAsync();
        }

        [Fact]
        public async Task The_list_can_be_narrowed_by_priority()
        {
            var lab = await NewLabAsync();
            var low = await RaiseAsync(lab.CategoryId, 1);
            var medium = await RaiseAsync(lab.CategoryId, 2);
            var high = await RaiseAsync(lab.CategoryId, 3);
            var head = await As(lab.HeadName);
            var url = $"/api/tickets?view=department&departmentId={lab.DepartmentId}&unitId={lab.UnitId}";

            Assert.Equal(3, (await Ok<TicketPageDto>(await head.GetAsync(url))).Total);
            Assert.Equal(low.Id, Assert.Single((await Ok<TicketPageDto>(await head.GetAsync(url + "&priority=1"))).Items).Id);
            Assert.Equal(medium.Id, Assert.Single((await Ok<TicketPageDto>(await head.GetAsync(url + "&priority=2"))).Items).Id);
            Assert.Equal(high.Id, Assert.Single((await Ok<TicketPageDto>(await head.GetAsync(url + "&priority=3&open=true"))).Items).Id);
            Assert.Empty((await Ok<TicketPageDto>(await head.GetAsync(url + "&priority=4"))).Items);

            // the requester's own list takes the filter too, and only shows what they may see
            var mine = await Ok<TicketPageDto>(await (await As("test.requester")).GetAsync("/api/tickets?view=mine&priority=3"));
            Assert.Contains(mine.Items, i => i.Id == high.Id);
            Assert.All(mine.Items, i => Assert.Equal(TicketPriority.High, i.Priority));
        }

        [Fact]
        public async Task The_age_bands_pick_the_same_tickets_the_performance_chart_counts()
        {
            var lab = await NewLabAsync();
            var days = new[] { 0.5, 2.0, 4.0, 8.0, 20.0 };   // one in the middle of each band
            var tickets = new List<CreatedTicketDto>();
            foreach (var d in days)
            {
                var ticket = await RaiseAsync(lab.CategoryId, 2);
                await BackdateAsync(ticket.Id, d);
                tickets.Add(ticket);
            }
            var head = await As(lab.HeadName);
            var url = $"/api/tickets?view=department&departmentId={lab.DepartmentId}&unitId={lab.UnitId}&open=true";
            var chart = await Ok<UnitPerformanceDto>(await head.GetAsync($"/api/performance/units/{lab.UnitId}?preset=all"));
            var labels = new[] { "Under 1 day", "1 to 2 days", "3 to 5 days", "6 to 10 days", "Over 10 days" };

            for (var band = 1; band <= 5; band++)
            {
                var list = await Ok<TicketPageDto>(await head.GetAsync(url + "&ageBand=" + band));
                var label = labels[band - 1];
                var bar = chart.OpenByAge.Single(c => c.Label == label);
                Assert.Equal(1, list.Total);
                Assert.Equal(bar.Count, list.Total);
                Assert.Equal(tickets[band - 1].Id, Assert.Single(list.Items).Id);
            }

            // together with priority, and a band with nothing in it
            Assert.Single((await Ok<TicketPageDto>(await head.GetAsync(url + "&ageBand=3&priority=2"))).Items);
            Assert.Empty((await Ok<TicketPageDto>(await head.GetAsync(url + "&ageBand=3&priority=4"))).Items);
        }

        [Fact]
        public async Task An_age_band_outside_1_to_5_is_refused()
        {
            var head = await As("test.superadmin");
            foreach (var bad in new[] { 0, 6, -1 })
            {
                var response = await head.GetAsync("/api/tickets?view=mine&ageBand=" + bad);
                Assert.Equal(System.Net.HttpStatusCode.BadRequest, response.StatusCode);
            }
        }
    }
}