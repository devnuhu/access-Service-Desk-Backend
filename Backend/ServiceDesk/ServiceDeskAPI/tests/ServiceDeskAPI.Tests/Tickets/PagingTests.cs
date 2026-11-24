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
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Assignment;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Paging and search over the whole set: the unit pool, saved reports and the pending filter on the ticket list. The assignment worker is off (PickFactory) so a freed ticket stays in the pool.</summary>
    public class PagingTests : IClassFixture<PickFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public PagingTests(PickFactory factory) => _factory = factory;

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

        private async Task<int> CountAsync(Guid recipient, Guid ticketId, string titlePart)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.InAppNotifications.AsNoTracking().CountAsync(n => n.RecipientUserId == recipient && n.RelatedEntityId == ticketId && n.Title.Contains(titlePart));
        }

        private static readonly string[] NoRoles = Array.Empty<string>();

        private async Task<T> WithAssign<T>(Func<IAssignmentService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<IAssignmentService>());
        }

        private async Task<T> WithTickets<T>(Func<ITicketService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<ITicketService>());
        }

        private async Task<T> WithSaved<T>(Func<ISavedReportService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<ISavedReportService>());
        }

        private async Task<Guid> SuperAdminIdAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Users.AsNoTracking().Where(u => u.UserName == "test.superadmin").Select(u => u.Id).FirstAsync();
        }

        /// <summary>A raised ticket is auto-assigned; put it back in the pool (New, nobody).</summary>
        private async Task<Guid> RaiseIntoPoolAsync(Lab lab)
        {
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.Status = TicketStatus.New; t.AssigneeUserId = null; t.AssignedAt = null; });
            return id;
        }

        [Fact]
        public async Task The_pool_pages_ten_at_a_time_and_counts_every_ticket()
        {
            var lab = await NewLabAsync();
            var ids = new List<Guid>();
            for (var i = 0; i < 12; i++) ids.Add(await RaiseIntoPoolAsync(lab));

            var first = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, null, null, 1, 10));
            Assert.Equal(12, first.Total);
            Assert.Equal(10, first.Items.Count);
            Assert.Equal(1, first.Page);
            Assert.Equal(10, first.PageSize);
            var unit = Assert.Single(first.Units);
            Assert.Equal(lab.UnitId, unit.Id);
            Assert.Equal(12, unit.Count);

            var second = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, null, null, 2, 10));
            Assert.Equal(12, second.Total);
            Assert.Equal(2, second.Items.Count);
            Assert.Equal(12, first.Items.Select(i => i.Id).Concat(second.Items.Select(i => i.Id)).Distinct().Count());
            Assert.True(first.Items.All(i => ids.Contains(i.Id)));

            var defaults = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, null, null, 0, 0));
            Assert.Equal(1, defaults.Page);
            Assert.Equal(10, defaults.PageSize);
        }

        [Fact]
        public async Task Pool_search_covers_the_whole_pool_and_the_unit_filter_narrows_it()
        {
            var lab = await NewLabAsync();
            var ids = new List<Guid>();
            for (var i = 0; i < 3; i++) ids.Add(await RaiseIntoPoolAsync(lab));
            var reference = (await LoadAsync(ids[1])).Reference;

            var byReference = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, reference, null, 1, 10));
            Assert.Equal(1, byReference.Total);
            Assert.Equal(ids[1], byReference.Items.Single().Id);

            var bySubject = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, "Team report test", null, 1, 10));
            Assert.Equal(3, bySubject.Total);
            Assert.False(string.IsNullOrEmpty(bySubject.Items[0].Subject));

            var none = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, "no-such-words-" + Guid.NewGuid().ToString("N"), null, 1, 10));
            Assert.Equal(0, none.Total);
            Assert.Empty(none.Items);

            var inUnit = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, null, lab.UnitId, 1, 10));
            Assert.Equal(3, inUnit.Total);
            var otherUnit = await WithAssign(s => s.ListPoolPageAsync(lab.WorkerId, null, Guid.NewGuid(), 1, 10));
            Assert.Equal(0, otherUnit.Total);
            Assert.Equal(3, Assert.Single(otherUnit.Units).Count);
        }

        [Fact]
        public async Task A_person_outside_the_unit_has_an_empty_pool()
        {
            var lab = await NewLabAsync();
            await RaiseIntoPoolAsync(lab);
            var outsider = await NewUserAsync();
            var page = await WithAssign(s => s.ListPoolPageAsync(outsider, null, null, 1, 10));
            Assert.Equal(0, page.Total);
            Assert.Empty(page.Items);
            Assert.Empty(page.Units);
        }

        [Fact]
        public async Task Saved_reports_page_and_search_across_everything_the_person_can_see()
        {
            var superAdmin = await SuperAdminIdAsync();
            var tag = Guid.NewGuid().ToString("N").Substring(0, 8);
            for (var i = 0; i < 12; i++)
            {
                var request = new SaveReportRequest
                {
                    Name = "Paging " + tag + " " + i.ToString("00"),
                    Definition = new ReportSpec { Preset = "all", GroupBy = "unit", Measures = new() { "count" } }
                };
                var (problem, _) = await WithSaved(s => s.SaveAsync(null, request, superAdmin, true, NoRoles));
                Assert.Null(problem);
            }

            var (p1, first) = await WithSaved(s => s.ListPageAsync(superAdmin, true, NoRoles, tag, null, 1, 10));
            Assert.Null(p1);
            Assert.Equal(12, first!.Total);
            Assert.Equal(10, first.Items.Count);
            var (_, second) = await WithSaved(s => s.ListPageAsync(superAdmin, true, NoRoles, tag, null, 2, 10));
            Assert.Equal(2, second!.Items.Count);
            Assert.Equal(12, first.Items.Select(r => r.Id).Concat(second.Items.Select(r => r.Id)).Distinct().Count());

            var (_, one) = await WithSaved(s => s.ListPageAsync(superAdmin, true, NoRoles, "Paging " + tag + " 07", null, 1, 10));
            Assert.Equal(1, one!.Total);

            var (_, mine) = await WithSaved(s => s.ListPageAsync(superAdmin, true, NoRoles, tag, "mine", 1, 10));
            Assert.Equal(12, mine!.Total);
            var (_, shared) = await WithSaved(s => s.ListPageAsync(superAdmin, true, NoRoles, tag, "shared", 1, 10));
            Assert.Equal(0, shared!.Total);
        }

        [Fact]
        public async Task The_ticket_list_filters_by_what_a_pending_ticket_waits_on_and_can_sort_longest_waiting_first()
        {
            var lab = await NewLabAsync();
            var a = await RaiseAssignedAsync(lab);
            var b = await RaiseAssignedAsync(lab);
            var c = await RaiseAssignedAsync(lab);
            await ChangeAsync(a, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.Requester; t.PendingSince = DateTime.UtcNow.AddDays(-5); });
            await ChangeAsync(b, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.ThirdParty; t.PendingSince = DateTime.UtcNow.AddDays(-2); });
            await ChangeAsync(c, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.Requester; t.PendingSince = DateTime.UtcNow.AddDays(-1); });

            var (problem, page) = await WithTickets(s => s.ListAsync("assigned", null, null, null, null, null, 1, 10, lab.WorkerId, false, sort: "pendingsince", pendingReason: 1));
            Assert.Null(problem);
            Assert.Equal(2, page!.Total);
            Assert.Equal(new[] { a, c }, page.Items.Select(i => i.Id).ToArray());

            var (_, third) = await WithTickets(s => s.ListAsync("assigned", null, null, null, null, null, 1, 10, lab.WorkerId, false, pendingReason: 2));
            Assert.Equal(b, third!.Items.Single().Id);
        }
    }
}