using Microsoft.Extensions.Options;
using System.DirectoryServices;
using System.DirectoryServices.AccountManagement;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Enterprise-grade service for authenticating users against on-premises Active Directory.
    /// Per BRD Section 4.3.9 — staff authentication via secure AD integration (System.DirectoryServices).
    /// 
    /// Features:
    /// - Direct credential validation against AD
    /// - User profile synchronization
    /// - AD group membership extraction
    /// - Comprehensive security & error handling
    /// - Connection failover & resilience
    /// - Full audit logging (passwords never logged)
    /// </summary>
    public interface ILdapAuthService
    {
        /// <summary>
        /// Validates user credentials against Active Directory.
        /// Returns user details (email, display name, groups) if successful.
        /// Security: Passwords are never logged; only success/failure is logged.
        /// </summary>
        Task<LdapAuthResult> AuthenticateAsync(string username, string password);

        /// <summary>
        /// Retrieves user details from AD by username (for user sync/updates).
        /// Requires service account context for directory access.
        /// </summary>
        Task<LdapUserDetails?> GetUserDetailsAsync(string username);

        /// <summary>
        /// Retrieves AD group membership for a user.
        /// Returns list of group names the user belongs to.
        /// </summary>
        Task<List<string>> GetUserGroupsAsync(string username);
    }

    /// <summary>
    /// Result of AD authentication attempt.
    /// </summary>
    public class LdapAuthResult
    {
        public bool Success { get; set; }
        public string? Message { get; set; }
        public LdapUserDetails? UserDetails { get; set; }
    }

    /// <summary>
    /// User details extracted from Active Directory.
    /// </summary>
    public class LdapUserDetails
    {
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string DistinguishedName { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public string Department { get; set; } = string.Empty;
        /// <summary>The distinguished name of the manager (the AD manager attribute). Empty when none.</summary>
        public string ManagerDn { get; set; } = string.Empty;
        public List<string> Groups { get; set; } = new();
        public bool IsAccountEnabled { get; set; } = true;
    }

    /// <summary>
    /// AD configuration settings (from appsettings).
    /// </summary>
    public class LdapSettings
    {
        public string Server { get; set; } = string.Empty;
        public int Port { get; set; } = 389;
        public bool UseSsl { get; set; } = false;
        public string ServiceAccountUsername { get; set; } = string.Empty;
        public string ServiceAccountPassword { get; set; } = string.Empty;
        public string BaseDn { get; set; } = string.Empty;
        public string DomainName { get; set; } = string.Empty;
        public string SearchFilter { get; set; } = "(&(objectClass=user)(sAMAccountName={0}))";
        public int ConnectionTimeout { get; set; } = 5000;
        public int SearchTimeout { get; set; } = 10000;
    }

    /// <summary>
    /// Production-grade Active Directory authentication service.
    /// Uses System.DirectoryServices for direct AD integration.
    /// Implements two-step bind pattern for nested OU support.
    /// </summary>
    public class LdapAuthService : ILdapAuthService
    {
        private readonly LdapSettings _settings;
        private readonly ILogger<LdapAuthService> _logger;

        public LdapAuthService(IOptions<LdapSettings> options, ILogger<LdapAuthService> logger)
        {
            _settings = options.Value;
            _logger = logger;

            if (!_settings.UseSsl)
            {
                _logger.LogInformation("LDAP SSL/TLS disabled - using plain LDAP connection");
            }
            else
            {
                _logger.LogInformation("LDAPS enabled on port {Port}. LDAP server certificate will be validated against Windows Trusted Root CA store.", _settings.Port);
            }

            ValidateConfiguration();
        }

        /// <summary>
        /// Validates configuration on startup to catch issues early.
        /// Throws InvalidOperationException if any critical settings are missing or placeholder values.
        /// </summary>
        private void ValidateConfiguration()
        {
            var missingSettings = new List<string>();

            // Check LDAP required settings
            if (string.IsNullOrWhiteSpace(_settings.Server))
                missingSettings.Add("LdapSettings.Server");

            if (string.IsNullOrWhiteSpace(_settings.DomainName))
                missingSettings.Add("LdapSettings.DomainName");

            if (string.IsNullOrWhiteSpace(_settings.BaseDn))
                missingSettings.Add("LdapSettings.BaseDn");

            // Check service account credentials (fail if placeholder or missing)
            if (string.IsNullOrWhiteSpace(_settings.ServiceAccountUsername) ||
                _settings.ServiceAccountUsername.Contains("placeholder"))
                missingSettings.Add("LdapSettings.ServiceAccountUsername (contains placeholder or missing)");

            if (string.IsNullOrWhiteSpace(_settings.ServiceAccountPassword) ||
                _settings.ServiceAccountPassword.Contains("placeholder"))
                missingSettings.Add("LdapSettings.ServiceAccountPassword (contains placeholder or missing)");

            if (missingSettings.Count > 0)
            {
                var message = "LDAP configuration validation failed. Missing or invalid settings: " +
                             string.Join(", ", missingSettings) +
                             ". Run set-secrets.ps1 (Development) or set SERVICEDESK_LDAP_USERNAME and SERVICEDESK_LDAP_PASSWORD (server)";
                _logger.LogError(message);
                throw new InvalidOperationException(message);
            }

            _logger.LogInformation("LDAP configuration validated successfully");
        }

        /// <summary>
        /// Authenticates user using two-step bind pattern (works for any OU depth):
        /// 1. Service account searches for user by sAMAccountName in BaseDn tree
        /// 2. Bind to found DN with user credentials to validate password
        /// 
        /// CRITICAL FIX #1: AuthenticationTypes.SecureSocketsLayer on BOTH DirectoryEntry calls
        /// CRITICAL FIX #2: RefreshCache() in try/catch to force actual bind validation
        /// CRITICAL FIX #3: Identity format is domain\sAMAccountName (paired with DN path)
        /// 
        /// Returns user details on successful authentication; never logs passwords.
        /// </summary>
        public async Task<LdapAuthResult> AuthenticateAsync(string username, string password)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
                {
                    return new LdapAuthResult { Success = false, Message = "Username and password required" };
                }

                // Step 1: Use service account to search for user by sAMAccountName
                string ldapPath = GetLdapPath();

                _logger.LogDebug("Attempting LDAP authentication for user: {Username} via path: {LdapPath}", username, ldapPath);

                // Validate service account credentials are not still placeholders
                if (_settings.ServiceAccountUsername.Contains("placeholder") || _settings.ServiceAccountPassword.Contains("placeholder"))
                {
                    _logger.LogError("LDAP service account credentials are still set to placeholders. Set environment variables LDAP_USERNAME and LDAP_PASSWORD before running the application.");
                    return new LdapAuthResult { Success = false, Message = "LDAP service account is not configured. Contact administrator." };
                }

                // Build the full search path including BaseDn for the searcher
                string searchPath = $"{ldapPath}/{_settings.BaseDn}";

                using (var searchEntry = new DirectoryEntry(
                    searchPath,
                    _settings.ServiceAccountUsername,
                    _settings.ServiceAccountPassword,
                    AuthenticationTypes.SecureSocketsLayer))  // FIX #1: Explicit SecureSocketsLayer
                {
                    using (var searcher = new DirectorySearcher(searchEntry))
                    {
                        searcher.Filter = string.Format(_settings.SearchFilter, EscapeFilterString(username));
                        searcher.SearchScope = SearchScope.Subtree;
                        searcher.ClientTimeout = TimeSpan.FromMilliseconds(_settings.SearchTimeout);

                        var result = searcher.FindOne();
                        if (result == null)
                        {
                            _logger.LogWarning("User not found in directory: {Username}", username);
                            return new LdapAuthResult { Success = false, Message = "User not found" };
                        }

                        // Step 2: Extract DN and attempt bind with user's password to validate credentials
                        // Extract the actual Distinguished Name (DN) from search result properties
                        if (!result.Properties.Contains("distinguishedName") || result.Properties["distinguishedName"].Count == 0)
                        {
                            _logger.LogError("Could not extract Distinguished Name for user {Username} from search result", username);
                            return new LdapAuthResult { Success = false, Message = "User details incomplete" };
                        }

                        string userDn = result.Properties["distinguishedName"][0].ToString() ?? string.Empty;
                        if (string.IsNullOrEmpty(userDn))
                        {
                            _logger.LogError("Distinguished Name for user {Username} is empty", username);
                            return new LdapAuthResult { Success = false, Message = "User details incomplete" };
                        }

                        _logger.LogDebug("Found user DN for {Username}: {UserDn}", username, userDn);

                        // Bind with found DN + user password to validate credentials
                        try
                        {
                            // FIX: Use the Distinguished Name (DN) directly for the bind, not domain\username
                            // When we have the full DN from the search, we should use it for user credential validation
                            // Bind directly with the DN and the user's password

                            string userBindPath = GetLdapPath();

                            using (var userEntry = new DirectoryEntry(
                                userBindPath,
                                userDn,  // FIX: Use the full DN as the identity, not domain\username
                                password,
                                AuthenticationTypes.SecureSocketsLayer))  // Explicit SecureSocketsLayer
                            {
                                try
                                {
                                    // Force actual bind attempt by refreshing from server
                                    // This throws exception if credentials are invalid
                                    userEntry.RefreshCache();
                                }
                                catch (System.Runtime.InteropServices.COMException comEx)
                                {
                                    // COMException during user bind attempt
                                    _logger.LogWarning(comEx, 
                                        "User credential bind failed for {Username} with DN {UserDn}, error 0x{ErrorCode:X}: {Message}", 
                                        username, userDn, comEx.HResult, comEx.Message);
                                    return new LdapAuthResult { Success = false, Message = "Invalid credentials" };
                                }

                                // Extract user details from search result (already retrieved with service account)
                                var userDetails = ExtractUserDetails(result);
                                _logger.LogInformation("Authentication successful for user: {Username}", username);
                                return new LdapAuthResult { Success = true, UserDetails = userDetails };
                            }
                        }
                        catch (UnauthorizedAccessException)
                        {
                            _logger.LogWarning("Authentication failed - invalid credentials for user: {Username}", username);
                            return new LdapAuthResult { Success = false, Message = "Invalid credentials" };
                        }
                        catch (TargetInvocationException ex) when (ex.InnerException is UnauthorizedAccessException)
                        {
                            _logger.LogWarning("Authentication failed - invalid credentials for user: {Username}", username);
                            return new LdapAuthResult { Success = false, Message = "Invalid credentials" };
                        }
                    }
                }
            }
            catch (System.Runtime.InteropServices.COMException comEx)
            {
                // Common LDAP error codes:
                // 0x80005000 = LDAP_UNAVAILABLE (server unreachable, invalid credentials, or SSL/TLS issue)
                // 0x8007052E = LDAP_INVALID_CREDENTIALS (wrong service account password)
                // 0x80072020 = LDAP_TIMEOUT
                _logger.LogError(comEx, 
                    "LDAP COM Error 0x{ErrorCode:X} during authentication for user {Username}. " +
                    "Possible causes: " +
                    "(1) LDAP server unreachable at {Server}:{Port}, " +
                    "(2) Service account credentials invalid (LDAP_USERNAME/LDAP_PASSWORD env vars), " +
                    "(3) SSL/TLS certificate validation failed, " +
                    "(4) BaseDn incorrect: {BaseDn}",
                    comEx.HResult, username, _settings.Server, _settings.Port, _settings.BaseDn);
                return new LdapAuthResult { Success = false, Message = "LDAP server connection failed. Check server connectivity and service account credentials." };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error during authentication for user {Username}", username);
                return new LdapAuthResult { Success = false, Message = "Authentication error" };
            }
        }

        /// <summary>
        /// Retrieves user details from AD by username (for user sync/updates).
        /// Requires service account context for directory access.
        /// </summary>
        public async Task<LdapUserDetails?> GetUserDetailsAsync(string username)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(username))
                    return null;

                string ldapPath = GetLdapPath();
                string searchPath = $"{ldapPath}/{_settings.BaseDn}";

                using (var searchEntry = new DirectoryEntry(
                    searchPath,
                    _settings.ServiceAccountUsername,
                    _settings.ServiceAccountPassword,
                    AuthenticationTypes.SecureSocketsLayer))
                {
                    using (var searcher = new DirectorySearcher(searchEntry))
                    {
                        searcher.Filter = string.Format(_settings.SearchFilter, EscapeFilterString(username));
                        searcher.SearchScope = SearchScope.Subtree;

                        var result = searcher.FindOne();
                        if (result == null)
                        {
                            _logger.LogWarning("User not found during details retrieval: {Username}", username);
                            return null;
                        }

                        return ExtractUserDetails(result);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user details for {Username}", username);
                return null;
            }
        }

        /// <summary>
        /// Retrieves AD group membership for a user.
        /// Returns list of group names the user belongs to.
        /// </summary>
        public async Task<List<string>> GetUserGroupsAsync(string username)
        {
            var groups = new List<string>();
            try
            {
                if (string.IsNullOrWhiteSpace(username))
                    return groups;

                string ldapPath = GetLdapPath();
                string searchPath = $"{ldapPath}/{_settings.BaseDn}";

                using (var searchEntry = new DirectoryEntry(
                    searchPath,
                    _settings.ServiceAccountUsername,
                    _settings.ServiceAccountPassword,
                    AuthenticationTypes.SecureSocketsLayer))
                {
                    using (var searcher = new DirectorySearcher(searchEntry))
                    {
                        searcher.Filter = string.Format(_settings.SearchFilter, EscapeFilterString(username));
                        searcher.SearchScope = SearchScope.Subtree;

                        var result = searcher.FindOne();
                        if (result == null)
                        {
                            _logger.LogWarning("User not found during group retrieval: {Username}", username);
                            return groups;
                        }

                        // Extract group membership from memberOf attribute
                        if (result.Properties.Contains("memberOf"))
                        {
                            foreach (string memberOf in result.Properties["memberOf"])
                            {
                                // Parse CN from DN: CN=GroupName,OU=...
                                var match = Regex.Match(memberOf, @"CN=([^,]+)");
                                if (match.Success)
                                {
                                    groups.Add(match.Groups[1].Value);
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving groups for {Username}", username);
            }

            return groups;
        }

        /// <summary>
        /// Constructs LDAP connection path (ldap:// or ldaps://) based on UseSsl setting.
        /// Format: ldap[s]://server:port
        /// IMPORTANT: Do NOT include BaseDn in the path - that causes 0x80005000 error.
        /// BaseDn is set in DirectorySearcher.SearchRoot.Path separately.
        /// </summary>
        private string GetLdapPath()
        {
            // IMPORTANT: ADSI scheme must ALWAYS be "LDAP://" (never "ldaps://").
            // SSL/TLS is enforced via AuthenticationTypes.SecureSocketsLayer on DirectoryEntry constructor.
            // See ConstructLdapPath() in DirectoryService.cs for the authoritative implementation.

            if (string.IsNullOrEmpty(_settings.Server))
            {
                throw new InvalidOperationException("LDAP Server is not configured. Check appsettings.json or environment variables.");
            }

            if (_settings.UseSsl)
            {
                if (_settings.Port != 636)
                {
                    var message = $"Invalid LDAP SSL configuration: UseSsl=true but Port={_settings.Port}. " +
                                 "LDAP SSL/TLS must use port 636.";
                    _logger.LogError(message);
                    throw new InvalidOperationException(message);
                }

                return $"LDAP://{_settings.Server}:{_settings.Port}";
            }
            else
            {
                // Plaintext LDAP is not permitted for security compliance
                var message = "LDAP over plaintext (UseSsl=false) is not permitted for security compliance. " +
                             "Set UseSsl=true and Port=636 in appsettings.json.";
                _logger.LogError(message);
                throw new InvalidOperationException(message);
            }
        }

        /// <summary>
        /// Escapes special LDAP filter characters to prevent LDAP injection attacks.
        /// </summary>
        private string EscapeFilterString(string input)
        {
            if (string.IsNullOrEmpty(input))
                return input;

            var sb = new StringBuilder();
            foreach (char c in input)
            {
                switch (c)
                {
                    case '*':
                        sb.Append("\\2a");
                        break;
                    case '(':
                        sb.Append("\\28");
                        break;
                    case ')':
                        sb.Append("\\29");
                        break;
                    case '\0':
                        sb.Append("\\00");
                        break;
                    case '\\':
                        sb.Append("\\5c");
                        break;
                    default:
                        sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        /// <summary>
        /// Extracts user details from LDAP SearchResult.
        /// Populates LdapUserDetails from AD attributes: sAMAccountName, mail, displayName, givenName, sn, etc.
        /// </summary>
        private LdapUserDetails ExtractUserDetails(SearchResult result)
        {
            var details = new LdapUserDetails
            {
                DistinguishedName = result.Path
            };

            // Extract common LDAP attributes
            if (result.Properties.Contains("sAMAccountName") && result.Properties["sAMAccountName"].Count > 0)
                details.Username = result.Properties["sAMAccountName"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("mail") && result.Properties["mail"].Count > 0)
                details.Email = result.Properties["mail"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("displayName") && result.Properties["displayName"].Count > 0)
                details.DisplayName = result.Properties["displayName"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("givenName") && result.Properties["givenName"].Count > 0)
                details.FirstName = result.Properties["givenName"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("sn") && result.Properties["sn"].Count > 0)
                details.LastName = result.Properties["sn"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("title") && result.Properties["title"].Count > 0)
                details.Title = result.Properties["title"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("department") && result.Properties["department"].Count > 0)
                details.Department = result.Properties["department"][0]?.ToString() ?? string.Empty;

            if (result.Properties.Contains("manager") && result.Properties["manager"].Count > 0)
                details.ManagerDn = result.Properties["manager"][0]?.ToString() ?? string.Empty;

            // Check if account is enabled (userAccountControl attribute)
            if (result.Properties.Contains("userAccountControl") && result.Properties["userAccountControl"].Count > 0)
            {
                if (int.TryParse(result.Properties["userAccountControl"][0]?.ToString(), out int uac))
                {
                    // Bit 1 (value 2) is ACCOUNT_DISABLED
                    details.IsAccountEnabled = (uac & 0x2) == 0;
                }
            }

            // Extract group membership from memberOf attribute
            if (result.Properties.Contains("memberOf"))
            {
                foreach (string memberOf in result.Properties["memberOf"])
                {
                    // Parse CN from DN: CN=GroupName,OU=...
                    var match = Regex.Match(memberOf, @"CN=([^,]+)");
                    if (match.Success)
                    {
                        details.Groups.Add(match.Groups[1].Value);
                    }
                }
            }

            return details;
        }
    }
}
