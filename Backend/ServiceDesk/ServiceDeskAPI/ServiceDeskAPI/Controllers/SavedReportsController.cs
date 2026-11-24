using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Api;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Saved reports (Step 9b): yours, and the ones shared with you. Running a shared report always uses your own scope.</summary>
    [ApiController]
    [Route("api/reports/saved")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class SavedReportsController : ControllerBase
    {
        private readonly ISavedReportService _saved;

        public SavedReportsController(ISavedReportService saved) => _saved = saved;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private List<string> Roles() => AppRoles.All.Where(r => User.IsInRole(r)).ToList();

        private ObjectResult Fail(ReportProblem problem) => StatusCode(problem.Status, new ApiError(problem.Message));

        /// <summary>Your saved reports and those shared with you, newest first, one page at a time. search covers the name, description and owner of all of them; scope is mine or shared; pageSize defaults to 10 (at most 100).</summary>
        [HttpGet]
        [ProducesResponseType(typeof(SavedReportPageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<SavedReportPageDto>> List([FromQuery] string? search, [FromQuery] string? scope, [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
        {
            var (problem, reports) = await _saved.ListPageAsync(Me(), IsSuperAdmin(), Roles(), search, scope, page, pageSize);
            return problem == null && reports != null ? Ok(reports) : Fail(problem!);
        }

        [HttpPost]
        [ProducesResponseType(typeof(SavedReportDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<SavedReportDto>> Create([FromBody] SaveReportRequest request)
        {
            var (problem, report) = await _saved.SaveAsync(null, request, Me(), IsSuperAdmin(), Roles());
            return problem == null && report != null ? Ok(report) : Fail(problem!);
        }

        /// <summary>The owner (or Super Admin) changes the name, the definition or who it is shared with.</summary>
        [HttpPut("{id:guid}")]
        [ProducesResponseType(typeof(SavedReportDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<SavedReportDto>> Update(Guid id, [FromBody] SaveReportRequest request)
        {
            var (problem, report) = await _saved.SaveAsync(id, request, Me(), IsSuperAdmin(), Roles());
            return problem == null && report != null ? Ok(report) : Fail(problem!);
        }

        [HttpDelete("{id:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid id)
        {
            var problem = await _saved.DeleteAsync(id, Me(), IsSuperAdmin(), Roles());
            return problem == null ? Ok(new MessageDto("Report deleted.")) : Fail(problem);
        }

        /// <summary>Runs a saved report. Nothing about the report changes.</summary>
        [HttpPost("{id:guid}/run")]
        [ProducesResponseType(typeof(ReportResultDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<ReportResultDto>> Run(Guid id, CancellationToken cancellationToken)
        {
            var (problem, result) = await _saved.RunAsync(id, Me(), IsSuperAdmin(), Roles(), cancellationToken);
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }
    }
}
