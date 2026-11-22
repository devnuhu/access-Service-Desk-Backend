using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Api;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// The priority matrix and changing a ticket's priority. The matrix (the two questions and the 16 cells) is readable by anyone signed in, because the request form
    /// uses it; only a Super Admin edits it. A priority change is for the head of the ticket's unit, the Head of Department, the Department Admin and Super Admins.
    /// </summary>
    [ApiController]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class PriorityController : ControllerBase
    {
        private readonly IPriorityService _priority;

        public PriorityController(IPriorityService priority) => _priority = priority;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem)
        {
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

        /// <summary>The wording of the two questions and the priority for every answer pair. Priority 1 Low, 2 Medium, 3 High, 4 Critical.</summary>
        [HttpGet("api/priority-matrix")]
        [ProducesResponseType(typeof(PriorityMatrixDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<PriorityMatrixDto>> GetMatrix() => Ok(await _priority.GetMatrixAsync());

        /// <summary>Super Admin only: changes the priority of the cells sent. A cell sent at its built-in default goes back to "not edited". Affects tickets raised from now on.</summary>
        [HttpPut("api/admin/priority-matrix")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(PriorityMatrixDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<PriorityMatrixDto>> SaveMatrix([FromBody] SavePriorityMatrixRequest request)
        {
            var (problem, matrix) = await _priority.SaveMatrixAsync(request, Me());
            return problem == null && matrix != null ? Ok(matrix) : Fail(problem!);
        }

        /// <summary>Can I change this ticket's priority, why not, and (for staff) the requester's impact and urgency answers. 404: cannot see the ticket.</summary>
        [HttpGet("api/tickets/{ticketId:guid}/priority")]
        [ProducesResponseType(typeof(PriorityOptionsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<PriorityOptionsDto>> Options(Guid ticketId)
        {
            var (problem, options) = await _priority.GetOptionsAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && options != null ? Ok(options) : Fail(problem!);
        }

        /// <summary>Changes the priority of an open ticket, with a reason (5 to 500 characters, kept as an internal note). The service-level targets follow the new priority.</summary>
        [HttpPost("api/tickets/{ticketId:guid}/priority")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Change(Guid ticketId, [FromBody] ChangePriorityRequest request)
        {
            var (problem, message) = await _priority.ChangeAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
    }
}