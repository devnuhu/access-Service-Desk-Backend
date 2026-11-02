using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Super Admin: people and roles (BRD Section 4). Ported from People Hub's AdminController and AdminRolesController.
    /// A person can hold several roles; giving and removing are separate calls. Errors use ApiError { message, errors }.
    /// </summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminUsersController : ControllerBase
    {
        private readonly IAdminUserService _service;

        public AdminUsersController(IAdminUserService service) => _service = service;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private ActionResult<MessageDto> From(AdminResult result) =>
            result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>People, with every active role. Search matches login name, name, email or department; role filters by role name.</summary>
        [HttpGet("users")]
        [ProducesResponseType(typeof(PagedResult<AdminUserDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<PagedResult<AdminUserDto>>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20,
            [FromQuery] string? search = null, [FromQuery] string? role = null)
            => Ok(await _service.ListUsersAsync(page, pageSize, search, role));

        [HttpGet("users/{userId:guid}")]
        [ProducesResponseType(typeof(AdminUserDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<AdminUserDto>> Get(Guid userId)
        {
            var user = await _service.GetUserAsync(userId);
            return user == null ? NotFound(new ApiError("Person not found.")) : Ok(user);
        }

        /// <summary>The five roles with their ids, for the role picker.</summary>
        [HttpGet("roles")]
        [ProducesResponseType(typeof(List<RoleItemDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<RoleItemDto>>> Roles() => Ok(await _service.ListRolesAsync());

        /// <summary>Gives a role. 409 when the person already holds it.</summary>
        [HttpPost("users/{userId:guid}/roles")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> AssignRole(Guid userId, [FromBody] AssignRoleRequest request)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            if (request.RoleId == Guid.Empty)
                return BadRequest(new ApiError("Choose a role.", "roleId", "Choose a role."));
            return From(await _service.AssignRoleAsync(userId, request.RoleId, actor));
        }

        /// <summary>Takes a role away. The assignment is kept as history. 400 for Requester and for the last Super Admin.</summary>
        [HttpDelete("users/{userId:guid}/roles/{roleId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> RemoveRole(Guid userId, Guid roleId)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            return From(await _service.RemoveRoleAsync(userId, roleId, actor));
        }

        /// <summary>Lets a person sign in (true) or blocks them and ends their sessions (false).</summary>
        [HttpPatch("users/{userId:guid}/status")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetStatus(Guid userId, [FromBody] UpdateUserStatusRequest request)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            return From(await _service.SetStatusAsync(userId, request.IsActive, actor));
        }
    }
}