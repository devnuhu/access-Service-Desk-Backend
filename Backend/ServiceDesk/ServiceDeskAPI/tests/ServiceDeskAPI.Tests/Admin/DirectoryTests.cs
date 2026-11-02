using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Services;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Admin
{
    /// <summary>The API with a pretend Active Directory: one person, "new.person", and a search that fails on "fail".</summary>
    public class DirectoryApiFactory : ServiceDeskApiFactory
    {
        public sealed class FakeLdap : ILdapAuthService
        {
            public Task<LdapAuthResult> AuthenticateAsync(string username, string password) =>
                Task.FromResult(new LdapAuthResult { Success = false, Message = "Not used in these tests" });

            public Task<LdapUserDetails?> GetUserDetailsAsync(string username) => Task.FromResult(
                string.Equals(username, "new.person", StringComparison.OrdinalIgnoreCase)
                    ? new LdapUserDetails
                    {
                        Username = "new.person", Email = "new.person@test.invalid", DisplayName = "New Person",
                        FirstName = "New", LastName = "Person", Department = "Contribution Processing", Title = "Officer",
                        DistinguishedName = "CN=New Person,OU=Staff,DC=test,DC=local"
                    }
                    : null);

            public Task<List<string>> GetUserGroupsAsync(string username) => Task.FromResult(new List<string>());
        }

        public sealed class FakeDirectory : IDirectoryService
        {
            public Task<List<DirectoryUserDto>> SearchUsersAsync(string query) =>
                query == "fail"
                    ? throw new InvalidOperationException("Directory down (test)")
                    : Task.FromResult(new List<DirectoryUserDto>
                    {
                        new() { SamAccountName = "new.person", DisplayName = "New Person", Email = "new.person@test.invalid", Department = "Contribution Processing", ManagerDn = "CN=Boss" }
                    });
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services =>
            {
                foreach (var d in services.Where(d => d.ServiceType == typeof(ILdapAuthService) || d.ServiceType == typeof(IDirectoryService)).ToList())
                    services.Remove(d);
                services.AddScoped<ILdapAuthService, FakeLdap>();
                services.AddScoped<IDirectoryService, FakeDirectory>();
            });
        }
    }

    /// <summary>Step 1d: staff search and adding people from the directory before their first sign-in.</summary>
    public class DirectoryTests : IClassFixture<DirectoryApiFactory>
    {
        private readonly DirectoryApiFactory _factory;

        public DirectoryTests(DirectoryApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        [Fact]
        public async Task Super_Admin_and_Heads_of_Unit_can_search_the_directory()
        {
            var adminResponse = await (await As("test.superadmin")).GetAsync("/api/directory/users/search?query=new");
            var houResponse = await (await As("test.hou")).GetAsync("/api/directory/users/search?query=new");
            var workerResponse = await (await As("test.caseworker1")).GetAsync("/api/directory/users/search?query=new");

            Assert.Equal(HttpStatusCode.OK, adminResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, houResponse.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, workerResponse.StatusCode);
            var body = await adminResponse.Content.ReadAsStringAsync();
            Assert.Contains("new.person", body);
            Assert.DoesNotContain("CN=Boss", body); // the manager link never reaches the browser
        }

        [Fact]
        public async Task An_empty_search_is_400_and_a_directory_failure_is_503()
        {
            var admin = await As("test.superadmin");
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/directory/users/search?query=")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await admin.GetAsync("/api/directory/users/search?query=fail")).StatusCode);
        }

        [Fact]
        public async Task A_person_from_the_directory_gets_an_account_once_and_can_then_join_a_unit()
        {
            var admin = await As("test.superadmin");

            var first = await admin.PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "new.person" });
            var created = await first.Content.ReadFromJsonAsync<ProvisionedUserDto>();
            var second = await (await admin.PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "NEW.PERSON" })).Content.ReadFromJsonAsync<ProvisionedUserDto>();
            var unknown = await admin.PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "nobody.here" });

            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            Assert.True(created!.Created);
            Assert.Equal(new[] { AppRoles.Requester }, created.Roles);
            Assert.Equal("Contribution Processing", created.Department);
            Assert.False(second!.Created);
            Assert.Equal(created.UserId, second.UserId);
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

            // Then a Super Admin can make them a case worker by adding them to a unit (Step 2a)
            var join = await admin.PostAsJsonAsync($"/api/admin/units/{ServiceDeskAPI.Domain.Organisation.OrgSeed.RefundUnitId}/members", new { userId = created.UserId });
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
        }

        [Fact]
        public async Task Only_a_Super_Admin_can_add_people_from_the_directory()
        {
            var response = await (await As("test.hou")).PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "new.person" });
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }

        [Fact]
        public void Search_text_cannot_change_the_LDAP_filter()
        {
            const string attack = "a*)(cn=*";
            var escaped = DirectoryService.EscapeLdapFilterValue(attack);

            // Every LDAP special character in the search text is escaped, so it can only ever be searched for, never obeyed
            Assert.Equal("a\\2a\\29\\28cn=\\2a", escaped);
            Assert.DoesNotContain("(", escaped);
            Assert.DoesNotContain(")", escaped);
            Assert.DoesNotContain("*", escaped);
            Assert.Contains("(displayName=*" + escaped + "*)", DirectoryService.BuildFilter(attack));
        }
    }
}