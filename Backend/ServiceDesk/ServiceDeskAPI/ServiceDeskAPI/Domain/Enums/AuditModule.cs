namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Which part of the Service Desk an audit entry relates to.</summary>
    public enum AuditModule
    {
        System = 1,
        Authentication = 2,
        Administration = 3,
        Units = 4,
        Catalogue = 5,
        Tickets = 6,
        Assignment = 7,
        Sla = 8,
        Notifications = 9,
        Reports = 10
    }
}