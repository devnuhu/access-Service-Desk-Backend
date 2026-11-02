using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// Append-only audit record (copied from People Hub). Rows are only ever inserted: AppDbContext refuses to update
    /// or delete them. Customer data (RSA PIN, employer, amounts) must never be written into OldValues/NewValues.
    /// </summary>
    public class AuditLog
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        /// <summary>Who did it; null for the system (background jobs).</summary>
        public Guid? UserId { get; set; }
        public string? UserDisplayName { get; set; }
        public AuditAction Action { get; set; }
        public string EntityType { get; set; } = string.Empty;
        public Guid EntityId { get; set; }
        public string? EntityDisplayName { get; set; }
        /// <summary>JSON of the changed fields before the change.</summary>
        public string? OldValues { get; set; }
        /// <summary>JSON of the changed fields after the change.</summary>
        public string? NewValues { get; set; }
        public string? IpAddress { get; set; }
        public string? UserAgent { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        public AuditModule Module { get; set; }
    }
}