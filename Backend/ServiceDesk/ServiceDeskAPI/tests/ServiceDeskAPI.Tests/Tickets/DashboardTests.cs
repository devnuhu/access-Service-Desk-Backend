using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
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
    /// <summary>Step 9e: the home-screen counts. Who sees which units, the SLA levels, and the person's own work.</summary>
    public class DashboardTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public DashboardTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.db" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private async Task<DashboardSummaryDto> SummaryAs(string user) => await Ok<DashboardSummaryDto>(await (await As(user)).GetAsync("/api/dashboard/summary"));

        private sealed record Lab(Guid DepartmentId, Guid UnitAId, Guid UnitBId, Guid TicketId, Guid MemberBId, string HeadA, string HeadB, string MemberB, string Hod, string DeptAdmin, string Outsider);

        /// <summary>A department with units A and B, a head in each, a case worker in B, one ticket in B held by that case worker, a HOD, a Department Admin and an outsider.</summary>
        private async Task<Lab> BuildAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "D" + tag, name = "Dash lab " + tag }));
            var unitA = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "UA", name = "Dash unit A " + tag }));
            var unitB = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "UB", name = "Dash unit B " + tag }));
            var headA = await NewUserAsync();
            var headB = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unitA.Id}/head", new { userId = headA.Id }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unitB.Id}/head", new { userId = headB.Id }));
            var memberB = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unitB.Id}/members", new { userId = memberB.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unitB.Id, name = "Dash category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unitB.Id}/skills/{memberB.Id}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Dashboard test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var ticket = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));

            var hod = await NewUserAsync();
            var deptAdmin = await NewUserAsync();
            var outsider = await NewUserAsync();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var dept = await db.Departments.FirstAsync(d => d.Id == department.Id);
                dept.HodUserId = hod.Id;
                dept.AdminUserId = deptAdmin.Id;
                var t = await db.Tickets.FirstAsync(x => x.Id == ticket.Id);
                t.AssigneeUserId = memberB.Id;     // held by the case worker, waiting to start
                t.Status = TicketStatus.Assigned;
                await db.SaveChangesAsync();
            }
            return new Lab(department.Id, unitA.Id, unitB.Id, ticket.Id, memberB.Id, headA.Name, headB.Name, memberB.Name, hod.Name, deptAdmin.Name, outsider.Name);
        }

        private async Task ChangeAsync(Guid ticketId, Action<Ticket> change)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var t = await db.Tickets.FirstAsync(x => x.Id == ticketId);
            change(t);
            await db.SaveChangesAsync();
        }

        [Fact]
        public async Task Each_person_sees_the_units_they_oversee_and_case_workers_and_outsiders_get_no_overview()
        {
            var lab = await BuildAsync();

            var headB = await SummaryAs(lab.HeadB);
            Assert.NotNull(headB.Overview);
            var onlyB = Assert.Single(headB.Overview!.Units);
            Assert.Equal(lab.UnitBId, onlyB.UnitId);
            Assert.Equal(1, onlyB.Open);
            Assert.Equal(1, onlyB.WaitingToStart);
            Assert.Equal(0, onlyB.Unassigned);
            Assert.Equal(1, headB.Overview.Total.Open);

            var headA = await SummaryAs(lab.HeadA);
            Assert.Equal(lab.UnitAId, Assert.Single(headA.Overview!.Units).UnitId);
            Assert.Equal(0, headA.Overview.Total.Open);                        // unit A has no tickets and unit B's are not theirs

            foreach (var person in new[] { lab.Hod, lab.DeptAdmin })
            {
                var wide = await SummaryAs(person);
                Assert.Equal(2, wide.Overview!.Units.Count);                   // the whole department
                Assert.Equal(1, wide.Overview.Total.Open);
            }

            var superAdmin = await SummaryAs("test.superadmin");
            Assert.Contains(superAdmin.Overview!.Units, u => u.UnitId == lab.UnitBId && u.Open == 1);

            Assert.Null((await SummaryAs(lab.MemberB)).Overview);              // a case worker sees "mine" only
            Assert.Null((await SummaryAs(lab.Outsider)).Overview);
        }

        [Fact]
        public async Task Warning_overdue_far_past_and_escalated_are_counted_once_each_and_closed_tickets_drop_out()
        {
            var lab = await BuildAsync();
            var now = DateTime.UtcNow;

            await ChangeAsync(lab.TicketId, t => t.SlaWarnedAt = now);
            var warning = (await SummaryAs(lab.HeadB)).Overview!.Total;
            Assert.Equal(1, warning.Warning); Assert.Equal(0, warning.Overdue); Assert.Equal(0, warning.FarPast);

            await ChangeAsync(lab.TicketId, t => t.SlaBreachedAt = now);
            var overdue = (await SummaryAs(lab.HeadB)).Overview!.Total;
            Assert.Equal(0, overdue.Warning); Assert.Equal(1, overdue.Overdue); Assert.Equal(0, overdue.FarPast);

            await ChangeAsync(lab.TicketId, t => { t.SlaL2At = now; t.EscalatedToHeadAt = now; });
            var far = (await SummaryAs(lab.Hod)).Overview!.Total;
            Assert.Equal(0, far.Overdue); Assert.Equal(1, far.FarPast); Assert.Equal(1, far.Escalated);
            var unit = Assert.Single((await SummaryAs(lab.HeadB)).Overview!.Units);
            Assert.Equal(1, unit.FarPast); Assert.Equal(1, unit.Escalated);

            await ChangeAsync(lab.TicketId, t => t.Status = TicketStatus.Closed);
            var closed = (await SummaryAs(lab.Hod)).Overview!.Total;
            Assert.Equal(0, closed.Open); Assert.Equal(0, closed.FarPast); Assert.Equal(0, closed.Escalated);
        }

        [Fact]
        public async Task Mine_shows_the_persons_own_open_tickets_and_what_waits_for_their_confirmation()
        {
            var lab = await BuildAsync();

            var worker = (await SummaryAs(lab.MemberB)).Mine;
            Assert.Equal(1, worker.Open);
            Assert.Equal(1, worker.WaitingToStart);
            Assert.Equal(0, worker.Overdue);

            await ChangeAsync(lab.TicketId, t => { t.Status = TicketStatus.InProgress; t.SlaWarnedAt = DateTime.UtcNow; t.SlaBreachedAt = DateTime.UtcNow; });
            worker = (await SummaryAs(lab.MemberB)).Mine;
            Assert.Equal(1, worker.Open);
            Assert.Equal(0, worker.WaitingToStart);
            Assert.Equal(1, worker.Overdue);

            var before = (await SummaryAs("test.requester")).Mine;
            Assert.True(before.RaisedOpen >= 1);
            await ChangeAsync(lab.TicketId, t => t.Status = TicketStatus.Resolved);
            var after = (await SummaryAs("test.requester")).Mine;
            Assert.Equal(before.ToConfirm + 1, after.ToConfirm);
            Assert.Equal(before.RaisedOpen - 1, after.RaisedOpen);
            Assert.Equal(0, (await SummaryAs(lab.MemberB)).Mine.Open);        // resolved tickets are no longer open work
        }

        [Fact]
        public async Task The_dashboard_needs_a_sign_in()
        {
            var response = await ApiTestHelpers.Client(_factory).GetAsync("/api/dashboard/summary");
            Assert.Equal(401, (int)response.StatusCode);
        }
    }
}
