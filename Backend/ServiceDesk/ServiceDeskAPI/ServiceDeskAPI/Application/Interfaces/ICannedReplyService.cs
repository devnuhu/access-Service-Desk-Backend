using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Saved replies. A unit's library is kept by its head, the Department Admin of its department and Super Admin; shared replies (no unit) by Super Admin.
    /// Staff of a ticket (its unit's members, HOD, Department Admin, Super Admin) read the replies that fit it, with placeholders filled in.
    /// </summary>
    public interface ICannedReplyService
    {
        /// <summary>Replies of the ticket's unit plus the shared ones, filled in for this ticket. Anyone who is not staff for the ticket gets 404.</summary>
        Task<(TicketProblem? Problem, List<TicketCannedReplyDto>? Replies)> ListForTicketAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);

        /// <summary>The library to edit: one unit's (unitId), or the shared one (unitId null, Super Admin).</summary>
        Task<(TicketProblem? Problem, List<CannedReplyDto>? Replies)> ListLibraryAsync(Guid? unitId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, CannedReplyDto? Reply)> CreateAsync(Guid? unitId, SaveCannedReplyRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, CannedReplyDto? Reply)> UpdateAsync(Guid replyId, SaveCannedReplyRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> DeleteAsync(Guid replyId, Guid actorUserId, bool actorIsSuperAdmin);
    }
}