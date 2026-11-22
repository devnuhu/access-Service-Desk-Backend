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
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Scheduled reports: the daily team measures, chosen weekdays, people copied from the directory, and the table in the email.</summary>
    public class ReportCopiesTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public ReportCopiesTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        [Fact]
        public async Task The_daily_team_measures_count_assigned_today_pending_resolved_today_and_everything_open()
        {
            var lab = await NewLabAsync();
            var resolved = await RaiseAssignedAsync(lab);
            var onHold = await RaiseAssignedAsync(lab);
            var older = await RaiseAssignedAsync(lab);
            await ChangeAsync(resolved, t => { t.Status = TicketStatus.Resolved; t.ResolvedAt = DateTime.UtcNow; t.ResolvedByUserId = lab.WorkerId; t.ResolutionCode = ResolutionCode.Completed; });
            await ChangeAsync(onHold, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.Requester; t.PendingSince = DateTime.UtcNow; });
            // raised 20 days ago and assigned yesterday: it is not in today's period at all, but it is still open
            await ChangeAsync(older, t => { t.Status = TicketStatus.InProgress; t.CreatedAt = DateTime.UtcNow.AddDays(-20); t.AssignedAt = DateTime.UtcNow.AddDays(-1); });

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var workerName = (await db.Users.AsNoTracking().FirstAsync(u => u.Id == lab.WorkerId)).FullName;
            var spec = new ReportSpec
            {
                Title = "Daily team report", Preset = "today", GroupBy = "assignee", UnitIds = new() { lab.UnitId },
                Measures = new() { "assignedInPeriod", "pending", "pendingRequester", "pendingThirdParty", "resolvedInPeriod", "openNow" }
            };
            var (problem, result) = await scope.ServiceProvider.GetRequiredService<IReportService>().RunAsync(spec, lab.HeadId, false);
            Assert.Null(problem);
            var keys = result!.Columns.Select(c => c.Key).ToList();
            var line = result.Rows.Single(r => (r[0] as string) == workerName);
            int Get(string key) => Convert.ToInt32(line[keys.IndexOf(key)]);
            Assert.Equal(2, Get("assignedInPeriod"));   // the resolved one and the one on hold; the older one was assigned yesterday
            Assert.Equal(1, Get("pending"));
            Assert.Equal(1, Get("pendingRequester"));
            Assert.Equal(0, Get("pendingThirdParty"));
            Assert.Equal(1, Get("resolvedInPeriod"));
            Assert.Equal(2, Get("openNow"));            // pending + in progress, whatever date they were raised
        }

        [Fact]
        public async Task The_ready_made_daily_team_report_exists_and_runs()
        {
            var lab = await NewLabAsync();
            var r12 = ReportCatalogue.BuiltIns().Single(b => b.Code == "R12");
            Assert.Equal("Daily team report", r12.Name);
            using var scope = _factory.Services.CreateScope();
            var (problem, result) = await scope.ServiceProvider.GetRequiredService<IReportService>().RunAsync(r12.Definition, lab.HeadId, false);
            Assert.Null(problem);
            Assert.Contains(result!.Columns, c => c.Key == "openNow");
        }

        [Fact]
        public void Custom_days_send_only_on_the_chosen_weekdays_once_a_day()
        {
            var clock = BusinessClock.From(new SlaOptions());
            var s = new ReportSchedule
            {
                Frequency = ReportFrequency.Custom,
                DaysMask = (1 << (int)DayOfWeek.Monday) | (1 << (int)DayOfWeek.Wednesday),
                SendHour = 8,
                StartsAfterUtc = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
            };
            Assert.True(ReportScheduleTimes.Qualifies(s, new DateTime(2026, 11, 23), clock));    // Monday
            Assert.False(ReportScheduleTimes.Qualifies(s, new DateTime(2026, 11, 24), clock));   // Tuesday
            Assert.True(ReportScheduleTimes.Qualifies(s, new DateTime(2026, 11, 25), clock));    // Wednesday
            Assert.Equal("D-20261123", ReportScheduleTimes.Key(s, new DateTime(2026, 11, 23)));
            Assert.NotNull(ReportScheduleTimes.Due(s, new DateTime(2026, 11, 23, 7, 30, 0, DateTimeKind.Utc), 1, 4, clock));   // 08:30 Lagos
            Assert.Null(ReportScheduleTimes.Due(s, new DateTime(2026, 11, 24, 7, 30, 0, DateTimeKind.Utc), 1, 4, clock));
        }

        [Fact]
        public async Task A_scheduled_report_can_use_chosen_weekdays_and_copy_people_from_the_directory()
        {
            var lab = await NewLabAsync();
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var saved = new SavedReport
            {
                Id = Guid.NewGuid(), OwnerUserId = lab.HeadId, Name = "Daily team " + Guid.NewGuid().ToString("N").Substring(0, 6),
                DefinitionJson = System.Text.Json.JsonSerializer.Serialize(new ReportSpec { Title = "Daily team report", Preset = "today", GroupBy = "assignee", Measures = new() { "assignedInPeriod" } }),
                Share = ReportShare.Private
            };
            db.SavedReports.Add(saved);
            await db.SaveChangesAsync();

            var schedules = scope.ServiceProvider.GetRequiredService<IReportScheduleService>();
            var roles = new[] { AppRoles.HeadOfUnit };
            SaveReportScheduleRequest Request(string frequency, List<string>? days, List<ReportRecipientDto>? cc) => new()
            {
                SavedReportId = saved.Id, Frequency = frequency, WeekDays = days, SendHour = 17, Format = "xlsx", Enabled = true, Cc = cc
            };

            var (problem, schedule) = await schedules.SaveAsync(null,
                Request("custom", new() { "Monday", "Wednesday", "Friday" }, new()
                {
                    new ReportRecipientDto { Name = "Ada Obi", Email = "Ada.Obi@Example.org" },
                    new ReportRecipientDto { Name = "Ada again", Email = "ada.obi@example.org" }
                }), lab.HeadId, false, roles);
            Assert.Null(problem);
            Assert.Equal("custom", schedule!.Frequency);
            Assert.Equal(new[] { "Monday", "Wednesday", "Friday" }, schedule.WeekDays);
            var copy = Assert.Single(schedule.Cc);        // the same address twice is kept once, in lower case
            Assert.Equal("ada.obi@example.org", copy.Email);
            Assert.NotNull(schedule.NextRunAt);

            Assert.Equal(400, (await schedules.SaveAsync(schedule.Id, Request("custom", new() { "Saturday" }, null), lab.HeadId, false, roles)).Problem!.Status);
            Assert.Equal(400, (await schedules.SaveAsync(schedule.Id, Request("custom", new(), null), lab.HeadId, false, roles)).Problem!.Status);
            Assert.Equal(400, (await schedules.SaveAsync(schedule.Id, Request("daily", null, new() { new ReportRecipientDto { Email = "not-an-email" } }), lab.HeadId, false, roles)).Problem!.Status);
            var many = Enumerable.Range(0, 11).Select(i => new ReportRecipientDto { Name = "P" + i, Email = "p" + i + "@example.org" }).ToList();
            Assert.Equal(400, (await schedules.SaveAsync(schedule.Id, Request("daily", null, many), lab.HeadId, false, roles)).Problem!.Status);

            // changing back to daily with no copies clears both
            var (backProblem, back) = await schedules.SaveAsync(schedule.Id, Request("daily", null, null), lab.HeadId, false, roles);
            Assert.Null(backProblem);
            Assert.Empty(back!.Cc);
            Assert.Null(back.WeekDays);
        }

        [Fact]
        public void The_email_table_shows_every_figure_and_never_lets_a_name_inject_markup()
        {
            var parts = EmailTemplates.Build(new EmailContent
            {
                Subject = "S", Heading = "H",
                Blocks = { EmailBlock.Table(new[] { "Person", "Assigned in period" }, new[] { new[] { "Ada <script>alert(1)</script>", "3" }, new[] { "Total", "3" } }, true) }
            }, EmailBrand.Current);
            Assert.Contains("Assigned in period", parts.Html);
            Assert.Contains("&lt;script&gt;", parts.Html);
            Assert.DoesNotContain("<script>", parts.Html);
            Assert.Contains("Person | Assigned in period", parts.Text);
        }

        [Fact]
        public async Task Only_heads_and_oversight_roles_can_search_the_directory_for_people_to_copy()
        {
            Assert.Equal(System.Net.HttpStatusCode.Forbidden, (await (await As("test.requester")).GetAsync("/api/reports/recipients/search?query=ab")).StatusCode);
            Assert.Equal(System.Net.HttpStatusCode.BadRequest, (await (await As("test.hou")).GetAsync("/api/reports/recipients/search?query=")).StatusCode);
        }
    }
}