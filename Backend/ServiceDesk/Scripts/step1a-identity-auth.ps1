# Step 1a - Users and roles (several per person), AD sign-in, JWT, cookies, refresh, test accounts.
# Ported from People Hub (ELM). No People Hub password, key or secret is used: the only thing read from ELM is the
# source code of LdapAuthService.cs (namespace renamed, checked for embedded secrets). Keys come from set-secrets.ps1.
#
# What it does:
#   - Users, Roles (5 BRD roles seeded), UserRoleAssignments (several active roles per person), RefreshTokenStores
#   - AuthService / AuthController: POST api/auth/login, refresh, logout; GET api/auth/me
#   - Own JWT issuer, audience and key; own cookie names (__Host-sd-* / __Secure-sd-*) so the apps never overwrite each other
#   - Policies: Super_Admin_Only, Unit_Management, Department_Oversight, Oversight, Case_Work
#   - Development test accounts: test.requester, test.caseworker1, test.caseworker2, test.hou, test.hod, test.superadmin
#   - Migration InitialIdentity, and tests on LocalDB
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk with the API stopped:
#   cd C:\Users\<you>\Desktop\PRO\ServiceDesk
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\step1a-identity-auth.ps1
# Then: .\set-secrets.ps1   (creates the Service Desk's own JWT key and test password; asks for the Service Desk AD settings)
# On any failure, every file is put back as it was.

param(
    [string]$ElmRoot = (Join-Path $env:USERPROFILE 'Desktop\PRO\ELM\EmployeeLCAPI')
)

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk (the folder that contains ServiceDeskAPI and docs).' -ForegroundColor Red; return }
Write-Host "  Solution root: $root"

$api = Join-Path $root 'ServiceDeskAPI'
$projPath = Join-Path $api 'ServiceDeskAPI.csproj'
$progPath = Join-Path $api 'Program.cs'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
$elmLdap = Join-Path $ElmRoot 'EmployeeLCAPI\Infrastructure\Identity\LdapAuthService.cs'
$elmProj = Join-Path $ElmRoot 'EmployeeLCAPI\EmployeeLCAPI.csproj'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Dotnet([string[]]$a) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & dotnet @a 2>&1 | ForEach-Object { "$_" }
    $script:lastExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    return $out
}

# ---------------- anchor checks (nothing is changed until all pass) ----------------
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Write-Host 'dotnet was not found on PATH.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Infrastructure\Persistence\AppDbContext.cs')) { Write-Host 'AppDbContext.cs already exists: Step 1a looks applied. Nothing changed.' -ForegroundColor Yellow; return }
$progOld = [System.IO.File]::ReadAllText($progPath)
if ($progOld -match 'AddAuthentication|AddDbContext') { Write-Host 'Program.cs already has authentication or a database. Nothing changed; send me Program.cs.' -ForegroundColor Red; return }
if ($progOld -notmatch 'AddSwaggerGen') { Write-Host 'Program.cs is not the Step 0a version (no AddSwaggerGen). Run step0a-fix-openapi.ps1 first.' -ForegroundColor Red; return }
$projOld = [System.IO.File]::ReadAllText($projPath)
$needed = @('Microsoft.AspNetCore.Identity.EntityFrameworkCore', 'Microsoft.AspNetCore.Authentication.JwtBearer', 'System.IdentityModel.Tokens.Jwt',
            'Microsoft.EntityFrameworkCore.SqlServer', 'Microsoft.EntityFrameworkCore.Design', 'System.DirectoryServices', 'System.DirectoryServices.AccountManagement',
            'Swashbuckle.AspNetCore')
$missing = @($needed | Where-Object { $projOld -notmatch ('Include="' + [regex]::Escape($_) + '"') })
if ($missing.Count -gt 0) { Write-Host ('ServiceDeskAPI.csproj is missing: ' + ($missing -join ', ') + '. Send me the project file.') -ForegroundColor Red; return }
$settingsOld = [System.IO.File]::ReadAllText((Join-Path $api 'appsettings.json'))
if ($settingsOld -notmatch 'ServiceDeskDB' -or $settingsOld -match 'JwtSettings') { Write-Host 'appsettings.json is not the Step 0 version. Nothing changed; send me appsettings.json.' -ForegroundColor Red; return }
if (-not (Test-Path $elmLdap)) { Write-Host "People Hub's LdapAuthService.cs was not found at $elmLdap (pass -ElmRoot)." -ForegroundColor Red; return }

# ---- LdapAuthService: code only, from People Hub ----
$ldapText = [System.IO.File]::ReadAllText($elmLdap)
if ($ldapText -notmatch 'namespace EmployeeLCAPI\.Infrastructure\.Identity') { Write-Host 'LdapAuthService.cs in ELM has a different namespace than expected. Send me the file.' -ForegroundColor Red; return }
$ldapText = $ldapText.Replace('namespace EmployeeLCAPI.Infrastructure.Identity', 'namespace ServiceDeskAPI.Infrastructure.Identity')
$ldapText = $ldapText.Replace('Set environment variables LDAP_USERNAME and LDAP_PASSWORD, or update appsettings.json', 'Run set-secrets.ps1 (Development) or set SERVICEDESK_LDAP_USERNAME and SERVICEDESK_LDAP_PASSWORD (server)')
if ($ldapText -match 'EmployeeLCAPI') { Write-Host 'LdapAuthService.cs still refers to EmployeeLCAPI after renaming. Send me the file.' -ForegroundColor Red; return }
foreach ($probe in @('ILdapAuthService', 'class LdapSettings', 'class LdapUserDetails', 'Department', 'Title', 'IOptions<LdapSettings> options, ILogger<LdapAuthService> logger')) {
    if (-not $ldapText.Contains($probe)) { Write-Host "LdapAuthService.cs in ELM no longer contains '$probe'. Send me the file." -ForegroundColor Red; return }
}
# Refuse to copy anything that looks like a value written into the code (password, key, secret, token)
$leaks = [regex]::Matches($ldapText, '(?im)^.*\b\w*(Password|Pwd|Secret|ApiKey|Token)\w*\s*=\s*"[^"]+".*$')
if ($leaks.Count -gt 0) {
    Write-Host 'LdapAuthService.cs in ELM contains what looks like a written-in secret, so it was not copied. Lines:' -ForegroundColor Red
    $leaks | ForEach-Object { Write-Host ('    ' + $_.Value.Trim()) }
    return
}

$files = [ordered]@{}
$files['ServiceDeskAPI\Program.cs'] = @'
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Services;

