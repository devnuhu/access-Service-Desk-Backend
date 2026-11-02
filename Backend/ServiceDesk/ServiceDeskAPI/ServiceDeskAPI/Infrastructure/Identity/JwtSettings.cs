namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// JWT settings (section "JwtSettings"). The signing key is the Service Desk's own: it comes from user secrets
    /// (set-secrets.ps1) or, on a server, the SERVICEDESK_JWT_SECRET_KEY environment variable.
    /// People Hub's JWT_SECRET_KEY is deliberately never read.
    /// </summary>
    public class JwtSettings
    {
        public const string SectionName = "JwtSettings";
        public const string SecretKeyVariable = "SERVICEDESK_JWT_SECRET_KEY";

        public string SecretKey { get; set; } = string.Empty;
        public string Issuer { get; set; } = "ServiceDeskAPI";
        public string Audience { get; set; } = "ServiceDeskWeb";
        public int AccessTokenExpiryMinutes { get; set; } = 15;
        public int RefreshTokenExpiryDays { get; set; } = 7;

        /// <summary>Why the key cannot be used, or null when it is fine.</summary>
        public string? Problem()
        {
            if (string.IsNullOrWhiteSpace(SecretKey) || SecretKey.Contains("placeholder", StringComparison.OrdinalIgnoreCase))
                return "The Service Desk JWT key is not set. Run set-secrets.ps1 from the ServiceDesk folder (Development) or set " + SecretKeyVariable + " (server). Never reuse the People Hub key.";
            if (SecretKey.Length < 32)
                return "The Service Desk JWT key must be at least 32 characters. Run set-secrets.ps1 -NewJwtKey.";
            return null;
        }
    }
}