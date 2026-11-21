using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The home-screen counts (Step 9e). Read-only.</summary>
    public interface IDashboardService
    {
        Task<DashboardSummaryDto> SummaryAsync(Guid userId, bool isSuperAdmin);
        /// <summary>One unit's dashboard: the unit's head, the Head of Department or Department Admin of its department, or a Super Admin. 404 unknown unit, 403 anyone else.</summary>
        Task<(TicketProblem? Problem, UnitDashboardDto? Dashboard)> UnitAsync(Guid unitId, Guid userId, bool isSuperAdmin);
    }
}
