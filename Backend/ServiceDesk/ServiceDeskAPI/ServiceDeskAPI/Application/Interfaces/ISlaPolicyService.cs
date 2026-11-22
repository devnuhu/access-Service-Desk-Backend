using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The service levels (response and resolution targets per priority). Super Admin only; who may call it is decided by the controller.</summary>
    public interface ISlaPolicyService
    {
        Task<SlaPoliciesDto> GetAsync();

        Task<(TicketProblem? Problem, SlaPolicyRowDto? Row)> SaveAsync(SaveSlaPolicyRequest request, Guid actorUserId);

        /// <summary>Removes a saved level, so the next level up (or the built-in default) applies again.</summary>
        Task<TicketProblem?> DeleteAsync(Guid id);
    }
}