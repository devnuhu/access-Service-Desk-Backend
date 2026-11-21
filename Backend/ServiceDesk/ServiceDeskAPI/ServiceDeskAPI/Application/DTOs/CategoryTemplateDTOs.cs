namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A category's template as its keepers edit it (placeholders not filled in). Both parts are null when there is no template.</summary>
    public record CategoryTemplateDto(Guid CategoryId, string CategoryName, string? Subject, string? DescriptionHtml);

    /// <summary>A template ready for the raise form: placeholders already filled in for the signed-in person.</summary>
    public record CatalogueTemplateDto(Guid CategoryId, string? Subject, string? DescriptionHtml);

    /// <summary>
    /// Replaces the template. Subject: plain text, up to 150 characters. DescriptionHtml: rich text (cleaned like a comment), up to 5000 characters of text.
    /// Leave both empty to remove the template. Allowed placeholders: {{requester.name}}, {{ticket.category}}, {{unit.name}}, {{department.name}}, {{today}}.
    /// </summary>
    public class SaveCategoryTemplateRequest
    {
        public string? Subject { get; set; }
        public string? DescriptionHtml { get; set; }
    }
}