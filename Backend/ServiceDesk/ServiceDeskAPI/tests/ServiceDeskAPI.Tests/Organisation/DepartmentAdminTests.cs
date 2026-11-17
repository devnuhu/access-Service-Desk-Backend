using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Organisation
{
    /// <summary>Step 6b-1: the Department Admin (a unit head named by the Super Admin).</summary>
    public class DepartmentAdminTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public DepartmentAdminTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.da" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private async Task<(Guid DepartmentId, Guid UnitId, Guid HeadId, string HeadName)> NewDepartmentAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "A" + tag, name = "Admin lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Admin unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            return (department.Id, unit.Id, head.Id, head.Name);
        }

        private async Task<bool> HoldsAdminRoleAsync(Guid userId)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().UserRoleAssignments
                .AnyAsync(a => a.UserId == userId && a.RoleId == AppRoles.DepartmentAdminId && a.IsActive);
        }

        [Fact]
        public async Task The_super_admin_names_a_unit_head_and_the_role_follows_and_goes_when_cleared()
        {
            var lab = await NewDepartmentAsync();
            var admin = await As("test.superadmin");

            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/admin", new { userId = lab.HeadId }));
            Assert.True(await HoldsAdminRoleAsync(lab.HeadId));

            var me = await Ok<MyOrganisationDto>(await (await As(lab.HeadName)).GetAsync("/api/org/me"));
            Assert.True(me.Departments.Single(d => d.Id == lab.DepartmentId).IsAdmin);

            var departments = await Ok<List<DepartmentDto>>(await admin.GetAsync("/api/admin/departments"));
            Assert.Equal(lab.HeadId, departments.Single(d => d.Id == lab.DepartmentId).Admin!.UserId);

            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/admin", new { userId = (Guid?)null }));
            Assert.False(await HoldsAdminRoleAsync(lab.HeadId));
        }

        [Fact]
        public async Task Someone_who_does_not_head_or_deputise_a_unit_of_the_department_cannot_be_its_admin()
        {
            var lab = await NewDepartmentAsync();
            var stranger = await NewUserAsync();
            var response = await (await As("test.superadmin")).PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/admin", new { userId = stranger.Id });
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [Fact]
        public async Task The_unit_head_who_is_the_department_admin_cannot_be_replaced_until_another_admin_is_chosen()
        {
            var lab = await NewDepartmentAsync();
            var admin = await As("test.superadmin");
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/admin", new { userId = lab.HeadId }));

            var other = await NewUserAsync();
            var refused = await admin.PutAsJsonAsync($"/api/admin/units/{lab.UnitId}/head", new { userId = other.Id });
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/admin", new { userId = (Guid?)null }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{lab.UnitId}/head", new { userId = other.Id }));
        }

        [Fact]
        public async Task Only_the_super_admin_can_set_the_department_admin()
        {
            var lab = await NewDepartmentAsync();
            var response = await (await As(lab.HeadName)).PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/admin", new { userId = lab.HeadId });
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
    }
}