namespace ServiceDeskAPI
{
    /// <summary>
    /// Start-up, laid out like People Hub's Program.cs. Settings are read when services are first used (not while the
    /// builder runs), so tests and "dotnet ef" can supply their own. The Service Desk never reads People Hub's
    /// JWT_SECRET_KEY or LDAP_SERVICE_* variables; its own are SERVICEDESK_JWT_SECRET_KEY and SERVICEDESK_LDAP_*.
    /// </summary>
    public class Program
    {
        public static void Main(string[] args)
        {
            var builder = WebApplication.CreateBuilder(args);

            // ============ SETTINGS (own keys; user secrets in Development, environment variables on a server) ============
            builder.Services.AddOptions<JwtSettings>()
                .BindConfiguration(JwtSettings.SectionName)
                .PostConfigure(s =>
                {
                    if (string.IsNullOrWhiteSpace(s.SecretKey))
                        s.SecretKey = Environment.GetEnvironmentVariable(JwtSettings.SecretKeyVariable) ?? string.Empty;
                });
            builder.Services.AddOptions<LdapSettings>()
                .BindConfiguration("LdapSettings")
                .PostConfigure(LdapSetup.FillFromEnvironment);

            // ============ DATABASE ============
            builder.Services.AddDbContext<AppDbContext>((services, options) =>
                options.UseSqlServer(services.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")));

            // ============ IDENTITY (users, roles, password hashing for test accounts) ============
            builder.Services
                .AddIdentityCore<User>(options =>
                {
                    options.Password.RequireDigit = true;
                    options.Password.RequiredLength = 8;
                    options.Password.RequireLowercase = true;
                    options.Password.RequireUppercase = true;
                    options.Password.RequireNonAlphanumeric = true;
                    options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(5);
                    options.Lockout.MaxFailedAccessAttempts = 5;
                })
                .AddRoles<Role>()
                .AddEntityFrameworkStores<AppDbContext>();

            // ============ JWT AUTHENTICATION ============
            builder.Services.AddAuthentication(options =>
            {
                options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer();

            builder.Services.AddOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme)
                .Configure<IOptions<JwtSettings>>((options, jwtOptions) =>
                {
                    var jwt = jwtOptions.Value;
                    options.TokenValidationParameters = new TokenValidationParameters
                    {
                        ValidateIssuerSigningKey = true,
                        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SecretKey)),
                        ValidateIssuer = true,
                        ValidIssuer = jwt.Issuer,
                        ValidateAudience = true,
                        ValidAudience = jwt.Audience,
                        ValidateLifetime = true,
                        ClockSkew = TimeSpan.Zero
                    };
                    // Token sources, as in People Hub: HttpOnly cookie (preferred), then Bearer header, then ?access_token= for /hubs (SignalR)
                    options.Events = new JwtBearerEvents
                    {
                        OnMessageReceived = context =>
                        {
                            var fromCookie = AuthCookies.ReadAccessToken(context.Request);
                            if (fromCookie != null)
                            {
                                context.Token = fromCookie;
                                return Task.CompletedTask;
                            }

                            var header = context.Request.Headers["Authorization"].ToString();
                            if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
                            {
                                var token = header.Substring("Bearer ".Length).Trim();
                                if (token.Length > 0)
                                {
                                    context.Token = token;
                                    return Task.CompletedTask;
                                }
                            }

                            if (context.Request.Path.StartsWithSegments("/hubs") &&
                                context.Request.Query.TryGetValue("access_token", out var queryToken))
                                context.Token = queryToken.ToString();

                            return Task.CompletedTask;
                        },
                        OnAuthenticationFailed = context =>
                        {
                            var logger = context.HttpContext.RequestServices.GetRequiredService<ILogger<Program>>();
                            logger.LogWarning("JWT authentication failed: {Message}", context.Exception?.Message);
                            return Task.CompletedTask;
                        }
                    };
                });

            // ============ AUTHORIZATION (BRD Section 4) ============
            builder.Services.AddAuthorization(Policies.Register);

            // ============ CONTROLLERS AND SWAGGER ============
            builder.Services.AddControllers();
            builder.Services.AddHttpContextAccessor();
            builder.Services.AddEndpointsApiExplorer();
            builder.Services.AddSwaggerGen(options =>
            {
                options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "Service Desk: Contribution Processing Module API", Version = "v1" });
                options.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
                {
                    Name = "Authorization",
                    Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
                    Scheme = "bearer",
                    BearerFormat = "JWT",
                    Description = "Paste the accessToken from POST /api/auth/login"
                });
                options.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
                {
                    {
                        new Microsoft.OpenApi.Models.OpenApiSecurityScheme
                        {
                            Reference = new Microsoft.OpenApi.Models.OpenApiReference
                            {
                                Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                                Id = "Bearer"
                            }
                        },
                        Array.Empty<string>()
                    }
                });
            });

            // ============ CORS (the Service Desk web app only) ============
            builder.Services.AddCors(options =>
            {
                options.AddPolicy("AllowFrontend", policy =>
                {
                    var origins = (builder.Configuration["Frontend:Url"] ?? "http://localhost:5174")
                        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    policy.WithOrigins(origins)
                        .AllowAnyMethod()
                        .AllowAnyHeader()
                        .WithExposedHeaders("Content-Disposition")
                        .AllowCredentials();
                });
            });

            // ============ SERVICES ============
            builder.Services.AddScoped<ILdapAuthService>(LdapSetup.Create);
            builder.Services.AddScoped<IAuthService, AuthService>();
            builder.Services.AddHostedService<TestAccountSeeder>();

            var app = builder.Build();

            StartupChecks.Run(app);

            if (app.Environment.IsDevelopment())
            {
                app.UseSwagger();
                app.UseSwaggerUI();
            }

            // CORS before HTTPS redirection so preflight requests work (as in People Hub)
            app.UseCors("AllowFrontend");
            if (!app.Environment.IsDevelopment())
                app.UseHttpsRedirection();

            app.UseAuthentication();
            app.UseAuthorization();
            app.MapControllers();

            // Apply migrations on start-up. The API must not run on an out-of-date schema.
            using (var scope = app.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
                try
                {
                    var pending = db.Database.GetPendingMigrations().ToList();
                    if (pending.Count > 0)
                    {
                        logger.LogInformation("Applying {Count} pending migrations...", pending.Count);
                        db.Database.Migrate();
                        logger.LogInformation("Migrations applied");
                    }
                    else
                    {
                        logger.LogInformation("Database schema is up to date");
                    }
                }
                catch (Exception ex)
                {
                    logger.LogCritical(ex, "Database initialisation failed: {Message}", ex.Message);
                    throw;
                }
            }

            app.Run();
        }
    }
}
'@
$files['ServiceDeskAPI\appsettings.Development.json'] = @'
{
  "TestAccounts": {
    "Enabled": true
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  }
}
'@
$files['ServiceDeskAPI\appsettings.json'] = @'
{
  "ConnectionStrings": {
    "DefaultConnection": "Server=(localdb)\\MSSQLLocalDB;Database=ServiceDeskDB;Trusted_Connection=True;MultipleActiveResultSets=true;TrustServerCertificate=True"
  },
  "App": {
    "Name": "Service Desk: Contribution Processing Module"
  },
  "JwtSettings": {
    "SecretKey": "",
    "Issuer": "ServiceDeskAPI",
    "Audience": "ServiceDeskWeb",
    "AccessTokenExpiryMinutes": 15,
    "RefreshTokenExpiryDays": 7
  },
  "LdapSettings": {
    "Server": "",
    "Port": 636,
    "UseSsl": true,
    "ServiceAccountUsername": "",
    "ServiceAccountPassword": "",
    "BaseDn": "",
    "DomainName": "",
    "SearchFilter": "(&(objectClass=user)(sAMAccountName={0}))",
    "ConnectionTimeout": 5000,
    "SearchTimeout": 10000
  },
  "Frontend": {
    "Url": "http://localhost:5174"
  },
  "TestAccounts": {
    "Enabled": false
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "AllowedHosts": "*"
}
'@
$files['ServiceDeskAPI\Application\DTOs\ApiResponse.cs'] = @'
namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>Response wrapper, as in People Hub.</summary>
    public class ApiResponse
    {
        public int StatusCode { get; set; }
        public string Message { get; set; } = string.Empty;
        public List<string> Errors { get; set; } = new();
    }

    /// <summary>Response wrapper with a typed payload, as in People Hub.</summary>
    public class ApiResponse<T>
    {
        public int StatusCode { get; set; }
        public string Message { get; set; } = string.Empty;
        public T? Data { get; set; }
        public List<string> Errors { get; set; } = new();
    }
}
'@
$files['ServiceDeskAPI\Application\DTOs\AuthDTOs.cs'] = @'
using System.ComponentModel.DataAnnotations;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>AD credentials from the sign-in form (sAMAccountName, DOMAIN\name or name@domain).</summary>
    public class LoginRequest
    {
        [Required, MaxLength(256)]
        public string Username { get; set; } = string.Empty;

        [Required, MaxLength(256)]
        public string Password { get; set; } = string.Empty;
    }

    /// <summary>Returned by login and refresh. The tokens are also set as HttpOnly cookies, which the web app uses.</summary>
    public class LoginResponse
    {
        public string AccessToken { get; set; } = string.Empty;
        public string RefreshToken { get; set; } = string.Empty;
        public string TokenType { get; set; } = "Bearer";
        public DateTime AccessTokenExpiresAt { get; set; }
        public UserClaimsDto User { get; set; } = new();
    }

    /// <summary>The signed-in person and every role they hold.</summary>
    public class UserClaimsDto
    {
        public Guid Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string FullName { get; set; } = string.Empty;
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Department { get; set; }
        /// <summary>All active roles: Requester, CaseWorker, HeadOfUnit, HOD, SuperAdmin (several at once is normal).</summary>
        public List<string> Roles { get; set; } = new();
        public bool IsActive { get; set; }
        public int UnreadNotificationCount { get; set; }
    }

    /// <summary>GET /api/auth/me</summary>
    public class UserProfileDto
    {
        public Guid Id { get; set; }
        public string Username { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? CorporateEmail { get; set; }
        public string? Department { get; set; }
        public string? JobTitle { get; set; }
        public List<string> Roles { get; set; } = new();
        public int UnreadNotificationCount { get; set; }
    }

    /// <summary>Body for refresh and logout when the cookie is not available.</summary>
    public class RefreshTokenRequest
    {
        public string RefreshToken { get; set; } = string.Empty;
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IAuthService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Sign-in with on-premises Active Directory and the Service Desk's own JWT (ported from People Hub).</summary>
    public interface IAuthService
    {
        Task<(bool Success, string Message, LoginResponse? Response)> LoginAsync(LoginRequest request);

        /// <summary>Rotates the refresh token: the old one stops working and a new pair is issued.</summary>
        Task<(bool Success, string Message, LoginResponse? Response)> RefreshTokenAsync(string refreshToken);

        Task<(bool Success, string Message, UserProfileDto? User)> GetCurrentUserAsync(Guid userId);

        Task<bool> SyncUserFromAdAsync(Guid userId);

        /// <summary>Logout: the refresh token can no longer be used.</summary>
        Task<bool> RevokeRefreshTokenAsync(string refreshToken);
    }
}
'@
$files['ServiceDeskAPI\Controllers\AuthController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Sign-in (ported from People Hub).
    /// POST /api/auth/login, POST /api/auth/refresh, GET /api/auth/me, POST /api/auth/logout.
    /// Tokens are set as HttpOnly cookies (Service Desk names, see AuthCookies) and also returned in the body.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IAuthService _authService;
        private readonly ILogger<AuthController> _logger;
        private readonly JwtSettings _jwt;
        private readonly IHostEnvironment _environment;

        public AuthController(IAuthService authService, ILogger<AuthController> logger, IOptions<JwtSettings> jwt, IHostEnvironment environment)
        {
            _authService = authService;
            _logger = logger;
            _jwt = jwt.Value;
            _environment = environment;
        }

        /// <summary>Sign in with AD credentials (or a Development test account).</summary>
        [HttpPost("login")]
        [AllowAnonymous]
        public async Task<ActionResult<ApiResponse<LoginResponse>>> Login([FromBody] LoginRequest request)
        {
            var (success, message, response) = await _authService.LoginAsync(request);
            if (!success || response == null)
                return Unauthorized(new ApiResponse<LoginResponse> { StatusCode = 401, Message = message });

            SetAuthenticationCookies(response);
            return Ok(new ApiResponse<LoginResponse> { StatusCode = 200, Message = message, Data = response });
        }

        /// <summary>New tokens from a refresh token (cookie first, then body). The old refresh token stops working.</summary>
        [HttpPost("refresh")]
        [AllowAnonymous]
        public async Task<ActionResult<ApiResponse<LoginResponse>>> RefreshToken([FromBody] RefreshTokenRequest? request)
        {
            var refreshToken = AuthCookies.ReadRefreshToken(Request);
            if (string.IsNullOrWhiteSpace(refreshToken))
                refreshToken = request?.RefreshToken;

            if (string.IsNullOrWhiteSpace(refreshToken))
                return BadRequest(new ApiResponse<LoginResponse> { StatusCode = 400, Message = "Refresh token is required." });

            var (success, message, response) = await _authService.RefreshTokenAsync(refreshToken);
            if (!success || response == null)
            {
                ClearAuthenticationCookies();
                return Unauthorized(new ApiResponse<LoginResponse> { StatusCode = 401, Message = message });
            }

            SetAuthenticationCookies(response);
            return Ok(new ApiResponse<LoginResponse> { StatusCode = 200, Message = message, Data = response });
        }

        /// <summary>The signed-in person and every role they hold.</summary>
        [HttpGet("me")]
        [Authorize]
        public async Task<ActionResult<ApiResponse<UserProfileDto>>> GetCurrentUser()
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
                return Unauthorized(new ApiResponse<UserProfileDto> { StatusCode = 401, Message = "Invalid user context" });

            var (success, message, user) = await _authService.GetCurrentUserAsync(userId);
            if (!success)
                return NotFound(new ApiResponse<UserProfileDto> { StatusCode = 404, Message = message });

            return Ok(new ApiResponse<UserProfileDto> { StatusCode = 200, Message = message, Data = user });
        }

        /// <summary>
        /// Sign out: revokes the refresh token and clears the cookies. Open to anonymous callers so an expired
        /// access token never leaves a person unable to sign out.
        /// </summary>
        [HttpPost("logout")]
        [AllowAnonymous]
        public async Task<ActionResult<ApiResponse>> Logout([FromBody] RefreshTokenRequest? request)
        {
            var refreshToken = AuthCookies.ReadRefreshToken(Request);
            if (string.IsNullOrWhiteSpace(refreshToken))
                refreshToken = request?.RefreshToken;

            try
            {
                if (!string.IsNullOrWhiteSpace(refreshToken))
                    await _authService.RevokeRefreshTokenAsync(refreshToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not revoke the refresh token during logout");
            }

            _logger.LogInformation("User logged out: {Username}", User.FindFirst(ClaimTypes.Name)?.Value ?? "(token expired)");
            ClearAuthenticationCookies();
            return Ok(new ApiResponse { StatusCode = 200, Message = "Logout successful." });
        }

        private void SetAuthenticationCookies(LoginResponse tokens)
        {
            var isHttps = Request.IsHttps;
            var isDevelopment = _environment.IsDevelopment();

            // Same rules as People Hub: SameSite=None in Development (frontend on another port), Strict over HTTPS, otherwise Lax.
            CookieOptions Options(DateTime expires) => new()
            {
                HttpOnly = true,
                Secure = isDevelopment || isHttps,
                SameSite = isDevelopment ? SameSiteMode.None : (isHttps ? SameSiteMode.Strict : SameSiteMode.Lax),
                Path = "/",
                Expires = expires
            };

            Response.Cookies.Append(isHttps ? AuthCookies.AccessHttps : AuthCookies.AccessHttp, tokens.AccessToken,
                Options(DateTime.UtcNow.AddMinutes(_jwt.AccessTokenExpiryMinutes)));
            Response.Cookies.Append(isHttps ? AuthCookies.RefreshHttps : AuthCookies.RefreshHttp, tokens.RefreshToken,
                Options(DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays)));
        }

        private void ClearAuthenticationCookies()
        {
            var expired = new CookieOptions
            {
                HttpOnly = true,
                Secure = true,
                SameSite = Request.IsHttps ? SameSiteMode.Strict : SameSiteMode.Lax,
                Path = "/",
                Expires = DateTime.UtcNow.AddDays(-1)
            };
            foreach (var name in new[] { AuthCookies.AccessHttps, AuthCookies.AccessHttp, AuthCookies.RefreshHttps, AuthCookies.RefreshHttp })
            {
                if (Request.Cookies.ContainsKey(name) || name == (Request.IsHttps ? AuthCookies.AccessHttps : AuthCookies.AccessHttp)
                    || name == (Request.IsHttps ? AuthCookies.RefreshHttps : AuthCookies.RefreshHttp))
                    Response.Cookies.Append(name, string.Empty, expired);
            }
        }
    }
}
'@
$files['ServiceDeskAPI\Domain\AppRoles.cs'] = @'
namespace ServiceDeskAPI.Domain
{
    /// <summary>
    /// The five roles of BRD Section 4. A person can hold several at once (for example Requester and CaseWorker).
    /// The ids are fixed so the seed data never changes between migrations.
    /// </summary>
    public static class AppRoles
    {
        public const string Requester = "Requester";
        public const string CaseWorker = "CaseWorker";
        public const string HeadOfUnit = "HeadOfUnit";
        public const string HOD = "HOD";
        public const string SuperAdmin = "SuperAdmin";

