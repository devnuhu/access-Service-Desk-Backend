namespace ServiceDeskAPI.Infrastructure.Middleware
{
    /// <summary>One throttling rule: at most Max requests per Window per client IP for a group of routes.</summary>
    public sealed record RateRule(string Group, int Max, TimeSpan Window);

    /// <summary>
    /// Rate limiting for sign-in, copied from People Hub with the Service Desk routes. Counters are per client IP and per route group.
    /// The client IP is the real connection address; X-Forwarded-For is NOT trusted because any caller can set it.
    /// Switch: RateLimiting:Enabled (default true; the tests turn it off).
    /// </summary>
    public class RateLimitingMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<RateLimitingMiddleware> _logger;
        private readonly IConfiguration _configuration;

        private static readonly Dictionary<string, Queue<DateTime>> Store = new();
        private static readonly object LockObj = new();
        private static DateTime _lastCleanup = DateTime.UtcNow;
        private const int MaxKeys = 50000;

        public RateLimitingMiddleware(RequestDelegate next, ILogger<RateLimitingMiddleware> logger, IConfiguration configuration)
        {
            _next = next;
            _logger = logger;
            _configuration = configuration;
        }

        /// <summary>Which rule applies to this request, or null when the route is not throttled.</summary>
        public static RateRule? Classify(string? rawPath, string? method)
        {
            var path = (rawPath ?? string.Empty).ToLowerInvariant().TrimEnd('/');
            if (!path.StartsWith("/api/")) return null;
            if (path.EndsWith("/auth/login")) return new RateRule("login", 10, TimeSpan.FromMinutes(1));
            if (path.EndsWith("/auth/refresh")) return new RateRule("refresh", 30, TimeSpan.FromMinutes(1));
            if (path.Contains("/directory/")) return new RateRule("directory", 60, TimeSpan.FromMinutes(1));
            return null;
        }

        public static string ClientIp(HttpContext context) => context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        public async Task InvokeAsync(HttpContext context)
        {
            var enabled = !string.Equals(_configuration["RateLimiting:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
            var rule = enabled ? Classify(context.Request.Path.Value, context.Request.Method) : null;
            if (rule != null)
            {
                var ip = ClientIp(context);
                if (!TryTake(ip + "|" + rule.Group, rule, out var retryAfter))
                {
                    _logger.LogWarning("Rate limit exceeded for IP {IpAddress} on group {Group}", ip, rule.Group);
                    context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                    context.Response.Headers["Retry-After"] = retryAfter.ToString();
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync("{\"statusCode\":429,\"message\":\"Too many requests. Please try again later.\"}");
                    return;
                }
            }
            await _next(context);
        }

        /// <summary>Takes one request from the key's allowance. Public so the tests can check the counting.</summary>
        public static bool TryTake(string key, RateRule rule, out int retryAfterSeconds)
        {
            lock (LockObj)
            {
                var now = DateTime.UtcNow;
                if (now - _lastCleanup > TimeSpan.FromMinutes(5) || Store.Count > MaxKeys)
                {
                    Cleanup(now);
                    _lastCleanup = now;
                }

                if (!Store.TryGetValue(key, out var q)) { q = new Queue<DateTime>(); Store[key] = q; }
                while (q.Count > 0 && now - q.Peek() > rule.Window) q.Dequeue();

                if (q.Count >= rule.Max)
                {
                    retryAfterSeconds = Math.Max(1, (int)Math.Ceiling((rule.Window - (now - q.Peek())).TotalSeconds));
                    return false;
                }
                q.Enqueue(now);
                retryAfterSeconds = 0;
                return true;
            }
        }

        private static void Cleanup(DateTime now)
        {
            var stale = new List<string>();
            foreach (var kv in Store)
                if (kv.Value.Count == 0 || now - kv.Value.Peek() > TimeSpan.FromMinutes(15)) stale.Add(kv.Key);
            foreach (var k in stale) Store.Remove(k);
            if (Store.Count > MaxKeys) Store.Clear();
        }
    }

    public static class RateLimitingExtensions
    {
        public static IApplicationBuilder UseRateLimiting(this IApplicationBuilder builder) => builder.UseMiddleware<RateLimitingMiddleware>();
    }
}