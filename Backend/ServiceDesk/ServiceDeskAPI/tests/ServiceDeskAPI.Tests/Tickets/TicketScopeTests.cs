using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
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
    /// <summary>Step 6c: a case worker sees only their own unit's tickets; the HOD and the Department Admin see the whole department.</summary>
    public class TicketScopeTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public TicketScopeTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            var name = "test.sc" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private sealed record Lab(Guid DepartmentId, Guid TicketId, Guid UnitAId, string MemberA, string MemberB, string Hod, string DeptAdmin, string Outsider);

        /// <summary>A department with two units (A and B), a case worker in each, and one ticket in unit B. Plus a Head of Department and a Department Admin who work in neither.</summary>
        private async Task<Lab> BuildAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "Z" + tag, name = "Scope lab " + tag }));
            var unitA = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "UA", name = "Scope unit A " + tag }));
            var unitB = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "UB", name = "Scope unit B " + tag }));
            var headA = await NewUserAsync();
            var headB = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unitA.Id}/head", new { userId = headA.Id }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unitB.Id}/head", new { userId = headB.Id }));
            var memberA = await NewUserAsync();
            var memberB = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unitA.Id}/members", new { userId = memberA.Id }));
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unitB.Id}/members", new { userId = memberB.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unitB.Id, name = "Scope category " + tag, timelineHours = 24, defaultPriority = 2 }));
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unitB.Id}/skills/{memberB.Id}", new { categoryIds = new[] { category.Id } }));

            var form = new MultipartFormDataContent
            {
                { new StringContent(category.Id.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent("2"), "priority" },
                { new StringContent("Scope test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            var ticket = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));

            var hod = await NewUserAsync();
            var deptAdmin = await NewUserAsync();
            var outsider = await NewUserAsync();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var dept = await db.Departments.FirstAsync(d => d.Id == department.Id);
                dept.HodUserId = hod.Id;
                dept.AdminUserId = deptAdmin.Id;
                await db.SaveChangesAsync();
            }
            return new Lab(department.Id, ticket.Id, unitA.Id, memberA.Name, memberB.Name, hod.Name, deptAdmin.Name, outsider.Name);
        }

        private async Task<TicketPageDto> DepartmentList(string user, Lab lab, string extra = "") =>
            await Ok<TicketPageDto>(await (await As(user)).GetAsync($"/api/tickets?view=department&departmentId={lab.DepartmentId}{extra}"));

        [Fact]
        public async Task A_case_worker_sees_only_their_own_unit_but_the_HOD_and_the_Admin_see_the_whole_department()
        {
            var lab = await BuildAsync();

            Assert.DoesNotContain((await DepartmentList(lab.MemberA, lab)).Items, i => i.Id == lab.TicketId);   // other unit
            Assert.Equal(404, (int)(await (await As(lab.MemberA)).GetAsync($"/api/tickets/{lab.TicketId}")).StatusCode);

            Assert.Contains((await DepartmentList(lab.MemberB, lab)).Items, i => i.Id == lab.TicketId);          // own unit
            Assert.True((await Ok<TicketDetailDto>(await (await As(lab.MemberB)).GetAsync($"/api/tickets/{lab.TicketId}"))).IsStaffView);

            Assert.Contains((await DepartmentList(lab.Hod, lab)).Items, i => i.Id == lab.TicketId);              // whole department
            Assert.True((await Ok<TicketDetailDto>(await (await As(lab.Hod)).GetAsync($"/api/tickets/{lab.TicketId}"))).IsStaffView);
            Assert.Contains((await DepartmentList(lab.DeptAdmin, lab)).Items, i => i.Id == lab.TicketId);
            Assert.True((await Ok<TicketDetailDto>(await (await As(lab.DeptAdmin)).GetAsync($"/api/tickets/{lab.TicketId}"))).IsStaffView);

            var denied = await (await As(lab.Outsider)).GetAsync($"/api/tickets?view=department&departmentId={lab.DepartmentId}");
            Assert.Equal(403, (int)denied.StatusCode);                                                           // works in no unit of it
            Assert.Equal(404, (int)(await (await As(lab.Outsider)).GetAsync($"/api/tickets/{lab.TicketId}")).StatusCode);
        }

        [Fact]
        public async Task The_sla_summary_follows_the_same_scope()
        {
            var lab = await BuildAsync();
            var other = await Ok<SlaSummaryDto>(await (await As(lab.MemberA)).GetAsync($"/api/tickets/sla-summary?departmentId={lab.DepartmentId}"));
            Assert.Equal(0, other.Open);
            var own = await Ok<SlaSummaryDto>(await (await As(lab.MemberB)).GetAsync($"/api/tickets/sla-summary?departmentId={lab.DepartmentId}"));
            Assert.Equal(1, own.Open);
            var wide = await Ok<SlaSummaryDto>(await (await As(lab.DeptAdmin)).GetAsync($"/api/tickets/sla-summary?departmentId={lab.DepartmentId}"));
            Assert.Equal(1, wide.Open);
        }

        [Fact]
        public async Task The_escalated_filter_is_applied_by_the_server()
        {
            var lab = await BuildAsync();
            Assert.Empty((await DepartmentList(lab.Hod, lab, "&escalated=true")).Items);

            var worker = await As(lab.MemberB);
            await Ok<MessageDto>(await worker.PostAsJsonAsync($"/api/tickets/{lab.TicketId}/escalate", new { reason = "I need the head of the unit to look at this." }));

            Assert.Contains((await DepartmentList(lab.Hod, lab, "&escalated=true")).Items, i => i.Id == lab.TicketId);
        }

        [Fact]
        public async Task The_Department_Admin_sees_the_availability_of_the_whole_department_and_a_case_worker_does_not()
        {
            var lab = await BuildAsync();
            var allowed = await (await As(lab.DeptAdmin)).GetAsync($"/api/availability/departments/{lab.DepartmentId}");
            Assert.True(allowed.IsSuccessStatusCode, allowed.StatusCode + ": " + await allowed.Content.ReadAsStringAsync());
            var unit = await (await As(lab.DeptAdmin)).GetAsync($"/api/availability/units/{lab.UnitAId}");
            Assert.True(unit.IsSuccessStatusCode, unit.StatusCode.ToString());
            var denied = await (await As(lab.MemberA)).GetAsync($"/api/availability/departments/{lab.DepartmentId}");
            Assert.Equal(403, (int)denied.StatusCode);
        }
    }
}