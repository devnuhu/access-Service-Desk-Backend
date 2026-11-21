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
    /// <summary>Category templates: kept by the unit's head and Super Admin, filled in for the requester, validated.</summary>
    public class CategoryTemplateTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public CategoryTemplateTests(ServiceDeskApiFactory factory) => _factory = factory;

        private sealed record Lab(Guid UnitId, string HeadName, string MemberName, Guid CategoryId, string Tag);

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
            var name = "test.ct" + Guid.NewGuid().ToString("N").Substring(0, 8);
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

        private async Task<Lab> NewLabAsync()
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "M" + tag, name = "Template Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Template Unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var member = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = member.Id }));
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Template category " + tag, timelineHours = 24, defaultPriority = 2 }));
            return new Lab(unit.Id, head.Name, member.Name, category.Id, tag);
        }

        [Fact]
        public async Task The_head_keeps_the_template_and_the_requester_gets_it_filled_in()
        {
            var lab = await NewLabAsync();
            var head = await As(lab.HeadName);
            var requester = await As("test.requester");
            var url = $"/api/categories/{lab.CategoryId}/template";

            var empty = await Ok<CategoryTemplateDto>(await head.GetAsync(url));
            Assert.Null(empty.Subject);
            Assert.Null(empty.DescriptionHtml);
            Assert.DoesNotContain(await Ok<List<CatalogueTemplateDto>>(await requester.GetAsync("/api/catalogue/templates")), t => t.CategoryId == lab.CategoryId);

            var saved = await Ok<CategoryTemplateDto>(await head.PutAsJsonAsync(url,
                new { subject = "  Help with {{ticket.category}}  ", descriptionHtml = "<p>Dear {{unit.name}} team</p><script>alert(1)</script>" }));
            Assert.Equal("Help with {{ticket.category}}", saved.Subject);
            Assert.DoesNotContain("<script", saved.DescriptionHtml!, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("{{unit.name}}", saved.DescriptionHtml);

            var forRequester = (await Ok<List<CatalogueTemplateDto>>(await requester.GetAsync("/api/catalogue/templates"))).Single(t => t.CategoryId == lab.CategoryId);
            Assert.Equal("Help with Template category " + lab.Tag, forRequester.Subject);
            Assert.Contains("Template Unit " + lab.Tag, forRequester.DescriptionHtml);
            Assert.DoesNotContain("{{", forRequester.DescriptionHtml);

            // Super Admin may replace it too; sending nothing removes it
            var admin = await As("test.superadmin");
            var replaced = await Ok<CategoryTemplateDto>(await admin.PutAsJsonAsync(url, new { subject = "Second", descriptionHtml = "<p>Two</p>" }));
            Assert.Equal("Second", replaced.Subject);
            var removed = await Ok<CategoryTemplateDto>(await head.PutAsJsonAsync(url, new { subject = "", descriptionHtml = "<p> </p>" }));
            Assert.Null(removed.Subject);
            Assert.Null(removed.DescriptionHtml);
            Assert.DoesNotContain(await Ok<List<CatalogueTemplateDto>>(await requester.GetAsync("/api/catalogue/templates")), t => t.CategoryId == lab.CategoryId);
        }

        [Fact]
        public async Task Only_the_keepers_can_change_it_and_bad_input_is_refused()
        {
            var lab = await NewLabAsync();
            var other = await NewLabAsync();
            var head = await As(lab.HeadName);
            var member = await As(lab.MemberName);
            var otherHead = await As(other.HeadName);
            var url = $"/api/categories/{lab.CategoryId}/template";

            Assert.Equal(HttpStatusCode.Forbidden, (await member.GetAsync(url)).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await member.PutAsJsonAsync(url, new { subject = "Nope" })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await otherHead.PutAsJsonAsync(url, new { subject = "Stolen" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await head.GetAsync($"/api/categories/{Guid.NewGuid()}/template")).StatusCode);

            var unknown = await head.PutAsJsonAsync(url, new { subject = "Hi {{requester.nmae}}" });
            Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
            Assert.Contains("requester.nmae", await unknown.Content.ReadAsStringAsync());
            // Words that only make sense once a ticket exists are not allowed in a template
            Assert.Equal(HttpStatusCode.BadRequest, (await head.PutAsJsonAsync(url, new { descriptionHtml = "<p>{{ticket.reference}}</p>" })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await head.PutAsJsonAsync(url, new { subject = new string('x', 151) })).StatusCode);

            // Nothing was saved by the refused calls
            var still = await Ok<CategoryTemplateDto>(await head.GetAsync(url));
            Assert.Null(still.Subject);
            Assert.Null(still.DescriptionHtml);
        }
    }
}