namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A step on a ticket's checklist. Staff only: the requester never sees tasks. The ticket cannot be resolved while any task is open
    /// (unless it is resolved as a duplicate or raised in error). DueAt is the due date at midnight UTC; it is overdue once the Lagos date is past it.
    /// </summary>
    public class TicketTask
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public string Title { get; set; } = string.Empty;
        /// <summary>Who does it. Null: the ticket's assignee.</summary>
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
    }
}