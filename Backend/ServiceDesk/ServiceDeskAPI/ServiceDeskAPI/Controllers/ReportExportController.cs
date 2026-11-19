using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Api;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Reports;
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Report downloads (Step 9c): Excel (.xlsx) or CSV, for any definition or any saved report you can see. The same scope rules as running the
    /// report apply, and every download is written to the audit log.
    /// </summary>
    [ApiController]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class ReportExportController : ControllerBase
    {
        private const int MaxExportRows = 50000;

        private readonly IReportService _reports;
        private readonly ISavedReportService _saved;
        private readonly IAuditService _audit;
        private readonly SlaOptions _sla;

        public ReportExportController(IReportService reports, ISavedReportService saved, IAuditService audit, IOptions<SlaOptions> sla)
        {
            _reports = reports;
            _saved = saved;
            _audit = audit;
            _sla = sla.Value;
        }

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private List<string> Roles() => AppRoles.All.Where(r => User.IsInRole(r)).ToList();

        private ObjectResult Fail(ReportProblem problem) => StatusCode(problem.Status, new ApiError(problem.Message));

        /// <summary>Runs a definition and downloads it. format = xlsx (default) or csv. List reports are limited to 50,000 rows.</summary>
        [HttpPost("api/reports/export")]
        [FileDownload]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<IActionResult> Export([FromBody] ReportSpec spec, [FromQuery] string format = "xlsx", CancellationToken cancellationToken = default)
        {
            var kind = ParseFormat(format);
            if (kind == null) return BadRequest(new ApiError("format must be xlsx or csv."));
            spec ??= new ReportSpec();
            spec.Limit ??= MaxExportRows;
            var (problem, result) = await _reports.RunAsync(spec, Me(), IsSuperAdmin(), cancellationToken);
            if (problem != null || result == null) return Fail(problem!);
            return await DownloadAsync(result, kind, Guid.Empty);
        }

        /// <summary>Downloads a saved report (yours, or shared with you), run with your own scope.</summary>
        [HttpPost("api/reports/saved/{id:guid}/export")]
        [FileDownload]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<IActionResult> ExportSaved(Guid id, [FromQuery] string format = "xlsx", CancellationToken cancellationToken = default)
        {
            var kind = ParseFormat(format);
            if (kind == null) return BadRequest(new ApiError("format must be xlsx or csv."));
            var (listProblem, list) = await _saved.ListAsync(Me(), IsSuperAdmin(), Roles());
            if (listProblem != null || list == null) return Fail(listProblem!);
            var report = list.FirstOrDefault(r => r.Id == id);
            if (report == null) return NotFound(new ApiError("Report not found."));
            var spec = report.Definition;
            if (string.IsNullOrWhiteSpace(spec.Title)) spec.Title = report.Name;
            spec.Limit ??= MaxExportRows;
            var (problem, result) = await _reports.RunAsync(spec, Me(), IsSuperAdmin(), cancellationToken);
            if (problem != null || result == null) return Fail(problem!);
            return await DownloadAsync(result, kind, id);
        }

        private static string? ParseFormat(string? format) => (format ?? "xlsx").Trim().ToLowerInvariant() switch { "xlsx" => "xlsx", "csv" => "csv", _ => null };

        private async Task<IActionResult> DownloadAsync(ReportResultDto result, string kind, Guid reportId)
        {
            var offset = _sla.UtcOffsetHours;
            var bytes = kind == "xlsx" ? ReportExporter.ToXlsx(result, offset) : ReportExporter.ToCsv(result, offset);
            var name = ReportExporter.FileName(result, kind, DateTime.UtcNow, offset);
            await _audit.LogAsync(Me(), User.Identity?.Name, AuditAction.Exported, "Report", reportId, result.Title, null,
                JsonSerializer.Serialize(new { format = kind, rows = result.Rows.Count, source = result.Source, mode = result.Mode }),
                HttpContext.Connection.RemoteIpAddress?.ToString(), Request.Headers.UserAgent.ToString(), AuditModule.Reports);
            Response.Headers.CacheControl = "private, no-store";
            return File(bytes, kind == "xlsx" ? ReportExporter.XlsxType : ReportExporter.CsvType, name);
        }
    }
}
