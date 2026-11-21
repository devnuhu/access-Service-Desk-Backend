using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Templates for categories: a suggested subject and description the raise form can pre-fill. Keepers (Super Admin, the unit's head,
    /// the Department Admin) read and replace a category's template; everyone signed in reads the filled-in ones.
    /// </summary>
    [ApiController]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class CategoryTemplatesController : ControllerBase
    {
        private readonly ICategoryTemplateService _templates;

        public CategoryTemplatesController(ICategoryTemplateService templates) => _templates = templates;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>Templates for the raise form: only categories requesters can choose that have one, with placeholders filled in for the signed-in person.</summary>
        [HttpGet("api/catalogue/templates")]
        [ProducesResponseType(typeof(List<CatalogueTemplateDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CatalogueTemplateDto>>> ForRequester() => Ok(await _templates.ListForRequesterAsync(Me()));

        /// <summary>A category's template to edit (placeholders not filled in). Super Admin, the unit's head, the Department Admin.</summary>
        [HttpGet("api/categories/{categoryId:guid}/template")]
        [ProducesResponseType(typeof(CategoryTemplateDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<CategoryTemplateDto>> Get(Guid categoryId)
        {
            var (problem, template) = await _templates.GetAsync(categoryId, Me(), IsSuperAdmin());
            return problem == null && template != null ? Ok(template) : Fail(problem!);
        }

        /// <summary>Replaces the template. Leave subject and description empty to remove it.</summary>
        [HttpPut("api/categories/{categoryId:guid}/template")]
        [ProducesResponseType(typeof(CategoryTemplateDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<CategoryTemplateDto>> Save(Guid categoryId, [FromBody] SaveCategoryTemplateRequest request)
        {
            var (problem, template) = await _templates.SaveAsync(categoryId, request, Me(), IsSuperAdmin());
            return problem == null && template != null ? Ok(template) : Fail(problem!);
        }
    }
}