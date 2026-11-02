using System.DirectoryServices;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Live search of on-premises Active Directory for the staff pickers (copied from People Hub). Binds like the sign-in does
    /// (the Service Desk service account, LDAPS on 636, same base DN). A directory failure throws, so "no match" and
    /// "directory unavailable" are never confused. Every search text is escaped before it goes into the LDAP filter.
    /// </summary>
    public class DirectoryService : IDirectoryService
    {
        private const int MaxResults = 20;
        private static readonly string[] AttributesToLoad =
        {
            "distinguishedName", "displayName", "cn", "mail", "sAMAccountName", "title", "department", "manager"
        };

        private readonly LdapSettings _ldapSettings;
        private readonly ILogger<DirectoryService> _logger;

        public DirectoryService(IOptions<LdapSettings> ldapSettingsOptions, ILogger<DirectoryService> logger)
        {
            _ldapSettings = ldapSettingsOptions.Value;
            _logger = logger;
        }

        public async Task<List<DirectoryUserDto>> SearchUsersAsync(string query)
        {
            var text = (query ?? string.Empty).Trim();
            if (text.Length == 0 || text.Length > 256)
                return new List<DirectoryUserDto>();

            try
            {
                var results = await Task.Run(() => Search(text));
                _logger.LogInformation("Directory search for '{Query}' found {Count} people", Shorten(text), results.Count);
                return results;
            }
            catch (Exception ex)
            {
                // Never log the service account password; the account name helps ICT find the problem.
                _logger.LogError(ex, "Directory search FAILED for '{Query}' (server {Server}:{Port}, base {BaseDn}, service account {Account}). {Reason}",
                    Shorten(text), _ldapSettings.Server, _ldapSettings.Port, _ldapSettings.BaseDn, _ldapSettings.ServiceAccountUsername, ex.Message);
                throw new InvalidOperationException("The staff directory could not be searched.", ex);
            }
        }

        private List<DirectoryUserDto> Search(string text)
        {
            var results = new List<DirectoryUserDto>();
            var path = ConstructLdapPath() + "/" + _ldapSettings.BaseDn;

            using (var root = new DirectoryEntry(path, _ldapSettings.ServiceAccountUsername, _ldapSettings.ServiceAccountPassword, AuthenticationTypes.SecureSocketsLayer))
            using (var searcher = new DirectorySearcher(root))
            {
                searcher.Filter = BuildFilter(text);
                searcher.SearchScope = SearchScope.Subtree;
                searcher.SizeLimit = MaxResults;
                searcher.ClientTimeout = TimeSpan.FromMilliseconds(_ldapSettings.SearchTimeout);
                foreach (var attribute in AttributesToLoad)
                    searcher.PropertiesToLoad.Add(attribute);

                using var found = searcher.FindAll();
                foreach (SearchResult hit in found)
                {
                    var person = ToDto(hit);
                    if (person != null) results.Add(person);
                }
            }

            return results.OrderBy(r => r.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
        }

        /// <summary>The LDAP filter for a search text: people (not computers), enabled accounts, matching name, login or mail.</summary>
        public static string BuildFilter(string query)
        {
            var q = EscapeLdapFilterValue((query ?? string.Empty).Trim());
            return "(&(objectCategory=person)(objectClass=user)"
                 + "(!(userAccountControl:1.2.840.113556.1.4.803:=2))"
                 + "(|(displayName=*" + q + "*)(cn=*" + q + "*)(givenName=*" + q + "*)(sn=*" + q + "*)"
                 + "(mail=*" + q + "*)(userPrincipalName=*" + q + "*)(sAMAccountName=*" + q + "*)))";
        }

        private static DirectoryUserDto? ToDto(SearchResult hit)
        {
            var sam = Prop(hit, "sAMAccountName");
            if (string.IsNullOrEmpty(sam)) return null;
            return new DirectoryUserDto
            {
                DistinguishedName = Prop(hit, "distinguishedName") ?? hit.Path,
                DisplayName = Prop(hit, "displayName") ?? Prop(hit, "cn") ?? sam,
                Email = Prop(hit, "mail") ?? string.Empty,
                SamAccountName = sam,
                JobTitle = Prop(hit, "title"),
                Department = Prop(hit, "department"),
                ManagerDn = Prop(hit, "manager")
            };
        }

        private static string? Prop(SearchResult hit, string name)
        {
            if (!hit.Properties.Contains(name) || hit.Properties[name].Count == 0) return null;
            var value = hit.Properties[name][0]?.ToString();
            return string.IsNullOrWhiteSpace(value) ? null : value;
        }

        private static string Shorten(string text) => text.Length <= 50 ? text : text.Substring(0, 50);

        /// <summary>Same rule as the sign-in: LDAPS on port 636 only.</summary>
        private string ConstructLdapPath()
        {
            if (string.IsNullOrEmpty(_ldapSettings.Server))
                throw new InvalidOperationException("LDAP Server is not configured. Run set-secrets.ps1 -LdapOnly.");
            if (!_ldapSettings.UseSsl || _ldapSettings.Port != 636)
                throw new InvalidOperationException("LDAP must use SSL on port 636. Set UseSsl=true and Port=636.");
            return "LDAP://" + _ldapSettings.Server + ":" + _ldapSettings.Port;
        }

        public static string EscapeLdapFilterValue(string input)
        {
            if (string.IsNullOrEmpty(input)) return input;
            var escaped = new System.Text.StringBuilder();
            foreach (var c in input)
            {
                switch (c)
                {
                    case '*': escaped.Append("\\2a"); break;
                    case '(': escaped.Append("\\28"); break;
                    case ')': escaped.Append("\\29"); break;
                    case '\\': escaped.Append("\\5c"); break;
                    case '/': escaped.Append("\\2f"); break;
                    case '\0': escaped.Append("\\00"); break;
                    default: escaped.Append(c); break;
                }
            }
            return escaped.ToString();
        }
    }

    /// <summary>Stands in when LdapSettings are empty (Development before AD is set up): every search reports the directory as unavailable.</summary>
    public class UnconfiguredDirectoryService : IDirectoryService
    {
        public Task<List<DirectoryUserDto>> SearchUsersAsync(string query) =>
            throw new InvalidOperationException("AD is not configured for the Service Desk yet. Run set-secrets.ps1 -LdapOnly.");
    }

    public static class DirectorySetup
    {
        public static IDirectoryService Create(IServiceProvider services)
        {
            var options = services.GetRequiredService<IOptions<LdapSettings>>();
            return LdapSetup.IsComplete(options.Value)
                ? new DirectoryService(options, services.GetRequiredService<ILogger<DirectoryService>>())
                : new UnconfiguredDirectoryService();
        }
    }
}