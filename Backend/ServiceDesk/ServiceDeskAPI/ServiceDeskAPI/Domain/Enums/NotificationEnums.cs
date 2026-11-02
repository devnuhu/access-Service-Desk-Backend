namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Colour and icon of a notification in the web app (same values as People Hub).</summary>
    public enum NotificationType
    {
        Info = 0,
        Success = 1,
        Warning = 2,
        ActionRequired = 3
    }

    /// <summary>Grouping of notifications in the bell (BRD M6).</summary>
    public enum NotificationCategory
    {
        System = 0,
        Ticket = 1,
        Assignment = 2,
        Sla = 3,
        Escalation = 4,
        Report = 5
    }
}