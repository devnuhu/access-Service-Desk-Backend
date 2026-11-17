using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Leave and out of office (BRD 5.3). Any signed-in person can call these; who may act for whom is checked against the
    /// organisation in the service (yourself; Head of Unit for their unit; HOD for their department; Super Admin for anyone).
    /// </summary>
    [ApiController]
    [Route("api/availability")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class AvailabilityController : ControllerBase
    {
        private readonly IAvailabilityService _availability;

        public AvailabilityController(IAvailabilityService availability) => _availability = availability;

        private Guid? Me() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Error(AdminResult result) => StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>My availability today and my current and future leave.</summary>
        [HttpGet("me")]
        [ProducesResponseType(typeof(MyAvailabilityDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MyAvailabilityDto>> Mine()
        {
            var me = Me();
            if (me == null) return Unauthorized();
            return Ok(await _availability.GetMineAsync(me.Value));
        }

        /// <summary>Records leave or out of office: for yourself (leave userId out), or for someone you manage.</summary>
        [HttpPost("absences")]
        [ProducesResponseType(typeof(AbsenceDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<AbsenceDto>> Create([FromBody] CreateAbsenceRequest request)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            if (!request.StartDate.HasValue) return BadRequest(new ApiError("Choose the start date.", "startDate", "Choose the start date."));
            if (!request.EndDate.HasValue) return BadRequest(new ApiError("Choose the end date.", "endDate", "Choose the end date."));
            if (request.EndDate < request.StartDate)
                return BadRequest(new ApiError("The end date must be on or after the start date.", "endDate", "Must be on or after the start date."));

            var (result, absence) = await _availability.CreateAsync(request, me.Value, IsSuperAdmin());
            return result.Success && absence != null ? Ok(absence) : Error(result);
        }

        /// <summary>Cancels a future period, or ends a current one early (it then ends yesterday).</summary>
        [HttpDelete("absences/{absenceId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Cancel(Guid absenceId)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            var result = await _availability.CancelAsync(absenceId, me.Value, IsSuperAdmin());
            return result.Success ? Ok(new MessageDto(result.Message)) : Error(result);
        }

        /// <summary>A unit's people, who is available today and their leave in the next 90 days (unit head, HOD, Department Admin, Super Admin).</summary>
        [HttpGet("units/{unitId:guid}")]
        [ProducesResponseType(typeof(UnitAvailabilityDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<UnitAvailabilityDto>> UnitView(Guid unitId)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            var (result, unit) = await _availability.GetUnitAsync(unitId, me.Value, IsSuperAdmin());
            return result.Success && unit != null ? Ok(unit) : Error(result);
        }

        /// <summary>Every active unit of a department (HOD, Super Admin).</summary>
        [HttpGet("departments/{departmentId:guid}")]
        [ProducesResponseType(typeof(List<UnitAvailabilityDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<UnitAvailabilityDto>>> DepartmentView(Guid departmentId)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            var (result, units) = await _availability.GetDepartmentAsync(departmentId, me.Value, IsSuperAdmin());
            return result.Success && units != null ? Ok(units) : Error(result);
        }
    }
}