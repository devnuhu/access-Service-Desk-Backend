namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>How two tickets are linked. DuplicateOf and MergedInto read from the ticket (TicketId) to the other one (RelatedTicketId).</summary>
    public enum TicketLinkKind
    {
        /// <summary>The two are about the same matter; no direction.</summary>
        Related = 1,
        /// <summary>TicketId is a duplicate of RelatedTicketId; both stay open.</summary>
        DuplicateOf = 2,
        /// <summary>TicketId was merged into RelatedTicketId and closed. Cannot be removed.</summary>
        MergedInto = 3
    }

    /// <summary>A link between two tickets. At most one link per pair of tickets.</summary>
    public class TicketLink
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid RelatedTicketId { get; set; }
        public Ticket? RelatedTicket { get; set; }
        public TicketLinkKind Kind { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
    }
}