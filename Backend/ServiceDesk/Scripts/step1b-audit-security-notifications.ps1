# Step 1b - Audit log, security middleware (security headers, rate limiting, CSRF), in-app notifications with live SignalR push.
# Ported from People Hub (ELM). Code only: no People Hub password, key or secret is read or used.
#
# What it adds:
#   - AuditLogs (append-only: updates and deletes are refused); every sign-in, failed sign-in and sign-out is audited
#   - InAppNotifications + GET/PATCH api/notifications; SignalR hub at /hubs/notifications pushes each saved notification live
#   - Security headers on every response; rate limits on login (10/min per IP) and refresh (30/min)
#   - CSRF protection for cookie sign-in: the web app sends X-CSRF-Token (from login/refresh or GET api/auth/csrf)
#   - Migration AuditAndNotifications, and tests
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk with the API stopped:
#   .\Scripts\step1b-audit-security-notifications.ps1
# On any failure, every file is put back as it was.

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
$testProj = Join-Path $root 'tests\ServiceDeskAPI.Tests\ServiceDeskAPI.Tests.csproj'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
$migrationsDir = Join-Path $api 'Infrastructure\Persistence\Migrations'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Invoke-Dotnet([string[]]$a) {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = & dotnet @a 2>&1 | ForEach-Object { "$_" }
    $script:lastExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    return $out
}
function Get-NormHash([string]$path) {
    $t = [System.IO.File]::ReadAllText($path).Replace("`r`n", "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($t)))).Replace('-', '').ToLowerInvariant()
}

# ---------------- anchor checks (nothing is changed until all pass) ----------------
if (-not (Test-Path (Join-Path $api 'Infrastructure\Persistence\AppDbContext.cs'))) { Write-Host 'Step 1a is not in place (no AppDbContext.cs). Run step1a-identity-auth.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Domain\Entities\AuditLog.cs')) { Write-Host 'AuditLog.cs already exists: Step 1b looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as Step 1a wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Program.cs' = 'ef69ca04a376b6140b127be3617669a4d5ae5dd873921fb188bc9e3e8debec40'
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = 'a60739c97f1a4ff463764a166adf70a68e53a010e7c7d6004a1e2e1794568007'
    'ServiceDeskAPI\Infrastructure\Identity\AuthService.cs' = '109cf141b034060dcfadadfd92ab140c1484f21c61a418ea9b0e064c8f0d58bf'
    'ServiceDeskAPI\Controllers\AuthController.cs' = 'b827255f5a03adad57ccabc2e6344dd6599d32ecdc839006e160907f9ed87710'
    'ServiceDeskAPI\Application\DTOs\AuthDTOs.cs' = '1c5dfde9af237cf320c9afea73b92df71d0d31946157bc94a8f1206ae43af9ed'
    'ServiceDeskAPI\Infrastructure\Identity\AuthCookies.cs' = 'bdda6d5b0d664002269c2e20b32a4a7df051cc5be7e442632deb51f33bec1d06'
    'tests\ServiceDeskAPI.Tests\Infrastructure\ServiceDeskApiFactory.cs' = 'c71af088a7c7228e41ff2beaaa4086d7dbc5063709f135db38c67cfd9e1cfe3c'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed after Step 1a, so Step 1b stopped to avoid overwriting your changes:' -ForegroundColor Red
    $changedByYou | ForEach-Object { Write-Host "    $_" }
    Write-Host 'Send me those files.'
    return
}
$testProjOld = [System.IO.File]::ReadAllText($testProj)
$mvcTesting = [regex]::Match($testProjOld, 'Include="Microsoft\.AspNetCore\.Mvc\.Testing"\s+Version="([^"]+)"')
if (-not $mvcTesting.Success) { Write-Host 'Could not read the Microsoft.AspNetCore.Mvc.Testing version from the test project. Send me ServiceDeskAPI.Tests.csproj.' -ForegroundColor Red; return }
$aspnetVersion = $mvcTesting.Groups[1].Value

