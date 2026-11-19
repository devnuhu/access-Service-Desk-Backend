using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Reports;
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 9d: scheduled report emails. The worker is off in tests; each test picks the time. Emails are recorded, never sent.</summary>
    public class ReportScheduleTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public ReportScheduleTests(ServiceDeskApiFactory factory) => _factory = factory;

        private static readonly string[] SuperAdminRole = { AppRoles.SuperAdmin };

        // November 2026: Monday 16th ... Friday 20th, Saturday 21st, Monday 23rd. Lagos is one hour ahead of UTC.
        private static DateTime Lagos(int day, int hour, int minute = 0) => new DateTime(2026, 11, day, hour, minute, 0, DateTimeKind.Utc).AddHours(-1);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<(Guid Id, string Email)> NewAdminAsync(bool withEmail = true, bool superAdmin = true)
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.rs" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var email = name + "@test.invalid";
            var user = new User
            {
                Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true,
                Email = withEmail ? email : null, CorporateEmail = withEmail ? email : null
            };
            var created = await users.CreateAsync(user);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            if (superAdmin) await RoleAssignments.EnsureRoleAsync(db, user.Id, AppRoles.SuperAdmin, null);
            else await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return (user.Id, email);
        }

        private async Task<Guid> NewSavedReportAsync(Guid owner)
        {
            using var scope = _factory.Services.CreateScope();
            var saved = scope.ServiceProvider.GetRequiredService<ISavedReportService>();
            var (problem, report) = await saved.SaveAsync(null, new SaveReportRequest
            {
                Name = "Sched " + Guid.NewGuid().ToString("N").Substring(0, 8),
                Definition = new ReportSpec { Preset = "all", GroupBy = "unit", Measures = new() { "count" } }
            }, owner, true, SuperAdminRole);
            Assert.Null(problem?.Message);
            return report!.Id;
        }

        private static SaveReportScheduleRequest Request(Guid reportId, string frequency = "daily", int hour = 8, string? weekDay = null, int? dayOfMonth = null,
            string format = "xlsx", bool enabled = true) => new()
        {
            SavedReportId = reportId, Frequency = frequency, SendHour = hour, WeekDay = weekDay, DayOfMonth = dayOfMonth, Format = format, Enabled = enabled
        };

        private async Task<ReportScheduleDto> NewScheduleAsync(Guid owner, SaveReportScheduleRequest request)
        {
            using var scope = _factory.Services.CreateScope();
            var (problem, dto) = await scope.ServiceProvider.GetRequiredService<IReportScheduleService>().SaveAsync(null, request, owner, true, SuperAdminRole);
            Assert.Null(problem?.Message);
            return dto!;
        }

        /// <summary>Pretends the schedule was saved at that time (the real clock is used when saving).</summary>
        private async Task SavedAtAsync(Guid scheduleId, DateTime utc)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.ReportSchedules.FirstAsync(s => s.Id == scheduleId);
            row.StartsAfterUtc = utc;
            await db.SaveChangesAsync();
        }

        private async Task RunAsync(DateTime now)
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IReportScheduleService>().RunDueAsync(now);
        }

        private async Task<ReportScheduleDto> LoadAsync(Guid owner, Guid scheduleId)
        {
            using var scope = _factory.Services.CreateScope();
            var (problem, list) = await scope.ServiceProvider.GetRequiredService<IReportScheduleService>().ListAsync(owner, true);
            Assert.Null(problem?.Message);
            return list!.Single(s => s.Id == scheduleId);
        }

        private List<RecordingEmailService.SentEmail> EmailsTo(string address) =>
            _factory.Emails.Sent.Where(e => e.To.Equals(address, StringComparison.OrdinalIgnoreCase)).ToList();

        [Fact]
        public void The_due_moment_follows_the_frequency_the_hour_the_window_and_the_holidays()
        {
            var clock = BusinessClock.From(new SlaOptions { Holidays = new() { "2026-11-18" } });
            var longAgo = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            var daily = new ReportSchedule { Frequency = ReportFrequency.Daily, SendHour = 8, StartsAfterUtc = longAgo };
            var due = ReportScheduleTimes.Due(daily, Lagos(17, 8, 30), 1, 4, clock);       // Tuesday
            Assert.NotNull(due);
            Assert.Equal("D-20261117", due!.Value.Key);
            Assert.Null(ReportScheduleTimes.Due(daily, Lagos(17, 7, 59), 1, 4, clock));    // too early
            Assert.Null(ReportScheduleTimes.Due(daily, Lagos(17, 12, 0), 1, 4, clock));    // the window has closed
            Assert.Null(ReportScheduleTimes.Due(daily, Lagos(18, 8, 30), 1, 4, clock));    // a public holiday
            Assert.Null(ReportScheduleTimes.Due(daily, Lagos(21, 8, 30), 1, 4, clock));    // Saturday

            var weekly = new ReportSchedule { Frequency = ReportFrequency.Weekly, WeekDay = DayOfWeek.Monday, SendHour = 9, StartsAfterUtc = longAgo };
            Assert.NotNull(ReportScheduleTimes.Due(weekly, Lagos(16, 9, 5), 1, 4, clock));
            Assert.Null(ReportScheduleTimes.Due(weekly, Lagos(17, 9, 5), 1, 4, clock));

            var monthly = new ReportSchedule { Frequency = ReportFrequency.Monthly, DayOfMonth = 17, SendHour = 8, StartsAfterUtc = longAgo };
            Assert.Equal("M-202611", ReportScheduleTimes.Due(monthly, Lagos(17, 8, 30), 1, 4, clock)!.Value.Key);
            Assert.Null(ReportScheduleTimes.Due(monthly, Lagos(16, 8, 30), 1, 4, clock));

            var savedAfterTheSlot = new ReportSchedule { Frequency = ReportFrequency.Daily, SendHour = 8, StartsAfterUtc = Lagos(17, 9, 0) };
            Assert.Null(ReportScheduleTimes.Due(savedAfterTheSlot, Lagos(17, 9, 30), 1, 4, clock));   // today's slot was before saving
            Assert.NotNull(ReportScheduleTimes.Due(savedAfterTheSlot, Lagos(19, 8, 30), 1, 4, clock));

            var next = ReportScheduleTimes.NextUtc(savedAfterTheSlot, Lagos(17, 9, 30), 1, clock);
            Assert.Equal(Lagos(19, 8, 0), next);                                                       // the 18th is a holiday
        }

        [Fact]
        public async Task The_first_send_is_the_next_scheduled_time_after_saving_and_each_day_sends_once_with_the_file_attached()
        {
            var admin = await NewAdminAsync();
            var report = await NewSavedReportAsync(admin.Id);
            var schedule = await NewScheduleAsync(admin.Id, Request(report, "daily", 8));
            Assert.NotNull(schedule.NextRunAt);
            await SavedAtAsync(schedule.Id, Lagos(17, 9, 0));                  // saved on Tuesday at 09:00, after the 08:00 slot

            await RunAsync(Lagos(17, 9, 30));
            Assert.Empty(EmailsTo(admin.Email));                               // no catch-up for today

            await RunAsync(Lagos(18, 8, 30));                                  // Wednesday morning
            var mail = Assert.Single(EmailsTo(admin.Email));
            Assert.StartsWith("Scheduled report: Sched ", mail.Subject);
            var file = Assert.Single(mail.Attachments!);
            Assert.EndsWith(".xlsx", file.FileName);
            Assert.Equal((byte)'P', file.Content[0]);
            Assert.Equal((byte)'K', file.Content[1]);

            await RunAsync(Lagos(18, 9, 15));
            Assert.Single(EmailsTo(admin.Email));                              // once a day

            await RunAsync(Lagos(19, 8, 30));
            Assert.Equal(2, EmailsTo(admin.Email).Count);                      // the next day sends again

            var row = await LoadAsync(admin.Id, schedule.Id);
            Assert.Equal("Sent", row.LastStatus);
            Assert.NotNull(row.LastSentAt);
        }

        [Fact]
        public async Task A_CSV_schedule_attaches_a_CSV_file()
        {
            var admin = await NewAdminAsync();
            var schedule = await NewScheduleAsync(admin.Id, Request(await NewSavedReportAsync(admin.Id), "daily", 8, format: "csv"));
            await SavedAtAsync(schedule.Id, Lagos(1, 0));
            await RunAsync(Lagos(17, 8, 30));
            var file = Assert.Single(Assert.Single(EmailsTo(admin.Email)).Attachments!);
            Assert.EndsWith(".csv", file.FileName);
        }

        [Fact]
        public async Task Weekly_sends_only_on_its_weekday_and_monthly_only_on_its_day()
        {
            var admin = await NewAdminAsync();
            var report = await NewSavedReportAsync(admin.Id);
            var other = await NewSavedReportAsync(admin.Id);
            var weekly = await NewScheduleAsync(admin.Id, Request(report, "weekly", 8, weekDay: "Monday"));
            var monthly = await NewScheduleAsync(admin.Id, Request(other, "monthly", 8, dayOfMonth: 17));
            await SavedAtAsync(weekly.Id, Lagos(1, 0));
            await SavedAtAsync(monthly.Id, Lagos(1, 0));

            await RunAsync(Lagos(16, 8, 30));                                  // Monday the 16th: weekly only
            Assert.Single(EmailsTo(admin.Email));
            await RunAsync(Lagos(17, 8, 30));                                  // Tuesday the 17th: monthly only
            Assert.Equal(2, EmailsTo(admin.Email).Count);
            await RunAsync(Lagos(18, 8, 30));
            await RunAsync(Lagos(23, 8, 30));                                  // the next Monday: weekly again
            Assert.Equal(3, EmailsTo(admin.Email).Count);
        }

        [Fact]
        public async Task Nothing_is_sent_outside_the_window_when_switched_off_or_to_someone_without_an_email_address()
        {
            var late = await NewAdminAsync();
            var lateSchedule = await NewScheduleAsync(late.Id, Request(await NewSavedReportAsync(late.Id), "daily", 8));
            await SavedAtAsync(lateSchedule.Id, Lagos(1, 0));
            await RunAsync(Lagos(17, 13, 0));
            Assert.Empty(EmailsTo(late.Email));                                // the 4-hour window had closed: the day is lost, not sent late

            var off = await NewAdminAsync();
            var offSchedule = await NewScheduleAsync(off.Id, Request(await NewSavedReportAsync(off.Id), "daily", 8, enabled: false));
            await SavedAtAsync(offSchedule.Id, Lagos(1, 0));
            await RunAsync(Lagos(17, 8, 30));
            Assert.Empty(EmailsTo(off.Email));
            Assert.Null((await LoadAsync(off.Id, offSchedule.Id)).NextRunAt);

            var nobody = await NewAdminAsync(withEmail: false);
            var nobodySchedule = await NewScheduleAsync(nobody.Id, Request(await NewSavedReportAsync(nobody.Id), "daily", 8));
            await SavedAtAsync(nobodySchedule.Id, Lagos(1, 0));
            await RunAsync(Lagos(17, 8, 30));
            var row = await LoadAsync(nobody.Id, nobodySchedule.Id);
            Assert.Equal("Skipped", row.LastStatus);
            Assert.Contains("email", row.LastError, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public async Task Bad_input_is_refused_and_only_the_owner_can_change_or_delete_a_schedule()
        {
            var owner = await NewAdminAsync();
            var report = await NewSavedReportAsync(owner.Id);
            using var scope = _factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<IReportScheduleService>();

            async Task<int?> Status(SaveReportScheduleRequest r, Guid? id = null, Guid? user = null, bool admin = true)
            {
                var (problem, _) = await service.SaveAsync(id, r, user ?? owner.Id, admin, SuperAdminRole);
                return problem?.Status;
            }

            Assert.Equal(400, await Status(Request(report, "hourly")));
            Assert.Equal(400, await Status(Request(report, "daily", 24)));
            Assert.Equal(400, await Status(Request(report, "weekly", 8)));
            Assert.Equal(400, await Status(Request(report, "monthly", 8, dayOfMonth: 31)));
            Assert.Equal(400, await Status(Request(report, "daily", 8, format: "pdf")));
            Assert.Equal(404, await Status(Request(Guid.NewGuid(), "daily", 8)));

            var created = await NewScheduleAsync(owner.Id, Request(report, "daily", 8));
            Assert.Equal(409, await Status(Request(report, "weekly", 9, weekDay: "Friday")));                // one schedule per report: change it instead

            var stranger = await NewAdminAsync();
            Assert.Equal(404, await Status(Request(report, "daily", 9), created.Id, stranger.Id));
            Assert.Equal(404, (await service.DeleteAsync(created.Id, stranger.Id))!.Status);

            Assert.Null(await Status(Request(report, "weekly", 9, weekDay: "Friday"), created.Id));
            var changed = await LoadAsync(owner.Id, created.Id);
            Assert.Equal("weekly", changed.Frequency);
            Assert.Equal("Friday", changed.WeekDay);

            var requester = await NewAdminAsync(superAdmin: false);
            Assert.Equal(403, await Status(Request(report, "daily", 8), null, requester.Id, false));         // reports are not for ordinary staff

            Assert.Null(await service.DeleteAsync(created.Id, owner.Id));
        }

        [Fact]
        public async Task The_API_creates_lists_and_deletes_schedules_and_deleting_the_report_removes_its_schedules()
        {
            var admin = await As("test.superadmin");
            var name = "Api sched " + Guid.NewGuid().ToString("N").Substring(0, 8);
            var savedResponse = await admin.PostAsJsonAsync("/api/reports/saved", new SaveReportRequest
            {
                Name = name,
                Definition = new ReportSpec { Preset = "all", GroupBy = "unit", Measures = new() { "count" } }
            });
            Assert.Equal(HttpStatusCode.OK, savedResponse.StatusCode);
            var saved = (await savedResponse.Content.ReadFromJsonAsync<SavedReportDto>())!;

            var createdResponse = await admin.PostAsJsonAsync("/api/reports/schedules", Request(saved.Id, "daily", 8));
            Assert.Equal(HttpStatusCode.OK, createdResponse.StatusCode);
            var created = (await createdResponse.Content.ReadFromJsonAsync<ReportScheduleDto>())!;
            Assert.Equal(name, created.ReportName);
            Assert.NotNull(created.NextRunAt);

            var list = (await admin.GetFromJsonAsync<List<ReportScheduleDto>>("/api/reports/schedules"))!;
            Assert.Contains(list, s => s.Id == created.Id);

            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync("/api/reports/saved/" + saved.Id)).StatusCode);
            var after = (await admin.GetFromJsonAsync<List<ReportScheduleDto>>("/api/reports/schedules"))!;
            Assert.DoesNotContain(after, s => s.Id == created.Id);

            var requester = await As("test.requester");
            Assert.Equal(HttpStatusCode.Forbidden, (await requester.PostAsJsonAsync("/api/reports/schedules", Request(saved.Id, "daily", 8))).StatusCode);
        }
    }
}
