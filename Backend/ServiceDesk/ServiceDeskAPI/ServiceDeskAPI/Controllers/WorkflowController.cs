using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// The ticket workflow (BRD Section 8). GET actions says what the signed-in person may do now; each POST checks again.
    /// 404: cannot see the ticket. 403: can see it but not the right person. 400: right person, wrong status or a field to fix.
    /// 409: the ticket changed at the same moment.
    /// </summary>
    [ApiController]
    [Route("api/tickets/{ticketId:guid}")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class WorkflowController : ControllerBase
    {
        private readonly IWorkflowService _workflow;

        public WorkflowController(IWorkflowService workflow) => _workflow = workflow;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ActionResult<MessageDto> Answer((TicketProblem? Problem, string? Message) result)
        {
            if (result.Problem == null && result.Message != null) return Ok(new MessageDto(result.Message));
            var problem = result.Problem ?? new TicketProblem(500, "Something went wrong.");
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

        /// <summary>What I may do with this ticket now, and the resolution codes.</summary>
        [HttpGet("actions")]
        [ProducesResponseType(typeof(TicketActionsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketActionsDto>> Actions(Guid ticketId)
        {
            var (problem, actions) = await _workflow.GetActionsAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && actions != null ? Ok(actions) : StatusCode(problem!.Status, new ApiError(problem.Message));
        }

        /// <summary>The assignee starts work: Assigned or Reopened to In progress.</summary>
        [HttpPost("acknowledge")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Acknowledge(Guid ticketId) => Answer(await _workflow.AcknowledgeAsync(ticketId, Me(), IsSuperAdmin()));

        /// <summary>The assignee waits on the requester (their reply resumes it) or on a third party. The note is posted as a public comment.</summary>
        [HttpPost("pending")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Pending(Guid ticketId, [FromBody] SetPendingRequest request) =>
            Answer(await _workflow.SetPendingAsync(ticketId, request, Me(), IsSuperAdmin()));

        /// <summary>The assignee resumes a Pending ticket.</summary>
        [HttpPost("resume")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Resume(Guid ticketId) => Answer(await _workflow.ResumeAsync(ticketId, Me(), IsSuperAdmin()));

        /// <summary>The assignee resolves it with a code and a note (posted as a public comment).</summary>
        [HttpPost("resolve")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Resolve(Guid ticketId, [FromBody] ResolveRequest request) =>
            Answer(await _workflow.ResolveAsync(ticketId, request, Me(), IsSuperAdmin()));

        /// <summary>The requester accepts the resolution: Resolved to Closed.</summary>
        [HttpPost("confirm")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Confirm(Guid ticketId) => Answer(await _workflow.ConfirmAsync(ticketId, Me(), IsSuperAdmin()));

        /// <summary>The requester rejects the resolution, with a reason: back to the same case worker, or the next available one.</summary>
        [HttpPost("reopen")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Reopen(Guid ticketId, [FromBody] WorkflowReasonRequest request) =>
            Answer(await _workflow.ReopenAsync(ticketId, request, Me(), IsSuperAdmin()));

        /// <summary>The requester withdraws it before work starts; a Super Admin can cancel any open ticket. A reason is required.</summary>
        [HttpPost("cancel")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Cancel(Guid ticketId, [FromBody] WorkflowReasonRequest request) =>
            Answer(await _workflow.CancelAsync(ticketId, request, Me(), IsSuperAdmin()));
    }
}