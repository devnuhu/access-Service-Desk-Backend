using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Api;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// The checklist on a ticket. Staff of the ticket and Super Admin; a requester or anyone else gets 404, except the person a task is given to
    /// (who may work in another unit of the department): they see only their own tasks and can finish or reject them.
    /// A ticket cannot be resolved while a task is open or rejected (resolving as a duplicate or raised in error is allowed). A cancelled task does not block it.
    /// </summary>
    [ApiController]
    [Route("api/tickets/{ticketId:guid}/tasks")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class TicketTasksController : ControllerBase
    {
        private readonly ITicketTaskService _tasks;

        public TicketTasksController(ITicketTaskService tasks) => _tasks = tasks;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem)
        {
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

        /// <summary>The tasks, in the order they were added, with how many are open, done, rejected and cancelled, and whether they can still be changed. Each task says what the signed-in person may do with it.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(TicketTasksDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTasksDto>> List(Guid ticketId)
        {
            var (problem, tasks) = await _tasks.ListAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && tasks != null ? Ok(tasks) : Fail(problem!);
        }

        /// <summary>The people who can own a task on this ticket: everyone active who works in the ticket's department. For the owner picker.</summary>
        [HttpGet("owners")]
        [ProducesResponseType(typeof(List<PersonDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<PersonDto>>> Owners(Guid ticketId)
        {
            var (problem, owners) = await _tasks.OwnersAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && owners != null ? Ok(owners) : Fail(problem!);
        }

        /// <summary>Adds a task (at most 30 per ticket). Not while the ticket is Resolved, Closed or Cancelled.</summary>
        [HttpPost]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> Add(Guid ticketId, [FromBody] TicketTaskRequest request)
        {
            var (problem, item) = await _tasks.AddAsync(ticketId, request ?? new TicketTaskRequest(), Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>Changes the title, owner and due date. Giving it to someone else clears an earlier rejection. A cancelled task cannot be changed.</summary>
        [HttpPut("{taskId:guid}")]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> Update(Guid ticketId, Guid taskId, [FromBody] TicketTaskRequest request)
        {
            var (problem, item) = await _tasks.UpdateAsync(ticketId, taskId, request ?? new TicketTaskRequest(), Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>Ticks a task done (done: true) or open again (done: false). Staff of the ticket, or the person the task is given to.</summary>
        [HttpPut("{taskId:guid}/done")]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> SetDone(Guid ticketId, Guid taskId, [FromBody] TicketTaskDoneRequest request)
        {
            var (problem, item) = await _tasks.SetDoneAsync(ticketId, taskId, request?.Done ?? false, Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>The person the task is given to sends it back, with a reason (5 to 500 characters). The ticket's case worker and the person who added the task are told. It still blocks resolving the ticket until it is given to someone else or cancelled.</summary>
        [HttpPut("{taskId:guid}/reject")]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> Reject(Guid ticketId, Guid taskId, [FromBody] TicketTaskReasonRequest request)
        {
            var (problem, item) = await _tasks.RejectAsync(ticketId, taskId, request?.Reason, Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>Cancels an open or rejected task, with a reason (3 to 500 characters). The ticket's case worker, the person who added the task, the unit's head and a Super Admin can. The owner is told. A cancelled task no longer blocks resolving.</summary>
        [HttpPut("{taskId:guid}/cancel")]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> Cancel(Guid ticketId, Guid taskId, [FromBody] TicketTaskReasonRequest request)
        {
            var (problem, item) = await _tasks.CancelAsync(ticketId, taskId, request?.Reason, Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>Removes a task (for a task added by mistake; use cancel when it was a real task, so the reason is kept).</summary>
        [HttpDelete("{taskId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Remove(Guid ticketId, Guid taskId)
        {
            var (problem, message) = await _tasks.RemoveAsync(ticketId, taskId, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
    }
}