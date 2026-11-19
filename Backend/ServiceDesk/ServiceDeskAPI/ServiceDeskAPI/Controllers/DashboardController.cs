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
    }
}
