using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Api;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>The tasks given to the signed-in person, across tickets, kept for good (for the My tasks tab). Whoever is signed in sees only their own.</summary>
    [ApiController]
    [Route("api/tasks")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class MyTasksController : ControllerBase
    {
        private readonly ITicketTaskService _tasks;

        public MyTasksController(ITicketTaskService tasks) => _tasks = tasks;

        /// <summary>
        /// My tasks. status: open (default, on running tickets, soonest due first), done, rejected, cancelled or all (newest first). dateField: given (default), due or finished,
        /// with from and to (yyyy-MM-dd, both included). counts shows how many tasks there are in each status inside the date window; openCount is the open tasks on running tickets
        /// whatever the filters (for the tab badge). includeFinished=true is the older way of saying status=all.
        /// </summary>
        [HttpGet("mine")]
        [ProducesResponseType(typeof(MyTasksDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<MyTasksDto>> Mine([FromQuery] MyTasksQuery query, [FromQuery] bool includeFinished = false)
        {
            query ??= new MyTasksQuery();
            if (includeFinished && string.IsNullOrWhiteSpace(query.Status)) query.Status = "all";
            var me = Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            var (problem, result) = await _tasks.MineAsync(me, query);
            if (problem != null || result == null)
            {
                var error = new ApiError(problem?.Message ?? "The tasks could not be listed.");
                if (problem?.Field != null) error.Errors[problem.Field] = problem.Message;
                return StatusCode(problem?.Status ?? 500, error);
            }
            return Ok(result);
        }
    }
}