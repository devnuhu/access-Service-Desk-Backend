using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Infrastructure.Middleware
{
    /// <summary>
    /// CSRF protection for cookie sign-in (double-submit), based on People Hub's CsrfProtectionMiddleware, which People Hub
    /// never switched on. Changes that make it safe to switch on:
    /// - the token is issued once per sign-in (login, refresh, GET /api/auth/csrf), not on every GET, so parallel requests never race;
    /// - it is checked only when the request is signed in by the access-token COOKIE; a Bearer header cannot be added by another site;
    /// - [AllowAnonymous] endpoints (login, refresh, logout) and /hubs (SignalR) are not checked;
    /// - Service Desk cookie names, compared in constant time.
    /// The web app sends the token in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE.
    /// </summary>
    public class CsrfProtectionMiddleware
    {
        public const string HeaderName = "X-CSRF-Token";

        private readonly RequestDelegate _next;
        private readonly ILogger<CsrfProtectionMiddleware> _logger;

        public CsrfProtectionMiddleware(RequestDelegate next, ILogger<CsrfProtectionMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var request = context.Request;
            if (!IsStateChanging(request.Method)
                || request.Path.StartsWithSegments("/hubs")
                || context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() != null
                || AuthCookies.ReadAccessToken(request) == null
                // A Bearer header cannot be added by another site, so it needs no CSRF token (Swagger, scripts)
                || request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                await _next(context);
                return;
            }

            var header = request.Headers[HeaderName].ToString();
            var cookie = AuthCookies.ReadCsrfToken(request);
            if (string.IsNullOrEmpty(header) || string.IsNullOrEmpty(cookie) || !SameToken(header, cookie))
            {
                _logger.LogWarning("CSRF check failed for {Method} {Path}", request.Method, request.Path);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { statusCode = 403, message = "Security check failed. Refresh the page and try again." });
                return;
            }

            await _next(context);
        }

        /// <summary>Sets the CSRF cookie (same cookie rules as the sign-in cookies) and returns the token for the X-CSRF-Token header.</summary>
        public static string Issue(HttpContext context, bool isDevelopment, DateTime expires)
        {
            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var isHttps = context.Request.IsHttps;
            context.Response.Cookies.Append(isHttps ? AuthCookies.CsrfHttps : AuthCookies.CsrfHttp, token, new CookieOptions
            {
                HttpOnly = true,
                Secure = isDevelopment || isHttps,
                SameSite = isDevelopment ? SameSiteMode.None : (isHttps ? SameSiteMode.Strict : SameSiteMode.Lax),
                Path = "/",
                Expires = expires,
                IsEssential = true
            });
            context.Response.Headers[HeaderName] = token;
            return token;
        }

        private static bool IsStateChanging(string method) =>
            HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);

        private static bool SameToken(string a, string b) =>
            CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
    }

    public static class CsrfProtectionExtensions
    {
        public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app) => app.UseMiddleware<CsrfProtectionMiddleware>();
    }
}