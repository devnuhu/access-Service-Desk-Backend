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
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Reminders and flags for tickets that sit in Pending: once per wait, to the right people.</summary>
    public class PendingRemindersTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public PendingRemindersTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        private Task MakePendingAsync(Guid id, PendingReason reason, DateTime since) =>
            ChangeAsync(id, t => { t.Status = TicketStatus.Pending; t.PendingReason = reason; t.PendingSince = since; });

        [Fact]
        public async Task A_ticket_that_has_only_just_gone_pending_sends_nothing()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await MakePendingAsync(id, PendingReason.Requester, DateTime.UtcNow);
            var ticket = await LoadAsync(id);
            await CheckSlaAsync();
            Assert.Equal(0, await CountAsync(ticket.RequesterUserId, id, "your reply is needed"));
            Assert.Equal(0, await CountAsync(lab.WorkerId, id, "requester has not replied"));
            Assert.Equal(0, await CountAsync(lab.HeadId, id, "Pending for"));
        }

        [Fact]
        public async Task A_long_wait_on_the_requester_reminds_them_tells_the_case_worker_and_flags_the_head_once_only()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await MakePendingAsync(id, PendingReason.Requester, DateTime.UtcNow.AddDays(-30));
            var ticket = await LoadAsync(id);
            await CheckSlaAsync();
            Assert.Equal(1, await CountAsync(ticket.RequesterUserId, id, "your reply is needed"));
            Assert.Equal(1, await CountAsync(lab.WorkerId, id, "requester has not replied"));
            Assert.Equal(1, await CountAsync(lab.HeadId, id, "Pending for"));

            await CheckSlaAsync();
            await CheckSlaAsync();
            Assert.Equal(1, await CountAsync(ticket.RequesterUserId, id, "your reply is needed"));
            Assert.Equal(1, await CountAsync(lab.WorkerId, id, "requester has not replied"));
            Assert.Equal(1, await CountAsync(lab.HeadId, id, "Pending for"));
        }

        [Fact]
        public async Task A_long_wait_on_a_third_party_nudges_the_case_worker_and_flags_the_head_but_does_not_bother_the_requester()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await MakePendingAsync(id, PendingReason.ThirdParty, DateTime.UtcNow.AddDays(-30));
            var ticket = await LoadAsync(id);
            await CheckSlaAsync();
            await CheckSlaAsync();
            Assert.Equal(1, await CountAsync(lab.WorkerId, id, "chase the third party"));
            Assert.Equal(1, await CountAsync(lab.HeadId, id, "Pending for"));
            Assert.Equal(0, await CountAsync(ticket.RequesterUserId, id, "your reply is needed"));
        }

        [Fact]
        public async Task A_new_wait_on_the_same_ticket_is_reminded_again()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await MakePendingAsync(id, PendingReason.ThirdParty, DateTime.UtcNow.AddDays(-30));
            await CheckSlaAsync();
            Assert.Equal(1, await CountAsync(lab.HeadId, id, "Pending for"));

            // it was resumed and went Pending again later: the earlier reminders belong to the earlier wait
            await ChangeAsync(id, t =>
            {
                t.PendingReminder1At = DateTime.UtcNow.AddDays(-60);
                t.PendingReminder2At = DateTime.UtcNow.AddDays(-60);
                t.PendingNudgeAt = DateTime.UtcNow.AddDays(-60);
                t.PendingFlaggedAt = DateTime.UtcNow.AddDays(-60);
                t.PendingSince = DateTime.UtcNow.AddDays(-30);
            });
            await CheckSlaAsync();
            Assert.Equal(2, await CountAsync(lab.HeadId, id, "Pending for"));
            Assert.Equal(2, await CountAsync(lab.WorkerId, id, "chase the third party"));
        }

        [Fact]
        public async Task A_ticket_that_is_no_longer_pending_is_left_alone()
        {
            var lab = await NewLabAsync();
            var id = await RaiseAssignedAsync(lab);
            await ChangeAsync(id, t => { t.Status = TicketStatus.InProgress; t.PendingReason = PendingReason.Requester; t.PendingSince = DateTime.UtcNow.AddDays(-30); });
            var ticket = await LoadAsync(id);
            await CheckSlaAsync();
            Assert.Equal(0, await CountAsync(ticket.RequesterUserId, id, "your reply is needed"));
            Assert.Equal(0, await CountAsync(lab.HeadId, id, "Pending for"));
        }
    }
}