namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One request type to suggest on the requester's home: the category and the department it belongs to.</summary>
    public class CatalogueSuggestionDto
    {
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public string? Description { get; set; }
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
    }

    /// <summary>
    /// Recent: what this person raised in the last 90 days, most recent first (at most 5). Popular: what most people raised in the last 30 days (at most 6).
    /// Only active categories of active departments and units, so nothing that is switched off or not ready is ever suggested.
    /// </summary>
    public class CatalogueSuggestionsDto
    {
        public List<CatalogueSuggestionDto> Recent { get; set; } = new();
        public List<CatalogueSuggestionDto> Popular { get; set; } = new();
    }
}