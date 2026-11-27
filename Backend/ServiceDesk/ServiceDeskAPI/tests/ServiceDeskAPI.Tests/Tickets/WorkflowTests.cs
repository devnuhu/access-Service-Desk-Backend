using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 6: acknowledge, pending and resume, resolve, confirm, reopen, cancel; plus the list and form changes.</summary>
    public class WorkflowTests : IClassFixture<ServiceDeskApiFactory>
    {
        private static readonly Guid MatchingCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.ContributionMatchingUnitId).Id;

        private readonly ServiceDeskApiFactory _factory;

        public WorkflowTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        private static MultipartFormDataContent Form(Guid category, string subject = "Workflow test", string html = "<p>Please help with this.</p>") => new()
        {
            { new StringContent(category.ToString()), "categoryId" },
            { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
            { new StringContent(subject), "subject" },
            { new StringContent(html), "descriptionHtml" }
        };

        /// <summary>Raises a ticket as test.requester and returns it with a client signed in as its assignee.</summary>
        private async Task<(CreatedTicketDto Ticket, HttpClient Assignee, Guid AssigneeId)> RaiseAsync()
        {
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", Form(MatchingCategory)));
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var assigneeId = await db.Tickets.Where(t => t.Id == created.Id).Select(t => t.AssigneeUserId!.Value).SingleAsync();
            var name = await db.Users.Where(u => u.Id == assigneeId).Select(u => u.UserName!).SingleAsync();
            return (created, await As(name), assigneeId);
        }

        private async Task<Ticket> TicketAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        private async Task<bool> NotifiedAsync(Guid userId, Guid ticketId, string title)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().InAppNotifications
                .AnyAsync(n => n.RecipientUserId == userId && n.RelatedEntityId == ticketId && n.Title == title);
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        private static string Url(Guid id, string action) => $"/api/tickets/{id}/{action}";

        [Fact]
        public async Task A_ticket_goes_from_assigned_to_closed_and_every_step_is_recorded()
        {
            var requester = await As("test.requester");
            var requesterId = await IdOf("test.requester");
            var (ticket, assignee, assigneeId) = await RaiseAsync();

            var actions = await Ok<TicketActionsDto>(await assignee.GetAsync(Url(ticket.Id, "actions")));
            Assert.True(actions.CanAcknowledge);
            Assert.False(actions.CanResolve);
            Assert.Equal(6, actions.ResolutionCodes.Count);
            Assert.True((await Ok<TicketActionsDto>(await requester.GetAsync(Url(ticket.Id, "actions")))).CanCancel);

            await Ok<MessageDto>(await assignee.PostAsync(Url(ticket.Id, "acknowledge"), null));
            Assert.Equal(TicketStatus.InProgress, (await TicketAsync(ticket.Id)).Status);
            Assert.False(await NotifiedAsync(requesterId, ticket.Id, "Ticket " + ticket.Reference + " in progress"));

            await Ok<MessageDto>(await assignee.PostAsJsonAsync(Url(ticket.Id, "pending"), new { reason = 1, note = "Please send the employer's schedule for March." }));
            var pending = await TicketAsync(ticket.Id);
            Assert.Equal(TicketStatus.Pending, pending.Status);
            Assert.Equal(PendingReason.Requester, pending.PendingReason);
            Assert.True(await NotifiedAsync(requesterId, ticket.Id, "Ticket " + ticket.Reference + " needs your reply"));

            // The requester's public reply resumes it
            var reply = new MultipartFormDataContent { { new StringContent("<p>Schedule attached as asked.</p>"), "bodyHtml" }, { new StringContent("false"), "isInternal" } };
            await Ok<TicketCommentDto>(await requester.PostAsync($"/api/tickets/{ticket.Id}/comments", reply));
            Assert.Equal(TicketStatus.InProgress, (await TicketAsync(ticket.Id)).Status);
            Assert.True(await NotifiedAsync(assigneeId, ticket.Id, "Ticket " + ticket.Reference + " resumed"));

            await Ok<MessageDto>(await assignee.PostAsJsonAsync(Url(ticket.Id, "resolve"), new { code = 1, note = "Matched the March remittance to the member's account." }));
            var requesterActions = await Ok<TicketActionsDto>(await requester.GetAsync(Url(ticket.Id, "actions")));
            Assert.True(requesterActions.CanConfirm);
            Assert.True(requesterActions.CanReopen);
            Assert.False(requesterActions.CanCancel);
            Assert.True(await NotifiedAsync(requesterId, ticket.Id, "Ticket " + ticket.Reference + " resolved"));

            await Ok<MessageDto>(await requester.PostAsync(Url(ticket.Id, "confirm"), null));
            var detail = await Ok<TicketDetailDto>(await requester.GetAsync($"/api/tickets/{ticket.Id}"));
            Assert.Equal(TicketStatus.Closed, detail.Status);
            Assert.Equal(ResolutionCode.Completed, detail.ResolutionCode);
            Assert.NotNull(detail.AcknowledgedAt);
            Assert.NotNull(detail.AssignedAt);
            Assert.NotNull(detail.ClosedAt);
            Assert.False(detail.CanComment);
            Assert.Contains(detail.Comments, c => c.BodyHtml.Contains("Waiting on you"));
            Assert.Contains(detail.Comments, c => c.BodyHtml.Contains("Resolved: Completed"));

            using var scope = _factory.Services.CreateScope();
            var changes = await scope.ServiceProvider.GetRequiredService<AppDbContext>().TicketStatusChanges.AsNoTracking()
                .Where(c => c.TicketId == ticket.Id).OrderBy(c => c.At).Select(c => c.ToStatus).ToListAsync();
            Assert.Equal(new[] { TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.InProgress, TicketStatus.Resolved, TicketStatus.Closed }, changes);
        }

        [Fact]
        public async Task The_wrong_person_gets_403_the_wrong_status_400_and_every_bad_field_is_named()
        {
            var requester = await As("test.requester");
            var (ticket, assignee, _) = await RaiseAsync();

            Assert.Equal(HttpStatusCode.Forbidden, (await requester.PostAsync(Url(ticket.Id, "acknowledge"), null)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await assignee.PostAsJsonAsync(Url(ticket.Id, "resolve"), new { code = 1, note = "Too early to resolve this." })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await assignee.PostAsync(Url(ticket.Id, "confirm"), null)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await (await As("test.hou2")).GetAsync(Url(Guid.NewGuid(), "actions"))).StatusCode);

            var bad = await assignee.PostAsJsonAsync(Url(ticket.Id, "pending"), new { reason = 9, note = "" });
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            var errors = (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
            Assert.True(errors.TryGetProperty("reason", out _));
            Assert.True(errors.TryGetProperty("note", out _));

            // Raising: every wrong field at once
            var form = await requester.PostAsync("/api/tickets", Form(Guid.Empty, subject: "Hi", html: "<p></p>"));
            var formErrors = (await form.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
            Assert.True(formErrors.TryGetProperty("categoryId", out _));
            Assert.True(formErrors.TryGetProperty("subject", out _));
            Assert.True(formErrors.TryGetProperty("descriptionHtml", out _));
        }

        [Fact]
        public async Task Reopening_goes_back_to_the_same_case_worker_or_through_the_engine_if_they_are_away()
        {
            var requester = await As("test.requester");
            var admin = await As("test.superadmin");

            // Same case worker
            var (first, assignee, assigneeId) = await RaiseAsync();
            await Ok<MessageDto>(await assignee.PostAsync(Url(first.Id, "acknowledge"), null));
            await Ok<MessageDto>(await assignee.PostAsJsonAsync(Url(first.Id, "resolve"), new { code = 2, note = "The balance is shown in the statement." }));
            Assert.Equal(HttpStatusCode.BadRequest, (await requester.PostAsJsonAsync(Url(first.Id, "reopen"), new { reason = "" })).StatusCode);
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(first.Id, "reopen"), new { reason = "The statement does not show March." }));
            var reopened = await TicketAsync(first.Id);
            Assert.Equal(TicketStatus.Reopened, reopened.Status);
            Assert.Equal(assigneeId, reopened.AssigneeUserId);
            Assert.Equal(1, reopened.ReopenCount);
            Assert.Null(reopened.ResolutionCode);
            Assert.True(await NotifiedAsync(assigneeId, first.Id, "Ticket " + first.Reference + " reopened"));
            await Ok<MessageDto>(await assignee.PostAsync(Url(first.Id, "acknowledge"), null));
            Assert.Equal(TicketStatus.InProgress, (await TicketAsync(first.Id)).Status);

            // The case worker is away when it is reopened
            var (second, secondAssignee, awayId) = await RaiseAsync();
            await Ok<MessageDto>(await secondAssignee.PostAsync(Url(second.Id, "acknowledge"), null));
            await Ok<MessageDto>(await secondAssignee.PostAsJsonAsync(Url(second.Id, "resolve"), new { code = 1, note = "Done and confirmed with the employer." }));
            DateOnly today;
            using (var scope = _factory.Services.CreateScope()) today = scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
            await Ok<AbsenceDto>(await admin.PostAsJsonAsync("/api/availability/absences", new { userId = awayId, kind = 1, startDate = today, endDate = today }));
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(second.Id, "reopen"), new { reason = "Still not reflecting on my side." }));
            var moved = await TicketAsync(second.Id);
            Assert.Equal(TicketStatus.Reopened, moved.Status);
            Assert.NotEqual(awayId, moved.AssigneeUserId);
            Assert.NotNull(moved.AssigneeUserId);
        }

        [Fact]
        public async Task The_requester_cancels_before_work_starts_and_a_Super_Admin_any_time()
        {
            var requester = await As("test.requester");
            var (early, _, earlyAssignee) = await RaiseAsync();
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(early.Id, "cancel"), new { reason = "Raised by mistake" }));
            Assert.Equal(TicketStatus.Cancelled, (await TicketAsync(early.Id)).Status);
            Assert.True(await NotifiedAsync(earlyAssignee, early.Id, "Ticket " + early.Reference + " cancelled"));

            var (late, assignee, _) = await RaiseAsync();
            await Ok<MessageDto>(await assignee.PostAsync(Url(late.Id, "acknowledge"), null));
            Assert.Equal(HttpStatusCode.BadRequest, (await requester.PostAsJsonAsync(Url(late.Id, "cancel"), new { reason = "Changed my mind" })).StatusCode);
            await Ok<MessageDto>(await (await As("test.superadmin")).PostAsJsonAsync(Url(late.Id, "cancel"), new { reason = "Duplicate of another request" }));
            Assert.Equal(TicketStatus.Cancelled, (await TicketAsync(late.Id)).Status);
        }

        [Fact]
        public async Task Lists_filter_open_tickets_and_narrow_every_view()
        {
            var requester = await As("test.requester");
            var (open, assignee, _) = await RaiseAsync();
            var (closed, _, _) = await RaiseAsync();
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(closed.Id, "cancel"), new { reason = "Not needed" }));

            var mineOpen = await Ok<TicketPageDto>(await requester.GetAsync("/api/tickets?view=mine&open=true&pageSize=100"));
            Assert.Contains(mineOpen.Items, t => t.Id == open.Id);
            Assert.DoesNotContain(mineOpen.Items, t => t.Id == closed.Id);
            Assert.All(mineOpen.Items, t => Assert.NotEqual(TicketStatus.Cancelled, t.Status));
            Assert.NotNull(mineOpen.Items.Single(t => t.Id == open.Id).AssignedAt);

            var assignedHere = await Ok<TicketPageDto>(await assignee.GetAsync($"/api/tickets?view=assigned&departmentId={OrgSeed.ContributionProcessingId}&open=true"));
            var assignedElsewhere = await Ok<TicketPageDto>(await assignee.GetAsync($"/api/tickets?view=assigned&departmentId={Guid.NewGuid()}"));
            Assert.Contains(assignedHere.Items, t => t.Id == open.Id);
            Assert.Empty(assignedElsewhere.Items);
        }

        [Fact]
        public async Task People_see_their_own_categories_and_are_left_out_of_their_own_search()
        {
            var worker = await As("test.caseworker1");

            var mine = await Ok<List<MyCategoriesDto>>(await worker.GetAsync("/api/catalogue/mine"));
            var none = await Ok<List<MyCategoriesDto>>(await (await As("test.requester")).GetAsync("/api/catalogue/mine"));
            var search = await Ok<List<PersonSearchResultDto>>(await worker.GetAsync("/api/people/search?query=caseworker"));

            var unit = Assert.Single(mine);
            Assert.Equal(OrgSeed.ContributionMatchingUnitId, unit.UnitId);
            Assert.True(unit.Categories.Count >= 15);
            Assert.Empty(none);
            Assert.DoesNotContain(search, p => p.UserName == "test.caseworker1");
            Assert.Contains(search, p => p.UserName == "test.caseworker2");
        }
    }
}