$files = [ordered]@{}
$files['ServiceDeskAPI\Program.cs'] = @'
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Hubs;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Middleware;
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
            // NotificationPushInterceptor sends saved notifications to the browser over SignalR
            builder.Services.AddSingleton<NotificationPushInterceptor>();
            builder.Services.AddDbContext<AppDbContext>((services, options) =>
                options.UseSqlServer(services.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection"))
                    .AddInterceptors(services.GetRequiredService<NotificationPushInterceptor>()));

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
                        .WithExposedHeaders("Content-Disposition", CsrfProtectionMiddleware.HeaderName)
                        .AllowCredentials();
                });
            });

            // ============ SERVICES ============
            builder.Services.AddScoped<ILdapAuthService>(LdapSetup.Create);
            builder.Services.AddScoped<IAuthService, AuthService>();
            builder.Services.AddScoped<IAuditService, AuditService>();
            builder.Services.AddScoped<IInAppNotificationService, InAppNotificationService>();

            // ============ SIGNALR (live notifications) ============
            builder.Services.AddSignalR();
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

            // ============ SECURITY MIDDLEWARE (People Hub order, plus CSRF) ============
            app.UseSecurityHeaders();
            app.UseRateLimiting();
            app.UseAuthentication();
            app.UseCsrfProtection();
            app.UseAuthorization();
            app.MapControllers();
            app.MapHub<NotificationHub>("/hubs/notifications").RequireAuthorization();

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
        /// <summary>Send this in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE (cookie sign-in). Also in the X-CSRF-Token response header.</summary>
        public string CsrfToken { get; set; } = string.Empty;
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
$files['ServiceDeskAPI\Application\DTOs\NotificationDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One notification, as listed by GET /api/notifications and pushed over SignalR (ReceiveNotification).</summary>
    public class InAppNotificationDto
    {
        public Guid Id { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public NotificationType Type { get; set; }
        public NotificationCategory Category { get; set; }
        public string? RelatedEntityType { get; set; }
        public Guid? RelatedEntityId { get; set; }
        public string? DeepLinkUrl { get; set; }
        public bool IsRead { get; set; }
        public DateTime? ReadAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public bool IsActionRequired => Type == NotificationType.ActionRequired;
    }

    public class InAppNotificationListDto
    {
        public List<InAppNotificationDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Unread { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IAuditService.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Audit logging (same contract as People Hub). The audit log is append-only.</summary>
    public interface IAuditService
    {
        /// <summary>
        /// Writes one entry straight away, in its own save, so it never saves other pending changes of the caller.
        /// Never throws: a failed audit write is logged as an error and the main operation goes on.
        /// </summary>
        Task LogAsync(
            Guid? userId,
            string? userDisplayName,
            AuditAction action,
            string entityType,
            Guid entityId,
            string? entityDisplayName,
            string? oldValues,
            string? newValues,
            string? ipAddress,
            string? userAgent,
            AuditModule module);

        /// <summary>
        /// Adds an entry to the current unit of work WITHOUT saving it. The caller's SaveChangesAsync saves the change
        /// and its audit entry together: if either fails, neither is saved. Use this for every business change.
        /// </summary>
        void Stage(
            Guid? userId,
            string? userDisplayName,
            AuditAction action,
            string entityType,
            Guid entityId,
            string? entityDisplayName,
            string? oldValues,
            string? newValues,
            string? ipAddress,
            string? userAgent,
            AuditModule module);
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IInAppNotificationService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The notification bell: writing notifications and reading a person's own (copied from People Hub).</summary>
    public interface IInAppNotificationService
    {
        /// <summary>
        /// Adds a notification to the current unit of work without saving it. When the caller saves, it is stored
        /// and then pushed live to the recipient (NotificationPushInterceptor).
        /// </summary>
        void Stage(Guid recipientUserId, string title, string message, NotificationType type, NotificationCategory category,
            string? relatedEntityType, Guid? relatedEntityId, string? deepLinkUrl);

        /// <summary>The people who currently hold one of these roles (active assignments, active accounts).</summary>
        Task<List<Guid>> UsersWithRolesAsync(params string[] roles);

        Task<InAppNotificationListDto> ListAsync(Guid userId, int page, int pageSize, bool unreadOnly);
        Task<int> UnreadCountAsync(Guid userId);

        /// <summary>Marks one of the person's own notifications read. False when it is not theirs or does not exist.</summary>
        Task<bool> MarkReadAsync(Guid userId, Guid notificationId);
        Task<int> MarkAllReadAsync(Guid userId);
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
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Middleware;

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
        private readonly IAuditService _audit;

        public AuthController(IAuthService authService, ILogger<AuthController> logger, IOptions<JwtSettings> jwt, IHostEnvironment environment, IAuditService audit)
        {
            _authService = authService;
            _logger = logger;
            _jwt = jwt.Value;
            _environment = environment;
            _audit = audit;
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
        /// A fresh CSRF token for a signed-in browser, for example after a page reload. Sets the CSRF cookie and returns the value.
        /// </summary>
        [HttpGet("csrf")]
        [Authorize]
        public ActionResult<ApiResponse<string>> Csrf()
        {
            var token = CsrfProtectionMiddleware.Issue(HttpContext, _environment.IsDevelopment(), DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays));
            return Ok(new ApiResponse<string> { StatusCode = 200, Message = "CSRF token issued.", Data = token });
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
            var actor = AuditActor.From(HttpContext);
            if (actor.UserId is Guid userId)
                await _audit.LogAsync(userId, actor.DisplayName, AuditAction.Logout, "User", userId, User.FindFirst(ClaimTypes.Name)?.Value,
                    null, null, actor.IpAddress, actor.UserAgent, AuditModule.Authentication);
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

            // A new CSRF token with every sign-in and refresh (cookie + X-CSRF-Token header + body)
            tokens.CsrfToken = CsrfProtectionMiddleware.Issue(HttpContext, isDevelopment, DateTime.UtcNow.AddDays(_jwt.RefreshTokenExpiryDays));
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
            var current = Request.IsHttps
                ? new[] { AuthCookies.AccessHttps, AuthCookies.RefreshHttps, AuthCookies.CsrfHttps }
                : new[] { AuthCookies.AccessHttp, AuthCookies.RefreshHttp, AuthCookies.CsrfHttp };
            var all = new[] { AuthCookies.AccessHttps, AuthCookies.AccessHttp, AuthCookies.RefreshHttps, AuthCookies.RefreshHttp, AuthCookies.CsrfHttps, AuthCookies.CsrfHttp };
            foreach (var name in all)
            {
                if (current.Contains(name) || Request.Cookies.ContainsKey(name))
                    Response.Cookies.Append(name, string.Empty, expired);
            }
        }
    }
}
'@
$files['ServiceDeskAPI\Controllers\NotificationsController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>The notification bell (copied from People Hub). Every call is limited to the signed-in person's own notifications.</summary>
    [ApiController]
    [Route("api/notifications")]
    [Authorize]
    public class NotificationsController : ControllerBase
    {
        private readonly IInAppNotificationService _service;

        public NotificationsController(IInAppNotificationService service) => _service = service;

        private Guid? CurrentUser() =>
            Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        [HttpGet]
        public async Task<ActionResult<InAppNotificationListDto>> List(
            [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] bool unreadOnly = false)
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(await _service.ListAsync(userId, page, pageSize, unreadOnly));
        }

        [HttpGet("unread-count")]
        public async Task<IActionResult> UnreadCount()
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(new { count = await _service.UnreadCountAsync(userId) });
        }

        [HttpPatch("{id:guid}/read")]
        public async Task<IActionResult> MarkRead(Guid id)
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return await _service.MarkReadAsync(userId, id) ? NoContent() : NotFound();
        }

        [HttpPatch("read-all")]
        public async Task<IActionResult> MarkAllRead()
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(new { marked = await _service.MarkAllReadAsync(userId) });
        }
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\AuditLog.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// Append-only audit record (copied from People Hub). Rows are only ever inserted: AppDbContext refuses to update
    /// or delete them. Customer data (RSA PIN, employer, amounts) must never be written into OldValues/NewValues.
    /// </summary>
    public class AuditLog
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        /// <summary>Who did it; null for the system (background jobs).</summary>
        public Guid? UserId { get; set; }
        public string? UserDisplayName { get; set; }
        public AuditAction Action { get; set; }
        public string EntityType { get; set; } = string.Empty;
        public Guid EntityId { get; set; }
        public string? EntityDisplayName { get; set; }
        /// <summary>JSON of the changed fields before the change.</summary>
        public string? OldValues { get; set; }
        /// <summary>JSON of the changed fields after the change.</summary>
        public string? NewValues { get; set; }
        public string? IpAddress { get; set; }
        public string? UserAgent { get; set; }
        public DateTime Timestamp { get; set; } = DateTime.UtcNow;
        public AuditModule Module { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\InAppNotification.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A notification in a person's bell (copied from People Hub). Stored first, then pushed live over SignalR
    /// by NotificationPushInterceptor when the save succeeds.
    /// </summary>
    public class InAppNotification
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid RecipientUserId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public NotificationType Type { get; set; } = NotificationType.Info;
        public NotificationCategory Category { get; set; }
        public string? RelatedEntityType { get; set; }
        public Guid? RelatedEntityId { get; set; }
        /// <summary>Web app route opened when the notification is clicked, for example /tickets/{id}.</summary>
        public string? DeepLinkUrl { get; set; }
        public bool IsRead { get; set; }
        public DateTime? ReadAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public User? RecipientUser { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Domain\Enums\AuditAction.cs'] = @'
namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>What kind of operation was performed (People Hub values 1-12 kept; Service Desk values from 13).</summary>
    public enum AuditAction
    {
        Created = 1,
        Updated = 2,
        StatusChanged = 3,
        Approved = 4,
        Rejected = 5,
        Deleted = 6,
        Uploaded = 7,
        Downloaded = 8,
        Login = 9,
        Logout = 10,
        PasswordChanged = 11,
        RoleChanged = 12,
        LoginFailed = 13,
        Assigned = 14,
        Reassigned = 15,
        Acknowledged = 16,
        Escalated = 17,
        Resolved = 18,
        Reopened = 19,
        Cancelled = 20,
        SlaBreached = 21,
        Exported = 22,
        ConfigurationChanged = 23
    }
}
'@
$files['ServiceDeskAPI\Domain\Enums\AuditModule.cs'] = @'
namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Which part of the Service Desk an audit entry relates to.</summary>
    public enum AuditModule
    {
        System = 1,
        Authentication = 2,
        Administration = 3,
        Units = 4,
        Catalogue = 5,
        Tickets = 6,
        Assignment = 7,
        Sla = 8,
        Notifications = 9,
        Reports = 10
    }
}
'@
$files['ServiceDeskAPI\Domain\Enums\NotificationEnums.cs'] = @'
namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Colour and icon of a notification in the web app (same values as People Hub).</summary>
    public enum NotificationType
    {
        Info = 0,
        Success = 1,
        Warning = 2,
        ActionRequired = 3
    }

    /// <summary>Grouping of notifications in the bell (BRD M6).</summary>
    public enum NotificationCategory
    {
        System = 0,
        Ticket = 1,
        Assignment = 2,
        Sla = 3,
        Escalation = 4,
        Report = 5
    }
}
'@
$files['ServiceDeskAPI\Hubs\INotificationClient.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Hubs
{
    /// <summary>Methods the server calls in the browser. The web app listens for "ReceiveNotification".</summary>
    public interface INotificationClient
    {
        Task ReceiveNotification(InAppNotificationDto notification);
    }
}
'@
$files['ServiceDeskAPI\Hubs\NotificationHub.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace ServiceDeskAPI.Hubs
{
    /// <summary>
    /// Live notifications at /hubs/notifications (copied from People Hub). Each signed-in connection joins the group
    /// "user-{id}", and NotificationPushInterceptor sends to that group after a notification is saved.
    /// The browser connects with the HttpOnly cookie; other clients may pass ?access_token= or a Bearer header.
    /// </summary>
    [Authorize]
    public class NotificationHub : Hub<INotificationClient>
    {
        private readonly ILogger<NotificationHub> _logger;

        public NotificationHub(ILogger<NotificationHub> logger) => _logger = logger;

        public static string GroupFor(Guid userId) => "user-" + userId;

        public override async Task OnConnectedAsync()
        {
            var userId = Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(userId, out var id))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(id));
                _logger.LogDebug("User {UserId} connected to NotificationHub ({ConnectionId})", id, Context.ConnectionId);
            }
            else
            {
                _logger.LogWarning("NotificationHub connection without a user id ({ConnectionId}); it will receive nothing", Context.ConnectionId);
            }
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            if (exception != null)
                _logger.LogWarning(exception, "NotificationHub connection {ConnectionId} closed with an error", Context.ConnectionId);
            await base.OnDisconnectedAsync(exception);
        }

        /// <summary>Keep-alive check from the web app: returns "pong".</summary>
        public string Ping() => "pong";
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Audit\AuditActor.cs'] = @'
using System.Security.Claims;

namespace ServiceDeskAPI.Infrastructure.Audit
{
    /// <summary>Who did something, read from the request: user id, display name, IP address and browser.</summary>
    public sealed record AuditActor(Guid? UserId, string? DisplayName, string? IpAddress, string? UserAgent)
    {
        /// <summary>Background jobs and other work with no signed-in person.</summary>
        public static readonly AuditActor System = new(null, "System", null, null);

        public static AuditActor From(HttpContext? context)
        {
            if (context == null) return System;
            var user = context.User;
            Guid? id = Guid.TryParse(user.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var parsed) ? parsed : null;
            var name = user.FindFirst("FullName")?.Value;
            if (string.IsNullOrWhiteSpace(name)) name = user.FindFirst(ClaimTypes.Name)?.Value;
            // The connection address, not X-Forwarded-For, which any caller can set (same rule as the rate limiter).
            return new AuditActor(id, name, context.Connection.RemoteIpAddress?.ToString(), context.Request.Headers["User-Agent"].ToString());
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Audit\AuditService.cs'] = @'
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Audit
{
    /// <summary>
    /// Audit logging, ported from People Hub. Changes: LogAsync writes through its own short-lived DbContext, so it never
    /// saves the caller's other pending changes by accident; failures go to the application log instead of the console;
    /// long values are cut to the column sizes so an audit write cannot fail on length.
    /// </summary>
    public class AuditService : IAuditService
    {
        private readonly AppDbContext _dbContext;
        private readonly DbContextOptions<AppDbContext> _options;
        private readonly ILogger<AuditService> _logger;

        public AuditService(AppDbContext dbContext, DbContextOptions<AppDbContext> options, ILogger<AuditService> logger)
        {
            _dbContext = dbContext;
            _options = options;
            _logger = logger;
        }

        public async Task LogAsync(Guid? userId, string? userDisplayName, AuditAction action, string entityType, Guid entityId,
            string? entityDisplayName, string? oldValues, string? newValues, string? ipAddress, string? userAgent, AuditModule module)
        {
            try
            {
                await using var own = new AppDbContext(_options);
                own.AuditLogs.Add(Build(userId, userDisplayName, action, entityType, entityId, entityDisplayName, oldValues, newValues, ipAddress, userAgent, module));
                await own.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                // An audit failure must not break the main operation, but it must be visible.
                _logger.LogError(ex, "Audit entry could not be written: {Action} {EntityType} {EntityId}", action, entityType, entityId);
            }
        }

        public void Stage(Guid? userId, string? userDisplayName, AuditAction action, string entityType, Guid entityId,
            string? entityDisplayName, string? oldValues, string? newValues, string? ipAddress, string? userAgent, AuditModule module)
        {
            _dbContext.AuditLogs.Add(Build(userId, userDisplayName, action, entityType, entityId, entityDisplayName, oldValues, newValues, ipAddress, userAgent, module));
        }

        private static AuditLog Build(Guid? userId, string? userDisplayName, AuditAction action, string entityType, Guid entityId,
            string? entityDisplayName, string? oldValues, string? newValues, string? ipAddress, string? userAgent, AuditModule module) => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            UserDisplayName = Cut(userDisplayName, 200),
            Action = action,
            EntityType = Cut(entityType, 100) ?? string.Empty,
            EntityId = entityId,
            EntityDisplayName = Cut(entityDisplayName, 256),
            OldValues = oldValues,
            NewValues = newValues,
            IpAddress = Cut(ipAddress, 64),
            UserAgent = Cut(userAgent, 512),
            Timestamp = DateTime.UtcNow,
            Module = module
        };

        private static string? Cut(string? value, int max) => value == null || value.Length <= max ? value : value.Substring(0, max);
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
        /// <summary>CSRF double-submit cookie (Step 1b); the same value goes in the X-CSRF-Token header.</summary>
        public const string CsrfHttps = "__Host-sd-csrf";
        public const string CsrfHttp = "__Secure-sd-csrf";

        public static string? ReadAccessToken(HttpRequest request) => Read(request, AccessHttps) ?? Read(request, AccessHttp);
        public static string? ReadRefreshToken(HttpRequest request) => Read(request, RefreshHttps) ?? Read(request, RefreshHttp);
        public static string? ReadCsrfToken(HttpRequest request) => Read(request, CsrfHttps) ?? Read(request, CsrfHttp);

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
'@
$files['ServiceDeskAPI\Infrastructure\Middleware\CsrfProtectionMiddleware.cs'] = @'
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Infrastructure.Middleware
{
    /// <summary>
    /// CSRF protection for cookie sign-in (double-submit), based on People Hub's CsrfProtectionMiddleware, which People Hub
    /// never switched on. Changes that make it safe to switch on:
    /// - the token is issued once per sign-in (login, refresh, GET /api/auth/csrf), not on every GET, so parallel requests never race;
    /// - it is checked only when the request is signed in by the access-token COOKIE; a Bearer header cannot be added by another site;
    /// - [AllowAnonymous] endpoints (login, refresh, logout) and /hubs (SignalR) are not checked;
    /// - Service Desk cookie names, compared in constant time.
    /// The web app sends the token in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE.
    /// </summary>
    public class CsrfProtectionMiddleware
    {
        public const string HeaderName = "X-CSRF-Token";

        private readonly RequestDelegate _next;
        private readonly ILogger<CsrfProtectionMiddleware> _logger;

        public CsrfProtectionMiddleware(RequestDelegate next, ILogger<CsrfProtectionMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var request = context.Request;
            if (!IsStateChanging(request.Method)
                || request.Path.StartsWithSegments("/hubs")
                || context.GetEndpoint()?.Metadata.GetMetadata<IAllowAnonymous>() != null
                || AuthCookies.ReadAccessToken(request) == null)
            {
                await _next(context);
                return;
            }

            var header = request.Headers[HeaderName].ToString();
            var cookie = AuthCookies.ReadCsrfToken(request);
            if (string.IsNullOrEmpty(header) || string.IsNullOrEmpty(cookie) || !SameToken(header, cookie))
            {
                _logger.LogWarning("CSRF check failed for {Method} {Path}", request.Method, request.Path);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new { statusCode = 403, message = "Security check failed. Refresh the page and try again." });
                return;
            }

            await _next(context);
        }

        /// <summary>Sets the CSRF cookie (same cookie rules as the sign-in cookies) and returns the token for the X-CSRF-Token header.</summary>
        public static string Issue(HttpContext context, bool isDevelopment, DateTime expires)
        {
            var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
            var isHttps = context.Request.IsHttps;
            context.Response.Cookies.Append(isHttps ? AuthCookies.CsrfHttps : AuthCookies.CsrfHttp, token, new CookieOptions
            {
                HttpOnly = true,
                Secure = isDevelopment || isHttps,
                SameSite = isDevelopment ? SameSiteMode.None : (isHttps ? SameSiteMode.Strict : SameSiteMode.Lax),
                Path = "/",
                Expires = expires,
                IsEssential = true
            });
            context.Response.Headers[HeaderName] = token;
            return token;
        }

        private static bool IsStateChanging(string method) =>
            HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);

        private static bool SameToken(string a, string b) =>
            CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
    }

    public static class CsrfProtectionExtensions
    {
        public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app) => app.UseMiddleware<CsrfProtectionMiddleware>();
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Middleware\RateLimitingMiddleware.cs'] = @'
namespace ServiceDeskAPI.Infrastructure.Middleware
{
    /// <summary>One throttling rule: at most Max requests per Window per client IP for a group of routes.</summary>
    public sealed record RateRule(string Group, int Max, TimeSpan Window);

    /// <summary>
    /// Rate limiting for sign-in, copied from People Hub with the Service Desk routes. Counters are per client IP and per route group.
    /// The client IP is the real connection address; X-Forwarded-For is NOT trusted because any caller can set it.
    /// Switch: RateLimiting:Enabled (default true; the tests turn it off).
    /// </summary>
    public class RateLimitingMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<RateLimitingMiddleware> _logger;
        private readonly IConfiguration _configuration;

        private static readonly Dictionary<string, Queue<DateTime>> Store = new();
        private static readonly object LockObj = new();
        private static DateTime _lastCleanup = DateTime.UtcNow;
        private const int MaxKeys = 50000;

        public RateLimitingMiddleware(RequestDelegate next, ILogger<RateLimitingMiddleware> logger, IConfiguration configuration)
        {
            _next = next;
            _logger = logger;
            _configuration = configuration;
        }

        /// <summary>Which rule applies to this request, or null when the route is not throttled.</summary>
        public static RateRule? Classify(string? rawPath, string? method)
        {
            var path = (rawPath ?? string.Empty).ToLowerInvariant().TrimEnd('/');
            if (!path.StartsWith("/api/")) return null;
            if (path.EndsWith("/auth/login")) return new RateRule("login", 10, TimeSpan.FromMinutes(1));
            if (path.EndsWith("/auth/refresh")) return new RateRule("refresh", 30, TimeSpan.FromMinutes(1));
            if (path.Contains("/directory/")) return new RateRule("directory", 60, TimeSpan.FromMinutes(1));
            return null;
        }

        public static string ClientIp(HttpContext context) => context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        public async Task InvokeAsync(HttpContext context)
        {
            var enabled = !string.Equals(_configuration["RateLimiting:Enabled"], "false", StringComparison.OrdinalIgnoreCase);
            var rule = enabled ? Classify(context.Request.Path.Value, context.Request.Method) : null;
            if (rule != null)
            {
                var ip = ClientIp(context);
                if (!TryTake(ip + "|" + rule.Group, rule, out var retryAfter))
                {
                    _logger.LogWarning("Rate limit exceeded for IP {IpAddress} on group {Group}", ip, rule.Group);
                    context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                    context.Response.Headers["Retry-After"] = retryAfter.ToString();
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync("{\"statusCode\":429,\"message\":\"Too many requests. Please try again later.\"}");
                    return;
                }
            }
            await _next(context);
        }

        /// <summary>Takes one request from the key's allowance. Public so the tests can check the counting.</summary>
        public static bool TryTake(string key, RateRule rule, out int retryAfterSeconds)
        {
            lock (LockObj)
            {
                var now = DateTime.UtcNow;
                if (now - _lastCleanup > TimeSpan.FromMinutes(5) || Store.Count > MaxKeys)
                {
                    Cleanup(now);
                    _lastCleanup = now;
                }

                if (!Store.TryGetValue(key, out var q)) { q = new Queue<DateTime>(); Store[key] = q; }
                while (q.Count > 0 && now - q.Peek() > rule.Window) q.Dequeue();

                if (q.Count >= rule.Max)
                {
                    retryAfterSeconds = Math.Max(1, (int)Math.Ceiling((rule.Window - (now - q.Peek())).TotalSeconds));
                    return false;
                }
                q.Enqueue(now);
                retryAfterSeconds = 0;
                return true;
            }
        }

        private static void Cleanup(DateTime now)
        {
            var stale = new List<string>();
            foreach (var kv in Store)
                if (kv.Value.Count == 0 || now - kv.Value.Peek() > TimeSpan.FromMinutes(15)) stale.Add(kv.Key);
            foreach (var k in stale) Store.Remove(k);
            if (Store.Count > MaxKeys) Store.Clear();
        }
    }

    public static class RateLimitingExtensions
    {
        public static IApplicationBuilder UseRateLimiting(this IApplicationBuilder builder) => builder.UseMiddleware<RateLimitingMiddleware>();
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Middleware\SecurityHeadersMiddleware.cs'] = @'
namespace ServiceDeskAPI.Infrastructure.Middleware
{
    /// <summary>
    /// Security headers, copied from People Hub. Change: on in every environment (People Hub only outside Development),
    /// except the strict content policy on the Development Swagger page, which needs its own scripts and styles.
    /// X-XSS-Protection is "0" as OWASP now advises (the old browser filter caused problems of its own).
    /// </summary>
    public class SecurityHeadersMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly IHostEnvironment _environment;

        public SecurityHeadersMiddleware(RequestDelegate next, IHostEnvironment environment)
        {
            _next = next;
            _environment = environment;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var headers = context.Response.Headers;
            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["X-XSS-Protection"] = "0";
            headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()";

            if (context.Request.IsHttps)
                headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

            var isSwagger = context.Request.Path.StartsWithSegments("/swagger");
            if (!(isSwagger && _environment.IsDevelopment()))
            {
                headers["Content-Security-Policy"] =
                    "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; " +
                    "connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'";
            }

            await _next(context);
        }
    }

    public static class SecurityHeadersExtensions
    {
        public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.UseMiddleware<SecurityHeadersMiddleware>();
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
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
        public DbSet<InAppNotification> InAppNotifications => Set<InAppNotification>();

        /// <summary>The audit log is append-only: any update or delete of an AuditLog row is refused before it reaches the database.</summary>
        public override int SaveChanges(bool acceptAllChangesOnSuccess)
        {
            GuardAuditLog();
            return base.SaveChanges(acceptAllChangesOnSuccess);
        }

        public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
        {
            GuardAuditLog();
            return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
        }

        private void GuardAuditLog()
        {
            if (ChangeTracker.Entries<AuditLog>().Any(e => e.State == EntityState.Modified || e.State == EntityState.Deleted))
                throw new InvalidOperationException("The audit log is append-only: audit entries cannot be changed or deleted.");
        }

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

            ConfigureAuditAndNotifications(builder);
        }

        private static void ConfigureAuditAndNotifications(ModelBuilder builder)
        {
            builder.Entity<AuditLog>(e =>
            {
                e.ToTable("AuditLogs");
                e.HasKey(a => a.Id);
                e.Property(a => a.EntityType).HasMaxLength(100).IsRequired();
                e.Property(a => a.EntityDisplayName).HasMaxLength(256);
                e.Property(a => a.UserDisplayName).HasMaxLength(200);
                e.Property(a => a.IpAddress).HasMaxLength(64);
                e.Property(a => a.UserAgent).HasMaxLength(512);
                e.Property(a => a.OldValues).HasColumnType("nvarchar(max)");
                e.Property(a => a.NewValues).HasColumnType("nvarchar(max)");
                e.HasIndex(a => a.Timestamp).HasDatabaseName("IX_AuditLogs_Timestamp");
                e.HasIndex(a => new { a.EntityType, a.EntityId }).HasDatabaseName("IX_AuditLogs_EntityType_EntityId");
                e.HasIndex(a => a.UserId).HasDatabaseName("IX_AuditLogs_UserId");
            });

            builder.Entity<InAppNotification>(e =>
            {
                e.ToTable("InAppNotifications");
                e.HasKey(n => n.Id);
                e.Property(n => n.Title).HasMaxLength(256).IsRequired();
                e.Property(n => n.Message).HasMaxLength(2000).IsRequired();
                e.Property(n => n.RelatedEntityType).HasMaxLength(100);
                e.Property(n => n.DeepLinkUrl).HasMaxLength(500);
                e.HasOne(n => n.RecipientUser).WithMany().HasForeignKey(n => n.RecipientUserId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(n => new { n.RecipientUserId, n.IsRead, n.CreatedAt }).HasDatabaseName("IX_InAppNotifications_Recipient_IsRead_CreatedAt");
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
$files['ServiceDeskAPI\Infrastructure\Services\InAppNotificationService.cs'] = @'
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>The notification bell, copied from People Hub. Live push happens in NotificationPushInterceptor after a save.</summary>
    public class InAppNotificationService : IInAppNotificationService
    {
        private readonly AppDbContext _context;

        public InAppNotificationService(AppDbContext context) => _context = context;

        public void Stage(Guid recipientUserId, string title, string message, NotificationType type, NotificationCategory category,
            string? relatedEntityType, Guid? relatedEntityId, string? deepLinkUrl)
        {
            _context.InAppNotifications.Add(new InAppNotification
            {
                Id = Guid.NewGuid(),
                RecipientUserId = recipientUserId,
                Title = title.Length > 256 ? title[..256] : title,
                Message = message.Length > 2000 ? message[..2000] : message,
                Type = type,
                Category = category,
                RelatedEntityType = relatedEntityType,
                RelatedEntityId = relatedEntityId,
                DeepLinkUrl = deepLinkUrl,
                CreatedAt = DateTime.UtcNow
            });
        }

        public async Task<List<Guid>> UsersWithRolesAsync(params string[] roles) =>
            await _context.UserRoleAssignments
                .Where(a => a.IsActive && a.User != null && a.User.IsActive && roles.Contains(a.Role!.Name!))
                .Select(a => a.UserId)
                .Distinct()
                .ToListAsync();

        public async Task<InAppNotificationListDto> ListAsync(Guid userId, int page, int pageSize, bool unreadOnly)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var own = _context.InAppNotifications.AsNoTracking().Where(n => n.RecipientUserId == userId);
            var unread = await own.CountAsync(n => !n.IsRead);
            var query = unreadOnly ? own.Where(n => !n.IsRead) : own;
            var total = await query.CountAsync();
            var items = await query
                .OrderByDescending(n => n.CreatedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(n => new InAppNotificationDto
                {
                    Id = n.Id, Title = n.Title, Message = n.Message, Type = n.Type, Category = n.Category,
                    RelatedEntityType = n.RelatedEntityType, RelatedEntityId = n.RelatedEntityId, DeepLinkUrl = n.DeepLinkUrl,
                    IsRead = n.IsRead, ReadAt = n.ReadAt, CreatedAt = n.CreatedAt
                })
                .ToListAsync();
            return new InAppNotificationListDto { Items = items, Total = total, Unread = unread, Page = page, PageSize = pageSize };
        }

        public Task<int> UnreadCountAsync(Guid userId) =>
            _context.InAppNotifications.CountAsync(n => n.RecipientUserId == userId && !n.IsRead);

        public async Task<bool> MarkReadAsync(Guid userId, Guid notificationId)
        {
            var notification = await _context.InAppNotifications
                .FirstOrDefaultAsync(n => n.Id == notificationId && n.RecipientUserId == userId);
            if (notification == null) return false;
            if (!notification.IsRead)
            {
                notification.IsRead = true;
                notification.ReadAt = DateTime.UtcNow;
                await _context.SaveChangesAsync();
            }
            return true;
        }

        public Task<int> MarkAllReadAsync(Guid userId)
        {
            var now = DateTime.UtcNow;
            return _context.InAppNotifications
                .Where(n => n.RecipientUserId == userId && !n.IsRead)
                .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true).SetProperty(n => n.ReadAt, (DateTime?)now));
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Services\NotificationPushInterceptor.cs'] = @'
using System.Runtime.CompilerServices;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Hubs;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Pushes new notifications to the recipient's browser (SignalR group "user-{id}") once they are safely saved.
    /// Same pattern as People Hub's NotificationMailInterceptor: collect added rows before the save, act only after it
    /// succeeds, forget them if it fails. Best effort: a failed push never breaks the save; the bell shows it on next load.
    /// </summary>
    public class NotificationPushInterceptor : SaveChangesInterceptor
    {
        private sealed record Outgoing(Guid RecipientUserId, InAppNotificationDto Notification);

        private readonly IHubContext<NotificationHub, INotificationClient> _hub;
        private readonly ILogger<NotificationPushInterceptor> _logger;
        private readonly ConditionalWeakTable<DbContext, List<Outgoing>> _pending = new();

        public NotificationPushInterceptor(IHubContext<NotificationHub, INotificationClient> hub, ILogger<NotificationPushInterceptor> logger)
        {
            _hub = hub;
            _logger = logger;
        }

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            Collect(eventData.Context);
            return result;
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            Collect(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
        {
            var items = Take(eventData.Context);
            if (items.Count > 0) _ = PushAsync(items);
            return result;
        }

        public override async ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            var items = Take(eventData.Context);
            if (items.Count > 0) await PushAsync(items);
            return result;
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData) => Take(eventData.Context);

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
        {
            Take(eventData.Context);
            return Task.CompletedTask;
        }

        public static InAppNotificationDto ToDto(InAppNotification n) => new()
        {
            Id = n.Id,
            Title = n.Title,
            Message = n.Message,
            Type = n.Type,
            Category = n.Category,
            RelatedEntityType = n.RelatedEntityType,
            RelatedEntityId = n.RelatedEntityId,
            DeepLinkUrl = n.DeepLinkUrl,
            IsRead = n.IsRead,
            ReadAt = n.ReadAt,
            CreatedAt = n.CreatedAt
        };

        private void Collect(DbContext? context)
        {
            if (context == null) return;
            var list = _pending.GetOrCreateValue(context);
            list.Clear();
            foreach (var entry in context.ChangeTracker.Entries<InAppNotification>())
                if (entry.State == EntityState.Added)
                    list.Add(new Outgoing(entry.Entity.RecipientUserId, ToDto(entry.Entity)));
        }

        private List<Outgoing> Take(DbContext? context)
        {
            if (context == null || !_pending.TryGetValue(context, out var list) || list.Count == 0) return new List<Outgoing>();
            var copy = list.ToList();
            list.Clear();
            return copy;
        }

        private async Task PushAsync(List<Outgoing> items)
        {
            foreach (var item in items)
            {
                try
                {
                    await _hub.Clients.Group(NotificationHub.GroupFor(item.RecipientUserId)).ReceiveNotification(item.Notification);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Live push of notification {Id} failed; it is stored and shows on the next load", item.Notification.Id);
                }
            }
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Audit\AuditTests.cs'] = @'
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Audit
{
    /// <summary>Step 1b: the audit log (BRD M10) records sign-ins and cannot be altered.</summary>
    public class AuditTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AuditTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task A_successful_sign_in_is_audited()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.requester");

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.AuditLogs.AnyAsync(a => a.UserId == signIn.UserId && a.Action == AuditAction.Login && a.Module == AuditModule.Authentication));
        }

        [Fact]
        public async Task A_failed_sign_in_is_audited_without_the_password()
        {
            const string wrong = "Wrong-Password#9";
            var response = await ApiTestHelpers.Client(_factory).PostAsync("/api/auth/login",
                System.Net.Http.Json.JsonContent.Create(new { username = "test.hou", password = wrong }));
            Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var rows = await db.AuditLogs.Where(a => a.Action == AuditAction.LoginFailed && a.EntityDisplayName == "test.hou").ToListAsync();
            Assert.NotEmpty(rows);
            Assert.All(rows, r =>
            {
                Assert.DoesNotContain(wrong, r.OldValues ?? string.Empty);
                Assert.DoesNotContain(wrong, r.NewValues ?? string.Empty);
            });
        }

        [Fact]
        public async Task Audit_entries_cannot_be_changed_or_deleted()
        {
            var entityId = Guid.NewGuid();
            using (var scope = _factory.Services.CreateScope())
            {
                var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
                await audit.LogAsync(null, "System", AuditAction.Created, "Test", entityId, "append-only check", null, null, null, null, AuditModule.System);
            }

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.AuditLogs.SingleAsync(a => a.EntityId == entityId);
                row.EntityDisplayName = "tampered";
                await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            }

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.AuditLogs.Remove(await db.AuditLogs.SingleAsync(a => a.EntityId == entityId));
                await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync());
            }

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.Equal("append-only check", (await db.AuditLogs.SingleAsync(a => a.EntityId == entityId)).EntityDisplayName);
            }
        }

        [Fact]
        public async Task LogAsync_never_saves_the_callers_unsaved_changes()
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
            var user = await db.Users.FirstAsync(u => u.UserName == "test.caseworker2");
            var original = user.FullName;
            user.FullName = "Not saved yet";

            await audit.LogAsync(null, "System", AuditAction.Updated, "Test", Guid.NewGuid(), null, null, null, null, null, AuditModule.System);

            using var check = _factory.Services.CreateScope();
            var fresh = await check.ServiceProvider.GetRequiredService<AppDbContext>().Users.AsNoTracking().FirstAsync(u => u.UserName == "test.caseworker2");
            Assert.Equal(original, fresh.FullName);
        }

        [Fact]
        public async Task Stage_saves_together_with_the_change()
        {
            var entityId = Guid.NewGuid();
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var audit = scope.ServiceProvider.GetRequiredService<IAuditService>();
                audit.Stage(null, "System", AuditAction.Created, "Test", entityId, "staged", null, null, null, null, AuditModule.System);
                using (var check = _factory.Services.CreateScope())
                    Assert.False(await check.ServiceProvider.GetRequiredService<AppDbContext>().AuditLogs.AnyAsync(a => a.EntityId == entityId));
                await db.SaveChangesAsync();
            }

            using var after = _factory.Services.CreateScope();
            Assert.True(await after.ServiceProvider.GetRequiredService<AppDbContext>().AuditLogs.AnyAsync(a => a.EntityId == entityId));
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Infrastructure\ApiTestHelpers.cs'] = @'
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>Small helpers shared by the API tests.</summary>
    public static class ApiTestHelpers
    {
        public sealed record SignIn(Guid UserId, string AccessToken, string RefreshToken, string CsrfToken, IReadOnlyList<string> SetCookies);

        public static HttpClient Client(ServiceDeskApiFactory factory) =>
            factory.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

        public static async Task<SignIn> SignInAsync(ServiceDeskApiFactory factory, string userName)
        {
            var response = await Client(factory).PostAsJsonAsync("/api/auth/login", new { username = userName, password = ServiceDeskApiFactory.TestPassword });
            response.EnsureSuccessStatusCode();
            var data = (await response.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("data");
            return new SignIn(
                data.GetProperty("user").GetProperty("id").GetGuid(),
                data.GetProperty("accessToken").GetString()!,
                data.GetProperty("refreshToken").GetString()!,
                data.GetProperty("csrfToken").GetString()!,
                response.Headers.TryGetValues("Set-Cookie", out var c) ? c.ToList() : new List<string>());
        }

        /// <summary>The value of one cookie from Set-Cookie lines.</summary>
        public static string CookieValue(IEnumerable<string> setCookies, string name)
        {
            var line = setCookies.First(c => c.StartsWith(name + "=", StringComparison.Ordinal));
            var value = line.Substring(name.Length + 1);
            var end = value.IndexOf(';');
            return Uri.UnescapeDataString(end >= 0 ? value.Substring(0, end) : value);
        }
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
                ["TestAccounts:Password"] = TestPassword,
                ["RateLimiting:Enabled"] = "false" // many sign-ins per minute in tests; RateLimitingTests checks the counter directly
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
$files['tests\ServiceDeskAPI.Tests\Notifications\NotificationTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Notifications
{
    /// <summary>Step 1b: the notification bell and live push (BRD M6 groundwork).</summary>
    public class NotificationTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public NotificationTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<Guid> NotifyAsync(Guid recipient, string title)
        {
            using var scope = _factory.Services.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<IInAppNotificationService>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            service.Stage(recipient, title, "Test message", NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", Guid.NewGuid(), "/tickets/test");
            await db.SaveChangesAsync();
            return db.InAppNotifications.Local.Single(n => n.Title == title).Id;
        }

        private HttpClient Bearer(string token)
        {
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        [Fact]
        public async Task A_person_sees_their_own_notifications_and_can_mark_them_read()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker1");
            var id = await NotifyAsync(me.UserId, "Ticket assigned to you");
            var client = Bearer(me.AccessToken);

            var list = await client.GetFromJsonAsync<InAppNotificationListDto>("/api/notifications");
            Assert.Contains(list!.Items, n => n.Id == id && !n.IsRead && n.IsActionRequired);
            Assert.True(list.Unread >= 1);

            var read = await client.PatchAsync($"/api/notifications/{id}/read", null);
            Assert.Equal(HttpStatusCode.NoContent, read.StatusCode);

            var all = await client.PatchAsync("/api/notifications/read-all", null);
            Assert.Equal(HttpStatusCode.OK, all.StatusCode);
            var count = await client.GetFromJsonAsync<JsonElement>("/api/notifications/unread-count");
            Assert.Equal(0, count.GetProperty("count").GetInt32());
        }

        [Fact]
        public async Task Nobody_can_mark_someone_elses_notification()
        {
            var owner = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");
            var other = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var id = await NotifyAsync(owner.UserId, "Private to case worker two");

            var response = await Bearer(other.AccessToken).PatchAsync($"/api/notifications/{id}/read", null);

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        }

        [Fact]
        public async Task The_unread_count_appears_in_me()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.hod");
            await NotifyAsync(me.UserId, "Escalation level 2");

            var profile = await Bearer(me.AccessToken).GetFromJsonAsync<JsonElement>("/api/auth/me");

            Assert.True(profile.GetProperty("data").GetProperty("unreadNotificationCount").GetInt32() >= 1);
        }

        [Fact]
        public async Task A_saved_notification_is_pushed_live_to_the_recipient()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.hou");
            var connection = new HubConnectionBuilder()
                .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/notifications"), options =>
                {
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                    options.AccessTokenProvider = () => Task.FromResult<string?>(me.AccessToken);
                })
                .Build();
            var received = new TaskCompletionSource<InAppNotificationDto>(TaskCreationOptions.RunContinuationsAsynchronously);
            connection.On<InAppNotificationDto>("ReceiveNotification", n => received.TrySetResult(n));

            await connection.StartAsync();
            try
            {
                Assert.Equal("pong", await connection.InvokeAsync<string>("Ping"));
                var id = await NotifyAsync(me.UserId, "Live push check");

                var finished = await Task.WhenAny(received.Task, Task.Delay(TimeSpan.FromSeconds(15)));
                Assert.Same(received.Task, finished);
                Assert.Equal(id, received.Task.Result.Id);
                Assert.Equal(NotificationCategory.Assignment, received.Task.Result.Category);
            }
            finally
            {
                await connection.DisposeAsync();
            }
        }

        [Fact]
        public async Task The_hub_refuses_anonymous_connections()
        {
            var connection = new HubConnectionBuilder()
                .WithUrl(new Uri(_factory.Server.BaseAddress, "hubs/notifications"), options =>
                {
                    options.HttpMessageHandlerFactory = _ => _factory.Server.CreateHandler();
                    options.Transports = HttpTransportType.LongPolling;
                })
                .Build();

            await Assert.ThrowsAnyAsync<Exception>(() => connection.StartAsync());
            await connection.DisposeAsync();
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Security\MiddlewareTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Middleware;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Security
{
    /// <summary>Step 1b: security headers, CSRF protection for cookie sign-in, and sign-in rate limiting.</summary>
    public class MiddlewareTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public MiddlewareTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task Responses_carry_the_security_headers()
        {
            var response = await ApiTestHelpers.Client(_factory).GetAsync("/api/health");

            Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
            Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
            Assert.Contains("frame-ancestors 'none'", response.Headers.GetValues("Content-Security-Policy").Single());
        }

        private HttpRequestMessage CookieRequest(ApiTestHelpers.SignIn signIn, bool withCsrfCookie, string? csrfHeader)
        {
            var request = new HttpRequestMessage(HttpMethod.Patch, "/api/notifications/read-all");
            var cookies = AuthCookies.AccessHttp + "=" + ApiTestHelpers.CookieValue(signIn.SetCookies, AuthCookies.AccessHttp);
            if (withCsrfCookie)
                cookies += "; " + AuthCookies.CsrfHttp + "=" + Uri.EscapeDataString(ApiTestHelpers.CookieValue(signIn.SetCookies, AuthCookies.CsrfHttp));
            request.Headers.Add("Cookie", cookies);
            if (csrfHeader != null) request.Headers.Add(CsrfProtectionMiddleware.HeaderName, csrfHeader);
            return request;
        }

        [Fact]
        public async Task A_cookie_signed_change_without_the_CSRF_token_is_refused()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker1");

            var noHeader = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, true, null));
            var wrongHeader = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, true, "not-the-token"));
            var noCookie = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, false, signIn.CsrfToken));

            Assert.Equal(HttpStatusCode.Forbidden, noHeader.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, wrongHeader.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, noCookie.StatusCode);
        }

        [Fact]
        public async Task A_cookie_signed_change_with_the_CSRF_token_goes_through()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");
            Assert.Equal(signIn.CsrfToken, ApiTestHelpers.CookieValue(signIn.SetCookies, AuthCookies.CsrfHttp));

            var response = await ApiTestHelpers.Client(_factory).SendAsync(CookieRequest(signIn, true, signIn.CsrfToken));

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public async Task A_Bearer_signed_change_needs_no_CSRF_token()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var response = await client.PatchAsync("/api/notifications/read-all", null);

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }

        [Fact]
        public void Sign_in_routes_are_rate_limited()
        {
            Assert.Equal("login", RateLimitingMiddleware.Classify("/api/auth/login", "POST")!.Group);
            Assert.Equal("refresh", RateLimitingMiddleware.Classify("/api/Auth/Refresh/", "POST")!.Group);
            Assert.Null(RateLimitingMiddleware.Classify("/api/notifications", "GET"));
        }

        [Fact]
        public void The_limit_counts_per_key_and_says_when_to_retry()
        {
            var rule = new RateRule("test", 3, TimeSpan.FromMinutes(1));
            var key = "test|" + Guid.NewGuid();

            for (var i = 0; i < 3; i++)
                Assert.True(RateLimitingMiddleware.TryTake(key, rule, out _));
            Assert.False(RateLimitingMiddleware.TryTake(key, rule, out var retryAfter));
            Assert.InRange(retryAfter, 1, 60);
            Assert.True(RateLimitingMiddleware.TryTake("test|" + Guid.NewGuid(), rule, out _));
        }
    }
}
'@

