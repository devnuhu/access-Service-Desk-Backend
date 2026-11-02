using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// Sends email through Infobip (Email API v3), ported from People Hub. Settings: EmailSettings:Infobip:BaseUrl, SenderEmail, SenderName.
    /// The API key is the Service Desk's own: EmailSettings:Infobip:ApiKey (user secrets, via set-secrets.ps1 -Email) or the
    /// SERVICEDESK_INFOBIP_API_KEY environment variable on a server. People Hub's INFOBIP_API_KEY is never read.
    /// The key is never written to a file, a log or a response. Sending never throws.
    /// </summary>
    public class InfobipEmailService : EmailServiceBase
    {
        public const string HttpClientName = "infobip";
        public const string ApiKeyVariable = "SERVICEDESK_INFOBIP_API_KEY";

        private readonly HttpClient _http;
        private readonly ILogger<InfobipEmailService> _logger;
        private readonly string _baseUrl;
        private readonly string _senderEmail;
        private readonly string _senderName;
        private readonly string _apiKey;

        public InfobipEmailService(HttpClient http, IConfiguration configuration, ILogger<InfobipEmailService> logger)
        {
            _http = http;
            _logger = logger;

            var section = configuration.GetSection("EmailSettings:Infobip");
            _baseUrl = (section["BaseUrl"] ?? string.Empty).Trim()
                .Replace("https://", string.Empty, StringComparison.OrdinalIgnoreCase)
                .Replace("http://", string.Empty, StringComparison.OrdinalIgnoreCase)
                .TrimEnd('/');
            _senderEmail = (section["SenderEmail"] ?? string.Empty).Trim();
            var senderName = (section["SenderName"] ?? string.Empty).Trim();
            _senderName = senderName.Length > 0 ? senderName : EmailBrand.Current.TeamName;
            _apiKey = ApiKey(configuration);
        }

        /// <summary>The Service Desk's own key: settings first, then SERVICEDESK_INFOBIP_API_KEY.</summary>
        public static string ApiKey(IConfiguration configuration)
        {
            var fromSettings = configuration["EmailSettings:Infobip:ApiKey"];
            if (!string.IsNullOrWhiteSpace(fromSettings)) return fromSettings.Trim();
            return (Environment.GetEnvironmentVariable(ApiKeyVariable) ?? string.Empty).Trim();
        }

        protected override async Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_apiKey))
                    return Fail("Infobip is not set up: the Service Desk API key is missing (run set-secrets.ps1 -Email, or set " + ApiKeyVariable + ")");
                if (string.IsNullOrWhiteSpace(_baseUrl) || string.IsNullOrWhiteSpace(_senderEmail))
                    return Fail("Infobip is not set up: the base URL or sender address is missing");

                using var form = new MultipartFormDataContent();
                form.Add(new StringContent(_senderName + " <" + _senderEmail + ">", Encoding.UTF8), "from");
                form.Add(new StringContent(to, Encoding.UTF8), "to");
                form.Add(new StringContent(subject, Encoding.UTF8), "subject");
                form.Add(new StringContent(htmlBody, Encoding.UTF8), "html");
                form.Add(new StringContent(EmailLayout.HtmlToText(htmlBody), Encoding.UTF8), "text");
                foreach (var file in attachments ?? Array.Empty<EmailAttachment>())
                {
                    var part = new ByteArrayContent(file.Content);
                    part.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
                    form.Add(part, "attachment", file.FileName);
                }

                using var request = new HttpRequestMessage(HttpMethod.Post, "https://" + _baseUrl + "/email/3/send") { Content = form };
                request.Headers.Authorization = new AuthenticationHeaderValue("App", _apiKey);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                using var response = await _http.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    var detail = Shorten(body);
                    _logger.LogWarning("Infobip refused the email to {Email} ({Status}): {Detail}", to, (int)response.StatusCode, detail);
                    return (false, "Infobip refused the email (" + (int)response.StatusCode + "): " + detail);
                }

                // 200 means Infobip accepted the request. A message-level status can still say it was rejected.
                var rejected = RejectedReason(body);
                if (rejected != null)
                {
                    _logger.LogWarning("Infobip rejected the email to {Email}: {Detail}", to, rejected);
                    return (false, "Infobip rejected the email: " + rejected);
                }

                _logger.LogInformation("Email accepted by Infobip for {Email} with subject '{Subject}'", to, subject);
                return (true, "Email sent");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Sending an email through Infobip failed");
                return (false, "Failed to send email: " + ex.Message);
            }
        }

        private (bool, string) Fail(string message)
        {
            _logger.LogWarning("Email not sent: {Message}", message);
            return (false, message);
        }

        private static string Shorten(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return "no details";
            var flat = text.Replace("\r", " ").Replace("\n", " ").Trim();
            return flat.Length <= 300 ? flat : flat.Substring(0, 300) + "...";
        }

        private static string? RejectedReason(string body)
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (!doc.RootElement.TryGetProperty("messages", out var messages) || messages.ValueKind != JsonValueKind.Array) return null;
                foreach (var message in messages.EnumerateArray())
                {
                    if (!message.TryGetProperty("status", out var status)) continue;
                    var group = status.TryGetProperty("groupName", out var g) ? g.GetString() : null;
                    if (string.Equals(group, "REJECTED", StringComparison.OrdinalIgnoreCase) || string.Equals(group, "UNDELIVERABLE", StringComparison.OrdinalIgnoreCase))
                        return status.TryGetProperty("description", out var d) ? d.GetString() ?? group : group;
                }
            }
            catch (JsonException)
            {
                // Not JSON: the HTTP status already said it worked.
            }
            return null;
        }
    }
}