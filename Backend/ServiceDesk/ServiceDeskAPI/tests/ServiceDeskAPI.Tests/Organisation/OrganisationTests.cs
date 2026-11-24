using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Organisation
{
    /// <summary>Step 2a: departments, units, heads and members (BRD Section 5); structure roles follow automatically.</summary>
    public class OrganisationTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public OrganisationTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        /// <summary>A fresh staff account (as if added from AD), with the Requester role.</summary>
        private async Task<Guid> NewPersonAsync(string prefix)
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = prefix + "." + Guid.NewGuid().ToString("N").Substring(0, 6);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private async Task<List<string>> RolesOf(Guid userId)
        {
            using var scope = _factory.Services.CreateScope();
            return await RoleAssignments.GetActiveRoleNamesAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), userId);
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        [Fact]
        public async Task Contribution_Processing_is_seeded_with_its_two_units_and_the_test_people_in_place()
        {
            var departments = await (await As("test.superadmin")).GetFromJsonAsync<List<DepartmentDto>>("/api/admin/departments");

            var cp = Assert.Single(departments!, d => d.Id == OrgSeed.ContributionProcessingId);
            Assert.Equal("CP", cp.Code);
            Assert.Equal("test.hod", cp.Hod!.UserName);
            var matching = Assert.Single(cp.Units, u => u.Id == OrgSeed.ContributionMatchingUnitId);
            Assert.Equal("test.hou", matching.Head!.UserName);
            Assert.Contains(cp.Units, u => u.Id == OrgSeed.RefundUnitId && u.Name == "Refund");

            Assert.Contains(AppRoles.HOD, await RolesOf(await IdOf("test.hod")));
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(await IdOf("test.hou")));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(await IdOf("test.hou")));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(await IdOf("test.caseworker2")));
        }

        [Fact]
        public async Task Only_a_Super_Admin_manages_the_structure()
        {
            var hou = await As("test.hou");
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.GetAsync("/api/admin/departments")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.PostAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/members", new { userId = Guid.NewGuid() })).StatusCode);
        }

        [Fact]
        public async Task Joining_a_unit_makes_a_case_worker_and_leaving_takes_it_away()
        {
            var admin = await As("test.superadmin");
            var person = await NewPersonAsync("member");

            var join = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = person, staffNo = "AP1234" });
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(person));

            var members = await admin.GetFromJsonAsync<List<UnitMemberDto>>($"/api/admin/units/{OrgSeed.RefundUnitId}/members");
            var row = Assert.Single(members!, m => m.UserId == person);
            Assert.Equal("AP1234", row.StaffNo);
            Assert.Equal(StaffCategory.Employee, row.StaffCategory);

            var leave = await admin.DeleteAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members/{person}");
            Assert.Equal(HttpStatusCode.OK, leave.StatusCode);
            Assert.DoesNotContain(AppRoles.CaseWorker, await RolesOf(person));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.UnitMembers.AnyAsync(m => m.UserId == person && !m.IsActive && m.LeftAt != null)); // history kept
            Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityType == "UnitMember" && a.Module == Domain.Enums.AuditModule.Units));
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == person && n.Title == "Your Access Desk access changed"));
        }

        [Fact]
        public async Task A_person_works_in_one_unit_per_department()
        {
            var admin = await As("test.superadmin");
            var person = await NewPersonAsync("onlyone");

            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = person })).StatusCode);
            var second = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/members", new { userId = person });
            var again = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = person });

            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
            Assert.Contains("Refund", await second.Content.ReadAsStringAsync());
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        }

        [Fact]
        public async Task The_HOD_oversees_and_never_works_in_a_unit_of_their_department()
        {
            var admin = await As("test.superadmin");
            var hod = await IdOf("test.hod");
            var worker = await IdOf("test.caseworker1");

            var hodJoins = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = hod });
            var workerBecomesHod = await admin.PutAsJsonAsync($"/api/admin/departments/{OrgSeed.ContributionProcessingId}/hod", new { userId = worker });

            Assert.Equal(HttpStatusCode.BadRequest, hodJoins.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, workerBecomesHod.StatusCode);
        }

        [Fact]
        public async Task A_new_head_joins_the_unit_and_the_previous_head_stays_as_a_case_worker()
        {
            var admin = await As("test.superadmin");
            var dept = await admin.PostAsJsonAsync("/api/admin/departments", new { code = "T" + Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant(), name = "Test Dept " + Guid.NewGuid().ToString("N").Substring(0, 6) });
            var department = await dept.Content.ReadFromJsonAsync<DepartmentDto>();
            var unit = await (await admin.PostAsJsonAsync($"/api/admin/departments/{department!.Id}/units", new { code = "U1", name = "Unit One" })).Content.ReadFromJsonAsync<UnitDto>();
            var first = await NewPersonAsync("headone");
            var second = await NewPersonAsync("headtwo");

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{unit!.Id}/head", new { userId = first })).StatusCode);
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(first));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(first));

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = second })).StatusCode);
            Assert.DoesNotContain(AppRoles.HeadOfUnit, await RolesOf(first));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(first));
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(second));

            var members = await admin.GetFromJsonAsync<List<UnitMemberDto>>($"/api/admin/units/{unit.Id}/members");
            Assert.Equal(StaffCategory.Employee, members!.Single(m => m.UserId == first).StaffCategory);
            Assert.Equal(StaffCategory.HeadOfUnit, members.Single(m => m.UserId == second).StaffCategory);
            Assert.True(members.Single(m => m.UserId == second).IsHead);

            // The head cannot simply be removed: choose another head first
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync($"/api/admin/units/{unit.Id}/members/{second}")).StatusCode);
        }

        [Fact]
        public async Task Departments_and_units_have_unique_codes_and_switch_off_only_when_empty()
        {
            var admin = await As("test.superadmin");

            var duplicate = await admin.PostAsJsonAsync("/api/admin/departments", new { code = "CP", name = "Another" });
            var badCode = await admin.PostAsJsonAsync("/api/admin/departments", new { code = "c p!", name = "Bad Code" });
            var duplicateUnit = await admin.PostAsJsonAsync($"/api/admin/departments/{OrgSeed.ContributionProcessingId}/units", new { code = "CM", name = "Copy" });
            var switchOffBusyUnit = await admin.PatchAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}", new { isActive = false });
            var switchOffBusyDept = await admin.PatchAsJsonAsync($"/api/admin/departments/{OrgSeed.ContributionProcessingId}", new { isActive = false });

            Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, badCode.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, duplicateUnit.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, switchOffBusyUnit.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, switchOffBusyDept.StatusCode);
        }

        [Fact]
        public async Task Everyone_sees_their_own_place_and_the_departments_they_can_raise_tickets_to()
        {
            var hou = await As("test.hou");
            var requester = await As("test.requester");

            var mine = await hou.GetFromJsonAsync<MyOrganisationDto>("/api/org/me");
            var none = await requester.GetFromJsonAsync<MyOrganisationDto>("/api/org/me");
            var departments = await requester.GetFromJsonAsync<List<OrgDepartmentDto>>("/api/org/departments");

            var cp = Assert.Single(mine!.Departments, d => d.Id == OrgSeed.ContributionProcessingId);
            Assert.False(cp.IsHod);
            var unit = Assert.Single(cp.Units);
            Assert.True(unit.IsHead);
            Assert.True(unit.IsMember);
            Assert.Empty(none!.Departments);
            var listed = Assert.Single(departments!, d => d.Id == OrgSeed.ContributionProcessingId);
            Assert.Equal(2, listed.Units.Count);
        }
    }
}