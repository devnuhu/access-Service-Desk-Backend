using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// Picks the email provider from EmailSettings:Provider when the service is first needed: Infobip, Smtp, or Off (the default,
    /// until email is set up). Read at run time, so a settings change applies on the next start without code changes.
    /// </summary>
    public static class EmailSetup
    {
        public static string Provider(IConfiguration configuration)
        {
            var value = (configuration["EmailSettings:Provider"] ?? string.Empty).Trim();
            if (value.Equals("Infobip", StringComparison.OrdinalIgnoreCase)) return "Infobip";
            if (value.Equals("Smtp", StringComparison.OrdinalIgnoreCase)) return "Smtp";
            return "Off";
        }

        public static IEmailService Create(IServiceProvider services)
        {
            var configuration = services.GetRequiredService<IConfiguration>();
            return Provider(configuration) switch
            {
                "Infobip" => new InfobipEmailService(
                    services.GetRequiredService<IHttpClientFactory>().CreateClient(InfobipEmailService.HttpClientName),
                    configuration,
                    services.GetRequiredService<ILogger<InfobipEmailService>>()),
                "Smtp" => new SmtpEmailService(configuration, services.GetRequiredService<ILogger<SmtpEmailService>>()),
                _ => new NullEmailService(services.GetRequiredService<ILogger<NullEmailService>>())
            };
        }
    }
}