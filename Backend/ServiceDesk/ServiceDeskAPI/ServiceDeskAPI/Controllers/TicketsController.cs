using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Api;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Tickets (BRD M2, M4): raise, list, read, comment, download files. Any signed-in person; who may see what is decided in the
    /// service (requester, people copied, the department's staff, Super Admin). A ticket you cannot see answers 404.
    /// </summary>
    [ApiController]
    [Route("api/tickets")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class TicketsController : ControllerBase
    {
        /// <summary>6 files of 1 MB plus the form and its formatted text.</summary>
        private const long MaxRequestBytes = 8 * 1024 * 1024;

        private readonly ITicketService _tickets;

        public TicketsController(ITicketService tickets) => _tickets = tickets;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem)
        {
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

        /// <summary>Raises a ticket. multipart/form-data: categoryId, locationId, priority (optional), subject, descriptionHtml, ccUserIds (repeat), requesterUserId (Super Admin only), files (0 to 6, each at most 1 MB).</summary>
        [HttpPost]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(MaxRequestBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes)]
        [ProducesResponseType(typeof(CreatedTicketDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CreatedTicketDto>> Create([FromForm] CreateTicketRequest request)
        {
            var (problem, ticket) = await _tickets.CreateAsync(request, Me(), IsSuperAdmin());
            return problem == null && ticket != null ? Ok(ticket) : Fail(problem!);
        }

        /// <summary>Before submitting: open tickets in the same category from the last 7 days that mention the same RSA PIN (FR-2.7).</summary>
        [HttpPost("duplicate-check")]
        [ProducesResponseType(typeof(DuplicateCheckDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<DuplicateCheckDto>> DuplicateCheck([FromBody] DuplicateCheckRequest request)
        {
            var (problem, result) = await _tickets.CheckDuplicatesAsync(request, Me());
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }

        /// <summary>view = mine (default), copied, assigned, or department (with departmentId). departmentId and unitId narrow any view; open=true: New, Assigned, In progress, Pending, Reopened. priority: 1 Low, 2 Medium, 3 High, 4 Critical. ageBand: how long ago it was raised, the bands of the unit performance chart (1 under 1 day, 2 one to two days, 3 three to five days, 4 six to ten days, 5 over ten days); use it with open=true. pendingReason: 1 waiting on the requester, 2 waiting on a third party (Pending tickets only). sort: assignedat, assignedat_desc, pendingsince (longest waiting first), due (time runs out soonest first; tickets without a due time last). Newest first by default.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(TicketPageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<TicketPageDto>> List([FromQuery] string? view, [FromQuery] Guid? departmentId, [FromQuery] Guid? unitId,
            [FromQuery] TicketStatus? status, [FromQuery] bool? open, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] bool? waitingToStart = null, [FromQuery] string? sort = null, [FromQuery] bool? slaBreached = null, [FromQuery] bool? escalated = null, [FromQuery] TicketPriority? priority = null, [FromQuery] int? ageBand = null, [FromQuery] int? pendingReason = null)
        {
            var (problem, result) = await _tickets.ListAsync(view, departmentId, unitId, status, open, search, page, pageSize, Me(), IsSuperAdmin(), waitingToStart, sort, slaBreached, escalated, priority, ageBand, pendingReason);
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }

        /// <summary>Counts of open tickets by SLA level for a department (and optionally one unit): open, warning, overdue, farPast, unassigned. Staff of the department and Super Admin.</summary>
        [HttpGet("sla-summary")]
        [ProducesResponseType(typeof(SlaSummaryDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<SlaSummaryDto>> SlaSummary([FromQuery] Guid departmentId, [FromQuery] Guid? unitId)
        {
            var (problem, summary) = await _tickets.SlaSummaryAsync(departmentId, unitId, Me(), IsSuperAdmin());
            return problem == null && summary != null ? Ok(summary) : Fail(problem!);
        }
        [HttpGet("{ticketId:guid}")]
        [ProducesResponseType(typeof(TicketDetailDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketDetailDto>> Get(Guid ticketId)
        {
            var (problem, ticket) = await _tickets.GetAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && ticket != null ? Ok(ticket) : Fail(problem!);
        }

        /// <summary>The same as GET {id}, by reference (for example CP-2026-000123), for links in notifications.</summary>
        [HttpGet("by-reference/{reference}")]
        [ProducesResponseType(typeof(TicketDetailDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketDetailDto>> GetByReference(string reference)
        {
            var id = await _tickets.FindIdByReferenceAsync(reference);
            if (id == null) return NotFound(new ApiError("Ticket not found."));
            return await Get(id.Value);
        }

        /// <summary>Adds a public comment or (department staff) an internal note. multipart/form-data: bodyHtml, isInternal, files (0 to 6, each at most 1 MB).</summary>
        [HttpPost("{ticketId:guid}/comments")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(MaxRequestBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes)]
        [ProducesResponseType(typeof(TicketCommentDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<TicketCommentDto>> AddComment(Guid ticketId, [FromForm] AddCommentRequest request)
        {
            var (problem, comment) = await _tickets.AddCommentAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && comment != null ? Ok(comment) : Fail(problem!);
        }

        /// <summary>Downloads a file (always as a download, never shown inline).</summary>
        [HttpGet("{ticketId:guid}/attachments/{attachmentId:guid}")]
        [FileDownload]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Download(Guid ticketId, Guid attachmentId)
        {
            var (problem, name, type, data) = await _tickets.GetAttachmentAsync(ticketId, attachmentId, Me(), IsSuperAdmin());
            if (problem != null || data == null) return Fail(problem ?? new TicketProblem(404, "File not found."));
            Response.Headers.CacheControl = "private, no-store";
            return File(data, type ?? "application/octet-stream", name);
        }
    }

    /// <summary>Locations for the ticket form, and their upkeep by the Super Admin.</summary>
    [ApiController]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class LocationsController : ControllerBase
    {
        private readonly ILocationService _locations;

        public LocationsController(ILocationService locations) => _locations = locations;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        /// <summary>Active locations and the one to pre-select. forUserId (Super Admin raising for someone): that person's default.</summary>
        [HttpGet("api/locations")]
        [Authorize]
        [ProducesResponseType(typeof(LocationChoicesDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<LocationChoicesDto>> Choices([FromQuery] Guid? forUserId)
        {
            if (forUserId.HasValue && forUserId.Value != Me() && !User.IsInRole(AppRoles.SuperAdmin)) return Forbid();
            return Ok(await _locations.GetChoicesAsync(forUserId ?? Me()));
        }

        [HttpGet("api/admin/locations")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(List<LocationDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<List<LocationDto>>> List() => Ok(await _locations.ListAsync());

        [HttpPost("api/admin/locations")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(LocationDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<LocationDto>> Create([FromBody] SaveLocationRequest request)
        {
            var (result, location) = await _locations.CreateAsync(request, Me());
            return result.Success && location != null ? Ok(location) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename, reorder, switch on or off (at least one stays on).</summary>
        [HttpPatch("api/admin/locations/{locationId:guid}")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Update(Guid locationId, [FromBody] SaveLocationRequest request)
        {
            var result = await _locations.UpdateAsync(locationId, request, Me());
            return result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));
        }
    }
}