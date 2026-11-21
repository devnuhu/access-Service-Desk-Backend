using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Links between tickets and merging a duplicate into a primary ticket. Staff only: a person who is not staff for a ticket (or for the other ticket named)
    /// gets 404, so nothing leaks. A requester cannot use these.
    /// </summary>
    [ApiController]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class TicketLinksController : ControllerBase
    {
        private readonly ITicketLinkService _links;

        public TicketLinksController(ITicketLinkService links) => _links = links;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>The links of a ticket, seen from it. The other ticket's subject is shown only when the person is staff for that ticket too.</summary>
        [HttpGet("api/tickets/{ticketId:guid}/links")]
        [ProducesResponseType(typeof(List<TicketLinkDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<TicketLinkDto>>> List(Guid ticketId)
        {
            var (problem, links) = await _links.ListAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && links != null ? Ok(links) : Fail(problem!);
        }

        /// <summary>Links this ticket to another by reference. Relation: related (default) or duplicateOf. 409 when the two are already linked.</summary>
        [HttpPost("api/tickets/{ticketId:guid}/links")]
        [ProducesResponseType(typeof(TicketLinkDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<TicketLinkDto>> Add(Guid ticketId, [FromBody] AddTicketLinkRequest request)
        {
            var (problem, link) = await _links.AddAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && link != null ? Ok(link) : Fail(problem!);
        }

        /// <summary>Removes a link. A merge cannot be removed (400).</summary>
        [HttpDelete("api/tickets/{ticketId:guid}/links/{linkId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Remove(Guid ticketId, Guid linkId)
        {
            var (problem, message) = await _links.RemoveAsync(ticketId, linkId, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }

        /// <summary>
        /// Merges this ticket (the duplicate) into the one named by targetReference: the duplicate is closed with a public note, the target gets an internal note,
        /// nothing is deleted. Both must be open and in the same unit.
        /// </summary>
        [HttpPost("api/tickets/{ticketId:guid}/merge")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Merge(Guid ticketId, [FromBody] MergeTicketRequest request)
        {
            var (problem, message) = await _links.MergeAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
    }
}