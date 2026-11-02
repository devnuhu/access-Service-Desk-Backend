using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Sends one finished email (copied from People Hub, without the HR-specific messages). What the emails say is in
    /// EmailTemplates and NotificationEmail; how they look is in EmailLayout. Sending never throws: the result says whether it worked.
    /// </summary>
    public interface IEmailService
    {
        Task<(bool Success, string Message)> SendEmailAsync(string to, string subject, string htmlBody);

        Task<(bool Success, string Message)> SendEmailWithAttachmentsAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment> attachments);
    }
}