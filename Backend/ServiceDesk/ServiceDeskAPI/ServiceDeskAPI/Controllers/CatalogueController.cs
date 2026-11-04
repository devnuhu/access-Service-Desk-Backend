using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Super Admin: categories (BRD Section 7, FR-7.1) and the skills matrix (BRD 5.2, FR-7.3).</summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminCatalogueController : ControllerBase
    {
        private readonly ICatalogueService _catalogue;

        public AdminCatalogueController(ICatalogueService catalogue) => _catalogue = catalogue;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private ActionResult<MessageDto> From(AdminResult result) =>
            result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>Categories (all departments, or one), with how many case workers can take each and whether it needs cover.</summary>
        [HttpGet("categories")]
        [ProducesResponseType(typeof(List<CategoryAdminDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CategoryAdminDto>>> Categories([FromQuery] Guid? departmentId) => Ok(await _catalogue.ListAsync(departmentId));

        /// <summary>New category in a unit (and so in that unit's department).</summary>
        [HttpPost("categories")]
        [ProducesResponseType(typeof(CategoryAdminDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CategoryAdminDto>> Create([FromBody] CreateCategoryRequest request)
        {
            if (request.UnitId == Guid.Empty) return BadRequest(new ApiError("Choose the unit that handles it.", "unitId", "Choose a unit."));
            var (result, category) = await _catalogue.CreateAsync(request, Actor());
            return result.Success && category != null ? Ok(category) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename, describe, move to another unit of the department, change timeline, priority or order, switch on or off.</summary>
        [HttpPatch("categories/{categoryId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Update(Guid categoryId, [FromBody] UpdateCategoryRequest request)
            => From(await _catalogue.UpdateAsync(categoryId, request, Actor()));

        /// <summary>Active categories with fewer than two eligible case workers (BRD 5.2).</summary>
        [HttpGet("categories/cover-warnings")]
        [ProducesResponseType(typeof(List<CategoryCoverDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CategoryCoverDto>>> CoverWarnings() => Ok(await _catalogue.CoverWarningsAsync());

        /// <summary>The skills matrix of a unit: its categories, its members and what each handles.</summary>
        [HttpGet("units/{unitId:guid}/skills")]
        [ProducesResponseType(typeof(UnitSkillsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<UnitSkillsDto>> Skills(Guid unitId)
        {
            var skills = await _catalogue.GetUnitSkillsAsync(unitId);
            return skills == null ? NotFound(new ApiError("Unit not found.")) : Ok(skills);
        }

        /// <summary>Sets exactly which of the unit's categories this member handles (an empty list clears them).</summary>
        [HttpPut("units/{unitId:guid}/skills/{userId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetSkills(Guid unitId, Guid userId, [FromBody] SetSkillsRequest request)
            => From(await _catalogue.SetSkillsAsync(unitId, userId, request.CategoryIds ?? new List<Guid>(), Actor()));
    }

    /// <summary>The catalogue as any signed-in person sees it when raising a ticket.</summary>
    [ApiController]
    [Route("api/catalogue")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class CatalogueController : ControllerBase
    {
        private readonly ICatalogueService _catalogue;

        public CatalogueController(ICatalogueService catalogue) => _catalogue = catalogue;

        /// <summary>Active departments with the categories a requester can choose. The requester describes the request in the ticket body.</summary>
        [HttpGet("categories")]
        [ProducesResponseType(typeof(List<CatalogueDepartmentDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CatalogueDepartmentDto>>> Categories() => Ok(await _catalogue.ListForRequestersAsync());

        /// <summary>The categories I handle, per unit (empty for people who are not in a unit).</summary>
        [HttpGet("mine")]
        [ProducesResponseType(typeof(List<MyCategoriesDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<MyCategoriesDto>>> Mine() =>
            Ok(await _catalogue.MineAsync(Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value)));
    }
}