# ---------------- backups (for the automatic undo) ----------------
$backup = @{}
foreach ($rel in $files.Keys) {
    $full = Join-Path $root $rel
    $backup[$full] = if (Test-Path $full) { [System.IO.File]::ReadAllText($full) } else { $null }
}
$backup[$testProj] = $testProjOld
$migrationFilesBefore = @(Get-ChildItem $migrationsDir -File | ForEach-Object { $_.FullName })
foreach ($f in $migrationFilesBefore) { $backup[$f] = [System.IO.File]::ReadAllText($f) }

function Restore-All {
    foreach ($full in $backup.Keys) {
        if ($null -eq $backup[$full]) { if (Test-Path $full) { Remove-Item $full -Force } }
        else { [System.IO.File]::WriteAllText($full, $backup[$full], $utf8) }
    }
    Get-ChildItem $migrationsDir -File | Where-Object { $migrationFilesBefore -notcontains $_.FullName } | Remove-Item -Force
}

Push-Location $root
try {
    Write-Host ("1/5 Writing {0} source and test files..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }

    Write-Host "2/5 Adding the SignalR client to the tests (Microsoft.AspNetCore.SignalR.Client $aspnetVersion)..."
    if ($testProjOld -notmatch 'Microsoft\.AspNetCore\.SignalR\.Client') {
        $o = Invoke-Dotnet @('add', $testProj, 'package', 'Microsoft.AspNetCore.SignalR.Client', '--version', $aspnetVersion)
        if ($script:lastExit -ne 0) { $o | Select-Object -Last 10 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet add package failed.' }
    }

    Write-Host '3/5 Building...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }

    Write-Host '4/5 Creating the AuditAndNotifications migration...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'AuditAndNotifications', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_AuditAndNotifications.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

    Write-Host '5/5 Building and running all tests (LocalDB; takes a minute)...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed after adding the migration.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) {
        $t | Where-Object { $_ -match 'Error Message|Assert|Exception' } | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
        throw 'Tests failed.'
    }

    Write-Host ''
    Write-Host 'Done. Step 1b is in place.' -ForegroundColor Green
    Write-Host 'Start the API once to create the AuditLogs and InAppNotifications tables. In Swagger, sign in and try GET /api/notifications.'
    Write-Host 'Note for Swagger: it uses the Bearer header, so no CSRF token is needed there. The web app (cookies) sends X-CSRF-Token.'
}
catch {
    Write-Host ''
    Write-Host ('FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    Restore-All
    Write-Host 'Every file was put back as it was. Send me the lines above.' -ForegroundColor Yellow
    Pop-Location
    exit 1
}
Pop-Location
