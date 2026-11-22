using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One answer to offer on the request form, with the words to show.</summary>
    public record PriorityChoiceDto(int Value, string Label, string Description);

    /// <summary>The priority for an impact and urgency pair. IsDefault: nobody has edited it.</summary>
    public record PriorityCellDto(TicketImpact Impact, TicketUrgency Urgency, TicketPriority Priority, bool IsDefault);

    /// <summary>The questions (impacts 1 to 4, urgencies 1 to 4, with their wording) and all 16 cells. Priority 1 Low, 2 Medium, 3 High, 4 Critical.</summary>
    public class PriorityMatrixDto
    {
        public List<PriorityChoiceDto> Impacts { get; set; } = new();
        public List<PriorityChoiceDto> Urgencies { get; set; } = new();
        public List<PriorityCellDto> Cells { get; set; } = new();
    }

    public class PriorityCellRequest
    {
        public TicketImpact Impact { get; set; }
        public TicketUrgency Urgency { get; set; }
        public TicketPriority Priority { get; set; }
    }

    /// <summary>The cells to change (each impact and urgency pair at most once). A cell sent at its default goes back to "not edited".</summary>
    public class SavePriorityMatrixRequest
    {
        public List<PriorityCellRequest>? Cells { get; set; }
    }

    /// <summary>reason: 5 to 500 characters, kept as an internal note.</summary>
    public class ChangePriorityRequest
    {
        public TicketPriority Priority { get; set; }
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>Whether the signed-in person can change this ticket's priority now, and what it is. Impact and urgency are shown to staff only; null on older tickets.</summary>
    public class PriorityOptionsDto
    {
        public bool CanChange { get; set; }
        public string? Reason { get; set; }
        public TicketPriority Priority { get; set; }
        public TicketImpact? Impact { get; set; }
        public TicketUrgency? Urgency { get; set; }
    }
}