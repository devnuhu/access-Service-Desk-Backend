using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Saved and shared reports (Step 9b). roles are the signed-in person's role names.</summary>
    public interface ISavedReportService
    {
        Task<(ReportProblem? Problem, List<SavedReportDto>? Reports)> ListAsync(Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles);

        /// <summary>One page of the same list, with search and scope (mine or shared).</summary>
        Task<(ReportProblem? Problem, SavedReportPageDto? Page)> ListPageAsync(Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles, string? search, string? scope, int page, int pageSize);

        /// <summary>Creates a report (id null) or updates one (owner or Super Admin).</summary>
        Task<(ReportProblem? Problem, SavedReportDto? Report)> SaveAsync(Guid? id, SaveReportRequest request, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles);

        Task<ReportProblem?> DeleteAsync(Guid id, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles);

        /// <summary>Runs a saved report with the viewer's own scope.</summary>
        Task<(ReportProblem? Problem, ReportResultDto? Result)> RunAsync(Guid id, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles, CancellationToken cancellationToken = default);
    }
}
