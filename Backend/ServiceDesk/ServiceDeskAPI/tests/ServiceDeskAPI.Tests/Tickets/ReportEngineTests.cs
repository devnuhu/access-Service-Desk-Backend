using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Reports;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 9a: the report engine. Scope, grouping, the breach list, and every built-in report.</summary>
    public class ReportEngineTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public ReportEngineTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.rp" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private sealed record Lab(Guid DepartmentId, Guid UnitA, string UnitAName, Guid HeadA, Guid UnitB, Guid TicketA, string ReferenceA, Guid TicketB);

        private async Task<(Guid Unit, string Name, Guid Head, Guid Category)> NewUnitAsync(HttpClient admin, Guid departmentId, string code, string tag)
        {
            var name = "Unit " + code + " " + tag;
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{departmentId}/units", new { code, name }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Report category " + code + " " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{member}", new { categoryIds = new[] { category.Id } }));
            return (unit.Id, name, head, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Report test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private async Task<Lab> BuildAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "P" + tag, name = "Report lab " + tag }));
            var a = await NewUnitAsync(admin, department.Id, "UA", tag);
            var b = await NewUnitAsync(admin, department.Id, "UB", tag);
            var ticketA = await RaiseAsync(a.Category);
            var ticketB = await RaiseAsync(b.Category);
            return new Lab(department.Id, a.Unit, a.Name, a.Head, b.Unit, ticketA.Id, ticketA.Reference, ticketB.Id);
        }

        private IReportService Reports(IServiceScope scope) => scope.ServiceProvider.GetRequiredService<IReportService>();

        private static ReportSpec ByUnit(Guid departmentId) => new()
        {
            DepartmentId = departmentId, Preset = "all", GroupBy = "unit", Measures = new() { "count", "open" }
        };

        [Fact]
        public async Task A_person_with_no_unit_or_department_cannot_run_reports()
        {
            var stranger = await NewUserAsync();
            using var scope = _factory.Services.CreateScope();
            var (problem, result) = await Reports(scope).RunAsync(new ReportSpec(), stranger, false);
            Assert.Equal(403, problem!.Status);
            Assert.Null(result);
        }

        [Fact]
        public async Task A_unit_head_sees_only_their_unit_and_the_Head_of_Department_sees_both()
        {
            var lab = await BuildAsync();
            using var scope = _factory.Services.CreateScope();
            var reports = Reports(scope);

            var (headProblem, headResult) = await reports.RunAsync(ByUnit(lab.DepartmentId), lab.HeadA, false);
            Assert.Null(headProblem);
            var only = Assert.Single(headResult!.Rows);
            Assert.Equal(lab.UnitAName, only[0]);
            Assert.Equal(1, Convert.ToInt32(only[1]));

            var hod = await NewUserAsync();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var dept = await db.Departments.FirstAsync(d => d.Id == lab.DepartmentId);
            dept.HodUserId = hod;
            await db.SaveChangesAsync();

            var (hodProblem, hodResult) = await reports.RunAsync(ByUnit(lab.DepartmentId), hod, false);
            Assert.Null(hodProblem);
            Assert.Equal(2, hodResult!.Rows.Count);
            Assert.NotNull(hodResult.Totals);
            Assert.Equal(2, Convert.ToInt32(hodResult.Totals![1]));
        }

        [Fact]
        public async Task The_breach_list_shows_a_ticket_that_is_long_past_its_time()
        {
            var lab = await BuildAsync();
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var ticket = await db.Tickets.FirstAsync(t => t.Id == lab.TicketA);
            ticket.CreatedAt = DateTime.UtcNow.AddDays(-30);
            await db.SaveChangesAsync();

            var spec = new ReportSpec
            {
                Mode = "list", Preset = "all", DepartmentId = lab.DepartmentId, SlaBreached = true,
                Columns = new() { "reference", "usedPercent" }, SortBy = "usedPercent"
            };
            var (problem, result) = await Reports(scope).RunAsync(spec, Guid.NewGuid(), true);
            Assert.Null(problem);
            var row = Assert.Single(result!.Rows);
            Assert.Equal(lab.ReferenceA, row[0]);
            Assert.True(Convert.ToDouble(row[1]) > 100);
        }

        [Fact]
        public async Task An_unknown_measure_or_grouping_is_refused_with_a_clear_message()
        {
            using var scope = _factory.Services.CreateScope();
            var reports = Reports(scope);
            var (p1, _) = await reports.RunAsync(new ReportSpec { Measures = new() { "nonsense" } }, Guid.NewGuid(), true);
            Assert.Equal(400, p1!.Status);
            var (p2, _) = await reports.RunAsync(new ReportSpec { GroupBy = "colour" }, Guid.NewGuid(), true);
            Assert.Equal(400, p2!.Status);
            var (p3, _) = await reports.RunAsync(new ReportSpec { Preset = "someday" }, Guid.NewGuid(), true);
            Assert.Equal(400, p3!.Status);
        }

        [Fact]
        public async Task Every_built_in_report_runs()
        {
            await BuildAsync();
            using var scope = _factory.Services.CreateScope();
            var reports = Reports(scope);
            var codes = ReportCatalogue.BuiltIns();
            Assert.Equal(9, codes.Count);
            foreach (var built in codes)
            {
                var (problem, result) = await reports.RunAsync(built.Definition, Guid.NewGuid(), true);
                Assert.True(problem == null, built.Code + ": " + problem?.Message);
                Assert.NotEmpty(result!.Columns);
            }
        }
    }
}
