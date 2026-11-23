namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Draft articles are seen by the department's staff only; Published articles by every signed-in person.</summary>
    public enum KbArticleStatus
    {
        Draft = 1,
        Published = 2
    }
}