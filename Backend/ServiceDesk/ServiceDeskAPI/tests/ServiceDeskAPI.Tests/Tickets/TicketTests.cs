using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
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
    /// <summary>Step 4: raising, reading, commenting, files, locations and the duplicate check (BRD M2, M4).</summary>
    public class TicketTests : IClassFixture<ServiceDeskApiFactory>
    {
        private static readonly Guid MatchingCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.ContributionMatchingUnitId).Id;
        private static readonly Guid RefundCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.RefundUnitId).Id;
        private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

        private readonly ServiceDeskApiFactory _factory;

        public TicketTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        /// <summary>A new staff member outside Contribution Processing who can sign in.</summary>
        private async Task<string> NewOutsiderAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.out" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Outsider " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return name;
        }

        private static MultipartFormDataContent Form(Guid category, string subject = "Remittance not reflecting", string html = "<p>Please check the <strong>March</strong> remittance.</p>",
            Guid? location = null, IEnumerable<(string Name, byte[] Data)>? files = null, IEnumerable<Guid>? cc = null, Guid? requester = null, int? priority = null)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(category.ToString()), "categoryId" },
                { new StringContent((location ?? TicketSeed.HeadquartersLocationId).ToString()), "locationId" },
                { new StringContent(subject), "subject" },
                { new StringContent(html), "descriptionHtml" }
            };
            if (priority.HasValue) form.Add(new StringContent(priority.Value.ToString()), "priority");
            if (requester.HasValue) form.Add(new StringContent(requester.Value.ToString()), "requesterUserId");
            foreach (var id in cc ?? Array.Empty<Guid>()) form.Add(new StringContent(id.ToString()), "ccUserIds");
            foreach (var (name, data) in files ?? Array.Empty<(string, byte[])>())
            {
                var file = new ByteArrayContent(data);
                file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                form.Add(file, "files", name);
            }
            return form;
        }

        private static async Task<CreatedTicketDto> RaiseAsync(HttpClient client, MultipartFormDataContent form)
        {
            var response = await client.PostAsync("/api/tickets", form);
            Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<CreatedTicketDto>())!;
        }

        private static async Task<string?> FieldError(HttpResponseMessage response, string field)
        {
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("errors").TryGetProperty(field, out var value) ? value.GetString() : null;
        }

        [Fact]
        public async Task A_requester_raises_a_ticket_with_a_file_and_a_colleague_copied()
        {
            var requester = await As("test.requester");
            var copied = await IdOf("test.caseworker2");

            var created = await RaiseAsync(requester, Form(MatchingCategory, files: new[] { ("schedule.pdf", Pdf) }, cc: new[] { copied }));

            Assert.Matches(new Regex(@"^CP-\d{4}-\d{6}$"), created.Reference);
            var ticket = await requester.GetFromJsonAsync<TicketDetailDto>($"/api/tickets/{created.Id}");
            // Step 5: assigned straight away to one of the three Contribution Matching case workers
            Assert.Equal(TicketStatus.Assigned, ticket!.Status);
            Assert.NotNull(ticket.Assignee);
            Assert.Equal(TicketPriority.Medium, ticket.Priority);
            Assert.Equal("Contribution Matching", ticket.UnitName);
            Assert.Equal(TicketSeed.HeadquartersName, ticket.LocationName);
            Assert.Equal("test.requester", ticket.Requester.UserName);
            Assert.Contains("<strong>March</strong>", ticket.DescriptionHtml);
            Assert.Contains(ticket.Cc, p => p.UserId == copied);
            var file = Assert.Single(ticket.Attachments);
            Assert.Equal("schedule.pdf", file.FileName);
            Assert.Equal("application/pdf", file.ContentType);
            Assert.False(ticket.IsStaffView);

            var download = await requester.GetAsync($"/api/tickets/{created.Id}/attachments/{file.Id}");
            Assert.Equal(HttpStatusCode.OK, download.StatusCode);
            Assert.Equal(Pdf, await download.Content.ReadAsByteArrayAsync());
            Assert.Equal("attachment", download.Content.Headers.ContentDisposition!.DispositionType);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var told = await db.InAppNotifications.Where(n => n.RelatedEntityId == created.Id).Select(n => new { n.RecipientUserId, n.Title, n.Message }).ToListAsync();
            Assert.Contains(told, n => n.RecipientUserId == ticket.Requester.UserId && n.Title == "Ticket " + created.Reference + " received");
            Assert.Contains(told, n => n.RecipientUserId == copied && n.Title.StartsWith("You were copied"));
            Assert.Contains(told, n => n.RecipientUserId == ticket.Requester.UserId);
            Assert.Contains(told, n => n.RecipientUserId == ticket.Assignee!.UserId && n.Title == "Ticket " + created.Reference + " assigned to you");
            // Notifications never carry the subject or description
            Assert.DoesNotContain(told, n => n.Message.Contains("Remittance not reflecting") || n.Message.Contains("March"));
        }

        [Fact]
        public async Task References_count_up_per_department_and_year()
        {
            var requester = await As("test.requester");
            var first = await RaiseAsync(requester, Form(RefundCategory));
            var second = await RaiseAsync(requester, Form(MatchingCategory));

            var a = int.Parse(first.Reference.Substring(first.Reference.LastIndexOf('-') + 1));
            var b = int.Parse(second.Reference.Substring(second.Reference.LastIndexOf('-') + 1));
            Assert.Equal(a + 1, b);
            Assert.Equal(first.Reference.Substring(0, 8), second.Reference.Substring(0, 8));
        }

        [Fact]
        public async Task The_description_is_cleaned_before_it_is_stored()
        {
            var requester = await As("test.requester");
            var created = await RaiseAsync(requester, Form(MatchingCategory,
                html: "<p onclick=\"steal()\">See table<script>steal()</script></p><table><tr><td>PIN</td><td>Amount</td></tr></table><img src=x onerror=steal()><a href=\"javascript:steal()\">x</a>"));

            using var scope = _factory.Services.CreateScope();
            var stored = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == created.Id);
            Assert.DoesNotContain("onclick", stored.DescriptionHtml);
            Assert.DoesNotContain("onerror", stored.DescriptionHtml);
            Assert.DoesNotContain("<script", stored.DescriptionHtml);
            Assert.DoesNotContain("<img", stored.DescriptionHtml);
            Assert.DoesNotContain("javascript:", stored.DescriptionHtml);
            Assert.Contains("<td>Amount</td>", stored.DescriptionHtml);
            Assert.Contains("PIN Amount", stored.DescriptionText);
        }

        [Fact]
        public async Task Bad_forms_are_refused_with_the_field_to_blame()
        {
            var requester = await As("test.requester");
            var someoneElse = await IdOf("test.caseworker1");

            var noCategory = await requester.PostAsync("/api/tickets", Form(Guid.Empty));
            var empty = await requester.PostAsync("/api/tickets", Form(MatchingCategory, html: "<p> </p><p><br></p>"));
            var shortSubject = await requester.PostAsync("/api/tickets", Form(MatchingCategory, subject: "Hi"));
            var badLocation = await requester.PostAsync("/api/tickets", Form(MatchingCategory, location: Guid.NewGuid()));
            var sevenFiles = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: Enumerable.Range(1, 7).Select(i => ($"f{i}.pdf", Pdf))));
            var tooBig = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: new[] { ("big.pdf", Pdf.Concat(new byte[1024 * 1024]).ToArray()) }));
            var fakePdf = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: new[] { ("fake.pdf", Encoding.ASCII.GetBytes("not a pdf")) }));
            var exe = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: new[] { ("tool.exe", new byte[] { 0x4D, 0x5A, 0, 0 }) }));
            var forSomeoneElse = await requester.PostAsync("/api/tickets", Form(MatchingCategory, requester: someoneElse));

            Assert.Equal(HttpStatusCode.BadRequest, noCategory.StatusCode);
            Assert.NotNull(await FieldError(noCategory, "categoryId"));
            Assert.NotNull(await FieldError(empty, "descriptionHtml"));
            Assert.NotNull(await FieldError(shortSubject, "subject"));
            Assert.NotNull(await FieldError(badLocation, "locationId"));
            Assert.Contains("6", await FieldError(sevenFiles, "files"));
            Assert.Contains("1 MB", await FieldError(tooBig, "files"));
            Assert.NotNull(await FieldError(fakePdf, "files"));
            Assert.NotNull(await FieldError(exe, "files"));
            Assert.Equal(HttpStatusCode.Forbidden, forSomeoneElse.StatusCode);

            // Six files of up to 1 MB are fine
            var six = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: Enumerable.Range(1, 6).Select(i => ($"f{i}.pdf", Pdf))));
            Assert.Equal(HttpStatusCode.OK, six.StatusCode);
        }

        [Fact]
        public async Task Only_people_on_the_ticket_and_department_staff_can_see_it_and_internal_notes_stay_internal()
        {
            var requester = await As("test.requester");
            var copiedName = await NewOutsiderAsync();
            var created = await RaiseAsync(requester, Form(MatchingCategory, cc: new[] { await IdOf(copiedName) }));
            var outsider = await As(await NewOutsiderAsync());
            var worker = await As("test.caseworker1");

            Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/tickets/{created.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/tickets/by-reference/{created.Reference}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As(copiedName)).GetAsync($"/api/tickets/{created.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.hod")).GetAsync($"/api/tickets/{created.Id}")).StatusCode);

            // An internal note with a file
            var note = new MultipartFormDataContent { { new StringContent("<p>Checked the schedule.</p>"), "bodyHtml" }, { new StringContent("true"), "isInternal" } };
            var noteFile = new ByteArrayContent(Pdf);
            noteFile.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            note.Add(noteFile, "files", "internal.pdf");
            var noteResponse = await worker.PostAsync($"/api/tickets/{created.Id}/comments", note);
            Assert.Equal(HttpStatusCode.OK, noteResponse.StatusCode);
            var added = await noteResponse.Content.ReadFromJsonAsync<TicketCommentDto>();
            var internalFile = Assert.Single(added!.Attachments);

            // A public reply from the requester
            var reply = await requester.PostAsync($"/api/tickets/{created.Id}/comments",
                new MultipartFormDataContent { { new StringContent("<p>Thanks</p>"), "bodyHtml" }, { new StringContent("false"), "isInternal" } });
            Assert.Equal(HttpStatusCode.OK, reply.StatusCode);
            var sneaky = await requester.PostAsync($"/api/tickets/{created.Id}/comments",
                new MultipartFormDataContent { { new StringContent("<p>Let me in</p>"), "bodyHtml" }, { new StringContent("true"), "isInternal" } });
            Assert.Equal(HttpStatusCode.Forbidden, sneaky.StatusCode);

            var staffView = await (await As("test.hou")).GetFromJsonAsync<TicketDetailDto>($"/api/tickets/{created.Id}");
            var requesterView = await requester.GetFromJsonAsync<TicketDetailDto>($"/api/tickets/by-reference/{created.Reference}");
            Assert.True(staffView!.IsStaffView);
            Assert.True(staffView.CanAddInternalNote);
            Assert.Equal(2, staffView.Comments.Count);
            Assert.Single(requesterView!.Comments);
            Assert.False(requesterView.Comments[0].IsInternal);
            Assert.False(requesterView.CanAddInternalNote);
            Assert.Equal(HttpStatusCode.NotFound, (await requester.GetAsync($"/api/tickets/{created.Id}/attachments/{internalFile.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await worker.GetAsync($"/api/tickets/{created.Id}/attachments/{internalFile.Id}")).StatusCode);

            // The requester's reply reached the assignee; the internal note did not reach the requester
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var assignee = staffView.Assignee!.UserId;
            Assert.True(assignee == await IdOf("test.caseworker1")
                || await db.InAppNotifications.AnyAsync(n => n.RelatedEntityId == created.Id && n.RecipientUserId == assignee && n.Title == "New comment on " + created.Reference));
            Assert.False(await db.InAppNotifications.AnyAsync(n => n.RelatedEntityId == created.Id && n.RecipientUserId == requesterView.Requester.UserId && n.Title.StartsWith("Internal note")));
        }

        [Fact]
        public async Task Lists_show_my_copied_and_department_tickets()
        {
            var requester = await As("test.requester");
            var copiedName = await NewOutsiderAsync();
            var created = await RaiseAsync(requester, Form(RefundCategory, subject: "Refund list check", cc: new[] { await IdOf(copiedName) }));

            var mine = await requester.GetFromJsonAsync<TicketPageDto>("/api/tickets?view=mine&search=Refund%20list");
            var copied = await (await As(copiedName)).GetFromJsonAsync<TicketPageDto>("/api/tickets?view=copied");
            var refundQueue = await (await As("test.caseworker2")).GetFromJsonAsync<TicketPageDto>($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}&unitId={OrgSeed.RefundUnitId}&status=2");
            var matchingQueue = await (await As("test.hod")).GetFromJsonAsync<TicketPageDto>($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}&unitId={OrgSeed.ContributionMatchingUnitId}");
            var refused = await requester.GetAsync($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}");

            Assert.Contains(mine!.Items, t => t.Id == created.Id);
            Assert.Contains(copied!.Items, t => t.Id == created.Id);
            Assert.Contains(refundQueue!.Items, t => t.Id == created.Id);
            Assert.DoesNotContain(matchingQueue!.Items, t => t.Id == created.Id);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        }

        [Fact]
        public async Task A_Super_Admin_raises_a_ticket_for_someone_else()
        {
            var admin = await As("test.superadmin");
            var requesterId = await IdOf("test.requester");

            var created = await RaiseAsync(admin, Form(MatchingCategory, requester: requesterId, priority: 3));

            var ticket = await (await As("test.requester")).GetFromJsonAsync<TicketDetailDto>($"/api/tickets/{created.Id}");
            Assert.Equal(requesterId, ticket!.Requester.UserId);
            Assert.Equal("test.superadmin", ticket.RaisedBy.UserName);
            Assert.Equal(TicketPriority.High, ticket.Priority);
        }

        [Fact]
        public async Task Location_is_preselected_from_the_last_ticket_and_kept_by_the_Super_Admin()
        {
            var admin = await As("test.superadmin");
            var newcomerName = await NewOutsiderAsync();
            var newcomer = await As(newcomerName);

            var branch = await admin.PostAsJsonAsync("/api/admin/locations", new { name = "Branch " + Guid.NewGuid().ToString("N").Substring(0, 5) });
            Assert.Equal(HttpStatusCode.OK, branch.StatusCode);
            var branchId = (await branch.Content.ReadFromJsonAsync<LocationDto>())!.Id;

            var before = await newcomer.GetFromJsonAsync<LocationChoicesDto>("/api/locations");
            Assert.True(before!.Locations.Count >= 2);
            Assert.Null(before.DefaultLocationId);

            await RaiseAsync(newcomer, Form(MatchingCategory, location: branchId));
            var after = await newcomer.GetFromJsonAsync<LocationChoicesDto>("/api/locations");
            Assert.Equal(branchId, after!.DefaultLocationId);

            Assert.Equal(HttpStatusCode.Forbidden, (await newcomer.GetAsync($"/api/locations?forUserId={await IdOf("test.requester")}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await newcomer.PostAsJsonAsync("/api/admin/locations", new { name = "Mine" })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/admin/locations/{branchId}", new { isActive = false })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"/api/admin/locations/{TicketSeed.HeadquartersLocationId}", new { isActive = false })).StatusCode);
            var afterOff = await newcomer.GetFromJsonAsync<LocationChoicesDto>("/api/locations");
            Assert.Equal(TicketSeed.HeadquartersLocationId, afterOff!.DefaultLocationId);
        }

        [Fact]
        public async Task The_duplicate_check_finds_open_tickets_with_the_same_PIN_in_the_same_category()
        {
            var requester = await As("test.requester");
            var pin = "PEN" + Random.Shared.NextInt64(100000000000, 999999999999);
            await RaiseAsync(requester, Form(MatchingCategory, html: $"<p>Member {pin} has a missing remittance.</p>"));

            var same = await requester.PostAsJsonAsync("/api/tickets/duplicate-check", new { categoryId = MatchingCategory, subject = "Again for " + pin.ToLowerInvariant() });
            var other = await requester.PostAsJsonAsync("/api/tickets/duplicate-check", new { categoryId = RefundCategory, descriptionHtml = $"<p>{pin}</p>" });
            var none = await requester.PostAsJsonAsync("/api/tickets/duplicate-check", new { categoryId = MatchingCategory, subject = "No PIN here" });

            var sameResult = await same.Content.ReadFromJsonAsync<DuplicateCheckDto>();
            var match = Assert.Single(sameResult!.Matches);
            Assert.True(match.IsYours);
            Assert.Equal("PEN********" + pin.Substring(pin.Length - 4), Assert.Single(sameResult.PinsFound));
            Assert.Empty((await other.Content.ReadFromJsonAsync<DuplicateCheckDto>())!.Matches);
            Assert.Empty((await none.Content.ReadFromJsonAsync<DuplicateCheckDto>())!.PinsFound);
        }
    }
}