using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Api;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Reports (Step 9). Open to unit heads, the Head of Department, Department Admins and Super Admin; the service limits what each can see.
    /// </summary>
    [ApiController]
    [Route("api/reports")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class ReportsController : ControllerBase
    {
        private readonly IReportService _reports;

        public ReportsController(IReportService reports) => _reports = reports;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        /// <summary>What a report can show: measures, groupings, list columns, date presets, and the built-in reports R1 to R9 as ready-made definitions.</summary>
        [HttpGet("catalogue")]
        [ProducesResponseType(typeof(ReportCatalogueDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<ReportCatalogueDto>> Catalogue()
        {
            var (problem, catalogue) = await _reports.CatalogueAsync(Me(), IsSuperAdmin());
            return problem == null && catalogue != null ? Ok(catalogue) : StatusCode(problem!.Status, new ApiError(problem.Message));
        }

        /// <summary>Runs a definition and returns the table. Nothing is saved.</summary>
        [HttpPost("run")]
        [ProducesResponseType(typeof(ReportResultDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<ReportResultDto>> Run([FromBody] ReportSpec spec, CancellationToken cancellationToken)
        {
            var (problem, result) = await _reports.RunAsync(spec, Me(), IsSuperAdmin(), cancellationToken);
            return problem == null && result != null ? Ok(result) : StatusCode(problem!.Status, new ApiError(problem.Message));
        }
    }
}
