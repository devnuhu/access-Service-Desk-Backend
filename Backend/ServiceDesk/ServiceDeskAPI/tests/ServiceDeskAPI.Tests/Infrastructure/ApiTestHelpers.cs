using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>Small helpers shared by the API tests.</summary>
    public static class ApiTestHelpers
    {
        public sealed record SignIn(Guid UserId, string AccessToken, string RefreshToken, string CsrfToken, IReadOnlyList<string> SetCookies);

        public static HttpClient Client(ServiceDeskApiFactory factory) =>
            factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        public static async Task<SignIn> SignInAsync(ServiceDeskApiFactory factory, string userName)
        {
            var response = await Client(factory).PostAsJsonAsync("/api/auth/login", new { username = userName, password = ServiceDeskApiFactory.TestPassword });
            response.EnsureSuccessStatusCode();
            var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            return new SignIn(
                data.GetProperty("user").GetProperty("id").GetGuid(),
                data.GetProperty("accessToken").GetString()!,
                data.GetProperty("refreshToken").GetString()!,
                data.GetProperty("csrfToken").GetString()!,
                response.Headers.TryGetValues("Set-Cookie", out var c) ? c.ToList() : new List<string>());
        }

        /// <summary>The value of one cookie from Set-Cookie lines.</summary>
        public static string CookieValue(IEnumerable<string> setCookies, string name)
        {
            var line = setCookies.First(c => c.StartsWith(name + "=", StringComparison.Ordinal));
            var value = line.Substring(name.Length + 1);
            var end = value.IndexOf(';');
            return Uri.UnescapeDataString(end >= 0 ? value.Substring(0, end) : value);
        }
    }
}