using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Audit logging (same contract as People Hub). The audit log is append-only.</summary>
    public interface IAuditService
    {
        /// <summary>
        /// Writes one entry straight away, in its own save, so it never saves other pending changes of the caller.
        /// Never throws: a failed audit write is logged as an error and the main operation goes on.
        /// </summary>
        Task LogAsync(
            Guid? userId,
            string? userDisplayName,
            AuditAction action,
            string entityType,
            Guid entityId,
            string? entityDisplayName,
            string? oldValues,
            string? newValues,
            string? ipAddress,
            string? userAgent,
            AuditModule module);

        /// <summary>
        /// Adds an entry to the current unit of work WITHOUT saving it. The caller's SaveChangesAsync saves the change
        /// and its audit entry together: if either fails, neither is saved. Use this for every business change.
        /// </summary>
        void Stage(
            Guid? userId,
            string? userDisplayName,
            AuditAction action,
            string entityType,
            Guid entityId,
            string? entityDisplayName,
            string? oldValues,
            string? newValues,
            string? ipAddress,
            string? userAgent,
            AuditModule module);
    }
}