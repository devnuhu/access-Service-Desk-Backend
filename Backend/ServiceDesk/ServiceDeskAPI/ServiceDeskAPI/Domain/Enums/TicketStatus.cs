namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>The eight ticket statuses (BRD Section 8). Step 4 creates tickets as New; later steps move them on.</summary>
    public enum TicketStatus
    {
        New = 1,
        Assigned = 2,
        InProgress = 3,
        Pending = 4,
        Resolved = 5,
        Reopened = 6,
        Closed = 7,
        Cancelled = 8
    }
}