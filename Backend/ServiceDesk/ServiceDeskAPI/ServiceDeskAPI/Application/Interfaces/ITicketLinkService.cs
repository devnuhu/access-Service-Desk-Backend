using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Links and merges between tickets. Only staff may use them: someone who works in the ticket's unit, the Head of Department, the Department Admin, Super Admin.
    /// Both tickets must be ones the person is staff for (otherwise 404, so nothing leaks). A merge needs two open tickets of the same unit.
    /// </summary>
    public interface ITicketLinkService
    {
        Task<(TicketProblem? Problem, List<TicketLinkDto>? Links)> ListAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, TicketLinkDto? Link)> AddAsync(Guid ticketId, AddTicketLinkRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> RemoveAsync(Guid ticketId, Guid linkId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> MergeAsync(Guid ticketId, MergeTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin);
    }
}