using System.Net;
using System.Net.Http.Headers;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Middleware;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Security
{
    /// <summary>Step 1b: security headers, CSRF protection for cookie sign-in, and sign-in rate limiting.</summary>
    public class MiddlewareTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public MiddlewareTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task Responses_carry_the_security_headers()
        {
            var response = await ApiTestHelpers.Client(_factory).GetAsync("/api/health");

            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
            Assert.Contains("frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
        }

        private HttpRequestMessage CookieRequest(ApiTestHelpers.SignIn signIn, bool withCsrfCookie, string? csrfHeader)
        {
            var request = new HttpRequestMessage(HttpMethod.Patch, "/api/notifications/read-all");
            var cookies = AuthCookies.AccessHttp + "=" + ApiTestHelpers.CookieValue(signIn.SetCookies, AuthCookies.AccessHttp);
            if (withCsrfCookie)
                cookies += "; " + AuthCookies.CsrfHttp + "=" + Uri.EscapeDataString(ApiTestHelpers.CookieValue(signIn.SetCookies, AuthCookies.CsrfHttp));
            request.Headers.Add("Cookie", cookies);
            if (csrfHeader != null) request.Headers.Add(CsrfProtectionMiddleware.HeaderName, csrfHeader);
            return request;
        }

        [Fact]
        public async Task A_cookie_signed_change_without_the_CSRF_token_is_refused()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker1");

            var noHeader = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, true, null));
            var wrongHeader = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, true, "not-the-token"));
            var noCookie = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, false, signIn.CsrfToken));

            Assert.Equal(HttpStatusCode.Forbidden, noHeader.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, wrongHeader.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, noCookie.StatusCode);
        }

        [Fact]
        public async Task A_cookie_signed_change_with_the_CSRF_token_goes_through()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");
            Assert.Equal(signIn.CsrfToken, ApiTestHelpers.CookieValue(signIn.SetCookies, AuthCookies.CsrfHttp));

            var response = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, true, signIn.CsrfToken));

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task A_Bearer_signed_change_needs_no_CSRF_token()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var response = await client.PatchAsync("/api/notifications/read-all", null);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task A_request_with_cookie_and_Bearer_header_needs_no_CSRF_token()
        {
            // What Swagger sends after signing in through it: the browser cookie plus the Authorization header
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.hod");
            var request = CookieRequest(signIn, false, null);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var response = await ApiTestHelpers.Client(_factory).SendAsync(request);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public void Sign_in_routes_are_rate_limited()
        {
            Assert.Equal("login", RateLimitingMiddleware.Classify("/api/auth/login", "POST")!.Group);
            Assert.Equal("refresh", RateLimitingMiddleware.Classify("/api/Auth/Refresh/", "POST")!.Group);
            Assert.Null(RateLimitingMiddleware.Classify("/api/notifications", "GET"));
        }

        [Fact]
        public void The_limit_counts_per_key_and_says_when_to_retry()
        {
            var rule = new RateRule("test", 3, TimeSpan.FromMinutes(1));
            var key = "test|" + Guid.NewGuid();

            for (var i = 0; i < 3; i++)
                Assert.True(RateLimitingMiddleware.TryTake(key, rule, out _));
            Assert.False(RateLimitingMiddleware.TryTake(key, rule, out var retryAfter));
            Assert.InRange(retryAfter, 1, 60);
            Assert.True(RateLimitingMiddleware.TryTake("test|" + Guid.NewGuid(), rule, out _));
        }
    }
}