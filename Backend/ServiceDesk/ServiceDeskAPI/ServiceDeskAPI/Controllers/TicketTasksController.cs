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
    /// The checklist on a ticket. Staff of the ticket and Super Admin only; a requester or anyone else gets 404.
    /// A ticket cannot be resolved while a task is open (resolving as a duplicate or raised in error is allowed).
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

        /// <summary>The tasks, in the order they were added, with how many are open and done, and whether they can still be changed.</summary>
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

        /// <summary>Changes the title, owner and due date.</summary>
        [HttpPut("{taskId:guid}")]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> Update(Guid ticketId, Guid taskId, [FromBody] TicketTaskRequest request)
        {
            var (problem, item) = await _tasks.UpdateAsync(ticketId, taskId, request ?? new TicketTaskRequest(), Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>Ticks a task done (done: true) or open again (done: false).</summary>
        [HttpPut("{taskId:guid}/done")]
        [ProducesResponseType(typeof(TicketTaskDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketTaskDto>> SetDone(Guid ticketId, Guid taskId, [FromBody] TicketTaskDoneRequest request)
        {
            var (problem, item) = await _tasks.SetDoneAsync(ticketId, taskId, request?.Done ?? false, Me(), IsSuperAdmin());
            return problem == null && item != null ? Ok(item) : Fail(problem!);
        }

        /// <summary>Removes a task.</summary>
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