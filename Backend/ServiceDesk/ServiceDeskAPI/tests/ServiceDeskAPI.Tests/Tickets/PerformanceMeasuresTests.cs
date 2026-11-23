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
    public class PerformanceMeasuresTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public PerformanceMeasuresTests(ServiceDeskApiFactory factory) => _factory = factory;

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
        public async Task A_case_worker_gets_the_counts_the_appraisal_needs()
        {
            var (lab, resolved, _) = await WorkAsync();
            var (problem, mine) = await WithService(s => s.MineAsync(Today(), lab.WorkerId));
            Assert.Null(problem);
            Assert.Equal(2, mine!.Figures.Assigned);
            Assert.Equal(1, mine.Figures.Resolved);
            Assert.Equal(1, mine.Figures.ResolvedWithinSla);
            Assert.Equal(0, mine.Figures.ResolvedLate);
            Assert.Equal(0, mine.Figures.Reopened);
            Assert.Equal(0, mine.Figures.OverdueOpen);
            Assert.Equal(50.0, mine.Figures.ResolutionRatePercent);
            Assert.True(mine.Figures.FirstResponseMet > 0);
            Assert.Equal(0, mine.Figures.NoResponseInTime);

            await ChangeAsync(resolved, t => t.ReopenCount = 1);
            var (_, again) = await WithService(s => s.MineAsync(Today(), lab.WorkerId));
            Assert.Equal(1, again!.Figures.Reopened);
        }

        [Fact]
        public async Task An_open_ticket_past_its_deadline_counts_as_overdue_open_for_the_person_and_the_unit()
        {
            var (lab, _, open) = await WorkAsync();
            await ChangeAsync(open, t => t.CreatedAt = DateTime.UtcNow.AddDays(-30));

            var (_, mine) = await WithService(s => s.MineAsync(Today(), lab.WorkerId));
            Assert.Equal(1, mine!.Figures.OverdueOpen);

            var (problem, unit) = await WithService(s => s.UnitAsync(lab.UnitId, Today(), lab.HeadId, false));
            Assert.Null(problem);
            Assert.Equal(1, unit!.Figures.OverdueOpen);
            var member = unit.Members.Single(m => m.UserId == lab.WorkerId);
            Assert.Equal(1, member.Figures.OverdueOpen);
            Assert.Equal(1, member.Figures.ResolvedWithinSla);
            Assert.Equal(50.0, member.Figures.ResolutionRatePercent);
        }

        [Fact]
        public async Task A_person_with_nothing_assigned_has_no_resolution_rate_and_no_overdue()
        {
            var lab = await NewLabAsync();
            var (problem, mine) = await WithService(s => s.MineAsync(Today(), lab.HeadId));
            Assert.Null(problem);
            Assert.Null(mine!.Figures.ResolutionRatePercent);
            Assert.Equal(0, mine.Figures.OverdueOpen);
            Assert.Equal(0, mine.Figures.ResolvedWithinSla);
        }
    }
}