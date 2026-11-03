namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Ticket priority (BRD FR-2.2). Workload weights: Critical 3, High 2, Medium 1, Low 1 (FR-3.3).</summary>
    public enum TicketPriority
    {
        Low = 1,
        Medium = 2,
        High = 3,
        Critical = 4
    }
}