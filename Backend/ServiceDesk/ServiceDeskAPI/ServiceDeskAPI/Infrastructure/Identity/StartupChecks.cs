using Microsoft.Extensions.Options;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>Stops the API at start-up when a required setting is missing, instead of failing on the first sign-in.</summary>
    public static class StartupChecks
    {
        public static void Run(WebApplication app)
        {
            var jwt = app.Services.GetRequiredService<IOptions<JwtSettings>>().Value;
            var problem = jwt.Problem();
            if (problem != null)
                throw new InvalidOperationException(problem);

            var ldap = app.Services.GetRequiredService<IOptions<LdapSettings>>().Value;
            var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("ServiceDeskAPI.Startup");
            if (!LdapSetup.IsComplete(ldap))
            {
                if (app.Environment.IsProduction())
                    throw new InvalidOperationException("LdapSettings are incomplete; AD sign-in cannot work in Production.");
                logger.LogWarning("AD sign-in is off: LdapSettings are not filled in. Test accounts still work in Development. Run set-secrets.ps1 to add them.");
            }
        }
    }
}