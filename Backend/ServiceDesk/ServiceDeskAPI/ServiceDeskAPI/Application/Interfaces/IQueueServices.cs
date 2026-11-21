using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>A person's own saved list views. Nobody sees or changes anyone else's (they answer 404).</summary>
    public interface ISavedViewService
    {
        Task<List<SavedViewDto>> ListAsync(Guid userId);
        Task<(TicketProblem? Problem, SavedViewDto? View)> CreateAsync(Guid userId, SaveViewRequest request);
        Task<(TicketProblem? Problem, SavedViewDto? View)> UpdateAsync(Guid userId, Guid viewId, SaveViewRequest request);
        Task<(TicketProblem? Problem, string? Message)> DeleteAsync(Guid userId, Guid viewId);
    }

    /// <summary>
    /// The same action on up to 50 tickets, one after another. Each ticket goes through the service that does it for a single ticket, so every rule and
    /// notification is the same; one ticket failing never stops the others. A ticket the person cannot see answers 404 in its result.
    /// </summary>
    public interface IBulkTicketService
    {
        Task<(TicketProblem? Problem, BulkResultDto? Result)> PickAsync(BulkRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, BulkResultDto? Result)> AcknowledgeAsync(BulkRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, BulkResultDto? Result)> ReassignAsync(BulkReassignRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, BulkResultDto? Result)> ResolveAsync(BulkResolveRequest request, Guid actorUserId, bool actorIsSuperAdmin);
    }

    /// <summary>Records that the signed-in person opened a ticket they can see (clears its unread marker).</summary>
    public interface ITicketReadService
    {
        Task<TicketProblem?> MarkReadAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
    }
}