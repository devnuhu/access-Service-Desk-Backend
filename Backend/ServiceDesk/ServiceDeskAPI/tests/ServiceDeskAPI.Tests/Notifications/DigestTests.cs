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
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Notifications
{
    /// <summary>Step 8b: daily digests for unit heads and the Department Admin, the weekly one for the Head of Department. The worker is off in tests; each test picks the time.</summary>
    public class DigestTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public DigestTests(ServiceDeskApiFactory factory) => _factory = factory;

        // November 2026: Monday 16th ... Friday 20th, Saturday 21st. Lagos is one hour ahead of UTC.
        private static DateTime Lagos(int day, int hour, int minute = 0) => new DateTime(2026, 11, day, hour, minute, 0, DateTimeKind.Utc).AddHours(-1);

        private sealed record Lab(Guid TicketId, Guid MemberId, Guid HeadId, Guid HodId, Guid AdminId);

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
            var name = "test.dg" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return (user.Id, name);
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        /// <summary>A department with a head, a case worker, a Head of Department and a Department Admin, and one assigned ticket.</summary>
        private async Task<Lab> BuildAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "G" + tag, name = "Digest lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Digest unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Digest category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member.Id}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Digest test"), "subject" },
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
            await db.SaveChangesAsync();
            return new Lab(ticket.Id, member.Id, head.Id, hod.Id, departmentAdmin.Id);
        }

        private async Task ChangeTicketAsync(Guid ticketId, Action<Ticket> change)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ticket = await db.Tickets.FirstAsync(t => t.Id == ticketId);
            change(ticket);
            await db.SaveChangesAsync();
        }

        private async Task<int> RunAsync(DateTime now)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<IDigestService>().RunAsync(now);
        }

        private async Task<List<InAppNotification>> DigestsAsync(Guid user)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.InAppNotifications.AsNoTracking()
                .Where(n => n.RecipientUserId == user && n.RelatedEntityType != null && n.RelatedEntityType.StartsWith("Digest-"))
                .OrderBy(n => n.CreatedAt).ToListAsync();
        }

        [Fact]
        public async Task The_unit_head_and_the_department_admin_get_one_daily_digest_and_a_quiet_day_sends_nothing()
        {
            var lab = await BuildAsync();
            await ChangeTicketAsync(lab.TicketId, t => t.SlaBreachedAt = DateTime.UtcNow);

            await RunAsync(Lagos(17, 8, 30));                                   // Tuesday morning
            var head = await DigestsAsync(lab.HeadId);
            var admin = await DigestsAsync(lab.AdminId);
            Assert.Single(head);
            Assert.Single(admin);
            Assert.Contains("Overdue: 1", head[0].Message);
            Assert.Contains("Open: 1", admin[0].Message);
            Assert.Equal(NotificationType.Warning, head[0].Type);
            Assert.StartsWith("Digest-D-", head[0].RelatedEntityType);
            Assert.Empty(await DigestsAsync(lab.MemberId));                     // case workers get none
            Assert.Empty(await DigestsAsync(lab.HodId));                        // the Head of Department gets the weekly one only

            await RunAsync(Lagos(17, 9, 0));
            Assert.Single(await DigestsAsync(lab.HeadId));                      // once a day

            await ChangeTicketAsync(lab.TicketId, t => t.Status = TicketStatus.Closed);
            await RunAsync(Lagos(18, 8, 30));
            Assert.Single(await DigestsAsync(lab.HeadId));                      // nothing open: nothing sent
        }

        [Fact]
        public async Task The_head_of_department_gets_the_weekly_digest_on_the_first_working_day_only()
        {
            var lab = await BuildAsync();

            await RunAsync(Lagos(16, 8, 30));                                   // Monday
            var weekly = await DigestsAsync(lab.HodId);
            Assert.Single(weekly);
            Assert.StartsWith("Digest-W-", weekly[0].RelatedEntityType);
            Assert.Contains("Open: 1", weekly[0].Message);

            await RunAsync(Lagos(16, 8, 45));
            Assert.Single(await DigestsAsync(lab.HodId));                       // once a week
            await RunAsync(Lagos(17, 8, 30));                                   // Tuesday is not the first working day
            Assert.Single(await DigestsAsync(lab.HodId));
        }

        [Fact]
        public async Task Nothing_is_sent_at_weekends_before_the_send_hour_or_after_the_window()
        {
            var lab = await BuildAsync();

            await RunAsync(Lagos(21, 8, 30));                                   // Saturday
            await RunAsync(Lagos(17, 7, 0));                                    // before 08:00
            await RunAsync(Lagos(17, 12, 30));                                  // after the four-hour window
            Assert.Empty(await DigestsAsync(lab.HeadId));
            Assert.Empty(await DigestsAsync(lab.AdminId));
            Assert.Empty(await DigestsAsync(lab.HodId));
        }
    }
}
