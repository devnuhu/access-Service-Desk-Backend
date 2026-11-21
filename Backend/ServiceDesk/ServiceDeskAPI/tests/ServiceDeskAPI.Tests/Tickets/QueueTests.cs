using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The API for these tests with the background assignment worker switched off, so a ticket put back in the pool stays there.</summary>
    public class QueueFactory : ServiceDeskApiFactory
    {
        protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> { ["Assignment:WorkerEnabled"] = "false" }));
        }
    }

    /// <summary>Saved views, bulk actions and the unread/reply markers on the ticket list.</summary>
    public class QueueTests : IClassFixture<QueueFactory>
    {
        private readonly QueueFactory _factory;

        public QueueTests(QueueFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid HeadId, string HeadName, List<(Guid Id, string Name)> Members, Guid CategoryId);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private static Task<HttpResponseMessage> Patch(HttpClient client, string url, object body) =>
            client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, url) { Content = JsonContent.Create(body) });

        private async Task<(Guid Id, string Name)> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.qu" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A department of its own: a head, two members, one category, both members mapped to it.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "Q" + tag, name = "Queue Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Queue Unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var people = new List<(Guid Id, string Name)>();
            for (var i = 0; i < 2; i++)
            {
                var person = await NewUserAsync();
                await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = person.Id }));
                people.Add(person);
            }
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Queue category " + tag, timelineHours = 24, defaultPriority = 2 }));
            foreach (var person in people)
                await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{person.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(unit.Id, head.Id, head.Name, people, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Queue test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        /// <summary>A raised ticket is auto-assigned; put it back in the pool (New, nobody).</summary>
        private async Task<CreatedTicketDto> RaiseIntoPoolAsync(Guid categoryId)
        {
            var raised = await RaiseAsync(categoryId);
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.Tickets.SingleAsync(t => t.Id == raised.Id);
            row.Status = TicketStatus.New;
            row.AssigneeUserId = null;
            row.AssignedAt = null;
            await db.SaveChangesAsync();
            return raised;
        }

        private static async Task Comment(HttpClient client, Guid ticketId, string html, bool isInternal)
        {
            var form = new MultipartFormDataContent { { new StringContent(html), "bodyHtml" }, { new StringContent(isInternal ? "true" : "false"), "isInternal" } };
            await Ok<TicketCommentDto>(await client.PostAsync($"/api/tickets/{ticketId}/comments", form));
        }

        private static async Task<TicketListItemDto> Row(HttpClient client, string query, Guid ticketId)
        {
            var page = await Ok<TicketPageDto>(await client.GetAsync("/api/tickets?" + query + "&pageSize=100"));
            return page.Items.Single(i => i.Id == ticketId);
        }

        [Fact]
        public async Task Saved_views_are_personal_validated_and_ordered_with_favourites_first()
        {
            var me = await As("test.requester");
            var other = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 6);

            var plain = await Ok<SavedViewDto>(await me.PostAsJsonAsync("/api/views", new { name = "Plain " + tag, filterJson = "{\"view\":\"assigned\",\"open\":true}" }));
            Assert.False(plain.IsFavourite);
            var starred = await Ok<SavedViewDto>(await me.PostAsJsonAsync("/api/views", new { name = "Starred " + tag, filterJson = "{\"view\":\"mine\"}", isFavourite = true }));

            var list = (await Ok<List<SavedViewDto>>(await me.GetAsync("/api/views"))).Where(v => v.Name.EndsWith(tag)).ToList();
            Assert.Equal(new[] { starred.Id, plain.Id }, list.Select(v => v.Id).ToArray());

            Assert.Equal(HttpStatusCode.BadRequest, (await me.PostAsJsonAsync("/api/views", new { name = "Bad " + tag, filterJson = "not json" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await me.PostAsJsonAsync("/api/views", new { name = "Array " + tag, filterJson = "[1]" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await me.PostAsJsonAsync("/api/views", new { name = "x", filterJson = "{}" })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await me.PostAsJsonAsync("/api/views", new { name = "Plain " + tag, filterJson = "{}" })).StatusCode);

            var renamed = await Ok<SavedViewDto>(await Patch(me, $"/api/views/{plain.Id}", new { name = "Renamed " + tag, isFavourite = true }));
            Assert.Equal("Renamed " + tag, renamed.Name);
            Assert.True(renamed.IsFavourite);
            Assert.Equal(HttpStatusCode.BadRequest, (await Patch(me, $"/api/views/{plain.Id}", new { })).StatusCode);

            // Nobody else sees or touches them
            var theirs = await Ok<List<SavedViewDto>>(await other.GetAsync("/api/views"));
            Assert.DoesNotContain(theirs, v => v.Id == plain.Id || v.Id == starred.Id);
            Assert.Equal(HttpStatusCode.NotFound, (await Patch(other, $"/api/views/{plain.Id}", new { name = "Stolen" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await other.DeleteAsync($"/api/views/{plain.Id}")).StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await me.DeleteAsync($"/api/views/{plain.Id}")).StatusCode);
            Assert.DoesNotContain(await Ok<List<SavedViewDto>>(await me.GetAsync("/api/views")), v => v.Id == plain.Id);
        }

        [Fact]
        public async Task The_list_marks_unread_tickets_comments_and_the_requesters_last_word_and_hides_internal_notes_from_the_requester()
        {
            var lab = await NewLabAsync();
            var admin = await As("test.superadmin");
            var requester = await As("test.requester");
            var ticket = await RaiseAsync(lab.CategoryId);
            var detail = await Ok<TicketDetailDto>(await admin.GetAsync($"/api/tickets/{ticket.Id}"));
            Assert.NotNull(detail.Assignee);
            var assignee = await As(detail.Assignee!.UserName);
            const string mine = "view=assigned&open=true";

            // Newly assigned and never opened: unread
            var first = await Row(assignee, mine, ticket.Id);
            Assert.True(first.Unread);
            Assert.Equal(0, first.CommentCount);

            Assert.Equal(HttpStatusCode.OK, (await assignee.PostAsync($"/api/tickets/{ticket.Id}/read", null)).StatusCode);
            Assert.False((await Row(assignee, mine, ticket.Id)).Unread);

            // The requester writes: unread again, and the last word is theirs
            await Comment(requester, ticket.Id, "<p>Any update?</p>", false);
            var afterReply = await Row(assignee, mine, ticket.Id);
            Assert.True(afterReply.Unread);
            Assert.Equal(1, afterReply.CommentCount);
            Assert.True(afterReply.LastCommentByRequester);
            Assert.NotNull(afterReply.LastCommentAt);

            await assignee.PostAsync($"/api/tickets/{ticket.Id}/read", null);
            Assert.False((await Row(assignee, mine, ticket.Id)).Unread);

            // The assignee's own internal note never makes it unread for them, counts for staff, and is invisible to the requester
            await Comment(assignee, ticket.Id, "<p>Checking with finance.</p>", true);
            var afterNote = await Row(assignee, mine, ticket.Id);
            Assert.False(afterNote.Unread);
            Assert.Equal(2, afterNote.CommentCount);
            var theirRow = await Row(requester, "view=mine", ticket.Id);
            Assert.Equal(1, theirRow.CommentCount);
            Assert.False(theirRow.Unread);

            // Someone outside cannot mark a ticket they cannot see
            var outsider = await As((await NewUserAsync()).Name);
            Assert.Equal(HttpStatusCode.NotFound, (await outsider.PostAsync($"/api/tickets/{ticket.Id}/read", null)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await assignee.PostAsync($"/api/tickets/{Guid.NewGuid()}/read", null)).StatusCode);
        }

        [Fact]
        public async Task Bulk_actions_run_each_ticket_on_its_own_rules_and_report_every_result()
        {
            var lab = await NewLabAsync();
            var a = await RaiseIntoPoolAsync(lab.CategoryId);
            var b = await RaiseIntoPoolAsync(lab.CategoryId);
            var c = await RaiseIntoPoolAsync(lab.CategoryId);
            var m0 = await As(lab.Members[0].Name);
            var m1 = await As(lab.Members[1].Name);
            var head = await As(lab.HeadName);
            var missing = Guid.NewGuid();

            // m0 picks a and b; the third id does not exist
            var first = await Ok<BulkResultDto>(await m0.PostAsJsonAsync("/api/tickets/bulk/pick", new { ticketIds = new[] { a.Id, b.Id, missing } }));
            Assert.Equal(3, first.Total);
            Assert.Equal(2, first.Succeeded);
            Assert.Equal(1, first.Failed);
            var gone = first.Items.Single(i => i.TicketId == missing);
            Assert.False(gone.Ok);
            Assert.Equal(404, gone.Status);
            Assert.Null(gone.Reference);

            // m1 tries a (already taken) and c (free)
            var second = await Ok<BulkResultDto>(await m1.PostAsJsonAsync("/api/tickets/bulk/pick", new { ticketIds = new[] { a.Id, c.Id } }));
            Assert.Equal(1, second.Succeeded);
            Assert.Equal(409, second.Items.Single(i => i.TicketId == a.Id).Status);
            Assert.True(second.Items.Single(i => i.TicketId == c.Id).Ok);

            // m0 starts work on both of theirs
            var ack = await Ok<BulkResultDto>(await m0.PostAsJsonAsync("/api/tickets/bulk/acknowledge", new { ticketIds = new[] { a.Id, b.Id } }));
            Assert.Equal(2, ack.Succeeded);

            // m0 resolves a, and c which belongs to m1: only a works
            var resolved = await Ok<BulkResultDto>(await m0.PostAsJsonAsync("/api/tickets/bulk/resolve",
                new { ticketIds = new[] { a.Id, c.Id }, code = 1, note = "Sorted out for the whole batch." }));
            Assert.Equal(1, resolved.Succeeded);
            Assert.True(resolved.Items.Single(i => i.TicketId == a.Id).Ok);
            Assert.False(resolved.Items.Single(i => i.TicketId == c.Id).Ok);

            // The head moves b to the other member
            var moved = await Ok<BulkResultDto>(await head.PostAsJsonAsync("/api/tickets/bulk/reassign",
                new { ticketIds = new[] { b.Id }, toUserId = lab.Members[1].Id, reason = "Rebalancing the team workload" }));
            Assert.Equal(1, moved.Succeeded);

            // Someone outside the unit gets a 404 for every ticket and changes nothing
            var outsider = await As((await NewUserAsync()).Name);
            var refused = await Ok<BulkResultDto>(await outsider.PostAsJsonAsync("/api/tickets/bulk/acknowledge", new { ticketIds = new[] { b.Id, c.Id } }));
            Assert.Equal(0, refused.Succeeded);
            Assert.All(refused.Items, i => { Assert.Equal(404, i.Status); Assert.Null(i.Reference); });

            // The list itself must be 1 to 50 tickets
            Assert.Equal(HttpStatusCode.BadRequest, (await m0.PostAsJsonAsync("/api/tickets/bulk/pick", new { ticketIds = Array.Empty<Guid>() })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await m0.PostAsJsonAsync("/api/tickets/bulk/pick", new { ticketIds = Enumerable.Range(0, 51).Select(_ => Guid.NewGuid()).ToArray() })).StatusCode);
        }
    }
}