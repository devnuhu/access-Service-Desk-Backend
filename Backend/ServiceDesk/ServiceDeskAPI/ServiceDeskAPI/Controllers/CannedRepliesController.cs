using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Tickets;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Saved replies. Staff of a ticket read the ones that fit it (placeholders filled in); the unit's head, the Department Admin and Super Admin keep each
    /// unit's library; Super Admin keeps the shared one. Others get 403 on a library, 404 on a ticket they cannot see.
    /// </summary>
    [ApiController]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class CannedRepliesController : ControllerBase
    {
        private readonly ICannedReplyService _replies;

        public CannedRepliesController(ICannedReplyService replies) => _replies = replies;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>The words that can go between double braces in a reply, and what they become (for the editor's help).</summary>
        [HttpGet("api/canned-replies/placeholders")]
        [ProducesResponseType(typeof(IReadOnlyList<CannedPlaceholderDto>), StatusCodes.Status200OK)]
        public ActionResult<IReadOnlyList<CannedPlaceholderDto>> Placeholders() => Ok(CannedPlaceholders.All);

        /// <summary>Replies for this ticket: its unit's plus the shared ones, with the placeholders filled in. Staff for the ticket and Super Admin.</summary>
        [HttpGet("api/tickets/{ticketId:guid}/canned-replies")]
        [ProducesResponseType(typeof(List<TicketCannedReplyDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<TicketCannedReplyDto>>> ForTicket(Guid ticketId)
        {
            var (problem, replies) = await _replies.ListForTicketAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && replies != null ? Ok(replies) : Fail(problem!);
        }

        /// <summary>A unit's library, to edit (placeholders not filled in). Head of the unit, Department Admin, Super Admin.</summary>
        [HttpGet("api/units/{unitId:guid}/canned-replies")]
        [ProducesResponseType(typeof(List<CannedReplyDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<CannedReplyDto>>> UnitLibrary(Guid unitId)
        {
            var (problem, replies) = await _replies.ListLibraryAsync(unitId, Me(), IsSuperAdmin());
            return problem == null && replies != null ? Ok(replies) : Fail(problem!);
        }

        [HttpPost("api/units/{unitId:guid}/canned-replies")]
        [ProducesResponseType(typeof(CannedReplyDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CannedReplyDto>> CreateForUnit(Guid unitId, [FromBody] SaveCannedReplyRequest request)
        {
            var (problem, reply) = await _replies.CreateAsync(unitId, request, Me(), IsSuperAdmin());
            return problem == null && reply != null ? Ok(reply) : Fail(problem!);
        }

        /// <summary>The shared library (every unit can use these). Super Admin.</summary>
        [HttpGet("api/admin/canned-replies")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(List<CannedReplyDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<List<CannedReplyDto>>> SharedLibrary()
        {
            var (problem, replies) = await _replies.ListLibraryAsync(null, Me(), true);
            return problem == null && replies != null ? Ok(replies) : Fail(problem!);
        }

        [HttpPost("api/admin/canned-replies")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(CannedReplyDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CannedReplyDto>> CreateShared([FromBody] SaveCannedReplyRequest request)
        {
            var (problem, reply) = await _replies.CreateAsync(null, request, Me(), true);
            return problem == null && reply != null ? Ok(reply) : Fail(problem!);
        }

        /// <summary>Change the title and/or the text. A unit's reply: its head, the Department Admin, Super Admin. A shared reply: Super Admin.</summary>
        [HttpPatch("api/canned-replies/{replyId:guid}")]
        [ProducesResponseType(typeof(CannedReplyDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CannedReplyDto>> Update(Guid replyId, [FromBody] SaveCannedReplyRequest request)
        {
            var (problem, reply) = await _replies.UpdateAsync(replyId, request, Me(), IsSuperAdmin());
            return problem == null && reply != null ? Ok(reply) : Fail(problem!);
        }

        [HttpDelete("api/canned-replies/{replyId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid replyId)
        {
            var (problem, message) = await _replies.DeleteAsync(replyId, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }
    }
}