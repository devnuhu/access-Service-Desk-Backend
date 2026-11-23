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
    /// The knowledge base. Everyone signed in reads published articles and answers "Was this helpful?". A department's staff write drafts;
    /// heads of unit, the Head of Department, the Department Admin and Super Admin publish. A draft is 404 to anyone outside the department.
    /// </summary>
    [ApiController]
    [Route("api/kb")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class KnowledgeBaseController : ControllerBase
    {
        private readonly IKnowledgeBaseService _kb;

        public KnowledgeBaseController(IKnowledgeBaseService kb) => _kb = kb;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem)
        {
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

        /// <summary>Published articles. Query: search, departmentId, categoryId, page, pageSize (default 20, at most 50). Departments counts the matches per department.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(KbListDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<KbListDto>> List([FromQuery] KbListQuery query)
        {
            var (problem, list) = await _kb.ListAsync(query, Me(), IsSuperAdmin(), false);
            return problem == null && list != null ? Ok(list) : Fail(problem!);
        }

        /// <summary>Drafts and published articles of the departments the signed-in person writes for. Adds the status filter ("draft" or "published").</summary>
        [HttpGet("manage")]
        [ProducesResponseType(typeof(KbListDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<KbListDto>> Manage([FromQuery] KbListQuery query)
        {
            var (problem, list) = await _kb.ListAsync(query, Me(), IsSuperAdmin(), true);
            return problem == null && list != null ? Ok(list) : Fail(problem!);
        }

        /// <summary>The departments the signed-in person can write articles for (empty for a requester), with their categories and whether they can publish there.</summary>
        [HttpGet("options")]
        [ProducesResponseType(typeof(List<KbOptionDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<KbOptionDto>>> Options()
        {
            var (problem, options) = await _kb.OptionsAsync(Me(), IsSuperAdmin());
            return problem == null && options != null ? Ok(options) : Fail(problem!);
        }

        /// <summary>Up to 3 published articles that may answer the request being raised: those of the chosen category first, then matches on the words typed in the subject.</summary>
        [HttpGet("suggest")]
        [ProducesResponseType(typeof(List<KbSuggestionDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<KbSuggestionDto>>> Suggest([FromQuery] Guid? categoryId, [FromQuery] string? text)
        {
            var (problem, items) = await _kb.SuggestAsync(categoryId, text, Me());
            return problem == null && items != null ? Ok(items) : Fail(problem!);
        }

        /// <summary>One article. A draft is 404 unless the person writes for its department.</summary>
        [HttpGet("{id:guid}")]
        [ProducesResponseType(typeof(KbArticleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<KbArticleDto>> Get(Guid id)
        {
            var (problem, article) = await _kb.GetAsync(id, Me(), IsSuperAdmin());
            return problem == null && article != null ? Ok(article) : Fail(problem!);
        }

        /// <summary>Writes a new article as a draft.</summary>
        [HttpPost]
        [ProducesResponseType(typeof(KbArticleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<KbArticleDto>> Create([FromBody] KbArticleRequest request)
        {
            var (problem, article) = await _kb.CreateAsync(request, Me(), IsSuperAdmin());
            return problem == null && article != null ? Ok(article) : Fail(problem!);
        }

        /// <summary>Changes the title, summary, category and body. Staff change drafts; a published article is changed by a publisher only.</summary>
        [HttpPut("{id:guid}")]
        [ProducesResponseType(typeof(KbArticleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<KbArticleDto>> Update(Guid id, [FromBody] KbArticleRequest request)
        {
            var (problem, article) = await _kb.UpdateAsync(id, request, Me(), IsSuperAdmin());
            return problem == null && article != null ? Ok(article) : Fail(problem!);
        }

        /// <summary>Publishes the article. A head of unit, the Head of Department, the Department Admin or Super Admin only.</summary>
        [HttpPost("{id:guid}/publish")]
        [ProducesResponseType(typeof(KbArticleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<KbArticleDto>> Publish(Guid id)
        {
            var (problem, article) = await _kb.SetPublishedAsync(id, true, Me(), IsSuperAdmin());
            return problem == null && article != null ? Ok(article) : Fail(problem!);
        }

        /// <summary>Takes the article back to a draft. Same people as publish.</summary>
        [HttpPost("{id:guid}/unpublish")]
        [ProducesResponseType(typeof(KbArticleDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<KbArticleDto>> Unpublish(Guid id)
        {
            var (problem, article) = await _kb.SetPublishedAsync(id, false, Me(), IsSuperAdmin());
            return problem == null && article != null ? Ok(article) : Fail(problem!);
        }

        /// <summary>Deletes the article. Staff delete their own drafts; publishers delete any article of the department.</summary>
        [HttpDelete("{id:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid id)
        {
            var (problem, message) = await _kb.DeleteAsync(id, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }

        /// <summary>"Was this helpful?" Body {"helpful": true|false}. One answer per person; answering again changes it. Published articles only.</summary>
        [HttpPost("{id:guid}/vote")]
        [ProducesResponseType(typeof(KbVoteDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<KbVoteDto>> Vote(Guid id, [FromBody] KbVoteRequest request)
        {
            var (problem, vote) = await _kb.VoteAsync(id, request?.Helpful ?? false, Me());
            return problem == null && vote != null ? Ok(vote) : Fail(problem!);
        }
    }
}