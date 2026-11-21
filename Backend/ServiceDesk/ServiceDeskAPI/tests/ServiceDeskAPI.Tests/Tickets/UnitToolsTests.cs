using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The head's own-unit tools: categories, team, skills matrix, and setting who handles which category.</summary>
    public class UnitToolsTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public UnitToolsTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid DepartmentId, Guid UnitId, string HeadName, List<(Guid Id, string Name)> Members, Guid CategoryId);

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
            var name = "test.ut" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        /// <summary>A department of its own: a head, two members, one category. Nobody is mapped to the category yet.</summary>
        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "T" + tag, name = "Tools Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Tools Unit " + tag }));
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
                new { unitId = unit.Id, name = "Tools category " + tag, timelineHours = 24, defaultPriority = 2 }));
            return new Lab(department.Id, unit.Id, head.Name, people, category.Id);
        }

        [Fact]
        public async Task The_head_sees_the_unit_and_sets_who_handles_which_category()
        {
            var lab = await NewLabAsync();
            var head = await As(lab.HeadName);

            var categories = await Ok<List<CategoryAdminDto>>(await head.GetAsync($"/api/units/{lab.UnitId}/categories"));
            var category = categories.Single();
            Assert.Equal(lab.CategoryId, category.Id);
            Assert.Equal(0, category.EligibleCount);

            var team = await Ok<List<UnitMemberDto>>(await head.GetAsync($"/api/units/{lab.UnitId}/team"));
            foreach (var member in lab.Members) Assert.Contains(team, t => t.UserId == member.Id);

            var before = await Ok<UnitSkillsDto>(await head.GetAsync($"/api/units/{lab.UnitId}/skills"));
            Assert.Contains(before.Warnings, w => w.CategoryId == lab.CategoryId);

            await Ok<MessageDto>(await head.PutAsJsonAsync($"/api/units/{lab.UnitId}/skills/{lab.Members[0].Id}", new { categoryIds = new[] { lab.CategoryId } }));

            var after = await Ok<UnitSkillsDto>(await head.GetAsync($"/api/units/{lab.UnitId}/skills"));
            Assert.Contains(lab.CategoryId, after.Members.Single(m => m.UserId == lab.Members[0].Id).CategoryIds);
            Assert.Empty(after.Members.Single(m => m.UserId == lab.Members[1].Id).CategoryIds);
            Assert.Equal(1, after.Categories.Single().EligibleCount);

            // Clearing works too
            await Ok<MessageDto>(await head.PutAsJsonAsync($"/api/units/{lab.UnitId}/skills/{lab.Members[0].Id}", new { categoryIds = Array.Empty<Guid>() }));
            var cleared = await Ok<UnitSkillsDto>(await head.GetAsync($"/api/units/{lab.UnitId}/skills"));
            Assert.Empty(cleared.Members.Single(m => m.UserId == lab.Members[0].Id).CategoryIds);
        }

        [Fact]
        public async Task Members_and_other_units_heads_are_refused_and_an_unknown_unit_is_not_found()
        {
            var lab = await NewLabAsync();
            var other = await NewLabAsync();
            var admin = await As("test.superadmin");
            var url = $"/api/units/{lab.UnitId}";
            var body = new { categoryIds = new[] { lab.CategoryId } };

            foreach (var who in new[] { await As(lab.Members[0].Name), await As(other.HeadName) })
            {
                Assert.Equal(HttpStatusCode.Forbidden, (await who.GetAsync(url + "/categories")).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await who.GetAsync(url + "/team")).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await who.GetAsync(url + "/skills")).StatusCode);
                Assert.Equal(HttpStatusCode.Forbidden, (await who.PutAsJsonAsync($"{url}/skills/{lab.Members[0].Id}", body)).StatusCode);
            }

            var head = await As(lab.HeadName);
            Assert.Equal(HttpStatusCode.NotFound, (await head.GetAsync($"/api/units/{Guid.NewGuid()}/categories")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync(url + "/categories")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"{url}/skills/{lab.Members[1].Id}", body)).StatusCode);
        }

        [Fact]
        public async Task The_head_of_department_can_read_but_not_change()
        {
            var lab = await NewLabAsync();
            var admin = await As("test.superadmin");
            var hod = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/hod", new { userId = hod.Id }));
            var client = await As(hod.Name);
            var url = $"/api/units/{lab.UnitId}";

            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(url + "/categories")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(url + "/team")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(url + "/skills")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync($"{url}/skills/{lab.Members[0].Id}", new { categoryIds = new[] { lab.CategoryId } })).StatusCode);
        }
    }
}