using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The head's view of their own unit: its categories, its team and the skills matrix, and setting who handles which category.
    /// Read: the unit's head, the Head of Department, the Department Admin, Super Admin. Change skills: the unit's head, the Department Admin, Super Admin.
    /// Anyone else gets 403; an unknown unit 404. Categories themselves are still kept by the Super Admin.
    /// </summary>
    public interface IUnitToolsService
    {
        Task<(TicketProblem? Problem, List<CategoryAdminDto>? Categories)> CategoriesAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, List<UnitMemberDto>? Team)> TeamAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, UnitSkillsDto? Skills)> SkillsAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> SetSkillsAsync(Guid unitId, Guid userId, IReadOnlyCollection<Guid> categoryIds, Guid actorUserId, bool actorIsSuperAdmin);
    }
}