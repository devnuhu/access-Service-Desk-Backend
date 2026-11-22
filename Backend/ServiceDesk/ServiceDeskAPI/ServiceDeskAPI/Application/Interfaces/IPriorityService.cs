using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The priority matrix (impact and urgency to priority) and changing a ticket's priority. The matrix is read by anyone signed in and edited by a Super Admin.
    /// A priority change is for the head of the ticket's unit, the Head of Department, the Department Admin and Super Admins, on open tickets, with a reason.
    /// </summary>
    public interface IPriorityService
    {
        Task<PriorityMatrixDto> GetMatrixAsync();
        Task<(TicketProblem? Problem, PriorityMatrixDto? Matrix)> SaveMatrixAsync(SavePriorityMatrixRequest request, Guid actorUserId);
        Task<(TicketProblem? Problem, PriorityOptionsDto? Options)> GetOptionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ChangeAsync(Guid ticketId, ChangePriorityRequest request, Guid actorUserId, bool actorIsSuperAdmin);
    }
}