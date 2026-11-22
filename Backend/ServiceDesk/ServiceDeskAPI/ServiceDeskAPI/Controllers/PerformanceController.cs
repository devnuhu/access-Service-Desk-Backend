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
    /// Performance figures and chart series. Everyone signed in sees their own; a unit head sees their unit and its members; the Head of Department and the Department Admin
    /// see their department's units; a Super Admin sees everything. Query for all three: preset (today, last7, last30, thismonth, lastmonth, thisquarter, thisyear, all) or from and to (yyyy-MM-dd).
    /// </summary>
    [ApiController]
    [Route("api/performance")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class PerformanceController : ControllerBase
    {
        private readonly IPerformanceService _performance;

        public PerformanceController(IPerformanceService performance) => _performance = performance;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) => StatusCode(problem.Status, new ApiError(problem.Message));

        /// <summary>My own figures: assigned, resolved, open and on hold; resolution and first-response performance against the targets; the unit's averages; a series for charts.</summary>
        [HttpGet("me")]
        [ProducesResponseType(typeof(PerformanceDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<PerformanceDto>> Mine([FromQuery] PerformanceQuery query)
        {
            var (problem, result) = await _performance.MineAsync(query, Me());
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }

        /// <summary>One person, for their head, the Head of Department, the Department Admin or a Super Admin. 404 for anyone else.</summary>
        [HttpGet("people/{userId:guid}")]
        [ProducesResponseType(typeof(PerformanceDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<PerformanceDto>> Person(Guid userId, [FromQuery] PerformanceQuery query)
        {
            var (problem, result) = await _performance.PersonAsync(userId, query, Me(), IsSuperAdmin());
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }

        /// <summary>A unit: totals, every member, the trend, open tickets by status, priority and age, and its busiest categories. 403 for anyone who does not head or oversee it.</summary>
        [HttpGet("units/{unitId:guid}")]
        [ProducesResponseType(typeof(UnitPerformanceDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<UnitPerformanceDto>> Unit(Guid unitId, [FromQuery] PerformanceQuery query)
        {
            var (problem, result) = await _performance.UnitAsync(unitId, query, Me(), IsSuperAdmin());
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }
    }
}