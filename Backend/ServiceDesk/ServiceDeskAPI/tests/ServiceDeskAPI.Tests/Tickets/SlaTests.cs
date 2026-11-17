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
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Sla;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 7a: the business clock, and the SLA warning, overdue and far-past levels. The worker is off in tests; each test picks the time.</summary>
    public class SlaTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public SlaTests(ServiceDeskApiFactory factory) => _factory = factory;

        // November 2026: Monday 16th ... Friday 20th. Lagos is one hour ahead of UTC.
        private static DateTime Lagos(int day, int hour) => new DateTime(2026, 11, day, hour, 0, 0, DateTimeKind.Utc).AddHours(-1);

        private sealed record Lab(Guid TicketId, string Reference, Guid MemberId, Guid HeadId, Guid HodId, Guid AdminId);

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
            var name = "test.sla" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A department with a head, a case worker, a Head of Department and a Department Admin, and one assigned 24-hour ticket raised at the given time.</summary>
        private async Task<Lab> BuildAsync(DateTime createdUtc)
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "S" + tag, name = "Sla lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Sla unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Sla category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member.Id}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Sla test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));

            var hod = await NewUserAsync();
            var departmentAdmin = await NewUserAsync();
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var dept = await db.Departments.FirstAsync(d => d.Id == department.Id);
            dept.HodUserId = hod.Id;
            dept.AdminUserId = departmentAdmin.Id;
            var ticket = await db.Tickets.FirstAsync(t => t.Id == created.Id);
            Assert.Equal(member.Id, ticket.AssigneeUserId);
            ticket.CreatedAt = createdUtc;
            await db.SaveChangesAsync();
            return new Lab(ticket.Id, ticket.Reference, member.Id, head.Id, hod.Id, departmentAdmin.Id);
        }

        private async Task<int> RunAsync(DateTime now)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<ISlaService>().CheckAsync(now);
        }

        private async Task<int> CountAsync(Guid user, Lab lab, string title)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.InAppNotifications.CountAsync(n => n.RecipientUserId == user && n.RelatedEntityId == lab.TicketId && n.Title == title);
        }

        private async Task<Ticket> TicketAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Tickets.AsNoTracking().FirstAsync(t => t.Id == id);
        }

        private static string Warn(Lab l) => "Ticket " + l.Reference + " is nearing its deadline";
        private static string Overdue(Lab l) => "Ticket " + l.Reference + " is overdue";
        private static string FarPast(Lab l) => "Ticket " + l.Reference + " is far past its deadline";

        [Fact]
        public void The_business_clock_counts_only_working_hours_on_working_days()
        {
            var clock = new BusinessClock(1, 8, 17, new[] { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday }, Array.Empty<DateOnly>());
            Assert.Equal(9 * 60, clock.BusinessMinutes(Lagos(16, 8), Lagos(16, 17)));
            Assert.Equal(0, clock.BusinessMinutes(Lagos(16, 18), Lagos(17, 7)));                 // evening to early morning
            Assert.Equal(120, clock.BusinessMinutes(Lagos(20, 16), Lagos(23, 9)));               // Friday 16:00 to Monday 09:00 (weekend skipped)

            var withHoliday = new BusinessClock(1, 8, 17, new[] { DayOfWeek.Monday, DayOfWeek.Friday }, new[] { new DateOnly(2026, 11, 23) });
            Assert.Equal(60, withHoliday.BusinessMinutes(Lagos(20, 16), Lagos(24, 9)));          // Monday 23rd is a holiday
        }

        [Fact]
        public async Task Half_the_time_used_warns_the_assignee_once()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            await RunAsync(Lagos(17, 14));                                                        // 15 of 24 business hours = 62%

            Assert.Equal(1, await CountAsync(lab.MemberId, lab, Warn(lab)));
            Assert.Equal(0, await CountAsync(lab.HeadId, lab, Warn(lab)));
            Assert.Equal(0, await CountAsync(lab.HodId, lab, Warn(lab)));
            await RunAsync(Lagos(17, 15));
            Assert.Equal(1, await CountAsync(lab.MemberId, lab, Warn(lab)));
            var ticket = await TicketAsync(lab.TicketId);
            Assert.NotNull(ticket.SlaWarnedAt);
            Assert.Null(ticket.SlaBreachedAt);
        }

        [Fact]
        public async Task A_ticket_past_its_deadline_goes_to_the_unit_head_and_not_to_the_Head_of_Department()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            await RunAsync(Lagos(19, 14));                                                        // 33 business hours = 137%

            Assert.Equal(1, await CountAsync(lab.HeadId, lab, Overdue(lab)));
            Assert.Equal(1, await CountAsync(lab.MemberId, lab, Overdue(lab)));
            Assert.Equal(0, await CountAsync(lab.HodId, lab, FarPast(lab)));
            Assert.Equal(0, await CountAsync(lab.AdminId, lab, FarPast(lab)));
            var ticket = await TicketAsync(lab.TicketId);
            Assert.NotNull(ticket.SlaBreachedAt);
            Assert.Null(ticket.SlaL2At);
            Assert.Equal(lab.MemberId, ticket.AssigneeUserId);
            await RunAsync(Lagos(19, 15));
            Assert.Equal(1, await CountAsync(lab.HeadId, lab, Overdue(lab)));
        }

        [Fact]
        public async Task Far_past_the_deadline_tells_the_Head_of_Department_and_the_Admin_who_only_watch()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            await RunAsync(Lagos(19, 14));
            await RunAsync(Lagos(20, 10));                                                        // 38 business hours = 158%

            Assert.Equal(1, await CountAsync(lab.HodId, lab, FarPast(lab)));
            Assert.Equal(1, await CountAsync(lab.AdminId, lab, FarPast(lab)));
            Assert.Equal(1, await CountAsync(lab.HeadId, lab, Overdue(lab)));
            var ticket = await TicketAsync(lab.TicketId);
            Assert.NotNull(ticket.SlaL2At);
            Assert.Equal(lab.MemberId, ticket.AssigneeUserId);                                    // never handed to the HOD or the Admin

            var jumped = await BuildAsync(Lagos(16, 8));                                          // the worker was off: every level it has reached is sent
            await RunAsync(Lagos(20, 10));
            Assert.Equal(1, await CountAsync(jumped.HeadId, jumped, Overdue(jumped)));
            Assert.Equal(1, await CountAsync(jumped.HodId, jumped, FarPast(jumped)));
        }

        [Fact]
        public async Task Staff_see_the_sla_level_and_can_filter_by_it_and_the_requester_does_not()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            await RunAsync(Lagos(19, 14));                                                        // overdue
            var deptId = (await TicketAsync(lab.TicketId)).DepartmentId;
            var admin = await As("test.superadmin");
        
            var staffPage = await Ok<TicketPageDto>(await admin.GetAsync($"/api/tickets?view=department&departmentId={deptId}"));
            Assert.Equal(SlaLevel.Overdue, Assert.Single(staffPage.Items, i => i.Id == lab.TicketId).SlaLevel);
            var breached = await Ok<TicketPageDto>(await admin.GetAsync($"/api/tickets?view=department&departmentId={deptId}&slaBreached=true"));
            Assert.Contains(breached.Items, i => i.Id == lab.TicketId);
        
            var fresh = await BuildAsync(DateTime.UtcNow);                                        // raised just now: not breached
            var freshDept = (await TicketAsync(fresh.TicketId)).DepartmentId;
            var none = await Ok<TicketPageDto>(await admin.GetAsync($"/api/tickets?view=department&departmentId={freshDept}&slaBreached=true"));
            Assert.Empty(none.Items);
        
            var mine = await Ok<TicketPageDto>(await (await As("test.requester")).GetAsync("/api/tickets?view=mine&pageSize=100"));
            Assert.Contains(mine.Items, i => i.Id == lab.TicketId);
            Assert.All(mine.Items, i => Assert.Equal(SlaLevel.OnTrack, i.SlaLevel));
        }
        
        [Fact]
        public async Task The_ticket_detail_shows_first_response_and_the_sla_times_to_staff_only()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            await RunAsync(Lagos(19, 14));
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var ticket = await db.Tickets.FirstAsync(t => t.Id == lab.TicketId);
                ticket.FirstRespondedAt = Lagos(16, 9);
                await db.SaveChangesAsync();
            }
        
            var asStaff = await Ok<TicketDetailDto>(await (await As("test.superadmin")).GetAsync($"/api/tickets/{lab.TicketId}"));
            Assert.NotNull(asStaff.FirstRespondedAt);
            Assert.NotNull(asStaff.SlaBreachedAt);
            Assert.Equal(SlaLevel.Overdue, asStaff.SlaLevel);
        
            var asRequester = await Ok<TicketDetailDto>(await (await As("test.requester")).GetAsync($"/api/tickets/{lab.TicketId}"));
            Assert.Null(asRequester.SlaBreachedAt);
            Assert.Equal(SlaLevel.OnTrack, asRequester.SlaLevel);
        }
        
        [Fact]
        public async Task The_sla_summary_counts_open_tickets_by_level_for_staff_only()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            await RunAsync(Lagos(19, 14));
            var deptId = (await TicketAsync(lab.TicketId)).DepartmentId;
        
            var summary = await Ok<SlaSummaryDto>(await (await As("test.superadmin")).GetAsync($"/api/tickets/sla-summary?departmentId={deptId}"));
            Assert.Equal(1, summary.Open);
            Assert.Equal(1, summary.Overdue);
            Assert.Equal(0, summary.Warning);
            Assert.Equal(0, summary.FarPast);
        
            var denied = await (await As("test.requester")).GetAsync($"/api/tickets/sla-summary?departmentId={deptId}");
            Assert.Equal(403, (int)denied.StatusCode);
        }
        [Fact]
        public async Task Pending_and_resolved_time_does_not_count_and_a_pending_ticket_is_not_alerted()
        {
            var lab = await BuildAsync(Lagos(16, 8));
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.TicketStatusChanges.RemoveRange(db.TicketStatusChanges.Where(c => c.TicketId == lab.TicketId));
                db.TicketStatusChanges.AddRange(
                    new TicketStatusChange { Id = Guid.NewGuid(), TicketId = lab.TicketId, FromStatus = TicketStatus.Assigned, ToStatus = TicketStatus.InProgress, At = Lagos(16, 8) },
                    new TicketStatusChange { Id = Guid.NewGuid(), TicketId = lab.TicketId, FromStatus = TicketStatus.InProgress, ToStatus = TicketStatus.Pending, At = Lagos(16, 9) },
                    new TicketStatusChange { Id = Guid.NewGuid(), TicketId = lab.TicketId, FromStatus = TicketStatus.Pending, ToStatus = TicketStatus.InProgress, At = Lagos(18, 17) });
                var ticket = await db.Tickets.FirstAsync(t => t.Id == lab.TicketId);
                ticket.Status = TicketStatus.InProgress;
                await db.SaveChangesAsync();
            }

            await RunAsync(Lagos(20, 8));                                                         // 36 business hours, 26 of them paused = 10 hours = 42%
            Assert.Equal(0, await CountAsync(lab.MemberId, lab, Warn(lab)));
            Assert.Equal(0, await CountAsync(lab.HeadId, lab, Overdue(lab)));

            await RunAsync(Lagos(20, 17));                                                        // 45 - 26 = 19 hours = 79%: a warning, not overdue
            Assert.Equal(1, await CountAsync(lab.MemberId, lab, Warn(lab)));
            Assert.Equal(0, await CountAsync(lab.HeadId, lab, Overdue(lab)));

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.TicketStatusChanges.Add(new TicketStatusChange { Id = Guid.NewGuid(), TicketId = lab.TicketId, FromStatus = TicketStatus.InProgress, ToStatus = TicketStatus.Pending, At = Lagos(20, 17) });
                var ticket = await db.Tickets.FirstAsync(t => t.Id == lab.TicketId);
                ticket.Status = TicketStatus.Pending;
                await db.SaveChangesAsync();
            }
            await RunAsync(Lagos(27, 17));                                                        // a week later, still Pending
            Assert.Equal(0, await CountAsync(lab.HeadId, lab, Overdue(lab)));
            Assert.Null((await TicketAsync(lab.TicketId)).SlaBreachedAt);
        }
    }
}