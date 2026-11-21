using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Canned replies: kept per unit by its head, shared ones by the Super Admin, filled in for the ticket for its staff only.</summary>
    public class CannedReplyTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public CannedReplyTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, Guid HeadId, string HeadName, List<(Guid Id, string Name)> Members, Guid CategoryId, string Tag);

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
            var name = "test.cr" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A department of its own: a head, two members, one category.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "R" + tag, name = "Reply Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Reply Unit " + tag }));
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
                new { unitId = unit.Id, name = "Reply category " + tag, timelineHours = 24, defaultPriority = 2 }));
            foreach (var person in people)
                await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{person.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(unit.Id, head.Id, head.Name, people, category.Id, tag);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Reply test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private static Task<HttpResponseMessage> Patch(HttpClient client, string url, object body) =>
            client.SendAsync(new HttpRequestMessage(HttpMethod.Patch, url) { Content = JsonContent.Create(body) });

        [Fact]
        public async Task The_head_writes_replies_and_unit_staff_get_them_filled_in_but_outsiders_do_not()
        {
            var lab = await NewLabAsync();
            var head = await As(lab.HeadName);
            var admin = await As("test.superadmin");

            var own = await Ok<CannedReplyDto>(await head.PostAsJsonAsync($"/api/units/{lab.UnitId}/canned-replies",
                new { title = "Received " + lab.Tag, bodyHtml = "<p>Dear {{requester.name}}, we have received {{ticket.reference}} in {{unit.name}}.</p>" }));
            Assert.False(own.IsShared);
            var shared = await Ok<CannedReplyDto>(await admin.PostAsJsonAsync("/api/admin/canned-replies",
                new { title = "Thanks " + lab.Tag, bodyHtml = "<p>Thank you. {{ agent.name }}</p>" }));
            Assert.True(shared.IsShared);

            var ticket = await RaiseAsync(lab.CategoryId);
            var member = await As(lab.Members[0].Name);
            var list = await Ok<List<TicketCannedReplyDto>>(await member.GetAsync($"/api/tickets/{ticket.Id}/canned-replies"));

            var mine = list.Single(r => r.Id == own.Id);
            Assert.Contains(ticket.Reference, mine.BodyHtml);
            Assert.Contains("Reply Unit " + lab.Tag, mine.BodyHtml);
            Assert.DoesNotContain("{{", mine.BodyHtml);
            var thanks = list.Single(r => r.Id == shared.Id);
            Assert.True(thanks.IsShared);
            Assert.Contains("Person " + lab.Members[0].Name, thanks.BodyHtml);

            // The head and Super Admin read them too; someone outside the unit, and the requester, do not even see the ticket
            Assert.Equal(HttpStatusCode.OK, (await head.GetAsync($"/api/tickets/{ticket.Id}/canned-replies")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/tickets/{ticket.Id}/canned-replies")).StatusCode);
            var outsider = await As((await NewUserAsync()).Name);
            Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/tickets/{ticket.Id}/canned-replies")).StatusCode);
            var requester = await As("test.requester");
            Assert.Equal(HttpStatusCode.NotFound, (await requester.GetAsync($"/api/tickets/{ticket.Id}/canned-replies")).StatusCode);

            // A reply of this unit is not offered on another unit's ticket
            var other = await NewLabAsync();
            var otherTicket = await RaiseAsync(other.CategoryId);
            var otherHead = await As(other.HeadName);
            var otherList = await Ok<List<TicketCannedReplyDto>>(await otherHead.GetAsync($"/api/tickets/{otherTicket.Id}/canned-replies"));
            Assert.DoesNotContain(otherList, r => r.Id == own.Id);
            Assert.Contains(otherList, r => r.Id == shared.Id);

            var placeholders = await Ok<List<CannedPlaceholderDto>>(await member.GetAsync("/api/canned-replies/placeholders"));
            Assert.Contains(placeholders, p => p.Token == "{{requester.name}}");
        }

        [Fact]
        public async Task Only_those_who_keep_the_library_can_change_it()
        {
            var lab = await NewLabAsync();
            var head = await As(lab.HeadName);
            var member = await As(lab.Members[0].Name);
            var other = await NewLabAsync();
            var otherHead = await As(other.HeadName);
            var admin = await As("test.superadmin");

            var reply = await Ok<CannedReplyDto>(await head.PostAsJsonAsync($"/api/units/{lab.UnitId}/canned-replies",
                new { title = "Keep " + lab.Tag, bodyHtml = "<p>Hello.</p>" }));
            var shared = await Ok<CannedReplyDto>(await admin.PostAsJsonAsync("/api/admin/canned-replies",
                new { title = "Shared " + lab.Tag, bodyHtml = "<p>All units.</p>" }));

            // A member and another unit's head can neither read the library nor change it
            Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync($"/api/units/{lab.UnitId}/canned-replies")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.PostAsJsonAsync($"/api/units/{lab.UnitId}/canned-replies", new { title = "Nope", bodyHtml = "<p>x</p>" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await Patch(otherHead, $"/api/canned-replies/{reply.Id}", new { title = "Stolen" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await otherHead.DeleteAsync($"/api/canned-replies/{reply.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await head.GetAsync($"/api/units/{Guid.NewGuid()}/canned-replies")).StatusCode);

            // The head cannot touch a shared reply or the shared library
            Assert.Equal(HttpStatusCode.Forbidden, (await Patch(head, $"/api/canned-replies/{shared.Id}", new { title = "Mine now" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await head.DeleteAsync($"/api/canned-replies/{shared.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await head.GetAsync("/api/admin/canned-replies")).StatusCode);

            // The head edits and removes their own; the Super Admin removes the shared one
            var edited = await Ok<CannedReplyDto>(await Patch(head, $"/api/canned-replies/{reply.Id}", new { title = "Kept " + lab.Tag, bodyHtml = "<p>Changed.</p>" }));
            Assert.Equal("Kept " + lab.Tag, edited.Title);
            Assert.Contains("Changed.", edited.BodyHtml);
            var library = await Ok<List<CannedReplyDto>>(await head.GetAsync($"/api/units/{lab.UnitId}/canned-replies"));
            Assert.Contains(library, r => r.Id == reply.Id && r.Title == "Kept " + lab.Tag);
            Assert.Equal(HttpStatusCode.OK, (await head.DeleteAsync($"/api/canned-replies/{reply.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await head.DeleteAsync($"/api/canned-replies/{reply.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/canned-replies/{shared.Id}")).StatusCode);
        }

        [Fact]
        public async Task Bad_input_duplicates_unknown_placeholders_and_scripts_are_handled()
        {
            var lab = await NewLabAsync();
            var head = await As(lab.HeadName);
            var url = $"/api/units/{lab.UnitId}/canned-replies";

            Assert.Equal(HttpStatusCode.BadRequest, (await head.PostAsJsonAsync(url, new { title = "x", bodyHtml = "<p>Hi</p>" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await head.PostAsJsonAsync(url, new { title = "Empty", bodyHtml = "<p> </p>" })).StatusCode);
            var unknown = await head.PostAsJsonAsync(url, new { title = "Unknown", bodyHtml = "<p>Hi {{requester.nmae}}</p>" });
            Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
            Assert.Contains("requester.nmae", await unknown.Content.ReadAsStringAsync());

            var created = await Ok<CannedReplyDto>(await head.PostAsJsonAsync(url, new { title = "Safe", bodyHtml = "<p>Hi</p><script>alert(1)</script>" }));
            Assert.DoesNotContain("<script", created.BodyHtml, StringComparison.OrdinalIgnoreCase);

            Assert.Equal(HttpStatusCode.Conflict, (await head.PostAsJsonAsync(url, new { title = "Safe", bodyHtml = "<p>Again</p>" })).StatusCode);
            var second = await Ok<CannedReplyDto>(await head.PostAsJsonAsync(url, new { title = "Second", bodyHtml = "<p>Two</p>" }));
            Assert.Equal(HttpStatusCode.Conflict, (await Patch(head, $"/api/canned-replies/{second.Id}", new { title = "Safe" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await Patch(head, $"/api/canned-replies/{second.Id}", new { })).StatusCode);
        }
    }
}