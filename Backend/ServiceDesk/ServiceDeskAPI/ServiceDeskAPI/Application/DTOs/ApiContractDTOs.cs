namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>
    /// The one error shape (agent rule 6): { message, errors: { field: "what is wrong" } }. errors is empty when no single field is to blame.
    /// </summary>
    public class ApiError
    {
        public string Message { get; set; } = string.Empty;
        public Dictionary<string, string> Errors { get; set; } = new();

        public ApiError() { }
        public ApiError(string message) => Message = message;
        public ApiError(string message, string field, string fieldMessage)
        {
            Message = message;
            Errors[field] = fieldMessage;
        }
    }

    /// <summary>A plain success message, for actions that return nothing else.</summary>
    public record MessageDto(string Message);

    public record HealthDto(string Status, string App);

    public record UnreadCountDto(int Count);

    public record MarkedDto(int Marked);

    public record EmailTestResultDto(bool Success, string Message);

    public record InfobipStatusDto(string? BaseUrl, string? SenderEmail, string? SenderName, bool ApiKeyConfigured);

    public record SmtpStatusDto(string? Host, string? Port, string? SenderEmail, bool SignsIn);

    /// <summary>GET api/admin/email/status. Never contains a key or password.</summary>
    public record EmailStatusDto(string Provider, InfobipStatusDto Infobip, SmtpStatusDto Smtp, bool NotificationEmails, bool Ready);
}