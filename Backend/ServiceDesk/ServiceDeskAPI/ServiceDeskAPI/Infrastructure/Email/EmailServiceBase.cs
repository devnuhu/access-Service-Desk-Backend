using System.Net.Mail;
using System.Text.RegularExpressions;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// What every provider shares: the recipient check and the customer-data guard. A provider only delivers the finished message.
    /// </summary>
    public abstract class EmailServiceBase : IEmailService
    {
        public Task<(bool Success, string Message)> SendEmailAsync(string to, string subject, string htmlBody)
            => SendCoreAsync(to, subject, htmlBody, null);

        public Task<(bool Success, string Message)> SendEmailWithAttachmentsAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment> attachments)
            => SendCoreAsync(to, subject, htmlBody, attachments);

        private Task<(bool Success, string Message)> SendCoreAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            var recipient = (to ?? string.Empty).Trim();
            if (recipient.Length == 0 || !MailAddress.TryCreate(recipient, out _))
                return Task.FromResult((false, "The recipient address is not valid"));
            return DeliverAsync(recipient, EmailSafety.Redact(subject ?? string.Empty), EmailSafety.Redact(htmlBody ?? string.Empty), attachments);
        }

        /// <summary>Delivers one message. Must not throw.</summary>
        protected abstract Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments);
    }

    /// <summary>
    /// Agent rule 3: customer data never goes into an email. As a last line of defence, anything shaped like an RSA PIN
    /// (PEN followed by 12 digits) is masked in the subject and body before any provider sees it.
    /// </summary>
    public static class EmailSafety
    {
        private static readonly Regex RsaPin = new(@"\bPEN\d{12}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public static string Redact(string text) => RsaPin.Replace(text, "PEN************");
    }
}