using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Reports (Step 9). Who may run what is decided here: unit heads see their own units, HOD and Department Admin their department, Super Admin everything.</summary>
    public interface IReportService
    {
        Task<(ReportProblem? Problem, ReportCatalogueDto? Catalogue)> CatalogueAsync(Guid userId, bool isSuperAdmin);

        Task<(ReportProblem? Problem, ReportResultDto? Result)> RunAsync(ReportSpec spec, Guid userId, bool isSuperAdmin, CancellationToken cancellationToken = default);
    }
}
