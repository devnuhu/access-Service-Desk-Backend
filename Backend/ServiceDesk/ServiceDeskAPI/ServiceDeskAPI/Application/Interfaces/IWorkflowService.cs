using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The ticket workflow (BRD Section 8, FR-4.2 to FR-4.6). Who does what:
    /// - the assignee: acknowledge (Assigned or Reopened to In progress), set Pending with a reason, resume, resolve with a code and a note;
    /// - the requester (or whoever raised it): confirm or reopen a Resolved ticket; cancel it before work starts (New or Assigned);
    /// - a Super Admin: cancel any ticket that is not finished (FR-7.6).
    /// A requester's public reply resumes a ticket waiting on them (TicketService). Auto-close after 3 business days comes with Step 7.
    /// Anyone who cannot see the ticket gets 404; someone who can see it but may not do this gets 403.
    /// </summary>
    public interface IWorkflowService
    {
        Task<(TicketProblem? Problem, TicketActionsDto? Actions)> GetActionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> AcknowledgeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> SetPendingAsync(Guid ticketId, SetPendingRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ResumeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ResolveAsync(Guid ticketId, ResolveRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ConfirmAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ReopenAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> CancelAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> EscalateAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin);
    }
}