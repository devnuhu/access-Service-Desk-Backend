using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Catalogue
{
    /// <summary>Step 3: the 22 categories, managing them, and the skills matrix with its two-per-category warning (BRD 5.2, Section 7).</summary>
    public class CatalogueTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public CatalogueTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        /// <summary>A new person added to the unit by the Super Admin.</summary>
        private async Task<Guid> NewMemberAsync(Guid unitId)
        {
            Guid id;
            using (var scope = _factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var name = "cat." + Guid.NewGuid().ToString("N").Substring(0, 8);
                var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
                var created = await users.CreateAsync(user);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
                await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
                id = user.Id;
            }
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.superadmin")).PostAsJsonAsync($"/api/admin/units/{unitId}/members", new { userId = id })).StatusCode);
            return id;
        }

        private async Task<CategoryAdminDto> NewCategoryAsync(HttpClient admin, Guid unitId)
        {
            var response = await admin.PostAsJsonAsync("/api/admin/categories", new { unitId, name = "Test Category " + Guid.NewGuid().ToString("N").Substring(0, 6), timelineHours = 24, defaultPriority = 2 });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<CategoryAdminDto>())!;
        }

        [Fact]
        public async Task The_22_Contribution_Processing_categories_are_seeded_in_their_units()
        {
            var all = await (await As("test.superadmin")).GetFromJsonAsync<List<CategoryAdminDto>>($"/api/admin/categories?departmentId={OrgSeed.ContributionProcessingId}");
            var seeded = all!.Where(c => CatalogueSeed.Categories.Any(s => s.Id == c.Id)).ToList();

            Assert.Equal(22, seeded.Count);
            Assert.Equal(15, seeded.Count(c => c.UnitId == OrgSeed.ContributionMatchingUnitId));
            Assert.Equal(7, seeded.Count(c => c.UnitId == OrgSeed.RefundUnitId));
            Assert.All(seeded, c => Assert.Equal(24, c.TimelineHours));
            Assert.All(seeded, c => Assert.Equal(TicketPriority.Medium, c.DefaultPriority));
            Assert.Equal("Refund", seeded.Single(c => c.Name == "Transaction History Request").UnitName);
            // Development: three test people handle every category of their unit
            Assert.All(seeded, c => Assert.Equal(3, c.EligibleCount));
            Assert.DoesNotContain(seeded, c => c.NeedsCover);
        }

        [Fact]
        public async Task Requesters_see_active_categories_and_only_a_Super_Admin_manages_them()
        {
            var requester = await As("test.requester");

            var catalogue = await requester.GetFromJsonAsync<List<CatalogueDepartmentDto>>("/api/catalogue/categories");
            var cp = Assert.Single(catalogue!, d => d.DepartmentId == OrgSeed.ContributionProcessingId);
            Assert.Equal("Account Reconciliation", cp.Categories.First().Name);
            Assert.True(cp.Categories.Count >= 22);

            Assert.Equal(HttpStatusCode.Forbidden, (await requester.GetAsync("/api/admin/categories")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou")).PostAsJsonAsync("/api/admin/categories", new { unitId = OrgSeed.ContributionMatchingUnitId, name = "Nope" })).StatusCode);
        }

        [Fact]
        public async Task A_Super_Admin_adds_renames_and_switches_off_a_category()
        {
            var admin = await As("test.superadmin");
            var category = await NewCategoryAsync(admin, OrgSeed.ContributionMatchingUnitId);
            Assert.True(category.NeedsCover);
            Assert.Equal(0, category.EligibleCount);

            var duplicate = await admin.PostAsJsonAsync("/api/admin/categories", new { unitId = OrgSeed.RefundUnitId, name = "Fund Movement" });
            var badTimeline = await admin.PostAsJsonAsync("/api/admin/categories", new { unitId = OrgSeed.RefundUnitId, name = "Odd timeline", timelineHours = 0 });
            var noUnit = await admin.PostAsJsonAsync("/api/admin/categories", new { name = "No unit" });
            Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, badTimeline.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, noUnit.StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { name = category.Name + " renamed", defaultPriority = 3 })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { name = "PIN Change" })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { isActive = false })).StatusCode);

            var catalogue = await (await As("test.requester")).GetFromJsonAsync<List<CatalogueDepartmentDto>>("/api/catalogue/categories");
            Assert.DoesNotContain(catalogue!.SelectMany(d => d.Categories), c => c.Id == category.Id);
            var warnings = await admin.GetFromJsonAsync<List<CategoryCoverDto>>("/api/admin/categories/cover-warnings");
            Assert.DoesNotContain(warnings!, w => w.CategoryId == category.Id);
        }

        [Fact]
        public async Task The_matrix_maps_unit_members_to_their_units_categories_and_warns_under_two()
        {
            var admin = await As("test.superadmin");
            var category = await NewCategoryAsync(admin, OrgSeed.RefundUnitId);
            var worker = await IdOf("test.caseworker2");
            var other = await IdOf("test.caseworker4");
            var matchingWorker = await IdOf("test.caseworker1");
            var refundCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.RefundUnitId).Id;
            var matchingCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.ContributionMatchingUnitId).Id;

            var before = await admin.GetFromJsonAsync<UnitSkillsDto>($"/api/admin/units/{OrgSeed.RefundUnitId}/skills");
            Assert.Contains(before!.Warnings, w => w.CategoryId == category.Id);
            var current = before.Members.Single(m => m.UserId == worker).CategoryIds;

            // One person: still short of cover, and the message says so
            var one = await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{worker}", new { categoryIds = current.Append(category.Id) });
            Assert.Equal(HttpStatusCode.OK, one.StatusCode);
            Assert.Contains("Fewer than two", (await one.Content.ReadFromJsonAsync<MessageDto>())!.Message);

            // Two people: covered
            var otherCurrent = before.Members.Single(m => m.UserId == other).CategoryIds;
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{other}", new { categoryIds = otherCurrent.Append(category.Id) })).StatusCode);
            var after = await admin.GetFromJsonAsync<UnitSkillsDto>($"/api/admin/units/{OrgSeed.RefundUnitId}/skills");
            Assert.DoesNotContain(after!.Warnings, w => w.CategoryId == category.Id);
            Assert.Equal(2, after.Categories.Single(c => c.Id == category.Id).EligibleCount);

            using (var scope = _factory.Services.CreateScope())
            {
                var eligible = await scope.ServiceProvider.GetRequiredService<ICatalogueService>().EligibleCaseWorkerIdsAsync(category.Id);
                Assert.Equal(new[] { worker, other }.OrderBy(x => x), eligible.OrderBy(x => x));
            }

            // Only the unit's own categories, and only its members
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{worker}", new { categoryIds = new[] { refundCategory, matchingCategory } })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{matchingWorker}", new { categoryIds = new[] { refundCategory } })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou2")).PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{worker}", new { categoryIds = new[] { refundCategory } })).StatusCode);
        }

        [Fact]
        public async Task Leaving_the_unit_or_moving_the_category_ends_the_mapping()
        {
            var admin = await As("test.superadmin");
            var category = await NewCategoryAsync(admin, OrgSeed.ContributionMatchingUnitId);
            var leaver = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var stayer = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            foreach (var person in new[] { leaver, stayer })
                Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/skills/{person}", new { categoryIds = new[] { category.Id } })).StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/members/{leaver}")).StatusCode);
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.False(await db.CategorySkills.AnyAsync(s => s.UserId == leaver && s.IsActive));
                Assert.True(await db.CategorySkills.AnyAsync(s => s.UserId == leaver && !s.IsActive && s.RemovedAt != null));
            }

            var move = await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { unitId = OrgSeed.RefundUnitId });
            Assert.Equal(HttpStatusCode.OK, move.StatusCode);
            Assert.Contains("Moved to Refund", (await move.Content.ReadFromJsonAsync<MessageDto>())!.Message);
            var moved = (await admin.GetFromJsonAsync<List<CategoryAdminDto>>("/api/admin/categories"))!.Single(c => c.Id == category.Id);
            Assert.Equal(OrgSeed.RefundUnitId, moved.UnitId);
            Assert.Equal(0, moved.EligibleCount);
            Assert.True(moved.NeedsCover);
        }

        [Fact]
        public async Task Role_changes_on_the_People_page_are_announced_as_Access_Desk()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.requester");
            var roles = await admin.GetFromJsonAsync<List<RoleItemDto>>("/api/admin/roles");
            var superAdmin = roles!.Single(r => r.Name == "SuperAdmin").Id;

            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = superAdmin })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/users/{target}/roles/{superAdmin}")).StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.InAppNotifications.AnyAsync(n => n.Title.Contains("Service Desk")));
        }
    }
}