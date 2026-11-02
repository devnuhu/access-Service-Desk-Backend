namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Cookie names for the Service Desk tokens. They differ from People Hub's (__Host-accessToken and so on)
    /// because browsers share cookies across ports on the same host: with the same names, signing in to one
    /// app on localhost or a shared server would overwrite the other app's session.
    /// __Host- is used over HTTPS, __Secure- over plain HTTP in Development.
    /// </summary>
    public static class AuthCookies
    {
        public const string AccessHttps = "__Host-sd-accessToken";
        public const string AccessHttp = "__Secure-sd-accessToken";
        public const string RefreshHttps = "__Host-sd-refreshToken";
        public const string RefreshHttp = "__Secure-sd-refreshToken";
        /// <summary>CSRF double-submit cookie (Step 1b); the same value goes in the X-CSRF-Token header.</summary>
        public const string CsrfHttps = "__Host-sd-csrf";
        public const string CsrfHttp = "__Secure-sd-csrf";

        public static string? ReadAccessToken(HttpRequest request) => Read(request, AccessHttps) ?? Read(request, AccessHttp);
        public static string? ReadRefreshToken(HttpRequest request) => Read(request, RefreshHttps) ?? Read(request, RefreshHttp);
        public static string? ReadCsrfToken(HttpRequest request) => Read(request, CsrfHttps) ?? Read(request, CsrfHttp);

        private static string? Read(HttpRequest request, string name) =>
            request.Cookies.TryGetValue(name, out var value) && !string.IsNullOrEmpty(value) ? value : null;
    }
}