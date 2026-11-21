using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    public class UnitToolsService : IUnitToolsService
    {
        private readonly AppDbContext _db;
        private readonly ICatalogueService _catalogue;
        private readonly IOrganisationService _org;

        public UnitToolsService(AppDbContext db, ICatalogueService catalogue, IOrganisationService org)
        {
            _db = db;
            _catalogue = catalogue;
            _org = org;
        }

        /// <summary>manage: may change skills (head, Department Admin, Super Admin). Otherwise may read (also the Head of Department).</summary>
        private async Task<(TicketProblem? Problem, Unit? Unit)> LoadAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin, bool manage)
        {
            var unit = await _db.Units.AsNoTracking().Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return (new TicketProblem(404, "Unit not found."), null);
            if (actorIsSuperAdmin) return (null, unit);
            var canManage = unit.HeadUserId == actorUserId || unit.Department?.AdminUserId == actorUserId;
            var canView = canManage || unit.Department?.HodUserId == actorUserId;
            if (manage && !canManage)
                return (new TicketProblem(403, "Only the head of the unit, the Department Admin or a Super Admin can change who handles which category."), null);
            if (!canView)
                return (new TicketProblem(403, "Only the head of the unit, the Head of Department, the Department Admin or a Super Admin can see this."), null);
            return (null, unit);
        }

        public async Task<(TicketProblem? Problem, List<CategoryAdminDto>? Categories)> CategoriesAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, unit) = await LoadAsync(unitId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var all = await _catalogue.ListAsync(unit!.DepartmentId);
            return (null, all.Where(c => c.UnitId == unitId).OrderBy(c => c.SortOrder).ThenBy(c => c.Name).ToList());
        }

        public async Task<(TicketProblem? Problem, List<UnitMemberDto>? Team)> TeamAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, _) = await LoadAsync(unitId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var members = await _org.ListMembersAsync(unitId);
            return members == null ? (new TicketProblem(404, "Unit not found."), null) : (null, members);
        }

        public async Task<(TicketProblem? Problem, UnitSkillsDto? Skills)> SkillsAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, _) = await LoadAsync(unitId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var skills = await _catalogue.GetUnitSkillsAsync(unitId);
            return skills == null ? (new TicketProblem(404, "Unit not found."), null) : (null, skills);
        }

        public async Task<(TicketProblem? Problem, string? Message)> SetSkillsAsync(Guid unitId, Guid userId, IReadOnlyCollection<Guid> categoryIds, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, _) = await LoadAsync(unitId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var result = await _catalogue.SetSkillsAsync(unitId, userId, categoryIds, actorUserId);
            return result.Success ? (null, result.Message) : (new TicketProblem(result.Status, result.Message), null);
        }
    }
}