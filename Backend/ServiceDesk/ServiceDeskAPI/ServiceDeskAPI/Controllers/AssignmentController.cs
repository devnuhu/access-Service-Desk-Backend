using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Reassignment and the assignment history (BRD FR-3.7 to FR-3.10). Department staff and Super Admin only; who may move a
    /// ticket to whom is decided in the service. Requesters and people copied get 403; anyone else 404.
    /// </summary>
    [ApiController]
    [Route("api/tickets/{ticketId:guid}")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class AssignmentController : ControllerBase
    {
        private readonly IAssignmentService _assignment;

        public AssignmentController(IAssignmentService assignment) => _assignment = assignment;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>Whether the signed-in person can reassign this ticket, and to whom (with each person's current workload).</summary>
        [HttpGet("reassign-options")]
        [ProducesResponseType(typeof(ReassignOptionsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<ReassignOptionsDto>> Options(Guid ticketId)
        {
            var (problem, options) = await _assignment.GetReassignOptionsAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && options != null ? Ok(options) : Fail(problem!);
        }

        /// <summary>Moves the ticket to another case worker, with a reason. It becomes Assigned (a new acknowledgement window).</summary>
        [HttpPost("reassign")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Reassign(Guid ticketId, [FromBody] ReassignRequest request)
        {
            var (problem, message) = await _assignment.ReassignAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }

        /// <summary>Claims a New ticket from the unit pool (a member of the unit mapped to the category, or the unit's head).</summary>
        [HttpPost("pick")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Pick(Guid ticketId)
        {
            var (problem, message) = await _assignment.PickAsync(ticketId, Me());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
        /// <summary>Every assignment of the ticket, oldest first, with the workloads the engine compared.</summary>
        [HttpGet("assignments")]
        [ProducesResponseType(typeof(List<TicketAssignmentDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<TicketAssignmentDto>>> History(Guid ticketId)
        {
            var (problem, history) = await _assignment.GetHistoryAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && history != null ? Ok(history) : Fail(problem!);
        }
    }

    /// <summary>The unit pool: New tickets waiting for someone in the units the signed-in person works in.</summary>
    [ApiController]
    [Route("api/pool")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class PoolController : ControllerBase
    {
        private readonly IAssignmentService _assignment;

        public PoolController(IAssignmentService assignment) => _assignment = assignment;

        [HttpGet]
        [ProducesResponseType(typeof(PoolPageDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<PoolPageDto>> List([FromQuery] string? search, [FromQuery] Guid? unitId, [FromQuery] int page = 1, [FromQuery] int pageSize = 10) =>
            Ok(await _assignment.ListPoolPageAsync(Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value), search, unitId, page, pageSize));
    }
    /// <summary>Looking people up to copy them on a ticket (any signed-in person): name, login name and department only.</summary>
    [ApiController]
    [Route("api/people")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class PeopleController : ControllerBase
    {
        private readonly IAssignmentService _assignment;

        public PeopleController(IAssignmentService assignment) => _assignment = assignment;

        /// <summary>Active staff whose name or login name contains the text (at least 2 letters; at most 20 results).</summary>
        [HttpGet("search")]
        [ProducesResponseType(typeof(List<PersonSearchResultDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<List<PersonSearchResultDto>>> Search([FromQuery] string? query)
        {
            var (problem, people) = await _assignment.SearchPeopleAsync(query, Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value));
            if (problem != null) return StatusCode(problem.Status, new ApiError(problem.Message, problem.Field ?? "query", problem.Message));
            return Ok(people);
        }
    }
}