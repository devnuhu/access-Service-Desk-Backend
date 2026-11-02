using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    public class SendTestEmailRequest
    {
        /// <summary>Where to send the test message.</summary>
        public string To { get; set; } = string.Empty;
    }

    /// <summary>Super Admin checks that email is set up: which provider is on, and a test message (copied from People Hub).</summary>
    [ApiController]
    [Route("api/admin/email")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminEmailController : ControllerBase
    {
        private readonly IEmailService _email;
        private readonly IConfiguration _configuration;
        private readonly IAuditService _audit;

        public AdminEmailController(IEmailService email, IConfiguration configuration, IAuditService audit)
        {
            _email = email;
            _configuration = configuration;
            _audit = audit;
        }

        /// <summary>Which provider is on and whether it has what it needs. Never returns a key or password.</summary>
        [HttpGet("status")]
        [ProducesResponseType(typeof(EmailStatusDto), StatusCodes.Status200OK)]
        public ActionResult<EmailStatusDto> Status()
        {
            var provider = EmailSetup.Provider(_configuration);
            var infobip = _configuration.GetSection("EmailSettings:Infobip");
            var smtp = _configuration.GetSection("EmailSettings:Smtp");
            var keySet = InfobipEmailService.ApiKey(_configuration).Length > 0;
            var infobipReady = keySet && !string.IsNullOrWhiteSpace(infobip["BaseUrl"]) && !string.IsNullOrWhiteSpace(infobip["SenderEmail"]);
            var smtpReady = !string.IsNullOrWhiteSpace(smtp["Host"]) && !string.IsNullOrWhiteSpace(smtp["SenderEmail"]);
            return Ok(new EmailStatusDto(
                provider,
                new InfobipStatusDto(infobip["BaseUrl"], infobip["SenderEmail"], infobip["SenderName"], keySet),
                new SmtpStatusDto(smtp["Host"], smtp["Port"], smtp["SenderEmail"], !string.IsNullOrWhiteSpace(smtp["Username"])),
                !string.Equals(_configuration["EmailSettings:Notifications:Enabled"], "false", StringComparison.OrdinalIgnoreCase),
                provider switch { "Infobip" => infobipReady, "Smtp" => smtpReady, _ => false }));
        }

        /// <summary>Sends one test message. Always answers 200 with success and a message, so the page can show it.</summary>
        [HttpPost("test")]
        [ProducesResponseType(typeof(EmailTestResultDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<EmailTestResultDto>> Test([FromBody] SendTestEmailRequest request)
        {
            var to = (request?.To ?? string.Empty).Trim();
            if (to.Length == 0 || !MailAddress.TryCreate(to, out _))
                return BadRequest(new ApiError("Enter a valid email address.", "to", "Enter a valid email address."));

            var actor = AuditActor.From(HttpContext);
            var parts = EmailTemplates.Test(actor.DisplayName ?? "a Super Admin");
            var (success, message) = await _email.SendEmailAsync(to, parts.Subject, parts.Html);

            await _audit.LogAsync(actor.UserId, actor.DisplayName, AuditAction.Created, "TestEmail", Guid.NewGuid(), to,
                null, "{\"success\":" + (success ? "true" : "false") + "}", actor.IpAddress, actor.UserAgent, AuditModule.Notifications);
            return Ok(new EmailTestResultDto(success, message));
        }
    }
}