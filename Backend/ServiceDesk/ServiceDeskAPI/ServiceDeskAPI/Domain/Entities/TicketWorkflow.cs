using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>Why a ticket is Pending (FR-4.3). The SLA clock pauses while Pending (Step 7).</summary>
    public enum PendingReason
    {
        /// <summary>Waiting on the requester; their public reply resumes the ticket automatically.</summary>
        Requester = 1,
        /// <summary>Waiting on a third party, for example an employer or another PFA; the case worker resumes it.</summary>
        ThirdParty = 2
    }

    /// <summary>How a ticket was resolved (FR-4.4).</summary>
    public enum ResolutionCode
    {
        Completed = 1,
        InformationProvided = 2,
        ReferredElsewhere = 3,
        Duplicate = 4,
        NoActionRequired = 5
    }

    /// <summary>
    /// Every status change of a ticket, with who made it and why. Source for the SLA clock (Step 7) and the ticket's timeline.
    /// </summary>
    public class TicketStatusChange
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public TicketStatus FromStatus { get; set; }
        public TicketStatus ToStatus { get; set; }
        /// <summary>Null when the system made it (for example a requester's reply resuming a Pending ticket is still the requester).</summary>
        public Guid? ByUserId { get; set; }
        public string? Reason { get; set; }
        public DateTime At { get; set; } = DateTime.UtcNow;
    }
}