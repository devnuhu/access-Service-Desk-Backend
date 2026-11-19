using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The home-screen counts (Step 9e). Read-only.</summary>
    public interface IDashboardService
    {
        Task<DashboardSummaryDto> SummaryAsync(Guid userId, bool isSuperAdmin);
    }
}
