using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Staff search for the people to copy on a scheduled report. Heads of unit, the Head of Department, Department Admins and Super Admins
    /// (the same people who can run reports). The directory search used for setting up case workers stays as it was.
    /// </summary>
    [ApiController]
    [Route("api/reports/recipients")]
    [Authorize(Policy = Policies.Oversight)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
    public class ReportRecipientsController : ControllerBase
    {
        private readonly IDirectoryService _directory;
        private readonly ILogger<ReportRecipientsController> _logger;

        public ReportRecipientsController(IDirectoryService directory, ILogger<ReportRecipientsController> logger)
        {
            _directory = directory;
            _logger = logger;
        }

        /// <summary>Up to 20 enabled people matching name, login name or email, who have an email address. 400: empty or too long query. 503: the directory could not be reached.</summary>
        [HttpGet("search")]
        [ProducesResponseType(typeof(List<DirectoryUserDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status503ServiceUnavailable)]
        public async Task<ActionResult<List<DirectoryUserDto>>> Search([FromQuery] string? query)
        {
            var text = (query ?? string.Empty).Trim();
            if (text.Length == 0) return BadRequest(new ApiError("Type a name, login name or email to search.", "query", "Required."));
            if (text.Length > 256) return BadRequest(new ApiError("The search text must not exceed 256 characters.", "query", "Too long."));
            try
            {
                var found = await _directory.SearchUsersAsync(text);
                return Ok(found.Where(p => !string.IsNullOrWhiteSpace(p.Email) && p.Email.Contains('@')).ToList());
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Directory search for report copies failed for {User}", User.Identity?.Name);
                return StatusCode(503, new ApiError("The staff directory could not be searched right now. Try again, and tell ICT if it keeps happening."));
            }
        }
    }
}