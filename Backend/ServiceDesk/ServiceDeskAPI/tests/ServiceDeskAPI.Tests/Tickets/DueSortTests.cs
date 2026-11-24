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
    /// <summary>The stored SLA due time: kept current by the SLA check, stamped when a ticket is raised, and the 'due' sort across the whole list. The assignment worker is off (PickFactory).</summary>
    public class DueSortTests : IClassFixture<PickFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public DueSortTests(PickFactory factory) => _factory = factory;

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

        private async Task<T> WithSla<T>(Func<ISlaService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<ISlaService>());
        }

        private async Task<T> WithTickets<T>(Func<ITicketService, Task<T>> action)
        {
            using var scope = _factory.Services.CreateScope();
            return await action(scope.ServiceProvider.GetRequiredService<ITicketService>());
        }

        private async Task<DateTime?> StoredDueAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Tickets.AsNoTracking().Where(t => t.Id == id).Select(t => t.SlaDueAt).SingleAsync();
        }

        [Fact]
        public async Task A_ticket_has_its_due_time_stored_as_soon_as_it_is_raised()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            var due = await StoredDueAsync(id);
            Assert.NotNull(due);
            Assert.True(due > (await LoadAsync(id)).CreatedAt);
        }

        [Fact]
        public async Task The_due_sort_orders_the_whole_list_by_when_time_runs_out_and_puts_tickets_without_one_last()
        {
            var lab = await NewLabAsync();
            var low = await RaiseAssignedAsync(lab);
            var critical = await RaiseAssignedAsync(lab);
            var medium = await RaiseAssignedAsync(lab);
            var pending = await RaiseAssignedAsync(lab);
            await ChangeAsync(low, t => t.Priority = TicketPriority.Low);
            await ChangeAsync(critical, t => t.Priority = TicketPriority.Critical);
            await ChangeAsync(medium, t => t.Priority = TicketPriority.Medium);
            await ChangeAsync(pending, t => { t.Status = TicketStatus.Pending; t.PendingReason = PendingReason.Requester; t.PendingSince = DateTime.UtcNow; });

            await WithSla(s => s.CheckAsync(DateTime.UtcNow));

            Assert.NotNull(await StoredDueAsync(critical));
            Assert.Null(await StoredDueAsync(pending));

            var (problem, page) = await WithTickets(s => s.ListAsync("assigned", null, null, null, null, null, 1, 10, lab.WorkerId, false, sort: "due"));
            Assert.Null(problem);
            Assert.Equal(new[] { critical, medium, low, pending }, page!.Items.Select(i => i.Id).ToArray());
        }

        [Fact]
        public async Task A_finished_ticket_loses_its_due_time()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            Assert.NotNull(await StoredDueAsync(id));
            await ChangeAsync(id, t => t.Status = TicketStatus.Closed);
            await WithSla(s => s.CheckAsync(DateTime.UtcNow));
            Assert.Null(await StoredDueAsync(id));
        }
    }
}