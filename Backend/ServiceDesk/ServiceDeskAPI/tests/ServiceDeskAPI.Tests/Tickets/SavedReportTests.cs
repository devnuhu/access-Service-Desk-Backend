using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 9b: saved reports, sharing, and the rule that a shared report runs with the viewer's own scope.</summary>
    public class SavedReportTests : IClassFixture<ServiceDeskApiFactory>
    {
        private static readonly string[] NoRoles = Array.Empty<string>();
        private readonly ServiceDeskApiFactory _factory;

        public SavedReportTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<Guid> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.sr" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        private sealed record Lab(Guid DepartmentId, Guid UnitA, Guid HeadA, Guid UnitB, string UnitBName, Guid HeadB);

        private async Task<(Guid Unit, string Name, Guid Head, Guid Category)> NewUnitAsync(HttpClient admin, Guid departmentId, string code, string tag)
        {
            var name = "Unit " + code + " " + tag;
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{departmentId}/units", new { code, name }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Saved report category " + code + " " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member}", new { categoryIds = new[] { category.Id } }));
            return (unit.Id, name, head, category.Id);
        }

        private async Task RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Saved report test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private async Task<Lab> BuildAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "S" + tag, name = "Saved lab " + tag }));
            var a = await NewUnitAsync(admin, department.Id, "UA", tag);
            var b = await NewUnitAsync(admin, department.Id, "UB", tag);
            await RaiseAsync(a.Category);
            await RaiseAsync(b.Category);
            return new Lab(department.Id, a.Unit, a.Head, b.Unit, b.Name, b.Head);
        }

        private static SaveReportRequest Request(Guid departmentId, string name, string share = "private") => new()
        {
            Name = name, Share = share,
            Definition = new ReportSpec { DepartmentId = departmentId, Preset = "all", GroupBy = "unit", Measures = new() { "count" } }
        };

        [Fact]
        public async Task The_owner_saves_lists_and_runs_a_report_and_names_must_be_unique()
        {
            var lab = await BuildAsync();
            using var scope = _factory.Services.CreateScope();
            var saved = scope.ServiceProvider.GetRequiredService<ISavedReportService>();
            var name = "My units " + Guid.NewGuid().ToString("N").Substring(0, 6);

            var (problem, report) = await saved.SaveAsync(null, Request(lab.DepartmentId, name), lab.HeadA, false, NoRoles);
            Assert.Null(problem);
            Assert.True(report!.IsMine);
            Assert.Equal("private", report.Share);

            var (_, list) = await saved.ListAsync(lab.HeadA, false, NoRoles);
            Assert.Contains(list!, r => r.Id == report.Id);

            var (runProblem, result) = await saved.RunAsync(report.Id, lab.HeadA, false, NoRoles);
            Assert.Null(runProblem);
            Assert.Single(result!.Rows);

            var (duplicate, _) = await saved.SaveAsync(null, Request(lab.DepartmentId, name.ToUpperInvariant()), lab.HeadA, false, NoRoles);
            Assert.Equal(409, duplicate!.Status);

            var bad = Request(lab.DepartmentId, "Bad " + name);
            bad.Definition!.Measures = new() { "nonsense" };
            var (invalid, _) = await saved.SaveAsync(null, bad, lab.HeadA, false, NoRoles);
            Assert.Equal(400, invalid!.Status);
        }

        [Fact]
        public async Task A_shared_report_runs_with_the_viewers_own_scope_and_only_the_owner_can_delete_it()
        {
            var lab = await BuildAsync();
            using var scope = _factory.Services.CreateScope();
            var saved = scope.ServiceProvider.GetRequiredService<ISavedReportService>();
            var name = "Shared " + Guid.NewGuid().ToString("N").Substring(0, 6);

            var (_, report) = await saved.SaveAsync(null, Request(lab.DepartmentId, name), lab.HeadA, false, NoRoles);
            var (_, hiddenFromB) = await saved.ListAsync(lab.HeadB, false, NoRoles);
            Assert.DoesNotContain(hiddenFromB!, r => r.Id == report!.Id);
            var (notFound, _) = await saved.RunAsync(report!.Id, lab.HeadB, false, NoRoles);
            Assert.Equal(404, notFound!.Status);

            var share = Request(lab.DepartmentId, name, "department");
            share.ShareDepartmentId = lab.DepartmentId;
            var (shareProblem, _) = await saved.SaveAsync(report.Id, share, lab.HeadA, false, NoRoles);
            Assert.Null(shareProblem);

            var (_, visibleToB) = await saved.ListAsync(lab.HeadB, false, NoRoles);
            var seen = Assert.Single(visibleToB!, r => r.Id == report.Id);
            Assert.False(seen.IsMine);

            var (runProblem, result) = await saved.RunAsync(report.Id, lab.HeadB, false, NoRoles);
            Assert.Null(runProblem);
            var only = Assert.Single(result!.Rows);          // head B sees only unit B, even though head A built the report
            Assert.Equal(lab.UnitBName, only[0]);

            var forbidden = await saved.DeleteAsync(report.Id, lab.HeadB, false, NoRoles);
            Assert.Equal(403, forbidden!.Status);
            Assert.Null(await saved.DeleteAsync(report.Id, lab.HeadA, false, NoRoles));
            var (_, after) = await saved.ListAsync(lab.HeadB, false, NoRoles);
            Assert.DoesNotContain(after!, r => r.Id == report.Id);
        }

        [Fact]
        public async Task Sharing_is_limited_to_your_own_unit_or_department_and_to_real_roles()
        {
            var lab = await BuildAsync();
            using var scope = _factory.Services.CreateScope();
            var saved = scope.ServiceProvider.GetRequiredService<ISavedReportService>();

            var toOtherUnit = Request(lab.DepartmentId, "Other unit " + Guid.NewGuid().ToString("N").Substring(0, 6), "unit");
            toOtherUnit.ShareUnitId = lab.UnitB;
            var (p1, _) = await saved.SaveAsync(null, toOtherUnit, lab.HeadA, false, NoRoles);
            Assert.Equal(403, p1!.Status);

            var toRoles = Request(lab.DepartmentId, "Roles " + Guid.NewGuid().ToString("N").Substring(0, 6), "roles");
            toRoles.ShareRoles = new() { "Nonsense" };
            var (p2, _) = await saved.SaveAsync(null, toRoles, lab.HeadA, false, NoRoles);
            Assert.Equal(400, p2!.Status);

            toRoles.ShareRoles = new() { "HeadOfUnit" };
            var (p3, created) = await saved.SaveAsync(null, toRoles, lab.HeadA, false, NoRoles);
            Assert.Null(p3);
            var (_, forHeadB) = await saved.ListAsync(lab.HeadB, false, new[] { "HeadOfUnit" });
            Assert.Contains(forHeadB!, r => r.Id == created!.Id);
        }
    }
}
