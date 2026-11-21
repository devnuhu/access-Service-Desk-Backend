using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
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
    /// <summary>Linking tickets and merging a duplicate into a primary ticket: staff only, same unit, both open, nothing deleted.</summary>
    public class TicketLinkTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketLinkTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, string MemberName, Guid CategoryId);

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
            var name = "test.tl" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A department of its own with one unit, one member and one category. Nobody is mapped to the category, so its tickets stay New.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "L" + tag, name = "Link Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Link Unit " + tag }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Link category " + tag, timelineHours = 24, defaultPriority = 2 }));
            return new Lab(unit.Id, member.Name, category.Id);
        }

        private async Task<TicketDetailDto> RaiseAsync(Guid categoryId, string requester = "test.requester")
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Link test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var created = await Ok<CreatedTicketDto>(await (await As(requester)).PostAsync("/api/tickets", form));
            return await Ok<TicketDetailDto>(await (await As(requester)).GetAsync($"/api/tickets/{created.Id}"));
        }

        [Fact]
        public async Task Staff_link_two_tickets_and_see_the_link_from_both_sides()
        {
            var lab = await NewLabAsync();
            var member = await As(lab.MemberName);
            var a = await RaiseAsync(lab.CategoryId);
            var b = await RaiseAsync(lab.CategoryId);

            var link = await Ok<TicketLinkDto>(await member.PostAsJsonAsync($"/api/tickets/{a.Id}/links", new { reference = b.Reference }));
            Assert.Equal("related", link.Relation);
            Assert.Equal(b.Reference, link.Ticket.Reference);
            Assert.Equal("Link test", link.Ticket.Subject);
            Assert.True(link.CanRemove);

            var fromB = await Ok<List<TicketLinkDto>>(await member.GetAsync($"/api/tickets/{b.Id}/links"));
            Assert.Equal(a.Reference, fromB.Single().Ticket.Reference);
            Assert.Equal("related", fromB.Single().Relation);

            // One link per pair, from either side; not to itself; not to an unknown reference; only the two relations
            Assert.Equal(HttpStatusCode.Conflict, (await member.PostAsJsonAsync($"/api/tickets/{b.Id}/links", new { reference = a.Reference, relation = "duplicateOf" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await member.PostAsJsonAsync($"/api/tickets/{a.Id}/links", new { reference = a.Reference })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await member.PostAsJsonAsync($"/api/tickets/{a.Id}/links", new { reference = "NOPE-2026-999999" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await member.PostAsJsonAsync($"/api/tickets/{a.Id}/links", new { reference = b.Reference, relation = "banana" })).StatusCode);

            // Someone who is not staff for the ticket, and the requester, cannot see or change links
            var outsider = await As((await NewUserAsync()).Name);
            Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/tickets/{a.Id}/links")).StatusCode);
            var requester = await As("test.requester");
            Assert.Equal(HttpStatusCode.NotFound, (await requester.GetAsync($"/api/tickets/{a.Id}/links")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await requester.PostAsJsonAsync($"/api/tickets/{a.Id}/links", new { reference = b.Reference })).StatusCode);

            // Remove, then link as a duplicate: the two sides read differently
            Assert.Equal(HttpStatusCode.OK, (await member.DeleteAsync($"/api/tickets/{a.Id}/links/{link.Id}")).StatusCode);
            Assert.Empty(await Ok<List<TicketLinkDto>>(await member.GetAsync($"/api/tickets/{a.Id}/links")));
            await Ok<TicketLinkDto>(await member.PostAsJsonAsync($"/api/tickets/{a.Id}/links", new { reference = b.Reference, relation = "duplicateOf" }));
            Assert.Equal("duplicateOf", (await Ok<List<TicketLinkDto>>(await member.GetAsync($"/api/tickets/{a.Id}/links"))).Single().Relation);
            Assert.Equal("hasDuplicate", (await Ok<List<TicketLinkDto>>(await member.GetAsync($"/api/tickets/{b.Id}/links"))).Single().Relation);
        }

        [Fact]
        public async Task A_duplicate_is_merged_into_the_primary_and_both_stay_readable()
        {
            var lab = await NewLabAsync();
            var other = await NewLabAsync();
            var member = await As(lab.MemberName);
            var requester = await As("test.requester");
            var primary = await RaiseAsync(lab.CategoryId);
            var duplicate = await RaiseAsync(lab.CategoryId);
            var elsewhere = await RaiseAsync(other.CategoryId);
            var url = $"/api/tickets/{duplicate.Id}/merge";

            // Refused: into itself, no reason, another unit's ticket (not even visible), and by the requester
            Assert.Equal(HttpStatusCode.BadRequest, (await member.PostAsJsonAsync(url, new { targetReference = duplicate.Reference, reason = "Same request" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await member.PostAsJsonAsync(url, new { targetReference = primary.Reference, reason = "x" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await member.PostAsJsonAsync(url, new { targetReference = elsewhere.Reference, reason = "Same request" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await requester.PostAsJsonAsync(url, new { targetReference = primary.Reference, reason = "Same request" })).StatusCode);

            // Merged
            var merged = await member.PostAsJsonAsync(url, new { targetReference = primary.Reference, reason = "Same request raised twice" });
            Assert.True(merged.IsSuccessStatusCode, merged.StatusCode + ": " + await merged.Content.ReadAsStringAsync());
            Assert.Contains(primary.Reference, await merged.Content.ReadAsStringAsync());

            var duplicateAfter = await Ok<TicketDetailDto>(await requester.GetAsync($"/api/tickets/{duplicate.Id}"));
            Assert.Equal(TicketStatus.Closed, duplicateAfter.Status);
            Assert.Contains(duplicateAfter.Comments, c => !c.IsInternal && c.BodyHtml.Contains(primary.Reference) && c.BodyHtml.Contains("Same request raised twice"));

            var primaryAfter = await Ok<TicketDetailDto>(await member.GetAsync($"/api/tickets/{primary.Id}"));
            Assert.NotEqual(TicketStatus.Closed, primaryAfter.Status);
            Assert.Contains(primaryAfter.Comments, c => c.IsInternal && c.BodyHtml.Contains(duplicate.Reference));
            // The requester of the primary does not see the internal note
            var primaryForRequester = await Ok<TicketDetailDto>(await requester.GetAsync($"/api/tickets/{primary.Id}"));
            Assert.DoesNotContain(primaryForRequester.Comments, c => c.IsInternal);

            // The two stay linked, and a merge cannot be removed or repeated
            var fromPrimary = (await Ok<List<TicketLinkDto>>(await member.GetAsync($"/api/tickets/{primary.Id}/links"))).Single();
            Assert.Equal("hasMerged", fromPrimary.Relation);
            Assert.Equal(duplicate.Reference, fromPrimary.Ticket.Reference);
            Assert.False(fromPrimary.CanRemove);
            var fromDuplicate = (await Ok<List<TicketLinkDto>>(await member.GetAsync($"/api/tickets/{duplicate.Id}/links"))).Single();
            Assert.Equal("mergedInto", fromDuplicate.Relation);
            Assert.Equal(HttpStatusCode.BadRequest, (await member.DeleteAsync($"/api/tickets/{duplicate.Id}/links/{fromDuplicate.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await member.PostAsJsonAsync(url, new { targetReference = primary.Reference, reason = "Again" })).StatusCode);

            // Nothing can be merged into a closed ticket
            var third = await RaiseAsync(lab.CategoryId);
            Assert.Equal(HttpStatusCode.BadRequest, (await member.PostAsJsonAsync($"/api/tickets/{third.Id}/merge", new { targetReference = duplicate.Reference, reason = "Same request" })).StatusCode);
        }

        [Fact]
        public async Task The_requester_of_the_duplicate_is_copied_on_the_primary_only_when_asked()
        {
            var lab = await NewLabAsync();
            var member = await As(lab.MemberName);
            var second = await NewUserAsync();
            var primary = await RaiseAsync(lab.CategoryId);
            var viaOther = await RaiseAsync(lab.CategoryId, second.Name);
            var viaOther2 = await RaiseAsync(lab.CategoryId, second.Name);

            // Not asked: the other person is not copied
            await Ok<MessageDto>(await member.PostAsJsonAsync($"/api/tickets/{viaOther.Id}/merge", new { targetReference = primary.Reference, reason = "Same matter" }));
            Assert.DoesNotContain((await Ok<TicketDetailDto>(await member.GetAsync($"/api/tickets/{primary.Id}"))).Cc, p => p.UserId == second.Id);

            // Asked: they are copied
            await Ok<MessageDto>(await member.PostAsJsonAsync($"/api/tickets/{viaOther2.Id}/merge", new { targetReference = primary.Reference, reason = "Same matter", copyRequester = true }));
            Assert.Contains((await Ok<TicketDetailDto>(await member.GetAsync($"/api/tickets/{primary.Id}"))).Cc, p => p.UserId == second.Id);
        }
    }
}