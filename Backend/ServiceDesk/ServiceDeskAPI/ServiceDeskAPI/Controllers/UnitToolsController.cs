using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// The head's own unit: categories, team and who handles what. Read: the unit's head, the Head of Department, the Department Admin, Super Admin.
    /// Changing skills: the unit's head, the Department Admin, Super Admin. Others 403; unknown unit 404.
    /// </summary>
    [ApiController]
    [Route("api/units/{unitId:guid}")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
    public class UnitToolsController : ControllerBase
    {
        private readonly IUnitToolsService _tools;

        public UnitToolsController(IUnitToolsService tools) => _tools = tools;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>The unit's categories (its functions) with timeline, default priority, how many people handle each and whether it needs cover.</summary>
        [HttpGet("categories")]
        [ProducesResponseType(typeof(List<CategoryAdminDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CategoryAdminDto>>> Categories(Guid unitId)
        {
            var (problem, list) = await _tools.CategoriesAsync(unitId, Me(), IsSuperAdmin());
            return problem == null && list != null ? Ok(list) : Fail(problem!);
        }

        /// <summary>The unit's members (the head included).</summary>
        [HttpGet("team")]
        [ProducesResponseType(typeof(List<UnitMemberDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<UnitMemberDto>>> Team(Guid unitId)
        {
            var (problem, list) = await _tools.TeamAsync(unitId, Me(), IsSuperAdmin());
            return problem == null && list != null ? Ok(list) : Fail(problem!);
        }

        /// <summary>The skills matrix: categories (columns), members (rows) and what each member handles, with cover warnings.</summary>
        [HttpGet("skills")]
        [ProducesResponseType(typeof(UnitSkillsDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<UnitSkillsDto>> Skills(Guid unitId)
        {
            var (problem, skills) = await _tools.SkillsAsync(unitId, Me(), IsSuperAdmin());
            return problem == null && skills != null ? Ok(skills) : Fail(problem!);
        }

        /// <summary>Sets exactly which of the unit's categories this member handles (an empty list clears them). Head, Department Admin, Super Admin.</summary>
        [HttpPut("skills/{userId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<MessageDto>> SetSkills(Guid unitId, Guid userId, [FromBody] SetSkillsRequest request)
        {
            var (problem, message) = await _tools.SetSkillsAsync(unitId, userId, request.CategoryIds ?? new List<Guid>(), Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
    }
}