using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>The tasks given to the signed-in person, across tickets (for the My tasks tab). Whoever is signed in sees only their own.</summary>
    [ApiController]
    [Route("api/tasks")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class MyTasksController : ControllerBase
    {
        private readonly ITicketTaskService _tasks;

        public MyTasksController(ITicketTaskService tasks) => _tasks = tasks;

        /// <summary>Open tasks given to me on running tickets, soonest due first (undated last). includeFinished adds done, rejected and cancelled ones and tasks on finished tickets. OpenCount is for the tab badge.</summary>
        [HttpGet("mine")]
        [ProducesResponseType(typeof(MyTasksDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MyTasksDto>> Mine([FromQuery] bool includeFinished = false, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
        {
            var me = Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);
            return Ok(await _tasks.MineAsync(me, includeFinished, page, pageSize));
        }
    }
}