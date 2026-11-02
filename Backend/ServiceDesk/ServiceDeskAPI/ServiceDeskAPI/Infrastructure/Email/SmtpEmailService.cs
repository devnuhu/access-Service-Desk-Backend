using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// SMTP delivery (EmailSettings:Provider = Smtp), ported from People Hub. Settings: EmailSettings:Smtp:Host, Port, EnableSsl,
    /// SenderEmail, SenderName, and optionally Username/Password (user secrets) or SERVICEDESK_SMTP_USERNAME / SERVICEDESK_SMTP_PASSWORD.
    /// Without a username it sends without signing in (an internal relay). There is no built-in host: an empty Host means not set up.
    /// </summary>
    public class SmtpEmailService : EmailServiceBase
    {
        public const string UsernameVariable = "SERVICEDESK_SMTP_USERNAME";
        public const string PasswordVariable = "SERVICEDESK_SMTP_PASSWORD";

        private readonly ILogger<SmtpEmailService> _logger;
        private readonly string _senderEmail;
        private readonly string _senderName;
        private readonly string _host;
        private readonly int _port;
        private readonly bool _enableSsl;
        private readonly string _username;
        private readonly string _password;

        public SmtpEmailService(IConfiguration configuration, ILogger<SmtpEmailService> logger)
        {
            _logger = logger;
            var s = configuration.GetSection("EmailSettings:Smtp");
            _senderEmail = (s["SenderEmail"] ?? string.Empty).Trim();
            var senderName = (s["SenderName"] ?? string.Empty).Trim();
            _senderName = senderName.Length > 0 ? senderName : EmailBrand.Current.TeamName;
            _host = (s["Host"] ?? string.Empty).Trim();
            _port = int.TryParse(s["Port"], out var port) ? port : 587;
            _enableSsl = !bool.TryParse(s["EnableSsl"], out var ssl) || ssl;
            _username = FirstFilled(s["Username"], Environment.GetEnvironmentVariable(UsernameVariable));
            _password = FirstFilled(s["Password"], Environment.GetEnvironmentVariable(PasswordVariable));
        }

        private static string FirstFilled(string? a, string? b) => !string.IsNullOrWhiteSpace(a) ? a.Trim() : (b ?? string.Empty).Trim();

        protected override async Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            if (_host.Length == 0 || _senderEmail.Length == 0)
            {
                _logger.LogWarning("Email not sent: SMTP is not set up (EmailSettings:Smtp:Host or SenderEmail is empty)");
                return (false, "SMTP is not set up: the host or sender address is missing");
            }

            try
            {
                using var client = new SmtpClient(_host, _port) { EnableSsl = _enableSsl };
                if (_username.Length > 0)
                    client.Credentials = new NetworkCredential(_username, _password);

                using var msg = new MailMessage
                {
                    From = new MailAddress(_senderEmail, _senderName),
                    Subject = subject,
                    SubjectEncoding = Encoding.UTF8,
                    BodyEncoding = Encoding.UTF8
                };
                msg.To.Add(new MailAddress(to));
                msg.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(EmailLayout.HtmlToText(htmlBody), Encoding.UTF8, MediaTypeNames.Text.Plain));
                msg.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, Encoding.UTF8, MediaTypeNames.Text.Html));
                foreach (var file in attachments ?? Array.Empty<EmailAttachment>())
                    msg.Attachments.Add(new Attachment(new MemoryStream(file.Content), file.FileName, file.ContentType));

                await client.SendMailAsync(msg);
                _logger.LogInformation("Email sent to {Email} with subject '{Subject}'", to, subject);
                return (true, "Email sent");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send email to {Email}", to);
                return (false, "Failed to send email: " + ex.Message);
            }
        }
    }
}