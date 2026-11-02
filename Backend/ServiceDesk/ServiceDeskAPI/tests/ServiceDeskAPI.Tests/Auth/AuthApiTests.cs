using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Auth
{
    /// <summary>Step 1a: sign-in, tokens, cookies, refresh and logout through the real API.</summary>
    public class AuthApiTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AuthApiTests(ServiceDeskApiFactory factory) => _factory = factory;

        private HttpClient Client() => _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        private async Task<(HttpResponseMessage Response, JsonElement Body)> LoginAsync(string userName, string password)
        {
            var response = await Client().PostAsJsonAsync("/api/auth/login", new { username = userName, password });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return (response, body);
        }

        private static List<string> Roles(JsonElement user) =>
            user.GetProperty("roles").EnumerateArray().Select(r => r.GetString()!).ToList();

        [Fact]
        public async Task A_test_account_signs_in_with_every_role_it_holds()
        {
            var (response, body) = await LoginAsync("test.caseworker1", ServiceDeskApiFactory.TestPassword);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var data = body.GetProperty("data");
            Assert.False(string.IsNullOrEmpty(data.GetProperty("accessToken").GetString()));
            Assert.False(string.IsNullOrEmpty(data.GetProperty("refreshToken").GetString()));
            var roles = Roles(data.GetProperty("user"));
            Assert.Contains(AppRoles.Requester, roles);
            Assert.Contains(AppRoles.CaseWorker, roles);
        }

        [Fact]
        public async Task Sign_in_sets_HttpOnly_cookies_with_Service_Desk_names_only()
        {
            var (response, _) = await LoginAsync("test.requester", ServiceDeskApiFactory.TestPassword);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var cookies = response.Headers.GetValues("Set-Cookie").ToList();
            Assert.Contains(cookies, c => c.StartsWith(AuthCookies.AccessHttp + "=") && c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(cookies, c => c.StartsWith(AuthCookies.RefreshHttp + "=") && c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
            // People Hub's cookie names must never be written, or the two apps would sign each other out on the same host.
            Assert.DoesNotContain(cookies, c => c.StartsWith("__Secure-accessToken=") || c.StartsWith("__Host-accessToken="));
        }

        [Fact]
        public async Task The_token_is_issued_by_the_Service_Desk()
        {
            var (_, body) = await LoginAsync("test.hou", ServiceDeskApiFactory.TestPassword);
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(body.GetProperty("data").GetProperty("accessToken").GetString());

            Assert.Equal(ServiceDeskApiFactory.Issuer, jwt.Issuer);
            Assert.Contains(ServiceDeskApiFactory.Audience, jwt.Audiences);
            var roleClaims = jwt.Claims.Where(c => c.Type == "role" || c.Type == ClaimTypes.Role).Select(c => c.Value).ToList();
            Assert.Contains(AppRoles.HeadOfUnit, roleClaims);
            Assert.Contains(AppRoles.Requester, roleClaims);
        }

        [Fact]
        public async Task A_wrong_password_is_refused()
        {
            var (response, _) = await LoginAsync("test.requester", "Wrong-Password#1");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task An_AD_user_is_refused_cleanly_when_AD_is_not_configured()
        {
            var (response, _) = await LoginAsync("someone.from.ad", "Any-Password#1");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task Me_returns_the_profile_and_roles()
        {
            var (_, body) = await LoginAsync("test.hod", ServiceDeskApiFactory.TestPassword);
            var client = Client();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("data").GetProperty("accessToken").GetString());

            var response = await client.GetAsync("/api/auth/me");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var me = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            Assert.Equal("test.hod", me.GetProperty("username").GetString());
            Assert.Equal(new[] { AppRoles.HOD, AppRoles.Requester }, Roles(me));
        }

        [Fact]
        public async Task Me_without_a_token_is_401()
        {
            var response = await Client().GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task A_token_signed_with_any_other_key_is_refused()
        {
            // For example a People Hub token: same claim layout, different key.
            var otherKey = new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(64));
            var handler = new JwtSecurityTokenHandler();
            var forged = handler.WriteToken(handler.CreateToken(new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, AppRoles.SuperAdmin) }),
                Expires = DateTime.UtcNow.AddMinutes(5),
                Issuer = ServiceDeskApiFactory.Issuer,
                Audience = ServiceDeskApiFactory.Audience,
                SigningCredentials = new SigningCredentials(otherKey, SecurityAlgorithms.HmacSha256Signature)
            }));
            var client = Client();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", forged);

            var response = await client.GetAsync("/api/auth/me");

            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task Refresh_rotates_the_token_and_the_old_one_stops_working()
        {
            var (_, body) = await LoginAsync("test.caseworker2", ServiceDeskApiFactory.TestPassword);
            var first = body.GetProperty("data").GetProperty("refreshToken").GetString();

            var refreshed = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken = first });
            Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
            var second = (await refreshed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("refreshToken").GetString();
            Assert.NotEqual(first, second);

            var reused = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken = first });
            Assert.Equal(HttpStatusCode.Unauthorized, reused.StatusCode);

            var again = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken = second });
            Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        }

        [Fact]
        public async Task Logout_revokes_the_refresh_token()
        {
            var (_, body) = await LoginAsync("test.superadmin", ServiceDeskApiFactory.TestPassword);
            var refreshToken = body.GetProperty("data").GetProperty("refreshToken").GetString();

            var logout = await Client().PostAsJsonAsync("/api/auth/logout", new { refreshToken });
            Assert.Equal(HttpStatusCode.OK, logout.StatusCode);

            var refresh = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken });
            Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        }

        [Fact]
        public async Task An_inactive_account_cannot_sign_in()
        {
            const string name = "test.inactive";
            using (var scope = _factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Inactive Tester", IsActive = false, EmailConfirmed = true };
                var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
                await RoleAssignments.EnsureRoleAsync(db, user.Id, AppRoles.Requester, null);
            }

            var (response, _) = await LoginAsync(name, ServiceDeskApiFactory.TestPassword);

            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }
}