using System.Security.Claims;

namespace ServiceDeskAPI.Infrastructure.Audit
{
    /// <summary>Who did something, read from the request: user id, display name, IP address and browser.</summary>
    public sealed record AuditActor(Guid? UserId, string? DisplayName, string? IpAddress, string? UserAgent)
    {
        /// <summary>Background jobs and other work with no signed-in person.</summary>
        public static readonly AuditActor System = new(null, "System", null, null);

        public static AuditActor From(HttpContext? context)
        {
            if (context == null) return System;
            var user = context.User;
            Guid? id = Guid.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var parsed) ? parsed : null;
            var name = user.FindFirst("FullName")?.Value;
            if (string.IsNullOrWhiteSpace(name)) name = user.FindFirst(ClaimTypes.Name)?.Value;
            // The connection address, not X-Forwarded-For, which any caller can set (same rule as the rate limiter).
            return new AuditActor(id, name, context.Connection.RemoteIpAddress?.ToString(), context.Request.Headers["User-Agent"].ToString());
        }
    }
}