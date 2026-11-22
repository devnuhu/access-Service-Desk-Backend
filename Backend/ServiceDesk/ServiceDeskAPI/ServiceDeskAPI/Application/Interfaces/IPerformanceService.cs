using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Runs a report definition with no scope check of its own. Only for code that has already decided who may see what and has narrowed the definition
    /// (assignee or unit) itself; the Reports screens never use it.
    /// </summary>
    public interface IReportRunner
    {
        Task<(ReportProblem? Problem, ReportResultDto? Result)> RunTrustedAsync(ReportSpec spec, CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Performance figures and chart series, from the same calculations as the reports. A person sees their own; a unit head sees their unit and its members;
    /// the Head of Department and Department Admin see their department's units; a Super Admin sees everything. Anyone else gets 404 for a person, 403 for a unit.
    /// </summary>
    public interface IPerformanceService
    {
        Task<(TicketProblem? Problem, PerformanceDto? Performance)> MineAsync(PerformanceQuery query, Guid actorUserId);
        Task<(TicketProblem? Problem, PerformanceDto? Performance)> PersonAsync(Guid userId, PerformanceQuery query, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, UnitPerformanceDto? Performance)> UnitAsync(Guid unitId, PerformanceQuery query, Guid actorUserId, bool actorIsSuperAdmin);
    }
}