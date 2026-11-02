using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Staff search for the pickers (copied from People Hub). Search: Super Admin and Heads of Unit (for setting up case workers).
    /// Adding someone from the directory before their first sign-in: Super Admin.
    /// </summary>
    [ApiController]
    [Route("api/directory")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class DirectoryController : ControllerBase
    {
        private readonly IDirectoryService _directory;
        private readonly IAdminUserService _admin;
        private readonly ILogger<DirectoryController> _logger;

        public DirectoryController(IDirectoryService directory, IAdminUserService admin, ILogger<DirectoryController> logger)
        {
            _directory = directory;
            _admin = admin;
            _logger = logger;
        }

        /// <summary>
        /// Up to 20 enabled people matching name, login name or email.
        /// 400: empty or too long query. 503: the directory could not be reached (or AD is not set up yet).
        /// </summary>
        [HttpGet("users/search")]
        [Authorize(Policy = Policies.UnitManagement)]
        [ProducesResponseType(typeof(List<DirectoryUserDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status503ServiceUnavailable)]
        public async Task<ActionResult<List<DirectoryUserDto>>> Search([FromQuery] string? query)
        {
            var text = (query ?? string.Empty).Trim();
            if (text.Length == 0)
                return BadRequest(new ApiError("Type a name, login name or email to search.", "query", "Required."));
            if (text.Length > 256)
                return BadRequest(new ApiError("The search text must not exceed 256 characters.", "query", "Too long."));

            try
            {
                return Ok(await _directory.SearchUsersAsync(text));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Directory search failed for {User}", User.Identity?.Name);
                return StatusCode(503, new ApiError("The staff directory could not be searched right now. Try again, and tell ICT if it keeps happening."));
            }
        }

        /// <summary>Makes a local account (Requester) for someone found in the search, so roles can be given before they first sign in.</summary>
        [HttpPost("users/ensure")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(ProvisionedUserDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<ProvisionedUserDto>> Ensure([FromBody] EnsureUserRequest request)
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var actor)) return Unauthorized();
            var (result, user) = await _admin.EnsureFromDirectoryAsync(request.SamAccountName, actor);
            if (!result.Success || user == null) return StatusCode(result.Status, new ApiError(result.Message));
            return Ok(user);
        }
    }
}