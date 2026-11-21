namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A saved reply that staff drop into a comment. UnitId is the unit that owns it; null means shared: every unit may use it (Super Admin keeps those).
    /// The text may hold placeholders such as {{requester.name}}, filled in for the ticket when it is loaded.
    /// </summary>
    public class CannedReply
    {
        public Guid Id { get; set; }
        public Guid? UnitId { get; set; }
        public Unit? Unit { get; set; }
        public string Title { get; set; } = string.Empty;
        public string BodyHtml { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
    }
}