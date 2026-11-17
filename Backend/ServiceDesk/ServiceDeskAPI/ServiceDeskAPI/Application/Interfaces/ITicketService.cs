using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Locations for the ticket form (HQ at launch; a Super Admin keeps the list).</summary>
    public interface ILocationService
    {
        /// <summary>Active locations, and the one to pre-select for this person (their last ticket's location, or the only one).</summary>
        Task<LocationChoicesDto> GetChoicesAsync(Guid userId);
        Task<List<LocationDto>> ListAsync();
        Task<(AdminResult Result, LocationDto? Location)> CreateAsync(SaveLocationRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateAsync(Guid locationId, SaveLocationRequest request, Guid? actorUserId);
    }

    /// <summary>A failed ticket action: HTTP status, message, the first field to blame and (Step 6) every field to blame.</summary>
    public sealed record TicketProblem(int Status, string Message, string? Field = null, IReadOnlyDictionary<string, string>? Errors = null);

    /// <summary>
    /// Raising, reading and commenting on tickets (BRD M2, M4). Visibility: the requester, whoever raised it, the people copied, staff of
    /// the ticket's department (unit members and its HOD) and Super Admins. Anyone else gets 404, so references cannot be probed.
    /// Internal notes and their files: department staff and Super Admins only.
    /// </summary>
    public interface ITicketService
    {
        Task<(TicketProblem? Problem, CreatedTicketDto? Ticket)> CreateAsync(CreateTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, DuplicateCheckDto? Result)> CheckDuplicatesAsync(DuplicateCheckRequest request, Guid actorUserId);

        /// <summary>
        /// view: mine (raised by or for me), copied, assigned (to me), department (departmentId; staff of it or Super Admin).
        /// departmentId and unitId narrow every view; open=true keeps New, Assigned, In progress, Pending and Reopened.
        /// </summary>
        Task<(TicketProblem? Problem, TicketPageDto? Page)> ListAsync(string? view, Guid? departmentId, Guid? unitId, TicketStatus? status, bool? open, string? search,
            int page, int pageSize, Guid actorUserId, bool actorIsSuperAdmin, bool? waitingToStart = null, string? sort = null, bool? slaBreached = null, bool? escalated = null);

        Task<(TicketProblem? Problem, TicketDetailDto? Ticket)> GetAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<Guid?> FindIdByReferenceAsync(string reference);
        /// <summary>Open tickets of a department (optionally one unit) counted by SLA level. Staff of the department and Super Admin.</summary>
        Task<(TicketProblem? Problem, SlaSummaryDto? Summary)> SlaSummaryAsync(Guid departmentId, Guid? unitId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, TicketCommentDto? Comment)> AddCommentAsync(Guid ticketId, AddCommentRequest request, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, string? FileName, string? ContentType, byte[]? Data)> GetAttachmentAsync(Guid ticketId, Guid attachmentId,
            Guid actorUserId, bool actorIsSuperAdmin);
    }
}