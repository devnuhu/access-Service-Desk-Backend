namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>A refresh token, stored as a SHA-256 hash only. Each use replaces it with a new one (rotation).</summary>
    public class RefreshTokenStore
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public string TokenHash { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime ExpiresAt { get; set; }
        public bool IsRevoked { get; set; }
        public DateTime? RevokedAt { get; set; }
        public string? IssuedFromIpAddress { get; set; }
        public string? IssuedFromUserAgent { get; set; }
        public DateTime? LastUsedAt { get; set; }

        public User? User { get; set; }
    }
}