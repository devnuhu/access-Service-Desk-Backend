using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Suggestions for the requester's home. Any signed-in person.</summary>
    [ApiController]
    [Route("api/catalogue")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class CatalogueSuggestionsController : ControllerBase
    {
        private readonly ICatalogueSuggestionService _suggestions;

        public CatalogueSuggestionsController(ICatalogueSuggestionService suggestions) => _suggestions = suggestions;

        /// <summary>What I raised in the last 90 days (up to 5, newest first) and what is popular in the last 30 days (up to 6). Active categories only.</summary>
        [HttpGet("suggestions")]
        [ProducesResponseType(typeof(CatalogueSuggestionsDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<CatalogueSuggestionsDto>> Suggestions() =>
            Ok(await _suggestions.GetAsync(Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value)));
    }
}