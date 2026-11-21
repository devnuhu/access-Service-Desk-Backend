using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Home-screen counts (Step 9e). Any signed-in person; what they see is decided by what they lead.</summary>
    [ApiController]
    [Route("api/dashboard")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class DashboardController : ControllerBase
    {
        private readonly IDashboardService _dashboard;

        public DashboardController(IDashboardService dashboard) => _dashboard = dashboard;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        /// <summary>
        /// "mine": your open tickets (waiting, warning, overdue), tickets you raised, tickets waiting for your confirmation.
        /// "overview": open, waiting to start, unassigned, warning, overdue, far past and escalated per unit, with a total, for the units you oversee
        /// (Super Admin all; HOD and Department Admin their department; unit head their unit). Null for everyone else.
        /// </summary>
        [HttpGet("summary")]
        [ProducesResponseType(typeof(DashboardSummaryDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<DashboardSummaryDto>> Summary() => Ok(await _dashboard.SummaryAsync(Me(), IsSuperAdmin()));

        /// <summary>
        /// One unit's dashboard: its pool by category, team workload and leave, categories and cover, escalations to the head, and tickets past their deadline.
        /// The head of the unit, the Head of Department or Department Admin of its department, or a Super Admin. 403 anyone else, 404 unknown unit.
        /// </summary>
        [HttpGet("unit/{unitId:guid}")]
        [ProducesResponseType(typeof(UnitDashboardDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<UnitDashboardDto>> Unit(Guid unitId)
        {
            var (problem, dashboard) = await _dashboard.UnitAsync(unitId, Me(), IsSuperAdmin());
            return problem == null && dashboard != null ? Ok(dashboard) : StatusCode(problem!.Status, new ApiError(problem.Message));
        }
    }
}
