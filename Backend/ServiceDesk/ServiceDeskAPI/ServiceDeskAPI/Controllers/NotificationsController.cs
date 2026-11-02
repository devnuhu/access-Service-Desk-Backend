using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>The notification bell (copied from People Hub). Every call is limited to the signed-in person's own notifications.</summary>
    [ApiController]
    [Route("api/notifications")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class NotificationsController : ControllerBase
    {
        private readonly IInAppNotificationService _service;

        public NotificationsController(IInAppNotificationService service) => _service = service;

        private Guid? CurrentUser() =>
            Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        [HttpGet]
        [ProducesResponseType(typeof(InAppNotificationListDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<InAppNotificationListDto>> List(
            [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] bool unreadOnly = false)
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(await _service.ListAsync(userId, page, pageSize, unreadOnly));
        }

        [HttpGet("unread-count")]
        [ProducesResponseType(typeof(UnreadCountDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<UnreadCountDto>> UnreadCount()
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(new UnreadCountDto(await _service.UnreadCountAsync(userId)));
        }

        /// <summary>Marks one of your notifications read. 204 on success; 404 when it is not yours or does not exist.</summary>
        [HttpPatch("{id:guid}/read")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<IActionResult> MarkRead(Guid id)
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return await _service.MarkReadAsync(userId, id) ? NoContent() : NotFound(new ApiError("Notification not found."));
        }

        [HttpPatch("read-all")]
        [ProducesResponseType(typeof(MarkedDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MarkedDto>> MarkAllRead()
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(new MarkedDto(await _service.MarkAllReadAsync(userId)));
        }
    }
}