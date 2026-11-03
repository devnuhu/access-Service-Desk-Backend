using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
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

namespace ServiceDeskAPI.Tests.Assignment
{
    /// <summary>Step 5: the assignment engine, the waiting queue, leave, reassignment and its history (BRD M3).</summary>
    public class AssignmentTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AssignmentTests(ServiceDeskApiFactory factory) => _factory = factory;

        /// <summary>A department of its own per test, so tests do not share workloads.</summary>
        private sealed record Lab(Guid DepartmentId, Guid UnitId, Guid HeadId, string HeadName, List<(Guid Id, string Name)> Members, Guid CategoryId);

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
            var name = "test.as" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private async Task<Lab> NewLabAsync(int members, bool mapSkills = true)
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "L" + tag, name = "Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Lab Unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var people = new List<(Guid Id, string Name)>();
            for (var i = 0; i < members; i++)
            {
                var person = await NewUserAsync();
                await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = person.Id }));
                people.Add(person);
            }
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Lab category " + tag, timelineHours = 24, defaultPriority = 2 }));
            if (mapSkills)
                foreach (var person in people)
                    await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{person.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(department.Id, unit.Id, head.Id, head.Name, people, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId, int priority = 2)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent(priority.ToString()), "priority" },
                { new StringContent("Assignment test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private async Task<Ticket> TicketAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        private async Task ProcessQueueAsync()
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IAssignmentService>().ProcessQueueAsync();
        }

        private async Task<bool> NotifiedAsync(Guid userId, Guid ticketId, string titleStart)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().InAppNotifications
                .AnyAsync(n => n.RecipientUserId == userId && n.RelatedEntityId == ticketId && n.Title.StartsWith(titleStart));
        }

        private DateOnly Today()
        {
            using var scope = _factory.Services.CreateScope();
            return scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
        }

        [Fact]
        public async Task The_lowest_weighted_workload_wins_and_ties_go_to_the_least_recently_assigned()
        {
            var lab = await NewLabAsync(2);

            var first = await RaiseAsync(lab.CategoryId, priority: 4); // Critical = 3
            var x = (await TicketAsync(first.Id)).AssigneeUserId!.Value;
            var y = lab.Members.Select(m => m.Id).Single(id => id != x);

            var order = new List<Guid>();
            for (var i = 0; i < 4; i++) order.Add((await TicketAsync((await RaiseAsync(lab.CategoryId)).Id)).AssigneeUserId!.Value);

            // y: 0 -> 1 -> 2 -> 3 while x stays at 3; at 3 each, x was assigned longer ago
            Assert.Equal(new[] { y, y, y, x }, order);

            var firstTicket = await TicketAsync(first.Id);
            Assert.Equal(TicketStatus.Assigned, firstTicket.Status);
            Assert.NotNull(firstTicket.AssignedAt);
            var history = await Ok<List<TicketAssignmentDto>>(await (await As(lab.HeadName)).GetAsync($"/api/tickets/{first.Id}/assignments"));
            var auto = Assert.Single(history);
            Assert.Equal(AssignmentMethod.Auto, auto.Method);
            Assert.Equal("raised", auto.Reason);
            Assert.Equal(2, auto.Scores.Count);
            Assert.Equal(x, auto.Scores.Single(s => s.Chosen).UserId);
            Assert.True(await NotifiedAsync(x, first.Id, "Ticket " + first.Reference + " assigned to you"));
            Assert.True(await NotifiedAsync((await TicketAsync(first.Id)).RequesterUserId, first.Id, "Ticket " + first.Reference + " picked up"));
        }

        [Fact]
        public async Task With_nobody_eligible_the_ticket_waits_the_head_is_told_and_it_is_assigned_once_someone_can_take_it()
        {
            var lab = await NewLabAsync(1, mapSkills: false);

            var raised = await RaiseAsync(lab.CategoryId);
            Assert.Contains("waiting", raised.Message);
            var waiting = await TicketAsync(raised.Id);
            Assert.Equal(TicketStatus.New, waiting.Status);
            Assert.Null(waiting.AssigneeUserId);
            Assert.True(await NotifiedAsync(lab.HeadId, raised.Id, "Ticket " + raised.Reference + " is waiting"));

            var admin = await As("test.superadmin");
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{lab.UnitId}/skills/{lab.Members[0].Id}", new { categoryIds = new[] { lab.CategoryId } }));
            await ProcessQueueAsync();

            var assigned = await TicketAsync(raised.Id);
            Assert.Equal(TicketStatus.Assigned, assigned.Status);
            Assert.Equal(lab.Members[0].Id, assigned.AssigneeUserId);
            Assert.Null(assigned.QueueAlertedAt);
        }

        [Fact]
        public async Task Leave_moves_tickets_not_started_and_flags_started_ones_to_the_head()
        {
            var lab = await NewLabAsync(2);
            var head = await As(lab.HeadName);
            var today = Today();

            var notStarted = await RaiseAsync(lab.CategoryId);
            var away = (await TicketAsync(notStarted.Id)).AssigneeUserId!.Value;
            var other = lab.Members.Select(m => m.Id).Single(id => id != away);
            await Ok<AbsenceDto>(await head.PostAsJsonAsync("/api/availability/absences", new { userId = away, kind = 1, startDate = today, endDate = today.AddDays(2) }));
            await ProcessQueueAsync();

            var moved = await TicketAsync(notStarted.Id);
            Assert.Equal(other, moved.AssigneeUserId);
            Assert.Equal(TicketStatus.Assigned, moved.Status);
            Assert.True(await NotifiedAsync(away, notStarted.Id, "Ticket " + notStarted.Reference + " moved while you are unavailable"));

            // A ticket already in progress stays with its assignee when they go away; the head is told once
            var started = await RaiseAsync(lab.CategoryId);
            Assert.Equal(other, (await TicketAsync(started.Id)).AssigneeUserId);
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.Tickets.SingleAsync(t => t.Id == started.Id);
                row.Status = TicketStatus.InProgress;
                await db.SaveChangesAsync();
            }
            await Ok<AbsenceDto>(await head.PostAsJsonAsync("/api/availability/absences", new { userId = other, kind = 2, startDate = today, endDate = today }));
            await ProcessQueueAsync();

            var flagged = await TicketAsync(started.Id);
            Assert.Equal(other, flagged.AssigneeUserId);
            Assert.Equal(TicketStatus.InProgress, flagged.Status);
            Assert.NotNull(flagged.AssigneeAwayFlaggedAt);
            Assert.True(await NotifiedAsync(lab.HeadId, started.Id, "Ticket " + started.Reference + ": assignee unavailable"));
        }

        [Fact]
        public async Task Reassignment_follows_who_is_asking_and_always_needs_a_reason()
        {
            var lab = await NewLabAsync(2);
            var admin = await As("test.superadmin");
            var otherUnit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/units", new { code = "U2", name = "Lab Unit Two " + Guid.NewGuid().ToString("N").Substring(0, 4) }));
            var stranger = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{otherUnit.Id}/members", new { userId = stranger.Id }));

            var raised = await RaiseAsync(lab.CategoryId);
            var holderId = (await TicketAsync(raised.Id)).AssigneeUserId!.Value;
            var holder = await As(lab.Members.Single(m => m.Id == holderId).Name);
            var colleague = lab.Members.Single(m => m.Id != holderId);
            var url = $"/api/tickets/{raised.Id}/reassign";

            // Requesters and outsiders cannot
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.requester")).PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "Please move it" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await (await As((await NewUserAsync()).Name)).PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "Please move it" })).StatusCode);

            // The holder: only within the unit, to someone who handles the category, with a reason
            var options = await Ok<ReassignOptionsDto>(await holder.GetAsync($"/api/tickets/{raised.Id}/reassign-options"));
            Assert.True(options.CanReassign);
            Assert.Contains(options.Candidates, c => c.UserId == colleague.Id && c.HandlesCategory);
            Assert.DoesNotContain(options.Candidates, c => c.UserId == stranger.Id);
            var noReason = await holder.PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "" });
            Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
            Assert.True((await noReason.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("reason", out _));
            Assert.Equal(HttpStatusCode.BadRequest, (await holder.PostAsJsonAsync(url, new { toUserId = stranger.Id, reason = "Other unit please" })).StatusCode);
            await Ok<MessageDto>(await holder.PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "I am out tomorrow" }));
            Assert.Equal(colleague.Id, (await TicketAsync(raised.Id)).AssigneeUserId);
            Assert.True(await NotifiedAsync(colleague.Id, raised.Id, "Ticket " + raised.Reference + " assigned to you"));

            // The HOD: any unit of the department; the ticket moves unit
            var hod = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/hod", new { userId = hod.Id }));
            await Ok<MessageDto>(await (await As(hod.Name)).PostAsJsonAsync(url, new { toUserId = stranger.Id, reason = "Miscategorised; belongs to unit two" }));
            var movedTicket = await TicketAsync(raised.Id);
            Assert.Equal(stranger.Id, movedTicket.AssigneeUserId);
            Assert.Equal(otherUnit.Id, movedTicket.UnitId);
            Assert.Equal(TicketStatus.Assigned, movedTicket.Status);

            var history = await Ok<List<TicketAssignmentDto>>(await admin.GetAsync($"/api/tickets/{raised.Id}/assignments"));
            Assert.Equal(new[] { AssignmentMethod.Auto, AssignmentMethod.Reassigned, AssignmentMethod.Reassigned }, history.Select(h => h.Method));
            Assert.Equal("I am out tomorrow", history[1].Reason);
            Assert.Equal(holderId, history[1].By!.UserId);
            Assert.Equal(otherUnit.Name, history[2].ToUnitName);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.requester")).GetAsync($"/api/tickets/{raised.Id}/assignments")).StatusCode);
        }

        [Fact]
        public async Task Anyone_can_look_up_colleagues_to_copy_by_name_only()
        {
            var requester = await As("test.requester");

            var found = await Ok<List<JsonElement>>(await requester.GetAsync("/api/people/search?query=caseworker"));
            var tooShort = await requester.GetAsync("/api/people/search?query=a");

            Assert.Contains(found, p => p.GetProperty("userName").GetString() == "test.caseworker1");
            Assert.All(found, p => Assert.False(p.TryGetProperty("email", out _)));
            Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
        }
    }
}