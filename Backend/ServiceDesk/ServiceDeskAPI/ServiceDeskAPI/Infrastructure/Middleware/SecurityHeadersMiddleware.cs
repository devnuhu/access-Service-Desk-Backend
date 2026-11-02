namespace ServiceDeskAPI.Infrastructure.Middleware
{
    /// <summary>
    /// Security headers, copied from People Hub. Change: on in every environment (People Hub only outside Development),
    /// except the strict content policy on the Development Swagger page, which needs its own scripts and styles.
    /// X-XSS-Protection is "0" as OWASP now advises (the old browser filter caused problems of its own).
    /// </summary>
    public class SecurityHeadersMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly IHostEnvironment _environment;

        public SecurityHeadersMiddleware(RequestDelegate next, IHostEnvironment environment)
        {
            _next = next;
            _environment = environment;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["X-XSS-Protection"] = "0";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";

            if (context.Request.IsHttps)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

            var isSwagger = context.Request.Path.StartsWithSegments("/swagger");
            if (!(isSwagger && _environment.IsDevelopment()))
            {
                headers["Content-Security-Policy"] =
                    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
                    "connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'";
            }

            await _next(context);
        }
    }

    public static class SecurityHeadersExtensions
    {
        public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.UseMiddleware<SecurityHeadersMiddleware>();
    }
}