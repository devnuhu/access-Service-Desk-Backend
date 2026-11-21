using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Suggested subject and description per category. Read and change: Super Admin, the head of the category's unit, the Department Admin.
    /// Everyone signed in can read the filled-in templates of the categories requesters can choose.
    /// </summary>
    public interface ICategoryTemplateService
    {
        Task<(TicketProblem? Problem, CategoryTemplateDto? Template)> GetAsync(Guid categoryId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, CategoryTemplateDto? Template)> SaveAsync(Guid categoryId, SaveCategoryTemplateRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<List<CatalogueTemplateDto>> ListForRequesterAsync(Guid userId);
    }
}