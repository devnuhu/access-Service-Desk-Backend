using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The checklist on a ticket. Staff of the ticket (its unit's members, the Head of Department, the Department Admin) and Super Admin only; everyone else gets 404.</summary>
    public interface ITicketTaskService
    {
        Task<(TicketProblem? Problem, TicketTasksDto? Tasks)> ListAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, TicketTaskDto? Item)> AddAsync(Guid ticketId, TicketTaskRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, TicketTaskDto? Item)> UpdateAsync(Guid ticketId, Guid taskId, TicketTaskRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, TicketTaskDto? Item)> SetDoneAsync(Guid ticketId, Guid taskId, bool done, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> RemoveAsync(Guid ticketId, Guid taskId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, List<PersonDto>? Owners)> OwnersAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
    }
}