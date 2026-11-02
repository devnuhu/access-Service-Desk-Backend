namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A file sent with an email (for example an exported report).</summary>
    public sealed record EmailAttachment(string FileName, byte[] Content, string ContentType = "application/octet-stream");
}