using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Admin
{
    /// <summary>Step 1d: Super Admin management of people and roles (BRD Section 4).</summary>
    public class AdminUsersTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AdminUsersTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        [Fact]
        public async Task Only_a_Super_Admin_can_manage_people()
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.requester")).GetAsync("/api/admin/users")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou")).GetAsync("/api/admin/users")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.superadmin")).GetAsync("/api/admin/users")).StatusCode);
        }

        [Fact]
        public async Task The_list_shows_every_role_and_can_be_filtered()
        {
            var admin = await As("test.superadmin");

            var caseworkers = await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/api/admin/users?search=caseworker");
            var hods = await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/api/admin/users?role=HOD");

            Assert.Equal(2, caseworkers!.Total);
            Assert.All(caseworkers.Items, u => Assert.Equal(new[] { AppRoles.CaseWorker, AppRoles.Requester }, u.Roles));
            Assert.Contains(hods!.Items, u => u.UserName == "test.hod");
            Assert.DoesNotContain(hods.Items, u => u.UserName == "test.requester");
        }

        [Fact]
        public async Task The_five_roles_are_listed()
        {
            var roles = await (await As("test.superadmin")).GetFromJsonAsync<List<RoleItemDto>>("/api/admin/roles");
            Assert.Equal(AppRoles.All.OrderBy(r => r), roles!.Select(r => r.Name).OrderBy(r => r));
        }

        [Fact]
        public async Task Giving_a_role_works_once_and_is_audited_and_notified()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.requester");

            var first = await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = AppRoles.HeadOfUnitId });
            var second = await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = AppRoles.HeadOfUnitId });

            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityId == target && a.Action == AuditAction.RoleChanged && a.Module == AuditModule.Administration));
                Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == target && n.Title == "Your Service Desk access changed"));
            }

            // The new role is in the next sign-in, next to the roles the person already had
            var again = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var me = await ApiTestHelpers.Client(_factory).SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/auth/me")
            {
                Headers = { Authorization = new AuthenticationHeaderValue("Bearer", again.AccessToken) }
            });
            var body = await me.Content.ReadAsStringAsync();
            Assert.Contains(AppRoles.HeadOfUnit, body);
            Assert.Contains(AppRoles.Requester, body);
        }

        [Fact]
        public async Task Removing_a_role_keeps_the_history()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.hou");

            var removed = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.HeadOfUnitId}");
            var again = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.HeadOfUnitId}");

            Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var history = await db.UserRoleAssignments.Where(a => a.UserId == target && a.RoleId == AppRoles.HeadOfUnitId).ToListAsync();
            Assert.Contains(history, a => !a.IsActive && a.DisabledAt != null && a.DisabledByUserId != null);
            Assert.DoesNotContain(history, a => a.IsActive);
        }

        [Fact]
        public async Task Requester_cannot_be_removed()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.hod");

            var response = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.RequesterId}");

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [Fact]
        public async Task The_last_Super_Admin_is_protected()
        {
            var admin = await As("test.superadmin");
            var self = await IdOf("test.superadmin");

            var removeRole = await admin.DeleteAsync($"/api/admin/users/{self}/roles/{AppRoles.SuperAdminId}");
            var deactivate = await admin.PatchAsJsonAsync($"/api/admin/users/{self}/status", new { isActive = false });

            Assert.Equal(HttpStatusCode.BadRequest, removeRole.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, deactivate.StatusCode);
        }

        [Fact]
        public async Task Deactivating_a_person_signs_them_out_and_blocks_sign_in()
        {
            var admin = await As("test.superadmin");
            var person = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");

            var off = await admin.PatchAsJsonAsync($"/api/admin/users/{person.UserId}/status", new { isActive = false });
            Assert.Equal(HttpStatusCode.OK, off.StatusCode);

            var refresh = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/refresh", new { refreshToken = person.RefreshToken });
            var login = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/login", new { username = "test.caseworker2", password = ServiceDeskApiFactory.TestPassword });
            Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);

            var on = await admin.PatchAsJsonAsync($"/api/admin/users/{person.UserId}/status", new { isActive = true });
            Assert.Equal(HttpStatusCode.OK, on.StatusCode);
            var back = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/login", new { username = "test.caseworker2", password = ServiceDeskApiFactory.TestPassword });
            Assert.Equal(HttpStatusCode.OK, back.StatusCode);
        }

        [Fact]
        public async Task Unknown_people_and_roles_are_404()
        {
            var admin = await As("test.superadmin");
            var known = await IdOf("test.hod");

            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/admin/users/{Guid.NewGuid()}/roles", new { roleId = AppRoles.CaseWorkerId })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/admin/users/{known}/roles", new { roleId = Guid.NewGuid() })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/admin/users/{known}/roles", new { roleId = Guid.Empty })).StatusCode);
        }
    }
}