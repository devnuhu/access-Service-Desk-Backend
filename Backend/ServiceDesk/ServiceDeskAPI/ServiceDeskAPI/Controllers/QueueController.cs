using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>A person's own saved list views (any signed-in person). Others' views answer 404.</summary>
    [ApiController]
    [Route("api/views")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class SavedViewsController : ControllerBase
    {
        private readonly ISavedViewService _views;

        public SavedViewsController(ISavedViewService views) => _views = views;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>My saved views: favourites first, then by name.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(List<SavedViewDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<SavedViewDto>>> List() => Ok(await _views.ListAsync(Me()));

        [HttpPost]
        [ProducesResponseType(typeof(SavedViewDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<SavedViewDto>> Create([FromBody] SaveViewRequest request)
        {
            var (problem, view) = await _views.CreateAsync(Me(), request);
            return problem == null && view != null ? Ok(view) : Fail(problem!);
        }

        [HttpPatch("{viewId:guid}")]
        [ProducesResponseType(typeof(SavedViewDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<SavedViewDto>> Update(Guid viewId, [FromBody] SaveViewRequest request)
        {
            var (problem, view) = await _views.UpdateAsync(Me(), viewId, request);
            return problem == null && view != null ? Ok(view) : Fail(problem!);
        }

        [HttpDelete("{viewId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid viewId)
        {
            var (problem, message) = await _views.DeleteAsync(Me(), viewId);
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
    }

    /// <summary>
    /// The same action on 1 to 50 tickets. Always 200 with a result per ticket (done, or why not); 400 only when the list itself is wrong.
    /// Each ticket follows the rules of the single action: pick (pool rules), acknowledge and resolve (the assignee), reassign (head and others who may).
    /// </summary>
    [ApiController]
    [Route("api/tickets/bulk")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
    public class BulkTicketsController : ControllerBase
    {
        private readonly IBulkTicketService _bulk;

        public BulkTicketsController(IBulkTicketService bulk) => _bulk = bulk;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ActionResult<BulkResultDto> Answer((TicketProblem? Problem, BulkResultDto? Result) r) =>
            r.Problem == null && r.Result != null ? Ok(r.Result)
                : StatusCode(r.Problem!.Status, r.Problem.Field == null ? new ApiError(r.Problem.Message) : new ApiError(r.Problem.Message, r.Problem.Field, r.Problem.Message));

        [HttpPost("pick")]
        [ProducesResponseType(typeof(BulkResultDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<BulkResultDto>> Pick([FromBody] BulkRequest request) => Answer(await _bulk.PickAsync(request, Me(), IsSuperAdmin()));

        [HttpPost("acknowledge")]
        [ProducesResponseType(typeof(BulkResultDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<BulkResultDto>> Acknowledge([FromBody] BulkRequest request) => Answer(await _bulk.AcknowledgeAsync(request, Me(), IsSuperAdmin()));

        [HttpPost("reassign")]
        [ProducesResponseType(typeof(BulkResultDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<BulkResultDto>> Reassign([FromBody] BulkReassignRequest request) => Answer(await _bulk.ReassignAsync(request, Me(), IsSuperAdmin()));

        [HttpPost("resolve")]
        [ProducesResponseType(typeof(BulkResultDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<BulkResultDto>> Resolve([FromBody] BulkResolveRequest request) => Answer(await _bulk.ResolveAsync(request, Me(), IsSuperAdmin()));
    }

    /// <summary>Marks a ticket as opened by me (clears its unread marker in my lists). Anyone who can see the ticket; others 404.</summary>
    [ApiController]
    [Route("api/tickets/{ticketId:guid}/read")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class TicketReadController : ControllerBase
    {
        private readonly ITicketReadService _reads;

        public TicketReadController(ITicketReadService reads) => _reads = reads;

        [HttpPost]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Mark(Guid ticketId)
        {
            var problem = await _reads.MarkReadAsync(ticketId, Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value), User.IsInRole(AppRoles.SuperAdmin));
            return problem == null ? Ok(new MessageDto("Marked as read.")) : StatusCode(problem.Status, new ApiError(problem.Message));
        }
    }
}