        public static readonly Guid RequesterId = new("5d1a0001-0000-4000-8000-000000000001");
        public static readonly Guid CaseWorkerId = new("5d1a0001-0000-4000-8000-000000000002");
        public static readonly Guid HeadOfUnitId = new("5d1a0001-0000-4000-8000-000000000003");
        public static readonly Guid HODId = new("5d1a0001-0000-4000-8000-000000000004");
        public static readonly Guid SuperAdminId = new("5d1a0001-0000-4000-8000-000000000005");

        public static readonly IReadOnlyList<string> All = new[] { Requester, CaseWorker, HeadOfUnit, HOD, SuperAdmin };
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\RefreshTokenStore.cs'] = @'
namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>A refresh token, stored as a SHA-256 hash only. Each use replaces it with a new one (rotation).</summary>
    public class RefreshTokenStore
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public string TokenHash { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime ExpiresAt { get; set; }
        public bool IsRevoked { get; set; }
        public DateTime? RevokedAt { get; set; }
        public string? IssuedFromIpAddress { get; set; }
        public string? IssuedFromUserAgent { get; set; }
        public DateTime? LastUsedAt { get; set; }

        public User? User { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\Role.cs'] = @'
using Microsoft.AspNetCore.Identity;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>An application role (BRD Section 4). The five roles are seeded; see AppRoles.</summary>
    public class Role : IdentityRole<Guid>
    {
        public string? Description { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\User.cs'] = @'
using Microsoft.AspNetCore.Identity;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A staff member who has signed in with Active Directory (or a Development test account).
    /// Copied from People Hub, without the Employee link; department and job title come from AD.
    /// </summary>
    public class User : IdentityUser<Guid>
    {
        /// <summary>The AD distinguished name, set on first sign-in (just-in-time linking).</summary>
        public string? AdDistinguishedName { get; set; }
        public string? CorporateEmail { get; set; }
        public string? FullName { get; set; }
        /// <summary>The AD department attribute, refreshed at every sign-in.</summary>
        public string? Department { get; set; }
        /// <summary>The AD title attribute, refreshed at every sign-in.</summary>
        public string? JobTitle { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime? LastLoginAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }

        public ICollection<UserRoleAssignment> RoleAssignments { get; set; } = new List<UserRoleAssignment>();
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\UserRoleAssignment.cs'] = @'
namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// One role held by one person, with who granted it and when. Unlike People Hub, a person may hold
    /// several active roles; the database allows each role only once while it is active.
    /// </summary>
    public class UserRoleAssignment
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public Guid RoleId { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
        public Guid? AssignedByUserId { get; set; }
        public DateTime? DisabledAt { get; set; }
        public Guid? DisabledByUserId { get; set; }

        public User? User { get; set; }
        public Role? Role { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\AuthCookies.cs'] = @'
namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Cookie names for the Service Desk tokens. They differ from People Hub's (__Host-accessToken and so on)
    /// because browsers share cookies across ports on the same host: with the same names, signing in to one
    /// app on localhost or a shared server would overwrite the other app's session.
    /// __Host- is used over HTTPS, __Secure- over plain HTTP in Development.
    /// </summary>
    public static class AuthCookies
    {
        public const string AccessHttps = "__Host-sd-accessToken";
        public const string AccessHttp = "__Secure-sd-accessToken";
        public const string RefreshHttps = "__Host-sd-refreshToken";
        public const string RefreshHttp = "__Secure-sd-refreshToken";

        public static string? ReadAccessToken(HttpRequest request) => Read(request, AccessHttps) ?? Read(request, AccessHttp);
        public static string? ReadRefreshToken(HttpRequest request) => Read(request, RefreshHttps) ?? Read(request, RefreshHttp);

        private static string? Read(HttpRequest request, string name) =>
            request.Cookies.TryGetValue(name, out var value) && !string.IsNullOrEmpty(value) ? value : null;
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\AuthService.cs'] = @'
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

        public AuthService(
            UserManager<User> userManager,
            ILdapAuthService ldapAuthService,
            IHttpContextAccessor httpContextAccessor,
            ILogger<AuthService> logger,
            AppDbContext dbContext,
            IOptions<JwtSettings> jwtOptions,
            IConfiguration configuration,
            IHostEnvironment environment)
        {
            _userManager = userManager;
            _ldapAuthService = ldapAuthService;
            _httpContextAccessor = httpContextAccessor;
            _logger = logger;
            _dbContext = dbContext;
            _jwt = jwtOptions.Value;
            _configuration = configuration;
            _environment = environment;
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
                return (true, "User profile retrieved successfully", new UserProfileDto
                {
                    Id = user.Id,
                    Username = user.UserName ?? string.Empty,
                    Email = user.Email ?? string.Empty,
                    FullName = user.FullName,
                    CorporateEmail = user.CorporateEmail,
                    Department = user.Department,
                    JobTitle = user.JobTitle,
                    Roles = roles,
                    UnreadNotificationCount = 0 // in-app notifications arrive in Step 1b
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
                    UnreadNotificationCount = 0
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
                return (true, false, "Account is inactive. Contact your administrator.", null);

            if (!await _userManager.CheckPasswordAsync(testUser, password))
            {
                _logger.LogWarning("Test account login failed for {Username}", userName);
                return (true, false, "Invalid username or password.", null);
            }

            var roles = await RoleAssignments.GetActiveRoleNamesAsync(_dbContext, testUser.Id);
            if (roles.Count == 0)
                return (true, false, "Your account has no role. Contact the Service Desk administrator.", null);

            testUser.LastLoginAt = DateTime.UtcNow;
            await _userManager.UpdateAsync(testUser);

            var response = await IssueTokensAsync(testUser, roles, null, null);
            _logger.LogInformation("Test account login successful for {Username} with roles {Roles}", userName, string.Join(",", roles));
            return (true, true, "Login successful.", response);
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\JwtSettings.cs'] = @'
namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// JWT settings (section "JwtSettings"). The signing key is the Service Desk's own: it comes from user secrets
    /// (set-secrets.ps1) or, on a server, the SERVICEDESK_JWT_SECRET_KEY environment variable.
    /// People Hub's JWT_SECRET_KEY is deliberately never read.
    /// </summary>
    public class JwtSettings
    {
        public const string SectionName = "JwtSettings";
        public const string SecretKeyVariable = "SERVICEDESK_JWT_SECRET_KEY";

        public string SecretKey { get; set; } = string.Empty;
        public string Issuer { get; set; } = "ServiceDeskAPI";
        public string Audience { get; set; } = "ServiceDeskWeb";
        public int AccessTokenExpiryMinutes { get; set; } = 15;
        public int RefreshTokenExpiryDays { get; set; } = 7;

        /// <summary>Why the key cannot be used, or null when it is fine.</summary>
        public string? Problem()
        {
            if (string.IsNullOrWhiteSpace(SecretKey) || SecretKey.Contains("placeholder", StringComparison.OrdinalIgnoreCase))
                return "The Service Desk JWT key is not set. Run set-secrets.ps1 from the ServiceDesk folder (Development) or set " + SecretKeyVariable + " (server). Never reuse the People Hub key.";
            if (SecretKey.Length < 32)
                return "The Service Desk JWT key must be at least 32 characters. Run set-secrets.ps1 -NewJwtKey.";
            return null;
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\LdapSetup.cs'] = @'
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
'@
$files['ServiceDeskAPI\Infrastructure\Identity\Policies.cs'] = @'
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Authorization policies (BRD Section 4). Every endpoint names one of these, or [Authorize] for any signed-in staff member.
    /// SuperAdmin passes every policy. HOD oversees but does not work tickets, so HOD is not in Case_Work.
    /// </summary>
    public static class Policies
    {
        public const string SuperAdminOnly = "Super_Admin_Only";
        public const string UnitManagement = "Unit_Management";
        public const string DepartmentOversight = "Department_Oversight";
        public const string Oversight = "Oversight";
        public const string CaseWork = "Case_Work";

        public static readonly IReadOnlyDictionary<string, string[]> Roles = new Dictionary<string, string[]>
        {
            [SuperAdminOnly] = new[] { AppRoles.SuperAdmin },
            [UnitManagement] = new[] { AppRoles.HeadOfUnit, AppRoles.SuperAdmin },
            [DepartmentOversight] = new[] { AppRoles.HOD, AppRoles.SuperAdmin },
            [Oversight] = new[] { AppRoles.HeadOfUnit, AppRoles.HOD, AppRoles.SuperAdmin },
            [CaseWork] = new[] { AppRoles.CaseWorker, AppRoles.HeadOfUnit, AppRoles.SuperAdmin }
        };

        public static void Register(AuthorizationOptions options)
        {
            options.DefaultPolicy = new AuthorizationPolicyBuilder(JwtBearerDefaults.AuthenticationScheme)
                .RequireAuthenticatedUser()
                .Build();

            foreach (var (name, roles) in Roles)
            {
                options.AddPolicy(name, policy => policy
                    .AddAuthenticationSchemes(JwtBearerDefaults.AuthenticationScheme)
                    .RequireAuthenticatedUser()
                    .RequireRole(roles));
            }
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\RoleAssignments.cs'] = @'
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Reads and grants roles. UserRoleAssignments is the source of truth; the Identity UserRoles table is kept in step
    /// so UserManager role checks agree. A person may hold several roles.
    /// </summary>
    public static class RoleAssignments
    {
        public static async Task<List<string>> GetActiveRoleNamesAsync(AppDbContext db, Guid userId) =>
            await db.UserRoleAssignments
                .AsNoTracking()
                .Where(a => a.UserId == userId && a.IsActive && a.Role != null && a.Role.Name != null)
                .Select(a => a.Role!.Name!)
                .Distinct()
                .OrderBy(n => n)
                .ToListAsync();

        /// <summary>Grants the role if the person does not already hold it. Returns true when it was granted now.</summary>
        public static async Task<bool> EnsureRoleAsync(AppDbContext db, Guid userId, string roleName, Guid? assignedByUserId)
        {
            var normalized = roleName.ToUpperInvariant();
            var roleId = await db.Roles.Where(r => r.NormalizedName == normalized).Select(r => (Guid?)r.Id).FirstOrDefaultAsync()
                ?? throw new InvalidOperationException("Role " + roleName + " does not exist.");

            if (await HoldsAsync(db, userId, roleId))
                return false;

            var assignment = new UserRoleAssignment
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                RoleId = roleId,
                IsActive = true,
                AssignedAt = DateTime.UtcNow,
                AssignedByUserId = assignedByUserId
            };
            db.UserRoleAssignments.Add(assignment);

            IdentityUserRole<Guid>? link = null;
            if (!await db.UserRoles.AnyAsync(r => r.UserId == userId && r.RoleId == roleId))
            {
                link = new IdentityUserRole<Guid> { UserId = userId, RoleId = roleId };
                db.UserRoles.Add(link);
            }

            try
            {
                await db.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateException)
            {
                // Two sign-ins at the same moment: the unique index lets only one through. Forget ours and keep theirs.
                db.Entry(assignment).State = EntityState.Detached;
                if (link != null) db.Entry(link).State = EntityState.Detached;
                if (await HoldsAsync(db, userId, roleId)) return false;
                throw;
            }
        }

        /// <summary>First sign-in: a person with no active role becomes a Requester (any staff member may raise tickets).</summary>
        public static async Task<bool> EnsureDefaultRoleAsync(AppDbContext db, Guid userId)
        {
            if (await db.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.IsActive))
                return false;
            return await EnsureRoleAsync(db, userId, AppRoles.Requester, null);
        }

        private static Task<bool> HoldsAsync(AppDbContext db, Guid userId, Guid roleId) =>
            db.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.RoleId == roleId && a.IsActive);
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\StartupChecks.cs'] = @'
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
'@
$files['ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs'] = @'
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;

namespace ServiceDeskAPI.Infrastructure.Persistence
{
    public class AppDbContext : IdentityDbContext<User, Role, Guid>
    {
        private static readonly DateTime SeedDate = new(2026, 11, 2, 0, 0, 0, DateTimeKind.Utc);

        public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

        public DbSet<UserRoleAssignment> UserRoleAssignments => Set<UserRoleAssignment>();
        public DbSet<RefreshTokenStore> RefreshTokenStores => Set<RefreshTokenStore>();

        protected override void OnModelCreating(ModelBuilder builder)
        {
            base.OnModelCreating(builder);

            // Same table names as People Hub
            builder.Entity<User>().ToTable("Users");
            builder.Entity<Role>().ToTable("Roles");
            builder.Entity<IdentityUserRole<Guid>>().ToTable("UserRoles");
            builder.Entity<IdentityUserClaim<Guid>>().ToTable("UserClaims");
            builder.Entity<IdentityUserLogin<Guid>>().ToTable("UserLogins");
            builder.Entity<IdentityRoleClaim<Guid>>().ToTable("RoleClaims");
            builder.Entity<IdentityUserToken<Guid>>().ToTable("UserTokens");

            builder.Entity<User>(e =>
            {
                e.Property(u => u.AdDistinguishedName).HasMaxLength(512);
                e.Property(u => u.CorporateEmail).HasMaxLength(256);
                e.Property(u => u.FullName).HasMaxLength(200);
                e.Property(u => u.Department).HasMaxLength(200);
                e.Property(u => u.JobTitle).HasMaxLength(200);
                e.HasIndex(u => u.AdDistinguishedName).IsUnique().HasFilter("[AdDistinguishedName] IS NOT NULL");
                e.HasIndex(u => u.CorporateEmail).IsUnique().HasFilter("[CorporateEmail] IS NOT NULL");
            });

            builder.Entity<Role>(e =>
            {
                e.Property(r => r.Description).HasMaxLength(500);
                e.HasData(
                    SeedRole(AppRoles.RequesterId, AppRoles.Requester, "Any staff member. Raises tickets, follows them, and confirms or reopens resolutions."),
                    SeedRole(AppRoles.CaseWorkerId, AppRoles.CaseWorker, "Works the tickets assigned to them in their unit."),
                    SeedRole(AppRoles.HeadOfUnitId, AppRoles.HeadOfUnit, "Runs one unit: assignment, reassignment, unit reports and level 1 escalations."),
                    SeedRole(AppRoles.HODId, AppRoles.HOD, "Oversees the department and receives level 2 escalations. Does not resolve tickets."),
                    SeedRole(AppRoles.SuperAdminId, AppRoles.SuperAdmin, "Full control of the system: configuration, users, roles and every unit."));
            });

            builder.Entity<UserRoleAssignment>(e =>
            {
                e.ToTable("UserRoleAssignments");
                e.HasKey(a => a.Id);
                e.HasOne(a => a.User).WithMany(u => u.RoleAssignments).HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(a => a.Role).WithMany().HasForeignKey(a => a.RoleId).OnDelete(DeleteBehavior.Restrict);
                // Several roles per person, but each role only once while active (People Hub allowed one active role in total).
                e.HasIndex(a => new { a.UserId, a.RoleId })
                    .IsUnique()
                    .HasFilter("[IsActive] = 1")
                    .HasDatabaseName("IX_UserRoleAssignments_UserId_RoleId_Active");
            });

            builder.Entity<RefreshTokenStore>(e =>
            {
                e.ToTable("RefreshTokenStores");
                e.HasKey(t => t.Id);
                e.Property(t => t.TokenHash).HasMaxLength(128).IsRequired();
                e.Property(t => t.IssuedFromIpAddress).HasMaxLength(64);
                e.Property(t => t.IssuedFromUserAgent).HasMaxLength(512);
                e.HasIndex(t => t.TokenHash).IsUnique();
                e.HasIndex(t => new { t.UserId, t.IsRevoked });
                e.HasOne(t => t.User).WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);
            });
        }

        private static Role SeedRole(Guid id, string name, string description) => new()
        {
            Id = id,
            Name = name,
            NormalizedName = name.ToUpperInvariant(),
            ConcurrencyStamp = id.ToString(),
            Description = description,
            CreatedAt = SeedDate
        };
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Persistence\AppDbContextDesignFactory.cs'] = @'
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace ServiceDeskAPI.Infrastructure.Persistence
{
    /// <summary>
    /// Used only by "dotnet ef" when creating migrations, so it never needs the JWT key or AD settings.
    /// The API itself reads ConnectionStrings:DefaultConnection.
    /// </summary>
    public class AppDbContextDesignFactory : IDesignTimeDbContextFactory<AppDbContext>
    {
        public AppDbContext CreateDbContext(string[] args) =>
            new(new DbContextOptionsBuilder<AppDbContext>()
                .UseSqlServer("Server=(localdb)\\MSSQLLocalDB;Database=ServiceDeskDB;Trusted_Connection=True;TrustServerCertificate=True")
                .Options);
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Services\TestAccountSeeder.cs'] = @'
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Development-only test accounts that work next to Active Directory (copied from People Hub). Active only when the environment is
    /// Development, TestAccounts:Enabled is true and TestAccounts:Password is set (user secrets, via set-secrets.ps1).
    /// Creates local accounts with a local password and the listed roles. Safe to run on every start. Never touches an account it did not create.
    /// </summary>
    public class TestAccountSeeder : IHostedService
    {
        public sealed record TestAccountSpec(string UserName, string FullName, string Department, string[] Roles);

        public static readonly IReadOnlyList<TestAccountSpec> Accounts = new List<TestAccountSpec>
        {
            new("test.requester", "Test Requester", "Finance", new[] { AppRoles.Requester }),
            new("test.caseworker1", "Test Case Worker One", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.CaseWorker }),
            new("test.caseworker2", "Test Case Worker Two", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.CaseWorker }),
            new("test.hou", "Test Head of Unit", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.HeadOfUnit }),
            new("test.hod", "Test Head of Department", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.HOD }),
            new("test.superadmin", "Test Super Admin", "Information Technology", new[] { AppRoles.Requester, AppRoles.SuperAdmin })
        };

        private static readonly Regex NameRule = new(@"^test\.[a-z0-9._-]+$", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>True for names shaped like test.something.</summary>
        public static bool IsTestUserName(string? userName) => !string.IsNullOrWhiteSpace(userName) && NameRule.IsMatch(userName.Trim());

        /// <summary>The master switch: Development environment AND TestAccounts:Enabled = true.</summary>
        public static bool IsEnabled(IConfiguration configuration, string? environmentName) =>
            string.Equals(environmentName, "Development", StringComparison.OrdinalIgnoreCase)
            && string.Equals(configuration["TestAccounts:Enabled"], "true", StringComparison.OrdinalIgnoreCase);

        private readonly IServiceProvider _services;
        private readonly IConfiguration _configuration;
        private readonly IHostEnvironment _environment;
        private readonly ILogger<TestAccountSeeder> _logger;

        public TestAccountSeeder(IServiceProvider services, IConfiguration configuration, IHostEnvironment environment, ILogger<TestAccountSeeder> logger)
        {
            _services = services;
            _configuration = configuration;
            _environment = environment;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            if (!IsEnabled(_configuration, _environment.EnvironmentName))
                return Task.CompletedTask;

            var password = _configuration["TestAccounts:Password"];
            if (string.IsNullOrWhiteSpace(password))
            {
                _logger.LogWarning("Test accounts are enabled but TestAccounts:Password is not set, so none were created. Run set-secrets.ps1.");
                return Task.CompletedTask;
            }

            // In the background so a slow or still-migrating database never blocks start-up
            _ = Task.Run(() => SeedWithRetriesAsync(password, cancellationToken));
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        private async Task SeedWithRetriesAsync(string password, CancellationToken cancellationToken)
        {
            for (var attempt = 1; attempt <= 6; attempt++)
            {
                try
                {
                    await SeedAsync(_services, password, _logger);
                    return;
                }
                catch (Exception ex) when (!cancellationToken.IsCancellationRequested)
                {
                    _logger.LogWarning(ex, "Test account seeding attempt {Attempt} failed. Trying again shortly.", attempt);
                    try { await Task.Delay(TimeSpan.FromSeconds(5), cancellationToken); } catch (OperationCanceledException) { return; }
                }
            }
            _logger.LogError("Test accounts could not be created after several attempts.");
        }

        /// <summary>Creates or refreshes the test accounts. Public so tests can run it directly.</summary>
        public static async Task SeedAsync(IServiceProvider services, string password, ILogger logger)
        {
            using var scope = services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var created = 0;

            foreach (var spec in Accounts)
            {
                var user = await users.FindByNameAsync(spec.UserName);
                if (user == null)
                {
                    user = new User
                    {
                        Id = Guid.NewGuid(),
                        UserName = spec.UserName,
                        Email = spec.UserName + "@test.invalid",
                        CorporateEmail = spec.UserName + "@test.invalid",
                        FullName = spec.FullName,
                        Department = spec.Department,
                        IsActive = true,
                        EmailConfirmed = true,
                        CreatedAt = DateTime.UtcNow
                    };
                    var result = await users.CreateAsync(user, password);
                    if (!result.Succeeded)
                    {
                        logger.LogWarning("Could not create {UserName}: {Errors}", spec.UserName, string.Join("; ", result.Errors.Select(e => e.Description)));
                        continue;
                    }
                    created++;
                }
                else if (string.IsNullOrEmpty(user.PasswordHash))
                {
                    // Same name but no local password: not one of ours (for example an AD-linked account). Leave it alone.
                    logger.LogWarning("{UserName} already exists without a local password, so it was not touched.", spec.UserName);
                    continue;
                }
                else if (!await users.CheckPasswordAsync(user, password))
                {
                    user.PasswordHash = users.PasswordHasher.HashPassword(user, password);
                    await users.UpdateAsync(user);
                }

                foreach (var role in spec.Roles)
                    await RoleAssignments.EnsureRoleAsync(db, user.Id, role, null);
            }

            logger.LogInformation("Test accounts ready ({Created} created): {Names}.", created, string.Join(", ", Accounts.Select(a => a.UserName)));
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Auth\AuthApiTests.cs'] = @'
using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Auth
{
    /// <summary>Step 1a: sign-in, tokens, cookies, refresh and logout through the real API.</summary>
    public class AuthApiTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AuthApiTests(ServiceDeskApiFactory factory) => _factory = factory;

        private HttpClient Client() => _factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        private async Task<(HttpResponseMessage Response, JsonElement Body)> LoginAsync(string userName, string password)
        {
            var response = await Client().PostAsJsonAsync("/api/auth/login", new { username = userName, password });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return (response, body);
        }

        private static List<string> Roles(JsonElement user) =>
            user.GetProperty("roles").EnumerateArray().Select(r => r.GetString()!).ToList();

        [Fact]
        public async Task A_test_account_signs_in_with_every_role_it_holds()
        {
            var (response, body) = await LoginAsync("test.caseworker1", ServiceDeskApiFactory.TestPassword);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var data = body.GetProperty("data");
            Assert.False(string.IsNullOrEmpty(data.GetProperty("accessToken").GetString()));
            Assert.False(string.IsNullOrEmpty(data.GetProperty("refreshToken").GetString()));
            var roles = Roles(data.GetProperty("user"));
            Assert.Contains(AppRoles.Requester, roles);
            Assert.Contains(AppRoles.CaseWorker, roles);
        }

        [Fact]
        public async Task Sign_in_sets_HttpOnly_cookies_with_Service_Desk_names_only()
        {
            var (response, _) = await LoginAsync("test.requester", ServiceDeskApiFactory.TestPassword);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var cookies = response.Headers.GetValues("Set-Cookie").ToList();
            Assert.Contains(cookies, c => c.StartsWith(AuthCookies.AccessHttp + "=") && c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
            Assert.Contains(cookies, c => c.StartsWith(AuthCookies.RefreshHttp + "=") && c.Contains("httponly", StringComparison.OrdinalIgnoreCase));
            // People Hub's cookie names must never be written, or the two apps would sign each other out on the same host.
            Assert.DoesNotContain(cookies, c => c.StartsWith("__Secure-accessToken=") || c.StartsWith("__Host-accessToken="));
        }

        [Fact]
        public async Task The_token_is_issued_by_the_Service_Desk()
        {
            var (_, body) = await LoginAsync("test.hou", ServiceDeskApiFactory.TestPassword);
            var jwt = new JwtSecurityTokenHandler().ReadJwtToken(body.GetProperty("data").GetProperty("accessToken").GetString());

            Assert.Equal(ServiceDeskApiFactory.Issuer, jwt.Issuer);
            Assert.Contains(ServiceDeskApiFactory.Audience, jwt.Audiences);
            var roleClaims = jwt.Claims.Where(c => c.Type == "role" || c.Type == ClaimTypes.Role).Select(c => c.Value).ToList();
            Assert.Contains(AppRoles.HeadOfUnit, roleClaims);
            Assert.Contains(AppRoles.Requester, roleClaims);
        }

        [Fact]
        public async Task A_wrong_password_is_refused()
        {
            var (response, _) = await LoginAsync("test.requester", "Wrong-Password#1");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task An_AD_user_is_refused_cleanly_when_AD_is_not_configured()
        {
            var (response, _) = await LoginAsync("someone.from.ad", "Any-Password#1");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task Me_returns_the_profile_and_roles()
        {
            var (_, body) = await LoginAsync("test.hod", ServiceDeskApiFactory.TestPassword);
            var client = Client();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", body.GetProperty("data").GetProperty("accessToken").GetString());

            var response = await client.GetAsync("/api/auth/me");

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var me = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            Assert.Equal("test.hod", me.GetProperty("username").GetString());
            Assert.Equal(new[] { AppRoles.HOD, AppRoles.Requester }, Roles(me));
        }

        [Fact]
        public async Task Me_without_a_token_is_401()
        {
            var response = await Client().GetAsync("/api/auth/me");
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task A_token_signed_with_any_other_key_is_refused()
        {
            // For example a People Hub token: same claim layout, different key.
            var otherKey = new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(64));
            var handler = new JwtSecurityTokenHandler();
            var forged = handler.WriteToken(handler.CreateToken(new SecurityTokenDescriptor
            {
                Subject = new ClaimsIdentity(new[] { new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, AppRoles.SuperAdmin) }),
                Expires = DateTime.UtcNow.AddMinutes(5),
                Issuer = ServiceDeskApiFactory.Issuer,
                Audience = ServiceDeskApiFactory.Audience,
                SigningCredentials = new SigningCredentials(otherKey, SecurityAlgorithms.HmacSha256Signature)
            }));
            var client = Client();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", forged);

            var response = await client.GetAsync("/api/auth/me");

            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        [Fact]
        public async Task Refresh_rotates_the_token_and_the_old_one_stops_working()
        {
            var (_, body) = await LoginAsync("test.caseworker2", ServiceDeskApiFactory.TestPassword);
            var first = body.GetProperty("data").GetProperty("refreshToken").GetString();

            var refreshed = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken = first });
            Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
            var second = (await refreshed.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data").GetProperty("refreshToken").GetString();
            Assert.NotEqual(first, second);

            var reused = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken = first });
            Assert.Equal(HttpStatusCode.Unauthorized, reused.StatusCode);

            var again = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken = second });
            Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        }

        [Fact]
        public async Task Logout_revokes_the_refresh_token()
        {
            var (_, body) = await LoginAsync("test.superadmin", ServiceDeskApiFactory.TestPassword);
            var refreshToken = body.GetProperty("data").GetProperty("refreshToken").GetString();

            var logout = await Client().PostAsJsonAsync("/api/auth/logout", new { refreshToken });
            Assert.Equal(HttpStatusCode.OK, logout.StatusCode);

            var refresh = await Client().PostAsJsonAsync("/api/auth/refresh", new { refreshToken });
            Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
        }

        [Fact]
        public async Task An_inactive_account_cannot_sign_in()
        {
            const string name = "test.inactive";
            using (var scope = _factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Inactive Tester", IsActive = false, EmailConfirmed = true };
                var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
                await RoleAssignments.EnsureRoleAsync(db, user.Id, AppRoles.Requester, null);
            }

            var (response, _) = await LoginAsync(name, ServiceDeskApiFactory.TestPassword);

            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Auth\PolicyTests.cs'] = @'
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Infrastructure;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using Xunit;

namespace ServiceDeskAPI.Tests.Auth
{
    /// <summary>Step 1a: the role policies match BRD Section 4.</summary>
    public class PolicyTests
    {
        private static string[] AllowedRoles(string policyName)
        {
            var options = new AuthorizationOptions();
            Policies.Register(options);
            var policy = options.GetPolicy(policyName);
            Assert.NotNull(policy);
            return Assert.Single(policy!.Requirements.OfType<RolesAuthorizationRequirement>()).AllowedRoles.OrderBy(r => r).ToArray();
        }

        [Fact]
        public void Super_Admin_Only_is_SuperAdmin_alone() =>
            Assert.Equal(new[] { AppRoles.SuperAdmin }, AllowedRoles(Policies.SuperAdminOnly));

        [Fact]
        public void SuperAdmin_passes_every_policy()
        {
            foreach (var name in Policies.Roles.Keys)
                Assert.Contains(AppRoles.SuperAdmin, AllowedRoles(name));
        }

        [Fact]
        public void HOD_oversees_but_does_not_work_tickets()
        {
            Assert.Contains(AppRoles.HOD, AllowedRoles(Policies.Oversight));
            Assert.DoesNotContain(AppRoles.HOD, AllowedRoles(Policies.CaseWork));
        }

        [Fact]
        public void A_Requester_alone_passes_no_named_policy()
        {
            foreach (var name in Policies.Roles.Keys)
                Assert.DoesNotContain(AppRoles.Requester, AllowedRoles(name));
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Infrastructure\DatabaseFixture.cs'] = @'
using Xunit;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>One migrated database per test class. Tests use unique ids, so they do not interfere.</summary>
    public sealed class DatabaseFixture : IAsyncLifetime
    {
        public TestDatabase Db { get; private set; } = null!;

        public async Task InitializeAsync() => Db = await TestDatabase.CreateAsync();

        public async Task DisposeAsync() => await Db.DisposeAsync();
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Infrastructure\ServiceDeskApiFactory.cs'] = @'
using System.Security.Cryptography;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Services;
using Xunit;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>
    /// The whole API on a throwaway LocalDB database (like People Hub's LocalDbWebApplicationFactory).
    /// Uses a random signing key made for this run, no AD (LdapSettings blanked), and the Development test accounts.
    /// No real key or password is used, from the Service Desk or anywhere else.
    /// </summary>
    public class ServiceDeskApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
    {
        public const string TestPassword = "Sd-Test-Only#2026";
        public const string Issuer = "ServiceDeskAPI";
        public const string Audience = "ServiceDeskWeb";

        public string SigningKey { get; } = Convert.ToBase64String(RandomNumberGenerator.GetBytes(64));

        private readonly string _databaseName = $"ServiceDesk_ApiTest_{Guid.NewGuid():N}";

        public string ConnectionString =>
            $"Server=(localdb)\\mssqllocaldb;Database={_databaseName};Integrated Security=true;TrustServerCertificate=true";

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:DefaultConnection"] = ConnectionString,
                ["JwtSettings:SecretKey"] = SigningKey,
                ["JwtSettings:Issuer"] = Issuer,
                ["JwtSettings:Audience"] = Audience,
                ["LdapSettings:Server"] = "",
                ["LdapSettings:ServiceAccountUsername"] = "",
                ["LdapSettings:ServiceAccountPassword"] = "",
                ["TestAccounts:Enabled"] = "true",
                ["TestAccounts:Password"] = TestPassword
            }));
            builder.ConfigureServices(services =>
            {
                // The tests seed the accounts themselves (below), so the background seeder is not needed.
                foreach (var d in services.Where(d => !d.IsKeyedService && d.ImplementationType == typeof(TestAccountSeeder)).ToList())
                    services.Remove(d);
            });
        }

        public async Task InitializeAsync()
        {
            _ = Services; // starts the API, which applies the migrations to the test database
            await TestAccountSeeder.SeedAsync(Services, TestPassword, NullLogger.Instance);
        }

        async Task IAsyncLifetime.DisposeAsync()
        {
            await base.DisposeAsync();
            SqlConnection.ClearAllPools();
            await using var ctx = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString).Options);
            try { await ctx.Database.EnsureDeletedAsync(); } catch { /* best effort */ }
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Infrastructure\TestDatabase.cs'] = @'
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>
    /// A throwaway LocalDB database built from the real EF migrations (copied from People Hub). MigrateAsync throws if the
    /// model has drifted from the migrations, so tests that use this also guard against drift.
    /// Rows are inserted with plain SQL so tests check the database rules themselves, not only the C# code.
    /// </summary>
    public sealed class TestDatabase : IAsyncDisposable
    {
        private readonly string _name = $"ServiceDesk_Test_{Guid.NewGuid():N}";

        public string ConnectionString =>
            $"Server=(localdb)\\mssqllocaldb;Database={_name};Integrated Security=true;TrustServerCertificate=true";

        public static async Task<TestDatabase> CreateAsync()
        {
            var db = new TestDatabase();
            await using var ctx = db.CreateContext();
            await ctx.Database.MigrateAsync();
            return db;
        }

        public AppDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString).Options);

        public async Task<Guid> AddUserAsync(string userName)
        {
            var id = Guid.NewGuid();
            var normalized = userName.ToUpperInvariant();
            var stamp1 = Guid.NewGuid().ToString();
            var stamp2 = Guid.NewGuid().ToString();
            await using var ctx = CreateContext();
            await ctx.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO Users (Id, UserName, NormalizedUserName, FullName, IsActive, CreatedAt, EmailConfirmed, PhoneNumberConfirmed,
                   TwoFactorEnabled, LockoutEnabled, AccessFailedCount, SecurityStamp, ConcurrencyStamp)
VALUES ({id}, {userName}, {normalized}, {userName}, 1, {DateTime.UtcNow}, 1, 0, 0, 0, 0, {stamp1}, {stamp2})");
            return id;
        }

        public async Task AddRoleAssignmentAsync(Guid userId, string roleName, bool active)
        {
            var normalizedRole = roleName.ToUpperInvariant();
            var assignmentId = Guid.NewGuid();
            await using var ctx = CreateContext();
            await ctx.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO UserRoleAssignments (Id, UserId, RoleId, IsActive, AssignedAt)
SELECT {assignmentId}, {userId}, Id, {active}, {DateTime.UtcNow} FROM Roles WHERE NormalizedName = {normalizedRole}");
        }

        public async Task<Guid> AddUserWithRolesAsync(string userName, params string[] roleNames)
        {
            var userId = await AddUserAsync(userName);
            foreach (var role in roleNames)
                await AddRoleAssignmentAsync(userId, role, active: true);
            return userId;
        }

        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await using var ctx = CreateContext();
            try { await ctx.Database.EnsureDeletedAsync(); } catch { /* best effort */ }
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Persistence\IdentitySchemaTests.cs'] = @'
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Persistence
{
    /// <summary>Step 1a: users and roles (BRD Section 4). Runs on a real migrated LocalDB database.</summary>
    public class IdentitySchemaTests : IClassFixture<DatabaseFixture>
    {
        private readonly TestDatabase _db;

        public IdentitySchemaTests(DatabaseFixture fixture) => _db = fixture.Db;

        private static string NewName(string prefix) => prefix + "." + Guid.NewGuid().ToString("N").Substring(0, 8);

        [Fact]
        public async Task The_five_BRD_roles_are_seeded()
        {
            await using var ctx = _db.CreateContext();
            var names = await ctx.Roles.Select(r => r.Name!).OrderBy(n => n).ToListAsync();
            Assert.Equal(AppRoles.All.OrderBy(n => n).ToList(), names);
        }

        [Fact]
        public async Task A_person_can_hold_several_active_roles()
        {
            var id = await _db.AddUserWithRolesAsync(NewName("multi"), AppRoles.Requester, AppRoles.CaseWorker, AppRoles.HeadOfUnit);
            await using var ctx = _db.CreateContext();
            var roles = await RoleAssignments.GetActiveRoleNamesAsync(ctx, id);
            Assert.Equal(new[] { AppRoles.CaseWorker, AppRoles.HeadOfUnit, AppRoles.Requester }, roles);
        }

        [Fact]
        public async Task The_same_role_cannot_be_active_twice_but_history_is_kept()
        {
            var id = await _db.AddUserWithRolesAsync(NewName("dup"), AppRoles.CaseWorker);
            await Assert.ThrowsAnyAsync<Exception>(() => _db.AddRoleAssignmentAsync(id, AppRoles.CaseWorker, active: true));
            await _db.AddRoleAssignmentAsync(id, AppRoles.CaseWorker, active: false); // a past, disabled assignment is allowed
            await using var ctx = _db.CreateContext();
            Assert.Equal(2, await ctx.UserRoleAssignments.CountAsync(a => a.UserId == id));
        }

        [Fact]
        public async Task First_sign_in_gives_Requester_once()
        {
            var id = await _db.AddUserAsync(NewName("first"));
            await using var ctx = _db.CreateContext();
            Assert.True(await RoleAssignments.EnsureDefaultRoleAsync(ctx, id));
            Assert.False(await RoleAssignments.EnsureDefaultRoleAsync(ctx, id));
            Assert.Equal(new[] { AppRoles.Requester }, await RoleAssignments.GetActiveRoleNamesAsync(ctx, id));
            Assert.Equal(1, await ctx.UserRoles.CountAsync(r => r.UserId == id)); // Identity table kept in step
        }

        [Fact]
        public async Task A_person_who_already_has_a_role_does_not_get_Requester_added()
        {
            var id = await _db.AddUserWithRolesAsync(NewName("hod"), AppRoles.HOD);
            await using var ctx = _db.CreateContext();
            Assert.False(await RoleAssignments.EnsureDefaultRoleAsync(ctx, id));
            Assert.Equal(new[] { AppRoles.HOD }, await RoleAssignments.GetActiveRoleNamesAsync(ctx, id));
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\LdapAuthService.cs'] = $ldapText

# ---------------- backups (for the automatic undo) ----------------
$backup = @{}
foreach ($rel in $files.Keys) {
    $full = Join-Path $root $rel
    $backup[$full] = if (Test-Path $full) { [System.IO.File]::ReadAllText($full) } else { $null }
}
$backup[$projPath] = $projOld
$migrationsDir = Join-Path $api 'Infrastructure\Persistence\Migrations'
$migrationsExisted = Test-Path $migrationsDir
# The tool manifest lives in .config\dotnet-tools.json (SDK 8/9) or dotnet-tools.json in the folder itself (SDK 10)
$manifestPaths = @((Join-Path $root '.config\dotnet-tools.json'), (Join-Path $root 'dotnet-tools.json'))
$manifestOld = @{}
foreach ($mp in $manifestPaths) { $manifestOld[$mp] = if (Test-Path $mp) { [System.IO.File]::ReadAllText($mp) } else { $null } }
function Find-Manifest { foreach ($mp in $manifestPaths) { if (Test-Path $mp) { return $mp } }; return $null }

function Restore-All {
    foreach ($full in $backup.Keys) {
        if ($null -eq $backup[$full]) { if (Test-Path $full) { Remove-Item $full -Force } }
        else { [System.IO.File]::WriteAllText($full, $backup[$full], $utf8) }
    }
    if (-not $migrationsExisted -and (Test-Path $migrationsDir)) { Remove-Item $migrationsDir -Recurse -Force }
    foreach ($mp in $manifestPaths) {
        if ($null -eq $manifestOld[$mp]) { if (Test-Path $mp) { Remove-Item $mp -Force } }
        else { [System.IO.File]::WriteAllText($mp, $manifestOld[$mp], $utf8) }
    }
}

Push-Location $root
try {
    Write-Host ("1/7 Writing {0} source, settings and test files..." -f ($files.Count - 1))
    foreach ($rel in $files.Keys) {
        if ($rel -like '*LdapAuthService.cs') { continue }
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }

    Write-Host '2/7 Copying LdapAuthService.cs from People Hub (code only, namespace renamed)...'
    [System.IO.File]::WriteAllText((Join-Path $root 'ServiceDeskAPI\Infrastructure\Identity\LdapAuthService.cs'), $ldapText, $utf8)

    Write-Host '3/7 Giving the API its own user-secrets id...'
    $elmSecretsId = $null
    if (Test-Path $elmProj) { $m = [regex]::Match([System.IO.File]::ReadAllText($elmProj), '<UserSecretsId>(.*?)</UserSecretsId>'); if ($m.Success) { $elmSecretsId = $m.Groups[1].Value.Trim() } }
    $projNow = [System.IO.File]::ReadAllText($projPath)
    $m = [regex]::Match($projNow, '<UserSecretsId>(.*?)</UserSecretsId>')
    $newId = 'servicedesk-' + [guid]::NewGuid().ToString()
    if (-not $m.Success) {
        $idx = $projNow.IndexOf('</PropertyGroup>')
        $projNow = $projNow.Insert($idx, "  <UserSecretsId>$newId</UserSecretsId>`r`n  ")
        [System.IO.File]::WriteAllText($projPath, $projNow, $utf8)
        Write-Host "  UserSecretsId: $newId"
    }
    elseif ($elmSecretsId -and $m.Groups[1].Value.Trim() -eq $elmSecretsId) {
        $projNow = $projNow.Replace($m.Value, "<UserSecretsId>$newId</UserSecretsId>")
        [System.IO.File]::WriteAllText($projPath, $projNow, $utf8)
        Write-Host "  The project had People Hub's user-secrets id; replaced with $newId" -ForegroundColor Yellow
    }
    else { Write-Host ('  Kept existing UserSecretsId ' + $m.Groups[1].Value) }

    Write-Host '4/7 Setting up the EF Core tool for this solution (local tool, nothing global changes)...'
    $efVersion = ([regex]::Match($projOld, 'Include="Microsoft\.EntityFrameworkCore\.SqlServer"\s+Version="([^"]+)"')).Groups[1].Value
    if (-not $efVersion) { throw 'Could not read the Microsoft.EntityFrameworkCore.SqlServer version from ServiceDeskAPI.csproj.' }
    $manifest = Find-Manifest
    if (-not $manifest) {
        $o = Invoke-Dotnet @('new', 'tool-manifest')
        if ($script:lastExit -ne 0) { $o | Select-Object -Last 10; throw 'dotnet new tool-manifest failed.' }
        $manifest = Find-Manifest
        if (-not $manifest) { $o | Select-Object -Last 10; throw 'dotnet new tool-manifest ran but no dotnet-tools.json was found.' }
    }
    if ([System.IO.File]::ReadAllText($manifest) -notmatch '"dotnet-ef"') {
        $o = Invoke-Dotnet @('tool', 'install', 'dotnet-ef', '--version', $efVersion)
        if ($script:lastExit -ne 0) { $o | Select-Object -Last 10; throw 'dotnet tool install dotnet-ef failed.' }
    }
    $o = Invoke-Dotnet @('tool', 'restore')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 10; throw 'dotnet tool restore failed.' }
    Write-Host "  dotnet-ef $efVersion"

    Write-Host '5/7 Building...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }

    Write-Host '6/7 Creating the InitialIdentity migration...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'InitialIdentity', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

    Write-Host '7/7 Building and running all tests (LocalDB; takes a minute)...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed after adding the migration.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) {
        $t | Where-Object { $_ -match 'Error Message|Assert|Exception' } | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
        throw 'Tests failed.'
    }

    Write-Host ''
    Write-Host 'Done. Step 1a is in place.' -ForegroundColor Green
    Write-Host 'Next:'
    Write-Host '  1. .\set-secrets.ps1   (own JWT key and test password; asks for the Service Desk AD settings, or use -SkipLdap)'
    Write-Host '  2. Start the API once: it creates ServiceDeskDB and the tables.'
    Write-Host '  3. In Swagger, POST /api/auth/login as test.caseworker1 with the test password, then GET /api/auth/me.'
}
catch {
    Write-Host ''
    Write-Host ('FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    Pop-Location
    Push-Location $root
    Restore-All
    Write-Host 'Every file was put back as it was. Send me the lines above.' -ForegroundColor Yellow
    Pop-Location
    exit 1
}
Pop-Location
