using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Super Admin: departments, units, heads and members (BRD Section 5, FR-7.2). The Case Worker, Head of Unit and HOD roles
    /// follow from these settings automatically; they are not given on the People page.
    /// </summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminOrganisationController : ControllerBase
    {
        private readonly IOrganisationService _org;

        public AdminOrganisationController(IOrganisationService org) => _org = org;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private ActionResult<MessageDto> From(AdminResult result) =>
            result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>Every department with its units, heads, deputies and member counts.</summary>
        [HttpGet("departments")]
        [ProducesResponseType(typeof(List<DepartmentDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<DepartmentDto>>> Departments() => Ok(await _org.ListDepartmentsAsync());

        [HttpPost("departments")]
        [ProducesResponseType(typeof(DepartmentDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<DepartmentDto>> CreateDepartment([FromBody] CreateDepartmentRequest request)
        {
            var (result, department) = await _org.CreateDepartmentAsync(request, Actor());
            return result.Success && department != null ? Ok(department) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename and/or switch on or off. A department is switched off only when its units are off.</summary>
        [HttpPatch("departments/{departmentId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> UpdateDepartment(Guid departmentId, [FromBody] UpdateOrgItemRequest request)
            => From(await _org.UpdateDepartmentAsync(departmentId, request, Actor()));

        /// <summary>Sets (or clears, with userId null) the Head of Department. The HOD cannot be a member of a unit in the department.</summary>
        [HttpPut("departments/{departmentId:guid}/hod")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetHod(Guid departmentId, [FromBody] SetPersonRequest request)
            => From(await _org.SetHodAsync(departmentId, request.UserId, Actor()));

        [HttpPost("departments/{departmentId:guid}/units")]
        [ProducesResponseType(typeof(UnitDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<UnitDto>> CreateUnit(Guid departmentId, [FromBody] CreateUnitRequest request)
        {
            var (result, unit) = await _org.CreateUnitAsync(departmentId, request, Actor());
            return result.Success && unit != null ? Ok(unit) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename and/or switch on or off. A unit is switched off only when it has no members.</summary>
        [HttpPatch("units/{unitId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> UpdateUnit(Guid unitId, [FromBody] UpdateOrgItemRequest request)
            => From(await _org.UpdateUnitAsync(unitId, request, Actor()));

        /// <summary>Sets (or clears) the Head of Unit. The head becomes a member of the unit with staff category Head of Unit.</summary>
        [HttpPut("units/{unitId:guid}/head")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> SetHead(Guid unitId, [FromBody] SetPersonRequest request)
            => From(await _org.SetUnitHeadAsync(unitId, request.UserId, Actor()));

        /// <summary>Sets (or clears) the deputy Head of Unit, who must be a member of the unit.</summary>
        [HttpPut("units/{unitId:guid}/deputy")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetDeputy(Guid unitId, [FromBody] SetPersonRequest request)
            => From(await _org.SetUnitDeputyAsync(unitId, request.UserId, Actor()));

        [HttpGet("units/{unitId:guid}/members")]
        [ProducesResponseType(typeof(List<UnitMemberDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<UnitMemberDto>>> Members(Guid unitId)
        {
            var members = await _org.ListMembersAsync(unitId);
            return members == null ? NotFound(new ApiError("Unit not found.")) : Ok(members);
        }

        /// <summary>Adds a case worker to the unit (one unit per person per department).</summary>
        [HttpPost("units/{unitId:guid}/members")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> AddMember(Guid unitId, [FromBody] AddUnitMemberRequest request)
        {
            if (request.UserId == Guid.Empty) return BadRequest(new ApiError("Choose a person.", "userId", "Choose a person."));
            return From(await _org.AddMemberAsync(unitId, request.UserId, request.StaffNo, Actor()));
        }

        /// <summary>Removes a member (history kept). Not the head or the deputy: change those first.</summary>
        [HttpDelete("units/{unitId:guid}/members/{userId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> RemoveMember(Guid unitId, Guid userId)
            => From(await _org.RemoveMemberAsync(unitId, userId, Actor()));
    }

    /// <summary>The organisation as seen by any signed-in person.</summary>
    [ApiController]
    [Route("api/org")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class OrgController : ControllerBase
    {
        private readonly IOrganisationService _org;

        public OrgController(IOrganisationService org) => _org = org;

        /// <summary>The departments and units the signed-in person heads, deputises or works in. The web app builds module menus from this.</summary>
        [HttpGet("me")]
        [ProducesResponseType(typeof(MyOrganisationDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MyOrganisationDto>> Me()
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId)) return Unauthorized();
            return Ok(await _org.GetMyOrganisationAsync(userId));
        }

        /// <summary>Active departments that receive tickets, with their active units.</summary>
        [HttpGet("departments")]
        [ProducesResponseType(typeof(List<OrgDepartmentDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<OrgDepartmentDto>>> Departments() => Ok(await _org.ListActiveDepartmentsAsync());
    }
}