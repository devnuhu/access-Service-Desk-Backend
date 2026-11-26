namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A step on a ticket's checklist. Staff only: the requester never sees tasks. The ticket cannot be resolved while any task is open or rejected
    /// (unless it is resolved as a duplicate or raised in error). DueAt is the due date at midnight UTC; it is overdue once the Lagos date is past it.
    /// State: Open, Done (IsDone), Rejected (RejectedAt: the owner sent it back with a reason; still blocks resolving) or Cancelled (CancelledAt: no longer blocks).
    /// </summary>
    public class TicketTask
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public string Title { get; set; } = string.Empty;
        /// <summary>Who does it. Null: the ticket's assignee. May work in any unit of the ticket's department.</summary>
        public Guid? AssigneeUserId { get; set; }
        public DateTime? DueAt { get; set; }
        public bool IsDone { get; set; }
        public DateTime? DoneAt { get; set; }
        public Guid? DoneByUserId { get; set; }
        public int SortOrder { get; set; }
        /// <summary>When the overdue notification went out (once per due date and owner).</summary>
        public DateTime? OverdueNotifiedAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        /// <summary>The owner sent the task back. Cleared when it is given to someone else.</summary>
        public DateTime? RejectedAt { get; set; }
        public Guid? RejectedByUserId { get; set; }
        public string? RejectedReason { get; set; }
        /// <summary>Cancelled with a reason by the ticket's case worker, the creator, a head or a Super Admin.</summary>
        public DateTime? CancelledAt { get; set; }
        public Guid? CancelledByUserId { get; set; }
        public string? CancelledReason { get; set; }
        /// <summary>The task was rejected and then given to someone else: the rejection stays on the first person's record and the work went on as a new task. A handed-over task no longer blocks resolving.</summary>
        public DateTime? HandedOverAt { get; set; }
    }
}