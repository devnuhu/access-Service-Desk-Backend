namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A saved reply as the people who keep the library see it (placeholders not filled in). UnitId null: shared by every unit.</summary>
    public record CannedReplyDto(Guid Id, Guid? UnitId, string? UnitName, bool IsShared, string Title, string BodyHtml, DateTime CreatedAt, DateTime? UpdatedAt);

    /// <summary>A saved reply ready to use on one ticket: the placeholders are already filled in with that ticket's details and the signed-in person's name.</summary>
    public record TicketCannedReplyDto(Guid Id, bool IsShared, string Title, string BodyHtml);

    /// <summary>A word in double braces that can be used in a reply, with what it becomes.</summary>
    public record CannedPlaceholderDto(string Token, string Description);

    /// <summary>On create both are required. On update leave one out to keep it as it is. Title 2 to 100 characters; body is rich text (cleaned like a comment) of at most 5000 characters of text.</summary>
    public class SaveCannedReplyRequest
    {
        public string? Title { get; set; }
        public string? BodyHtml { get; set; }
    }
}