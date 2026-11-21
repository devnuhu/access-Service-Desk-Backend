using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ServiceDeskAPI.Infrastructure.Api;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Api
{
    /// <summary>Step 1e: the API contract the web app relies on (answers to the FE-0 backend questions).</summary>
    public class ApiContractTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public ApiContractTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task An_invalid_request_uses_the_one_error_shape()
        {
            var response = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/login", new { });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(ApiErrors.ValidationMessage, body.GetProperty("message").GetString());
            var errors = body.GetProperty("errors");
            Assert.Equal(JsonValueKind.Object, errors.ValueKind);
            Assert.True(errors.TryGetProperty("username", out _));
            Assert.True(errors.TryGetProperty("password", out _));
        }

        [Fact]
        public async Task A_business_error_uses_the_same_shape()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.superadmin");
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var response = await client.GetAsync($"/api/admin/users/{Guid.NewGuid()}");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.False(string.IsNullOrEmpty(body.GetProperty("message").GetString()));
            Assert.Equal(JsonValueKind.Object, body.GetProperty("errors").ValueKind);
        }

        [Fact]
        public async Task Me_has_first_and_last_name()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.hod");
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var me = (await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("data");

            Assert.Equal("Test", me.GetProperty("firstName").GetString());
            Assert.Equal("Head of Department", me.GetProperty("lastName").GetString());
        }

        [Fact]
        public async Task The_health_check_names_the_platform_not_a_department()
        {
            var body = await ApiTestHelpers.Client(_factory).GetFromJsonAsync<JsonElement>("/api/health");
            Assert.Equal("Servio", body.GetProperty("app").GetString());
        }

        [Fact]
        public async Task Swagger_describes_every_success_response()
        {
            var doc = await ApiTestHelpers.Client(_factory).GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
            var problems = new List<string>();

            foreach (var path in doc.GetProperty("paths").EnumerateObject())
            foreach (var operation in path.Value.EnumerateObject())
            {
                var name = operation.Name.ToUpperInvariant() + " " + path.Name;
                var responses = operation.Value.GetProperty("responses");
                var successes = responses.EnumerateObject().Where(r => r.Name.StartsWith("2")).ToList();
                if (successes.Count == 0) { problems.Add(name + ": no success response"); continue; }
                foreach (var success in successes.Where(s => s.Name != "204"))
                    if (!success.Value.TryGetProperty("content", out _))
                        problems.Add(name + ": " + success.Name + " has no schema");
            }

            Assert.True(problems.Count == 0, string.Join("\n", problems));

            var markRead = doc.GetProperty("paths").GetProperty("/api/notifications/{id}/read").GetProperty("patch").GetProperty("responses");
            Assert.True(markRead.TryGetProperty("204", out _));
            Assert.False(markRead.TryGetProperty("200", out _));
        }
    }
}