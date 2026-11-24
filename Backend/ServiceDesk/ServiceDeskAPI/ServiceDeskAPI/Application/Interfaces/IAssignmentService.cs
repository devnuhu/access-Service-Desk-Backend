using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Automatic assignment and reassignment (BRD M3).
    /// Eligible: active members of the ticket's unit, with an active account, available today (not on leave), mapped to the category.
    /// The HOD is never a member of a unit in their department, so never eligible. Lowest weighted workload wins; ties go to the
    /// least recently assigned. Nobody eligible: the ticket stays New, the unit's head is told once, and the queue is
    /// tried again every few minutes and whenever availability, skills or membership change.
    /// </summary>
    public interface IAssignmentService
    {
        /// <summary>Assigns a New ticket (or one whose assignee is away and has not started it). Returns true when it now has an assignee.</summary>
        Task<bool> AssignAsync(Guid ticketId, string trigger, CancellationToken cancellationToken = default);

        /// <summary>The queue pass: New tickets, Assigned tickets whose assignee became unavailable (FR-3.11), and in-progress ones to flag. Returns how many were assigned.</summary>
        Task<int> ProcessQueueAsync(CancellationToken cancellationToken = default);

        Task<(TicketProblem? Problem, ReassignOptionsDto? Options)> GetReassignOptionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ReassignAsync(Guid ticketId, ReassignRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, List<TicketAssignmentDto>? History)> GetHistoryAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);

        /// <summary>New tickets waiting in the units the person works in: members see their mapped categories, a head sees every category of the unit.</summary>
        Task<List<PoolTicketDto>> ListPoolAsync(Guid actorUserId);

        /// <summary>The unit pool one page at a time: search, unit filter, per-unit counts. Oldest first.</summary>
        Task<PoolPageDto> ListPoolPageAsync(Guid actorUserId, string? search, Guid? unitId, int page, int pageSize);

        /// <summary>Claims a New ticket from the unit pool. Members: only categories they handle. Head: any category of the unit.</summary>
        Task<(TicketProblem? Problem, string? Message)> PickAsync(Guid ticketId, Guid actorUserId);
        /// <summary>The person searching is left out of their own results.</summary>
        Task<(TicketProblem? Problem, List<PersonSearchResultDto>? People)> SearchPeopleAsync(string? query, Guid actorUserId);
    }

    /// <summary>Wakes the assignment queue early (someone came back from leave, got new skills or joined a unit). Never blocks.</summary>
    public interface IAssignmentSignal
    {
        void Poke();
        Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken);
    }
}