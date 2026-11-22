using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Reports;
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Infrastructure.Tickets;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Performance figures and chart series: a case worker's own, a person seen by their head, and a whole unit.</summary>
    public class PerformanceTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public PerformanceTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid CategoryId, Guid HeadId, Guid WorkerId);

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
            var name = "test.fr" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        /// <summary>A unit with a head and one mapped case worker.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "R" + tag, name = "Response Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Response Unit " + tag }));
            var head = await NewUserAsync();
            var worker = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = head }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = worker }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Response category " + tag, timelineHours = 24, defaultPriority = 2 }));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            (await db.Units.FirstAsync(u => u.Id == unit.Id)).HeadUserId = head;
            db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = category.Id, UserId = worker, IsActive = true, AddedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
            return new Lab(unit.Id, category.Id, head, worker);
        }

        private async Task<Guid> RaiseAssignedAsync(Lab lab)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(lab.CategoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Team report test " + Guid.NewGuid().ToString("N")), "subject" },
                { new StringContent("<p>Please help " + Guid.NewGuid().ToString("N") + ".</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
            for (var i = 0; i < 60; i++)
            {
                using var scope = _factory.Services.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                if (await db.Tickets.AsNoTracking().AnyAsync(t => t.Id == created.Id && t.AssigneeUserId == lab.WorkerId)) return created.Id;
                await Task.Delay(250);
            }
            throw new Xunit.Sdk.XunitException("The ticket was not assigned to the case worker.");
        }

        private async Task ChangeAsync(Guid ticketId, Action<Ticket> change)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ticket = await db.Tickets.FirstAsync(t => t.Id == ticketId);
            change(ticket);
            await db.SaveChangesAsync();
        }

        private async Task CheckSlaAsync()
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ISlaService>().CheckAsync(DateTime.UtcNow);
        }

        private async Task<Ticket> LoadAsync(Guid ticketId)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().FirstAsync(t => t.Id == ticketId);
        }

        private async Task<T> WithService<T>(Func<IPerformanceService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<IPerformanceService>());
        }

        private int Offset()
        {
            using var scope = _factory.Services.CreateScope();
            return scope.ServiceProvider.GetRequiredService<IOptions<SlaOptions>>().Value.UtcOffsetHours;
        }

        private static PerformanceQuery Today() => new() { Preset = "today" };

        /// <summary>Two tickets assigned to the worker today: one resolved (answered at once), one still in progress.</summary>
        private async Task<(Lab Lab, Guid Resolved, Guid Open)> WorkAsync()
        {
            var lab = await NewLabAsync();
            var resolved = await RaiseAssignedAsync(lab);
            var open = await RaiseAssignedAsync(lab);
            var now = DateTime.UtcNow;
            await ChangeAsync(resolved, t =>
            {
                t.Status = TicketStatus.Resolved; t.ResolvedAt = now; t.ResolvedByUserId = lab.WorkerId; t.ResolutionCode = ResolutionCode.Completed; t.FirstRespondedAt = now;
            });
            await ChangeAsync(open, t => { t.Status = TicketStatus.InProgress; t.FirstRespondedAt = now; });
            return (lab, resolved, open);
        }

        [Fact]
        public async Task A_case_worker_sees_their_own_figures_series_and_targets()
        {
            var (lab, _, _) = await WorkAsync();
            var (problem, mine) = await WithService(s => s.MineAsync(Today(), lab.WorkerId));
            Assert.Null(problem);
            Assert.Equal(lab.WorkerId, mine!.UserId);
            Assert.Equal(2, mine.Figures.Assigned);
            Assert.Equal(1, mine.Figures.Resolved);
            Assert.Equal(1, mine.Figures.OpenNow);
            Assert.Equal(0, mine.Figures.OnHold);
            Assert.NotNull(mine.Figures.AvgFirstResponseHours);
            Assert.NotNull(mine.Figures.AvgResolutionHours);
            Assert.NotNull(mine.Team);                                   // the unit's averages, to compare with

            Assert.Equal("day", mine.Period.Bucket);
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(Offset())).ToString("yyyy-MM-dd");
            var point = Assert.Single(mine.Series);                       // one day in the period, even with nothing on other days
            Assert.Equal(today, point.Date);
            Assert.Equal(1, point.Resolved);
            Assert.Equal(2, point.Assigned);

            Assert.Equal(1, mine.OpenByStatus.Sum(c => c.Count));
            Assert.Equal(4, mine.Targets.Count);
            Assert.All(mine.Targets, t => Assert.True(t.ResponseHours > 0 && t.ResolutionHours >= t.ResponseHours));
        }

        [Fact]
        public async Task On_hold_tickets_are_counted_separately_and_a_person_with_no_work_sees_zeros()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.ThirdParty; t.PendingSince = DateTime.UtcNow; });
            var (_, mine) = await WithService(s => s.MineAsync(Today(), lab.WorkerId));
            Assert.Equal(1, mine!.Figures.OpenNow);
            Assert.Equal(1, mine.Figures.OnHold);

            var idle = await NewUserAsync();
            var (problem, none) = await WithService(s => s.MineAsync(Today(), idle));
            Assert.Null(problem);
            Assert.Equal(0, none!.Figures.Assigned);
            Assert.Equal(0, none.Figures.OpenNow);
            Assert.Empty(none.OpenByStatus);
        }

        [Fact]
        public async Task A_custom_range_gives_one_point_per_day_and_a_bad_range_is_refused()
        {
            var (lab, _, _) = await WorkAsync();
            var end = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(Offset()));
            var query = new PerformanceQuery { From = end.AddDays(-4).ToString("yyyy-MM-dd"), To = end.ToString("yyyy-MM-dd") };
            var (problem, mine) = await WithService(s => s.MineAsync(query, lab.WorkerId));
            Assert.Null(problem);
            Assert.Equal(5, mine!.Series.Count);
            Assert.Equal(1, mine.Series.Sum(p => p.Resolved));

            var wrong = await WithService(s => s.MineAsync(new PerformanceQuery { From = "2026-12-31", To = "2026-01-01" }, lab.WorkerId));
            Assert.Equal(400, wrong.Problem!.Status);
            var unknown = await WithService(s => s.MineAsync(new PerformanceQuery { Preset = "someday" }, lab.WorkerId));
            Assert.Equal(400, unknown.Problem!.Status);
        }

        [Fact]
        public async Task A_head_can_see_a_person_of_their_unit_and_nobody_else_can()
        {
            var (lab, _, _) = await WorkAsync();
            var seen = await WithService(s => s.PersonAsync(lab.WorkerId, Today(), lab.HeadId, false));
            Assert.Null(seen.Problem);
            Assert.Equal(2, seen.Performance!.Figures.Assigned);

            var colleague = await NewUserAsync();
            Assert.Equal(404, (await WithService(s => s.PersonAsync(lab.WorkerId, Today(), colleague, false))).Problem!.Status);
            Assert.Equal(404, (await WithService(s => s.PersonAsync(lab.HeadId, Today(), lab.WorkerId, false))).Problem!.Status);   // a case worker cannot see the head either
            Assert.Null((await WithService(s => s.PersonAsync(lab.WorkerId, Today(), lab.WorkerId, false))).Problem);                 // but everyone can see themselves
        }

        [Fact]
        public async Task A_unit_shows_totals_every_member_even_idle_ones_and_the_breakdowns()
        {
            var (lab, _, _) = await WorkAsync();
            var (problem, unit) = await WithService(s => s.UnitAsync(lab.UnitId, Today(), lab.HeadId, false));
            Assert.Null(problem);
            Assert.Equal(lab.UnitId, unit!.UnitId);
            Assert.Equal(2, unit.Figures.Assigned);
            Assert.Equal(1, unit.Figures.Resolved);
            Assert.Equal(1, unit.Figures.OpenNow);

            Assert.Equal(2, unit.Members.Count(m => m.UserId == lab.HeadId || m.UserId == lab.WorkerId));   // the head has no tickets and is still listed
            var worker = unit.Members.Single(m => m.UserId == lab.WorkerId);
            Assert.Equal(2, worker.Figures.Assigned);
            Assert.Equal(1, worker.Figures.Resolved);
            var head = unit.Members.Single(m => m.UserId == lab.HeadId);
            Assert.True(head.IsHead);
            Assert.Equal(0, head.Figures.Assigned);

            Assert.Equal(1, unit.OpenByStatus.Sum(c => c.Count));
            Assert.Equal(1, unit.OpenByPriority.Sum(c => c.Count));
            Assert.Equal(1, unit.OpenByAge.Sum(c => c.Count));
            Assert.Contains(unit.Categories, c => c.Tickets >= 2);
            Assert.Equal("day", unit.Period.Bucket);
            Assert.Single(unit.Series);
            Assert.Equal(4, unit.Targets.Count);
        }

        [Fact]
        public async Task Only_the_unit_head_oversight_and_super_admin_can_see_a_unit()
        {
            var lab = await NewLabAsync();
            Assert.Equal(403, (await WithService(s => s.UnitAsync(lab.UnitId, Today(), lab.WorkerId, false))).Problem!.Status);
            var outsider = await NewUserAsync();
            Assert.Equal(403, (await WithService(s => s.UnitAsync(lab.UnitId, Today(), outsider, false))).Problem!.Status);
            Assert.Equal(404, (await WithService(s => s.UnitAsync(Guid.NewGuid(), Today(), lab.HeadId, false))).Problem!.Status);
            var admin = await SuperAdminIdAsync();
            Assert.Null((await WithService(s => s.UnitAsync(lab.UnitId, Today(), admin, true))).Problem);
        }

        [Fact]
        public async Task The_endpoints_answer_signed_in_people_for_themselves_and_refuse_a_unit_to_a_requester()
        {
            var lab = await NewLabAsync();
            Assert.Equal(System.Net.HttpStatusCode.OK, (await (await As("test.requester")).GetAsync("/api/performance/me?preset=last7")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.Forbidden, (await (await As("test.requester")).GetAsync($"/api/performance/units/{lab.UnitId}")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.OK, (await (await As("test.superadmin")).GetAsync($"/api/performance/units/{lab.UnitId}?preset=thismonth")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await (await As("test.requester")).GetAsync("/api/performance/me?preset=someday")).StatusCode);
        }

        private async Task<Guid> SuperAdminIdAsync()
        {
            using var scope = _factory.Services.CreateScope();
            return (await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().FirstAsync(u => u.UserName == "test.superadmin")).Id;
        }
    }
}
