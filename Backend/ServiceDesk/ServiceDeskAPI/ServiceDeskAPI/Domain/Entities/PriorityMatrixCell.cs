using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// One edited cell of the priority matrix: the priority for an impact and urgency pair. A pair with no row uses the built-in default
    /// (impact plus urgency: 2-3 Low, 4-5 Medium, 6-7 High, 8 Critical). Sending a cell back at its default removes the row.
    /// </summary>
    public class PriorityMatrixCell
    {
        public Guid Id { get; set; }
        public TicketImpact Impact { get; set; }
        public TicketUrgency Urgency { get; set; }
        public TicketPriority Priority { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public Guid? UpdatedByUserId { get; set; }
    }
}