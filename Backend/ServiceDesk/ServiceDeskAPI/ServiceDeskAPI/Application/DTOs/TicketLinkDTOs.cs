using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>The other ticket of a link. Subject is null when the viewer is not staff for that ticket (only its reference and status are shown).</summary>
    public record TicketLinkTicketDto(Guid Id, string Reference, string? Subject, TicketStatus Status);

    /// <summary>
    /// A link seen from one ticket. Relation: related, duplicateOf (this ticket is a duplicate of the other), hasDuplicate (the other is a duplicate of this one),
    /// mergedInto (this ticket was merged into the other and closed), hasMerged (the other was merged into this one). CanRemove is false for merges.
    /// </summary>
    public record TicketLinkDto(Guid Id, string Relation, TicketLinkTicketDto Ticket, DateTime CreatedAt, bool CanRemove);

    /// <summary>Reference of the other ticket (for example CP-2026-000123) and the relation: related (default) or duplicateOf.</summary>
    public class AddTicketLinkRequest
    {
        public string? Reference { get; set; }
        public string? Relation { get; set; }
    }

    /// <summary>
    /// Merges the ticket in the URL (the duplicate) into the ticket named by TargetReference. Reason: 3 to 500 characters, shown on the duplicate and in an internal note
    /// on the target. CopyRequester copies the duplicate's requester on the target (only when they are different people; at most 10 copied).
    /// </summary>
    public class MergeTicketRequest
    {
        public string? TargetReference { get; set; }
        public string? Reason { get; set; }
        public bool CopyRequester { get; set; }
    }
}