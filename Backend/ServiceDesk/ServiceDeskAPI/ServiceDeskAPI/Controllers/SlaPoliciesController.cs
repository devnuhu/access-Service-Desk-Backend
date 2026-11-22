using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Service levels: the first-response and resolution targets per priority, with department and category overrides. Super Admin only.</summary>
    [ApiController]
    [Route("api/admin/sla-policies")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
    public class SlaPoliciesController : ControllerBase
    {
        private readonly ISlaPolicyService _policies;

        public SlaPoliciesController(ISlaPolicyService policies) => _policies = policies;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ActionResult NotAllowed() => StatusCode(StatusCodes.Status403Forbidden, new ApiError("Only a Super Admin can see or change the service levels."));

        /// <summary>The four global levels (Critical to Low, with the built-in default where nothing is saved) and every department and category override.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(SlaPoliciesDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<SlaPoliciesDto>> Get() => IsSuperAdmin() ? Ok(await _policies.GetAsync()) : NotAllowed();

        /// <summary>Adds or changes one level. 400 for a bad value (response 1 to 720 hours, resolution 1 to 4000 and not shorter than the response).</summary>
        [HttpPut]
        [ProducesResponseType(typeof(SlaPolicyRowDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<SlaPolicyRowDto>> Save([FromBody] SaveSlaPolicyRequest request)
        {
            if (!IsSuperAdmin()) return NotAllowed();
            var (problem, row) = await _policies.SaveAsync(request, Me());
            return problem == null && row != null ? Ok(row) : StatusCode(problem!.Status, new ApiError(problem.Message));
        }

        /// <summary>Removes a saved level, so the level above it (or the built-in default) applies again.</summary>
        [HttpDelete("{id:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid id)
        {
            if (!IsSuperAdmin()) return NotAllowed();
            var problem = await _policies.DeleteAsync(id);
            return problem == null ? Ok(new MessageDto("Back to the level above.")) : StatusCode(problem.Status, new ApiError(problem.Message));
        }
    }
}