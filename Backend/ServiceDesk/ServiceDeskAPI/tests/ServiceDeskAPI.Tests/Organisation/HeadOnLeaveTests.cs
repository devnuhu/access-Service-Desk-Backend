using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Organisation;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Organisation
{
    /// <summary>Step 6e: while the unit head is away, the Department Admin is told too.</summary>
    public class HeadOnLeaveTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public HeadOnLeaveTests(ServiceDeskApiFactory factory) => _factory = factory;

        // November 2026: Monday 16th ... Friday 20th. Lagos is one hour ahead of UTC.
        private static DateTime Lagos(int day, int hour) => new DateTime(2026, 11, day, hour, 0, 0, DateTimeKind.Utc).AddHours(-1);

        private sealed record Lab(Guid TicketId, string Reference, Guid UnitId, Guid HeadId, Guid AdminId);

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
            var name = "test.hl" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A department with a head, a case worker and a Department Admin, and one assigned 24-hour ticket raised at the given time.</summary>
        private async Task<Lab> BuildAsync(DateTime createdUtc)
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "L" + tag, name = "Leave lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Leave unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Leave category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Leave test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));

            var departmentAdmin = await NewUserAsync();
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var dept = await db.Departments.FirstAsync(d => d.Id == department.Id);
            dept.AdminUserId = departmentAdmin;
            var ticket = await db.Tickets.FirstAsync(t => t.Id == created.Id);
            Assert.Equal(member, ticket.AssigneeUserId);
            ticket.CreatedAt = createdUtc;
            await db.SaveChangesAsync();
            return new Lab(ticket.Id, ticket.Reference, unit.Id, head, departmentAdmin);
        }

        private async Task AddLeaveAsync(Guid userId, DateOnly start, DateOnly end)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Absences.Add(new Absence { Id = Guid.NewGuid(), UserId = userId, Kind = AbsenceKind.Leave, StartDate = start, EndDate = end, CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync();
        }

        private async Task<List<Guid>> ContactsAsync(Guid unitId, DateOnly day)
        {
            using var scope = _factory.Services.CreateScope();
            return await HeadContacts.ForAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), unitId, day);
        }

        private async Task RunSlaAsync(DateTime now)
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<ISlaService>().CheckAsync(now);
        }

        private async Task<int> OverdueNoticesAsync(Guid user, Lab lab)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var title = "Ticket " + lab.Reference + " is overdue";
            return await db.InAppNotifications.CountAsync(n => n.RecipientUserId == user && n.RelatedEntityId == lab.TicketId && n.Title == title);
        }

        [Fact]
        public async Task The_Department_Admin_is_added_only_while_the_head_is_away()
        {
            var lab = await BuildAsync(DateTime.UtcNow);
            var present = await ContactsAsync(lab.UnitId, new DateOnly(2026, 11, 17));
            Assert.Equal(new[] { lab.HeadId }, present);

            await AddLeaveAsync(lab.HeadId, new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 20));
            var away = await ContactsAsync(lab.UnitId, new DateOnly(2026, 11, 17));
            Assert.Equal(2, away.Count);
            Assert.Contains(lab.HeadId, away);
            Assert.Contains(lab.AdminId, away);
            Assert.Single(await ContactsAsync(lab.UnitId, new DateOnly(2026, 11, 23)));   // back the week after
        }

        [Fact]
        public async Task An_overdue_ticket_also_tells_the_Department_Admin_while_the_head_is_on_leave()
        {
            var lab = await BuildAsync(Lagos(16, 8));                           // raised Monday 08:00, 24 working hours allowed
            await AddLeaveAsync(lab.HeadId, new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 20));

            await RunSlaAsync(Lagos(19, 8));                                    // Thursday 08:00: 27 working hours used, overdue
            Assert.Equal(1, await OverdueNoticesAsync(lab.HeadId, lab));
            Assert.Equal(1, await OverdueNoticesAsync(lab.AdminId, lab));
        }

        [Fact]
        public async Task An_overdue_ticket_does_not_tell_the_Department_Admin_while_the_head_is_present()
        {
            var lab = await BuildAsync(Lagos(16, 8));

            await RunSlaAsync(Lagos(19, 8));
            Assert.Equal(1, await OverdueNoticesAsync(lab.HeadId, lab));
            Assert.Equal(0, await OverdueNoticesAsync(lab.AdminId, lab));
        }
    }
}
