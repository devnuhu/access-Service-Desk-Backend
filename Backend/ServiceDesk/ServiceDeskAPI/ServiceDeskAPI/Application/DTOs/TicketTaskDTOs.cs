namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One step on a ticket's checklist. DueDate is yyyy-MM-dd (Lagos date) or null.</summary>
    public class TicketTaskDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public PersonDto? Assignee { get; set; }
        public string? DueDate { get; set; }
        public bool IsDone { get; set; }
        public DateTime? DoneAt { get; set; }
        /// <summary>Open and the due date has passed (Lagos date).</summary>
        public bool IsOverdue { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>The ticket's tasks in the order they were added. CanEdit is false once the ticket is Resolved, Closed or Cancelled.</summary>
    public class TicketTasksDto
    {
        public List<TicketTaskDto> Items { get; set; } = new();
        public int Open { get; set; }
        public int Done { get; set; }
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
}