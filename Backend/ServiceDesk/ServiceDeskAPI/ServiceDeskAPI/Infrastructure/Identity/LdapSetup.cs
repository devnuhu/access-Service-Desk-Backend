using Microsoft.Extensions.Options;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Chooses the AD sign-in service. With complete LdapSettings it is the People Hub LdapAuthService (LDAPS, two-step bind).
    /// Without them: Production refuses to start; Development runs with AD sign-in switched off, so test accounts still work.
    /// The service account is the Service Desk's own (user secrets, or SERVICEDESK_LDAP_USERNAME / SERVICEDESK_LDAP_PASSWORD on a server).
    /// </summary>
    public static class LdapSetup
    {
        public const string UsernameVariable = "SERVICEDESK_LDAP_USERNAME";
        public const string PasswordVariable = "SERVICEDESK_LDAP_PASSWORD";

        public static void FillFromEnvironment(LdapSettings s)
        {
            if (string.IsNullOrWhiteSpace(s.ServiceAccountUsername))
                s.ServiceAccountUsername = Environment.GetEnvironmentVariable(UsernameVariable) ?? string.Empty;
            if (string.IsNullOrWhiteSpace(s.ServiceAccountPassword))
                s.ServiceAccountPassword = Environment.GetEnvironmentVariable(PasswordVariable) ?? string.Empty;
        }

        public static bool IsComplete(LdapSettings s) =>
            Filled(s.Server) && Filled(s.DomainName) && Filled(s.BaseDn) && Filled(s.ServiceAccountUsername) && Filled(s.ServiceAccountPassword);

        private static bool Filled(string? v) => !string.IsNullOrWhiteSpace(v) && !v.Contains("placeholder", StringComparison.OrdinalIgnoreCase);

        public static ILdapAuthService Create(IServiceProvider services)
        {
            var options = services.GetRequiredService<IOptions<LdapSettings>>();
            if (IsComplete(options.Value))
                return new LdapAuthService(options, services.GetRequiredService<ILogger<LdapAuthService>>());

            if (services.GetRequiredService<IHostEnvironment>().IsProduction())
                throw new InvalidOperationException("LdapSettings are incomplete. Set Server, DomainName and BaseDn, and the Service Desk service account in "
                    + UsernameVariable + " and " + PasswordVariable + ".");

            return new UnconfiguredLdapAuthService(services.GetRequiredService<ILogger<UnconfiguredLdapAuthService>>());
        }
    }

    /// <summary>Stands in for AD when LdapSettings are not filled in (Development and tests only). Every AD sign-in is refused.</summary>
    public class UnconfiguredLdapAuthService : ILdapAuthService
    {
        private readonly ILogger<UnconfiguredLdapAuthService> _logger;

        public UnconfiguredLdapAuthService(ILogger<UnconfiguredLdapAuthService> logger) => _logger = logger;

        public Task<LdapAuthResult> AuthenticateAsync(string username, string password)
        {
            _logger.LogWarning("AD sign-in is not configured (LdapSettings are empty), so {Username} was refused. Run set-secrets.ps1 to add the Service Desk AD settings.", username);
            return Task.FromResult(new LdapAuthResult { Success = false, Message = "AD sign-in is not configured." });
        }

        public Task<LdapUserDetails?> GetUserDetailsAsync(string username) => Task.FromResult<LdapUserDetails?>(null);

        public Task<List<string>> GetUserGroupsAsync(string username) => Task.FromResult(new List<string>());
    }
}