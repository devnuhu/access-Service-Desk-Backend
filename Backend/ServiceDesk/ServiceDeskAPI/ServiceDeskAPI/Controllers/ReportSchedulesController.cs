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
    /// Scheduled report emails (Step 9d): your own schedules only. The report is emailed to you, run with your own scope.
    /// There is no "send now": a report is sent only at its scheduled time.
    /// </summary>
    [ApiController]
    [Route("api/reports/schedules")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class ReportSchedulesController : ControllerBase
    {
        private readonly IReportScheduleService _schedules;

        public ReportSchedulesController(IReportScheduleService schedules) => _schedules = schedules;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private List<string> Roles() => AppRoles.All.Where(r => User.IsInRole(r)).ToList();

        private ObjectResult Fail(ReportProblem problem) => StatusCode(problem.Status, new ApiError(problem.Message));

        /// <summary>Your schedules, with the next send time and the last result.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(List<ReportScheduleDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<List<ReportScheduleDto>>> List()
        {
            var (problem, schedules) = await _schedules.ListAsync(Me(), IsSuperAdmin());
            return problem == null && schedules != null ? Ok(schedules) : Fail(problem!);
        }

        /// <summary>Schedules one of the saved reports you can see. The first send is the next scheduled time after saving.</summary>
        [HttpPost]
        [ProducesResponseType(typeof(ReportScheduleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<ReportScheduleDto>> Create([FromBody] SaveReportScheduleRequest request)
        {
            var (problem, schedule) = await _schedules.SaveAsync(null, request, Me(), IsSuperAdmin(), Roles());
            return problem == null && schedule != null ? Ok(schedule) : Fail(problem!);
        }

        /// <summary>Changes your schedule, or switches it on or off. Saving resets the start to the next scheduled time.</summary>
        [HttpPut("{id:guid}")]
        [ProducesResponseType(typeof(ReportScheduleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<ReportScheduleDto>> Update(Guid id, [FromBody] SaveReportScheduleRequest request)
        {
            var (problem, schedule) = await _schedules.SaveAsync(id, request, Me(), IsSuperAdmin(), Roles());
            return problem == null && schedule != null ? Ok(schedule) : Fail(problem!);
        }

        [HttpDelete("{id:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid id)
        {
            var problem = await _schedules.DeleteAsync(id, Me());
            return problem == null ? Ok(new MessageDto("Schedule deleted.")) : Fail(problem);
        }
    }
}
