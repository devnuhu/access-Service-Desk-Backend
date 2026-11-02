using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Services;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Sign-in with on-premises Active Directory and the Service Desk's own JWT. Ported from People Hub's AuthService with these changes:
    /// every active role goes into the token (a person can hold several); first sign-in gives the Requester role;
    /// there is no Employee record; settings come from IOptions&lt;JwtSettings&gt;; a refresh token that is used twice ends
    /// every session of that person; logout revokes the refresh token.
    /// </summary>
    public class AuthService : IAuthService
    {
        /// <summary>A just-rotated token may come back once more from a second browser tab; that is not treated as theft.</summary>
        private static readonly TimeSpan ReuseGrace = TimeSpan.FromSeconds(30);

        private readonly UserManager<User> _userManager;
        private readonly ILdapAuthService _ldapAuthService;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ILogger<AuthService> _logger;
        private readonly AppDbContext _dbContext;
        private readonly JwtSettings _jwt;
        private readonly IConfiguration _configuration;
        private readonly IHostEnvironment _environment;
        private readonly IAuditService _audit;

        public AuthService(
            UserManager<User> userManager,
            ILdapAuthService ldapAuthService,
            IHttpContextAccessor httpContextAccessor,
            ILogger<AuthService> logger,
            AppDbContext dbContext,
            IOptions<JwtSettings> jwtOptions,
            IConfiguration configuration,
            IHostEnvironment environment,
            IAuditService audit)
        {
            _userManager = userManager;
            _ldapAuthService = ldapAuthService;
            _httpContextAccessor = httpContextAccessor;
            _logger = logger;
            _dbContext = dbContext;
            _jwt = jwtOptions.Value;
            _configuration = configuration;
            _environment = environment;
            _audit = audit;
        }

        public async Task<(bool Success, string Message, LoginResponse? Response)> LoginAsync(LoginRequest request)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
                    return (false, "Username and password are required.", null);

                var typedName = request.Username.Trim();
                _logger.LogInformation("Login attempt for user: {Username}", typedName);

                // Development only: seeded test.* accounts sign in with a local password. Everything else goes to AD.
                var localTest = await TryTestAccountLoginAsync(typedName, request.Password);
                if (localTest.Handled) return (localTest.Success, localTest.Message, localTest.Response);

                // 1. Validate the credentials against AD
                var ldapResult = await _ldapAuthService.AuthenticateAsync(typedName, request.Password);
                if (!ldapResult.Success || ldapResult.UserDetails == null)
                {
                    _logger.LogWarning("AD authentication failed for user: {Username}", typedName);
                    await AuditLoginAsync(false, null, typedName, null);
                    return (false, "Invalid username or password.", null);
                }

                var ad = ldapResult.UserDetails;
                // One account per person, whether they typed "name", "DOMAIN\name" or "name@domain"
                var userName = string.IsNullOrWhiteSpace(ad.Username) ? typedName : ad.Username.Trim();

                // 2. Create or update the local user (just-in-time AD linking)
                var user = await _userManager.FindByNameAsync(userName);
                if (user == null)
                {
                    user = new User
                    {
                        Id = Guid.NewGuid(),
                        UserName = userName,
                        Email = NullIfBlank(ad.Email),
                        CorporateEmail = NullIfBlank(ad.Email),
                        FullName = ad.DisplayName,
                        Department = NullIfBlank(ad.Department),
                        JobTitle = NullIfBlank(ad.Title),
                        AdDistinguishedName = NullIfBlank(ad.DistinguishedName),
                        IsActive = true,
                        EmailConfirmed = true,
                        CreatedAt = DateTime.UtcNow,
                        LastLoginAt = DateTime.UtcNow
                    };
                    var created = await _userManager.CreateAsync(user);
                    if (!created.Succeeded)
                    {
                        _logger.LogError("Failed to create user {Username}: {Errors}", userName, string.Join(", ", created.Errors.Select(e => e.Description)));
                        return (false, "Failed to create user account.", null);
                    }
                    _logger.LogInformation("Created user {Username} on first sign-in (DN: {Dn})", userName, ad.DistinguishedName);
                }
                else
                {
                    if (!user.IsActive)
                    {
                        _logger.LogWarning("Sign-in refused for inactive account: {Username}", userName);
                        await AuditLoginAsync(false, user.Id, userName, user.FullName);
                        return (false, "Account is inactive. Contact your administrator.", null);
                    }

                    user.Email = NullIfBlank(ad.Email) ?? user.Email;
                    user.CorporateEmail = NullIfBlank(ad.Email) ?? user.CorporateEmail;
                    user.FullName = string.IsNullOrWhiteSpace(ad.DisplayName) ? user.FullName : ad.DisplayName;
                    user.Department = NullIfBlank(ad.Department) ?? user.Department;
                    user.JobTitle = NullIfBlank(ad.Title) ?? user.JobTitle;
                    if (string.IsNullOrEmpty(user.AdDistinguishedName))
                        user.AdDistinguishedName = NullIfBlank(ad.DistinguishedName);
                    user.LastLoginAt = DateTime.UtcNow;
                    user.UpdatedAt = DateTime.UtcNow;

                    var updated = await _userManager.UpdateAsync(user);
                    if (!updated.Succeeded)
                        _logger.LogError("Failed to update user {Username}: {Errors}", userName, string.Join(", ", updated.Errors.Select(e => e.Description)));
                }

                // 3. Roles: first sign-in becomes Requester; then every active role
                try
                {
                    await RoleAssignments.EnsureDefaultRoleAsync(_dbContext, user.Id);
                }
                catch (Exception roleEx)
                {
                    _logger.LogError(roleEx, "Could not give the Requester role to {Username} on first sign-in", userName);
                }

                var roles = await RoleAssignments.GetActiveRoleNamesAsync(_dbContext, user.Id);
                if (roles.Count == 0)
                    return (false, "Your account has no role. Contact the Service Desk administrator.", null);

                // 4. Tokens
                var response = await IssueTokensAsync(user, roles, ad.FirstName, ad.LastName);
                await AuditLoginAsync(true, user.Id, userName, user.FullName);
                _logger.LogInformation("Login successful for user: {Username} with roles: {Roles}", userName, string.Join(",", roles));
                return (true, "Login successful.", response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error during login for user: {Username}", request.Username);
                return (false, "An unexpected error occurred during login.", null);
            }
        }

        public async Task<(bool Success, string Message, LoginResponse? Response)> RefreshTokenAsync(string refreshToken)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(refreshToken))
                    return (false, "Invalid refresh token.", null);

                var hash = HashRefreshToken(refreshToken);
                var record = await _dbContext.RefreshTokenStores.Include(r => r.User).FirstOrDefaultAsync(r => r.TokenHash == hash);
                if (record == null)
                {
                    _logger.LogWarning("Refresh token not found");
                    return (false, "Invalid refresh token.", null);
                }

                if (record.IsRevoked)
                {
                    if (record.RevokedAt == null || DateTime.UtcNow - record.RevokedAt.Value > ReuseGrace)
                    {
                        // A token that was already used has come back: assume it was copied and end every session of this person.
                        var ended = await RevokeAllAsync(record.UserId);
                        _logger.LogWarning("Used refresh token presented again for user {UserId}; {Count} active sessions ended", record.UserId, ended);
                    }
                    return (false, "Refresh token has been revoked.", null);
                }

                if (DateTime.UtcNow > record.ExpiresAt)
                    return (false, "Refresh token has expired.", null);

                var user = record.User;
                if (user == null || !user.IsActive)
                    return (false, "User not found or inactive.", null);

                var roles = await RoleAssignments.GetActiveRoleNamesAsync(_dbContext, user.Id);
                if (roles.Count == 0)
                    return (false, "Your account has no role. Contact the Service Desk administrator.", null);

                // Rotation: the old token is spent, a new one is issued (saved together)
                record.IsRevoked = true;
                record.RevokedAt = DateTime.UtcNow;
                record.LastUsedAt = DateTime.UtcNow;
                var response = await IssueTokensAsync(user, roles, null, null);

                _logger.LogInformation("Token refreshed for user: {UserId}", user.Id);
                return (true, "Token refreshed successfully.", response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing token");
                return (false, "Failed to refresh token.", null);
            }
        }

        public async Task<(bool Success, string Message, UserProfileDto? User)> GetCurrentUserAsync(Guid userId)
        {
            try
            {
                var user = await _userManager.FindByIdAsync(userId.ToString());
                if (user == null || !user.IsActive)
                    return (false, "User account not found or inactive", null);

                var roles = await RoleAssignments.GetActiveRoleNamesAsync(_dbContext, user.Id);
                var (firstName, lastName) = SplitName(user.FullName ?? user.UserName);
                return (true, "User profile retrieved successfully", new UserProfileDto
                {
                    Id = user.Id,
                    Username = user.UserName ?? string.Empty,
                    Email = user.Email ?? string.Empty,
                    FullName = user.FullName,
                    FirstName = firstName,
                    LastName = lastName,
                    CorporateEmail = user.CorporateEmail,
                    Department = user.Department,
                    JobTitle = user.JobTitle,
                    Roles = roles,
                    UnreadNotificationCount = await UnreadAsync(user.Id)
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user profile for: {UserId}", userId);
                return (false, "An error occurred while loading the profile", null);
            }
        }

        public async Task<bool> SyncUserFromAdAsync(Guid userId)
        {
            try
            {
                var user = await _userManager.FindByIdAsync(userId.ToString());
                if (user == null || string.IsNullOrEmpty(user.UserName))
                    return false;

                var ad = await _ldapAuthService.GetUserDetailsAsync(user.UserName);
                if (ad == null)
                    return false;

                user.Email = NullIfBlank(ad.Email) ?? user.Email;
                user.CorporateEmail = NullIfBlank(ad.Email) ?? user.CorporateEmail;
                user.FullName = string.IsNullOrWhiteSpace(ad.DisplayName) ? user.FullName : ad.DisplayName;
                user.Department = NullIfBlank(ad.Department) ?? user.Department;
                user.JobTitle = NullIfBlank(ad.Title) ?? user.JobTitle;
                user.UpdatedAt = DateTime.UtcNow;

                var result = await _userManager.UpdateAsync(user);
                if (!result.Succeeded)
                {
                    _logger.LogError("Failed to sync user {UserId} from AD: {Errors}", userId, string.Join(", ", result.Errors.Select(e => e.Description)));
                    return false;
                }
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error syncing user from AD: {UserId}", userId);
                return false;
            }
        }

        public async Task<bool> RevokeRefreshTokenAsync(string refreshToken)
        {
            if (string.IsNullOrWhiteSpace(refreshToken))
                return false;
            var hash = HashRefreshToken(refreshToken);
            var record = await _dbContext.RefreshTokenStores.FirstOrDefaultAsync(r => r.TokenHash == hash);
            if (record == null || record.IsRevoked)
                return false;
            record.IsRevoked = true;
            record.RevokedAt = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync();
            return true;
        }

        // ---------------- helpers ----------------

        private async Task<LoginResponse> IssueTokensAsync(User user, IReadOnlyList<string> roles, string? firstName, string? lastName)
        {
            var expiresAt = DateTime.UtcNow.AddMinutes(_jwt.AccessTokenExpiryMinutes);
            var accessToken = GenerateAccessToken(user, roles, expiresAt);
            var refreshToken = GenerateRefreshToken();

            var userAgent = _httpContextAccessor.HttpContext?.Request.Headers["User-Agent"].ToString() ?? "unknown";
            if (userAgent.Length > 512) userAgent = userAgent.Substring(0, 512);
            var ip = GetClientIpAddress() ?? "unknown";
            if (ip.Length > 64) ip = ip.Substring(0, 64);

            _dbContext.RefreshTokenStores.Add(new RefreshTokenStore
            {
                Id = Guid.NewGuid(),
                UserId = user.Id,
                TokenHash = HashRefreshToken(refreshToken),
                CreatedAt = DateTime.UtcNow,
                ExpiresAt = DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays),
                IssuedFromIpAddress = ip,
                IssuedFromUserAgent = userAgent
            });
            await _dbContext.SaveChangesAsync();

            var fullName = user.FullName ?? user.UserName ?? string.Empty;
            var space = fullName.IndexOf(' ');
            return new LoginResponse
            {
                AccessToken = accessToken,
                RefreshToken = refreshToken,
                TokenType = "Bearer",
                AccessTokenExpiresAt = expiresAt,
                User = new UserClaimsDto
                {
                    Id = user.Id,
                    Username = user.UserName ?? string.Empty,
                    Email = user.Email ?? string.Empty,
                    FullName = fullName,
                    FirstName = !string.IsNullOrWhiteSpace(firstName) ? firstName : (space > 0 ? fullName.Substring(0, space) : fullName),
                    LastName = !string.IsNullOrWhiteSpace(lastName) ? lastName : (space > 0 ? fullName.Substring(space + 1) : string.Empty),
                    Department = user.Department,
                    Roles = roles.ToList(),
                    IsActive = user.IsActive,
                    UnreadNotificationCount = await UnreadAsync(user.Id)
                }
            };
        }

        private string GenerateAccessToken(User user, IReadOnlyList<string> roles, DateTime expiresAt)
        {
            var problem = _jwt.Problem();
            if (problem != null) throw new InvalidOperationException(problem);

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new(ClaimTypes.Name, user.UserName ?? string.Empty),
                new(ClaimTypes.Email, user.Email ?? string.Empty),
                new("FullName", user.FullName ?? string.Empty)
            };
            if (!string.IsNullOrWhiteSpace(user.Department))
                claims.Add(new Claim("Department", user.Department));
            foreach (var role in roles)
                claims.Add(new Claim(ClaimTypes.Role, role));

            var handler = new JwtSecurityTokenHandler();
            var token = handler.CreateToken(new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(claims),
                Expires = expiresAt,
                Issuer = _jwt.Issuer,
                Audience = _jwt.Audience,
                SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.SecretKey)), SecurityAlgorithms.HmacSha256Signature)
            });
            return handler.WriteToken(token);
        }

        private static string GenerateRefreshToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

        private static string HashRefreshToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

        private async Task<int> RevokeAllAsync(Guid userId)
        {
            var now = DateTime.UtcNow;
            return await _dbContext.RefreshTokenStores
                .Where(r => r.UserId == userId && !r.IsRevoked)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.IsRevoked, true).SetProperty(r => r.RevokedAt, (DateTime?)now));
        }

        private string? GetClientIpAddress()
        {
            var context = _httpContextAccessor.HttpContext;
            if (context?.Request.Headers.TryGetValue("X-Forwarded-For", out var forwardedFor) == true)
                return forwardedFor.ToString().Split(',')[0].Trim();
            return context?.Connection.RemoteIpAddress?.ToString();
        }

        private Task<int> UnreadAsync(Guid userId) =>
            _dbContext.InAppNotifications.CountAsync(n => n.RecipientUserId == userId && !n.IsRead);

        /// <summary>Every sign-in, successful or not, goes into the audit log. The password never does.</summary>
        private Task AuditLoginAsync(bool success, Guid? userId, string userName, string? fullName)
        {
            var http = _httpContextAccessor.HttpContext;
            return _audit.LogAsync(
                userId,
                string.IsNullOrWhiteSpace(fullName) ? userName : fullName,
                success ? AuditAction.Login : AuditAction.LoginFailed,
                "User",
                userId ?? Guid.Empty,
                userName,
                null,
                null,
                http?.Connection.RemoteIpAddress?.ToString(),
                http?.Request.Headers["User-Agent"].ToString(),
                AuditModule.Authentication);
        }

        /// <summary>"Amaka Grace Obi" -> ("Amaka", "Grace Obi"). One word -> (word, "").</summary>
        public static (string FirstName, string LastName) SplitName(string? fullName)
        {
            var name = (fullName ?? string.Empty).Trim();
            var space = name.IndexOf(' ');
            return space > 0 ? (name.Substring(0, space), name.Substring(space + 1).Trim()) : (name, string.Empty);
        }

        private static string? NullIfBlank(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        /// <summary>
        /// Development-only sign-in for the seeded test.* accounts (see TestAccountSeeder). Handles a login only when the environment is
        /// Development, TestAccounts:Enabled is true, the name looks like test.xxx and the local account has a local password.
        /// AD accounts never have a local password, so they always fall through to AD.
        /// </summary>
        private async Task<(bool Handled, bool Success, string Message, LoginResponse? Response)> TryTestAccountLoginAsync(string userName, string password)
        {
            var notHandled = (false, false, string.Empty, (LoginResponse?)null);

            if (!TestAccountSeeder.IsEnabled(_configuration, _environment.EnvironmentName) || !TestAccountSeeder.IsTestUserName(userName))
                return notHandled;

            var testUser = await _userManager.FindByNameAsync(userName);
            if (testUser == null || string.IsNullOrEmpty(testUser.PasswordHash))
                return notHandled;

            if (!testUser.IsActive)
            {
                await AuditLoginAsync(false, testUser.Id, userName, testUser.FullName);
                return (true, false, "Account is inactive. Contact your administrator.", null);
            }

            if (!await _userManager.CheckPasswordAsync(testUser, password))
            {
                _logger.LogWarning("Test account login failed for {Username}", userName);
                await AuditLoginAsync(false, testUser.Id, userName, testUser.FullName);
                return (true, false, "Invalid username or password.", null);
            }

            var roles = await RoleAssignments.GetActiveRoleNamesAsync(_dbContext, testUser.Id);
            if (roles.Count == 0)
                return (true, false, "Your account has no role. Contact the Service Desk administrator.", null);

            testUser.LastLoginAt = DateTime.UtcNow;
            await _userManager.UpdateAsync(testUser);

            var response = await IssueTokensAsync(testUser, roles, null, null);
            await AuditLoginAsync(true, testUser.Id, userName, testUser.FullName);
            _logger.LogInformation("Test account login successful for {Username} with roles {Roles}", userName, string.Join(",", roles));
            return (true, true, "Login successful.", response);
        }
    }
}