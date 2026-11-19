using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Scheduled report emails (Step 9d). People manage only their own schedules; a report is always run with its owner's own scope.</summary>
    public interface IReportScheduleService
    {
        Task<(ReportProblem? Problem, List<ReportScheduleDto>? Schedules)> ListAsync(Guid userId, bool isSuperAdmin);

        /// <summary>Creates a schedule (id null) or changes your own. Saving resets the start: the first send is the next scheduled time after saving.</summary>
        Task<(ReportProblem? Problem, ReportScheduleDto? Schedule)> SaveAsync(Guid? id, SaveReportScheduleRequest request, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles);

        Task<ReportProblem?> DeleteAsync(Guid id, Guid userId);

        /// <summary>One pass at the given time (UTC): sends what is due and not yet sent. Returns how many emails were sent.</summary>
        Task<int> RunDueAsync(DateTime nowUtc, CancellationToken cancellationToken = default);
    }
}
