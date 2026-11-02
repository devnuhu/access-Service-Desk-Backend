namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>What kind of operation was performed (People Hub values 1-12 kept; Service Desk values from 13).</summary>
    public enum AuditAction
    {
        Created = 1,
        Updated = 2,
        StatusChanged = 3,
        Approved = 4,
        Rejected = 5,
        Deleted = 6,
        Uploaded = 7,
        Downloaded = 8,
        Login = 9,
        Logout = 10,
        PasswordChanged = 11,
        RoleChanged = 12,
        LoginFailed = 13,
        Assigned = 14,
        Reassigned = 15,
        Acknowledged = 16,
        Escalated = 17,
        Resolved = 18,
        Reopened = 19,
        Cancelled = 20,
        SlaBreached = 21,
        Exported = 22,
        ConfigurationChanged = 23
    }
}