using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>
    /// One step on a ticket's checklist. DueDate is yyyy-MM-dd (Lagos date) or null.
    /// Status is Open, Done, Rejected or Cancelled. CanComplete, CanReject and CanCancel say what the signed-in person may do with it now.
    /// </summary>
    public class TicketTaskDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Status { get; set; } = "Open";
        public PersonDto? Assignee { get; set; }
        public PersonDto? CreatedBy { get; set; }
        /// <summary>Who ticked it done. Null while it is open.</summary>
        public PersonDto? DoneBy { get; set; }
        public string? DueDate { get; set; }
        public bool IsDone { get; set; }
        public DateTime? DoneAt { get; set; }
        /// <summary>Open and the due date has passed (Lagos date).</summary>
        public bool IsOverdue { get; set; }
        public DateTime CreatedAt { get; set; }
        public PersonDto? RejectedBy { get; set; }
        public DateTime? RejectedAt { get; set; }
        public string? RejectedReason { get; set; }
        public PersonDto? CancelledBy { get; set; }
        public DateTime? CancelledAt { get; set; }
        public string? CancelledReason { get; set; }
        public bool CanComplete { get; set; }
        public bool CanReject { get; set; }
        public bool CanCancel { get; set; }
    }

    /// <summary>
    /// The ticket's tasks in the order they were added (a task owner from another unit sees only their own). Open counts open tasks, Rejected the ones sent back.
    /// CanEdit is false once the ticket is Resolved, Closed or Cancelled, and for people who are not staff of the ticket.
    /// </summary>
    public class TicketTasksDto
    {
        public List<TicketTaskDto> Items { get; set; } = new();
        public int Open { get; set; }
        public int Done { get; set; }
        public int Rejected { get; set; }
        public int Cancelled { get; set; }
        public bool CanEdit { get; set; }
    }

    /// <summary>title: 3 to 200 characters. assigneeUserId: optional, someone who works in the ticket's department (empty: the ticket's assignee). dueDate: optional yyyy-MM-dd.</summary>
    public class TicketTaskRequest
    {
        public string? Title { get; set; }
        public Guid? AssigneeUserId { get; set; }
        public string? DueDate { get; set; }
    }

    public class TicketTaskDoneRequest
    {
        public bool Done { get; set; }
    }

    /// <summary>Why a task is rejected (5 to 500 characters) or cancelled (3 to 500 characters).</summary>
    public class TicketTaskReasonRequest
    {
        public string? Reason { get; set; }
    }

    /// <summary>One task given to the signed-in person, with the ticket it belongs to.</summary>
    public class MyTaskDto
    {
        public Guid TaskId { get; set; }
        public Guid TicketId { get; set; }
        public string TicketReference { get; set; } = string.Empty;
        public string TicketSubject { get; set; } = string.Empty;
        public TicketStatus TicketStatus { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Status { get; set; } = "Open";
        public string? DueDate { get; set; }
        public bool IsOverdue { get; set; }
        public PersonDto? GivenBy { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>The tasks given to the signed-in person. OpenCount is the open tasks on running tickets (for the tab badge), whatever the page shows.</summary>
    public class MyTasksDto
    {
        public List<MyTaskDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int OpenCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }
}