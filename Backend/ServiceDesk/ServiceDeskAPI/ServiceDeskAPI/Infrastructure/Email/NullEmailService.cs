using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>Used when EmailSettings:Provider is Off (the default until email is set up). Nothing is sent; callers are told so and carry on.</summary>
    public class NullEmailService : EmailServiceBase
    {
        private readonly ILogger<NullEmailService> _logger;

        public NullEmailService(ILogger<NullEmailService> logger) => _logger = logger;

        protected override Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            _logger.LogInformation("Email sending is switched off (EmailSettings:Provider). Not sent: '{Subject}'", subject);
            return Task.FromResult((false, "Email sending is switched off"));
        }
    }
}