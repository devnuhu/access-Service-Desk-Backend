# Step 1d - Super Admin management of people and roles, and the Active Directory staff search. Ported from People Hub (ELM).
# Code only: no People Hub password, key or secret is read or used.
#
# What it adds:
#   - GET  api/admin/users (search, role filter), GET api/admin/users/{id}, GET api/admin/roles
#   - POST api/admin/users/{id}/roles (give), DELETE api/admin/users/{id}/roles/{roleId} (take away; history kept)
#   - PATCH api/admin/users/{id}/status (block/unblock; blocking ends their sessions)
#   - Rules: each role once per person; Requester cannot be removed; the last Super Admin is protected; no self-deactivation
#   - GET  api/directory/users/search (Super Admin, Head of Unit); POST api/directory/users/ensure (Super Admin: add before first sign-in)
#   - Every change is audited and the person is notified (bell + email), in the same save
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk with the API stopped:
#   .\Scripts\step1d-admin-directory.ps1
# No database change in this step. On any failure, every file is put back as it was.

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from C:\Users\<you>\Desktop\PRO\ServiceDesk (the folder that contains ServiceDeskAPI and docs).' -ForegroundColor Red; return }
Write-Host "  Solution root: $root"

$api = Join-Path $root 'ServiceDeskAPI'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
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
if (-not (Test-Path (Join-Path $api 'Infrastructure\Email\EmailLayout.cs'))) { Write-Host 'Step 1c is not in place. Run step1c-email.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Controllers\AdminUsersController.cs')) { Write-Host 'AdminUsersController.cs already exists: Step 1d looks applied. Nothing changed.' -ForegroundColor Yellow; return }
foreach ($clash in @('Controllers\AdminController.cs', 'Controllers\DirectoryController.cs', 'Infrastructure\Services\DirectoryService.cs')) {
    if (Test-Path (Join-Path $api $clash)) { Write-Host "$clash already exists. Nothing changed; send me that file." -ForegroundColor Red; return }
}
$expected = [ordered]@{
    'ServiceDeskAPI\Program.cs' = '13ef735d85f0691183ef5189580fd88a58ec287eeeea080213d1fee470d5a012'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed after Step 1c, so Step 1d stopped to avoid overwriting your changes:' -ForegroundColor Red
    $changedByYou | ForEach-Object { Write-Host "    $_" }
    Write-Host 'Send me those files.'
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
using ServiceDeskAPI.Hubs;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
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
            // and NotificationMailInterceptor queues their email copies (Step 1c); both act only after a successful save
            builder.Services.AddSingleton<NotificationPushInterceptor>();
            builder.Services.AddSingleton<NotificationMailQueue>();
            builder.Services.AddSingleton<NotificationMailInterceptor>();
            builder.Services.AddDbContext<AppDbContext>((services, options) =>
                options.UseSqlServer(services.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection"))
                    .AddInterceptors(
                        services.GetRequiredService<NotificationPushInterceptor>(),
                        services.GetRequiredService<NotificationMailInterceptor>()));

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
            builder.Services.AddScoped<IAdminUserService, AdminUserService>();
            builder.Services.AddScoped<IDirectoryService>(DirectorySetup.Create);

            // ============ EMAIL (Step 1c): Infobip, Smtp or Off, chosen from EmailSettings:Provider ============
            builder.Services.AddHttpClient(InfobipEmailService.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(30));
            builder.Services.AddScoped<IEmailService>(EmailSetup.Create);
            builder.Services.AddHostedService<NotificationMailWorker>();

            // ============ SIGNALR (live notifications) ============
            builder.Services.AddSignalR();
            builder.Services.AddHostedService<TestAccountSeeder>();

            var app = builder.Build();

            StartupChecks.Run(app);
            EmailBrand.Current = EmailBrand.FromConfiguration(app.Configuration);

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
$files['ServiceDeskAPI\Application\DTOs\AdminDTOs.cs'] = @'
namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A page of results.</summary>
    public class PagedResult<T>
    {
        public List<T> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }

    /// <summary>One person in the Super Admin user list, with every active role.</summary>
    public class AdminUserDto
    {
        public Guid Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? Department { get; set; }
        public string? JobTitle { get; set; }
        public List<string> Roles { get; set; } = new();
        public bool IsActive { get; set; }
        /// <summary>False for someone added from the directory who has not signed in yet.</summary>
        public bool HasSignedIn { get; set; }
        public DateTime? LastLoginAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>A role that can be given (GET api/admin/roles).</summary>
    public record RoleItemDto(Guid Id, string Name, string? Description);

    public class AssignRoleRequest
    {
        public Guid RoleId { get; set; }
    }

    public class UpdateUserStatusRequest
    {
        /// <summary>True to let the person sign in, false to block them (their sessions end).</summary>
        public bool IsActive { get; set; }
    }

    /// <summary>Outcome of an admin action: Status is the HTTP status the controller returns (200, 400, 404 or 409).</summary>
    public sealed record AdminResult(int Status, string Message)
    {
        public bool Success => Status == 200;
        public static AdminResult Ok(string message) => new(200, message);
        public static AdminResult Invalid(string message) => new(400, message);
        public static AdminResult NotFound(string message) => new(404, message);
        public static AdminResult Conflict(string message) => new(409, message);
    }

    /// <summary>One person found in Active Directory. Only safe attributes; the manager link is never sent to the browser.</summary>
    public class DirectoryUserDto
    {
        public string DistinguishedName { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? JobTitle { get; set; }
        public string? Department { get; set; }
        public string SamAccountName { get; set; } = string.Empty;
        [System.Text.Json.Serialization.JsonIgnore]
        public string? ManagerDn { get; set; }
    }

    public class EnsureUserRequest
    {
        /// <summary>The login name (sAMAccountName) from the directory search.</summary>
        public string SamAccountName { get; set; } = string.Empty;
    }

    /// <summary>A local account made (or found) for a person from the directory, so roles can be given before their first sign-in.</summary>
    public class ProvisionedUserDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? Department { get; set; }
        /// <summary>True when this call created the local account.</summary>
        public bool Created { get; set; }
        public List<string> Roles { get; set; } = new();
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IAdminUserService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Super Admin management of people and roles (BRD Section 4), ported from People Hub's AdminUserRoleService with several
    /// roles per person. Every change is audited and the person is notified, in the same save.
    /// </summary>
    public interface IAdminUserService
    {
        Task<PagedResult<AdminUserDto>> ListUsersAsync(int page, int pageSize, string? search, string? role);
        Task<AdminUserDto?> GetUserAsync(Guid userId);
        Task<List<RoleItemDto>> ListRolesAsync();

        /// <summary>Gives a role. 409 when the person already holds it.</summary>
        Task<AdminResult> AssignRoleAsync(Guid userId, Guid roleId, Guid actorUserId);

        /// <summary>Takes a role away (the history is kept). Refuses Requester (every staff member has it) and the last Super Admin.</summary>
        Task<AdminResult> RemoveRoleAsync(Guid userId, Guid roleId, Guid actorUserId);

        /// <summary>Lets a person sign in or blocks them. Blocking ends their sessions. Refuses blocking yourself or the last Super Admin.</summary>
        Task<AdminResult> SetStatusAsync(Guid userId, bool isActive, Guid actorUserId);

        /// <summary>Makes a local account for someone from the directory (Requester role), so roles can be given before their first sign-in.</summary>
        Task<(AdminResult Result, ProvisionedUserDto? User)> EnsureFromDirectoryAsync(string samAccountName, Guid actorUserId);
    }

    /// <summary>Live search of on-premises Active Directory for the staff pickers (copied from People Hub).</summary>
    public interface IDirectoryService
    {
        /// <summary>Up to 20 enabled people matching name, login name or email. Throws when the directory cannot be reached.</summary>
        Task<List<DirectoryUserDto>> SearchUsersAsync(string query);
    }
}
'@
$files['ServiceDeskAPI\Controllers\AdminUsersController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Super Admin: people and roles (BRD Section 4). Ported from People Hub's AdminController and AdminRolesController.
    /// A person can hold several roles; giving and removing are separate calls. Errors are { message }.
    /// </summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    public class AdminUsersController : ControllerBase
    {
        private readonly IAdminUserService _service;

        public AdminUsersController(IAdminUserService service) => _service = service;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private IActionResult From(AdminResult result) =>
            result.Success ? Ok(new { message = result.Message }) : StatusCode(result.Status, new { message = result.Message });

        /// <summary>People, with every active role. Search matches login name, name, email or department; role filters by role name.</summary>
        [HttpGet("users")]
        public async Task<ActionResult<PagedResult<AdminUserDto>>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20,
            [FromQuery] string? search = null, [FromQuery] string? role = null)
            => Ok(await _service.ListUsersAsync(page, pageSize, search, role));

        [HttpGet("users/{userId:guid}")]
        public async Task<ActionResult<AdminUserDto>> Get(Guid userId)
        {
            var user = await _service.GetUserAsync(userId);
            return user == null ? NotFound(new { message = "Person not found." }) : Ok(user);
        }

        /// <summary>The five roles with their ids, for the role picker.</summary>
        [HttpGet("roles")]
        public async Task<ActionResult<List<RoleItemDto>>> Roles() => Ok(await _service.ListRolesAsync());

        /// <summary>Gives a role. 409 when the person already holds it.</summary>
        [HttpPost("users/{userId:guid}/roles")]
        public async Task<IActionResult> AssignRole(Guid userId, [FromBody] AssignRoleRequest request)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            if (request.RoleId == Guid.Empty)
                return BadRequest(new { message = "Choose a role.", errors = new { roleId = "Choose a role." } });
            return From(await _service.AssignRoleAsync(userId, request.RoleId, actor));
        }

        /// <summary>Takes a role away. The assignment is kept as history. 400 for Requester and for the last Super Admin.</summary>
        [HttpDelete("users/{userId:guid}/roles/{roleId:guid}")]
        public async Task<IActionResult> RemoveRole(Guid userId, Guid roleId)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            return From(await _service.RemoveRoleAsync(userId, roleId, actor));
        }

        /// <summary>Lets a person sign in (true) or blocks them and ends their sessions (false).</summary>
        [HttpPatch("users/{userId:guid}/status")]
        public async Task<IActionResult> SetStatus(Guid userId, [FromBody] UpdateUserStatusRequest request)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            return From(await _service.SetStatusAsync(userId, request.IsActive, actor));
        }
    }
}
'@
$files['ServiceDeskAPI\Controllers\DirectoryController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Staff search for the pickers (copied from People Hub). Search: Super Admin and Heads of Unit (for setting up case workers).
    /// Adding someone from the directory before their first sign-in: Super Admin.
    /// </summary>
    [ApiController]
    [Route("api/directory")]
    [Authorize]
    public class DirectoryController : ControllerBase
    {
        private readonly IDirectoryService _directory;
        private readonly IAdminUserService _admin;
        private readonly ILogger<DirectoryController> _logger;

        public DirectoryController(IDirectoryService directory, IAdminUserService admin, ILogger<DirectoryController> logger)
        {
            _directory = directory;
            _admin = admin;
            _logger = logger;
        }

        /// <summary>
        /// Up to 20 enabled people matching name, login name or email.
        /// 400: empty or too long query. 503: the directory could not be reached (or AD is not set up yet).
        /// </summary>
        [HttpGet("users/search")]
        [Authorize(Policy = Policies.UnitManagement)]
        public async Task<ActionResult<List<DirectoryUserDto>>> Search([FromQuery] string? query)
        {
            var text = (query ?? string.Empty).Trim();
            if (text.Length == 0)
                return BadRequest(new { message = "Type a name, login name or email to search.", errors = new { query = "Required." } });
            if (text.Length > 256)
                return BadRequest(new { message = "The search text must not exceed 256 characters.", errors = new { query = "Too long." } });

            try
            {
                return Ok(await _directory.SearchUsersAsync(text));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Directory search failed for {User}", User.Identity?.Name);
                return StatusCode(503, new { message = "The staff directory could not be searched right now. Try again, and tell ICT if it keeps happening." });
            }
        }

        /// <summary>Makes a local account (Requester) for someone found in the search, so roles can be given before they first sign in.</summary>
        [HttpPost("users/ensure")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        public async Task<ActionResult<ProvisionedUserDto>> Ensure([FromBody] EnsureUserRequest request)
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var actor)) return Unauthorized();
            var (result, user) = await _admin.EnsureFromDirectoryAsync(request.SamAccountName, actor);
            if (!result.Success || user == null) return StatusCode(result.Status, new { message = result.Message });
            return Ok(user);
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Identity\SuperAdminRules.cs'] = @'
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>Rules for the Super Admin role (copied from People Hub): the system must always keep one active Super Admin.</summary>
    public static class SuperAdminRules
    {
        /// <summary>True when the user is an active Super Admin and no other active account holds the role.</summary>
        public static async Task<bool> IsLastAsync(AppDbContext ctx, Guid userId)
        {
            var holds = await ctx.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.IsActive && a.RoleId == AppRoles.SuperAdminId);
            if (!holds) return false;
            var others = await ctx.UserRoleAssignments.AnyAsync(a => a.UserId != userId && a.IsActive
                && a.RoleId == AppRoles.SuperAdminId && a.User!.IsActive);
            return !others;
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Services\AdminUserService.cs'] = @'
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Super Admin management of people and roles. Ported from People Hub's AdminUserRoleService; the one-active-role rule was replaced
    /// by "each role once while active". Each change, its audit entry and the person's notification are saved together.
    /// A role change reaches the person's session at the next token refresh (within 15 minutes) or sign-in.
    /// </summary>
    public class AdminUserService : IAdminUserService
    {
        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly ILdapAuthService _ldap;
        private readonly IHttpContextAccessor _http;
        private readonly ILogger<AdminUserService> _logger;

        public AdminUserService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, ILdapAuthService ldap,
            IHttpContextAccessor http, ILogger<AdminUserService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _ldap = ldap;
            _http = http;
            _logger = logger;
        }

        public async Task<PagedResult<AdminUserDto>> ListUsersAsync(int page, int pageSize, string? search, string? role)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var query = _db.Users.AsNoTracking().AsQueryable();

            var text = (search ?? string.Empty).Trim();
            if (text.Length > 0)
                query = query.Where(u => u.UserName!.Contains(text)
                    || (u.FullName != null && u.FullName.Contains(text))
                    || (u.Email != null && u.Email.Contains(text))
                    || (u.Department != null && u.Department.Contains(text)));

            var roleName = (role ?? string.Empty).Trim().ToUpperInvariant();
            if (roleName.Length > 0)
                query = query.Where(u => u.RoleAssignments.Any(a => a.IsActive && a.Role!.NormalizedName == roleName));

            var total = await query.CountAsync();
            var items = await Project(query.OrderBy(u => u.FullName ?? u.UserName).Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync();
            return new PagedResult<AdminUserDto> { Items = items, Total = total, Page = page, PageSize = pageSize };
        }

        public Task<AdminUserDto?> GetUserAsync(Guid userId) =>
            Project(_db.Users.AsNoTracking().Where(u => u.Id == userId)).FirstOrDefaultAsync();

        private static IQueryable<AdminUserDto> Project(IQueryable<User> users) => users.Select(u => new AdminUserDto
        {
            Id = u.Id,
            UserName = u.UserName ?? string.Empty,
            FullName = u.FullName,
            Email = u.CorporateEmail ?? u.Email,
            Department = u.Department,
            JobTitle = u.JobTitle,
            Roles = u.RoleAssignments.Where(a => a.IsActive).Select(a => a.Role!.Name!).OrderBy(n => n).ToList(),
            IsActive = u.IsActive,
            HasSignedIn = u.LastLoginAt != null,
            LastLoginAt = u.LastLoginAt,
            CreatedAt = u.CreatedAt
        });

        public async Task<List<RoleItemDto>> ListRolesAsync() =>
            await _db.Roles.AsNoTracking().OrderBy(r => r.Name).Select(r => new RoleItemDto(r.Id, r.Name!, r.Description)).ToListAsync();

        public async Task<AdminResult> AssignRoleAsync(Guid userId, Guid roleId, Guid actorUserId)
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return AdminResult.NotFound("Person not found.");
            var role = await _db.Roles.FirstOrDefaultAsync(r => r.Id == roleId);
            if (role == null) return AdminResult.NotFound("Role not found.");
            if (await _db.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.RoleId == roleId && a.IsActive))
                return AdminResult.Conflict(Name(user) + " already has the " + role.Name + " role.");

            _db.UserRoleAssignments.Add(new UserRoleAssignment
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                RoleId = roleId,
                IsActive = true,
                AssignedAt = DateTime.UtcNow,
                AssignedByUserId = actorUserId
            });
            if (!await _db.UserRoles.AnyAsync(r => r.UserId == userId && r.RoleId == roleId))
                _db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = userId, RoleId = roleId });

            Stage(AuditAction.RoleChanged, user, null, Json(new { granted = role.Name }));
            _notifications.Stage(userId, "Your Service Desk access changed",
                "You now have the " + Friendly(role.Name) + " role. Sign out and back in if you do not see the new pages yet.",
                NotificationType.Info, NotificationCategory.System, "User", userId, null);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Granted by someone else at the same moment (unique index on active user + role)
                return AdminResult.Conflict(Name(user) + " already has the " + role.Name + " role.");
            }
            _logger.LogInformation("Role {Role} given to {User} by {Actor}", role.Name, user.UserName, actorUserId);
            return AdminResult.Ok(role.Name + " role given to " + Name(user) + ".");
        }

        public async Task<AdminResult> RemoveRoleAsync(Guid userId, Guid roleId, Guid actorUserId)
        {
            var assignment = await _db.UserRoleAssignments
                .Include(a => a.Role)
                .Include(a => a.User)
                .FirstOrDefaultAsync(a => a.UserId == userId && a.RoleId == roleId && a.IsActive);
            if (assignment?.User == null || assignment.Role == null)
                return AdminResult.NotFound("This person does not hold that role.");

            if (roleId == AppRoles.RequesterId)
                return AdminResult.Invalid("Every staff member is a Requester. To stop someone using the Service Desk, deactivate their account instead.");
            if (roleId == AppRoles.SuperAdminId && await SuperAdminRules.IsLastAsync(_db, userId))
                return AdminResult.Invalid("This is the last Super Admin. Give the role to someone else first.");

            assignment.IsActive = false;
            assignment.DisabledAt = DateTime.UtcNow;
            assignment.DisabledByUserId = actorUserId;
            var link = await _db.UserRoles.FirstOrDefaultAsync(r => r.UserId == userId && r.RoleId == roleId);
            if (link != null) _db.UserRoles.Remove(link);

            Stage(AuditAction.RoleChanged, assignment.User, Json(new { removed = assignment.Role.Name }), null);
            _notifications.Stage(userId, "Your Service Desk access changed",
                "The " + Friendly(assignment.Role.Name) + " role was removed from your account.",
                NotificationType.Info, NotificationCategory.System, "User", userId, null);

            await _db.SaveChangesAsync();
            _logger.LogInformation("Role {Role} removed from {User} by {Actor}", assignment.Role.Name, assignment.User.UserName, actorUserId);
            return AdminResult.Ok(assignment.Role.Name + " role removed from " + Name(assignment.User) + ".");
        }

        public async Task<AdminResult> SetStatusAsync(Guid userId, bool isActive, Guid actorUserId)
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return AdminResult.NotFound("Person not found.");
            if (user.IsActive == isActive)
                return AdminResult.Ok(Name(user) + (isActive ? " is already active." : " is already deactivated."));
            if (!isActive && userId == actorUserId)
                return AdminResult.Invalid("You cannot deactivate your own account.");
            if (!isActive && await SuperAdminRules.IsLastAsync(_db, userId))
                return AdminResult.Invalid("This is the last Super Admin. Give the role to someone else first.");

            user.IsActive = isActive;
            user.UpdatedAt = DateTime.UtcNow;
            if (!isActive)
            {
                // End every session: no refresh token of theirs works any more
                var now = DateTime.UtcNow;
                foreach (var token in await _db.RefreshTokenStores.Where(t => t.UserId == userId && !t.IsRevoked).ToListAsync())
                {
                    token.IsRevoked = true;
                    token.RevokedAt = now;
                }
            }

            Stage(AuditAction.StatusChanged, user, Json(new { isActive = !isActive }), Json(new { isActive }));
            await _db.SaveChangesAsync();
            _logger.LogInformation("{User} {State} by {Actor}", user.UserName, isActive ? "activated" : "deactivated", actorUserId);
            return AdminResult.Ok(Name(user) + (isActive ? " can sign in again." : " is deactivated and signed out."));
        }

        public async Task<(AdminResult Result, ProvisionedUserDto? User)> EnsureFromDirectoryAsync(string samAccountName, Guid actorUserId)
        {
            var sam = (samAccountName ?? string.Empty).Trim();
            if (sam.Length == 0 || sam.Length > 256)
                return (AdminResult.Invalid("Choose a person from the directory search."), null);

            var existing = await FindByUserNameAsync(sam);
            if (existing != null)
                return (AdminResult.Ok("Already has an account."), await ToProvisionedAsync(existing, false));

            var ad = await _ldap.GetUserDetailsAsync(sam);
            if (ad == null)
                return (AdminResult.NotFound("That person was not found in the directory."), null);

            var userName = string.IsNullOrWhiteSpace(ad.Username) ? sam : ad.Username.Trim();
            existing = await FindByUserNameAsync(userName);
            if (existing != null)
                return (AdminResult.Ok("Already has an account."), await ToProvisionedAsync(existing, false));

            var email = string.IsNullOrWhiteSpace(ad.Email) ? null : ad.Email.Trim();
            var user = new User
            {
                Id = Guid.NewGuid(),
                UserName = userName,
                NormalizedUserName = userName.ToUpperInvariant(),
                Email = email,
                NormalizedEmail = email?.ToUpperInvariant(),
                CorporateEmail = email,
                EmailConfirmed = email != null,
                FullName = string.IsNullOrWhiteSpace(ad.DisplayName) ? userName : ad.DisplayName,
                Department = string.IsNullOrWhiteSpace(ad.Department) ? null : ad.Department.Trim(),
                JobTitle = string.IsNullOrWhiteSpace(ad.Title) ? null : ad.Title.Trim(),
                AdDistinguishedName = string.IsNullOrWhiteSpace(ad.DistinguishedName) ? null : ad.DistinguishedName,
                IsActive = true,
                SecurityStamp = Guid.NewGuid().ToString(),
                ConcurrencyStamp = Guid.NewGuid().ToString(),
                CreatedAt = DateTime.UtcNow
            };
            _db.Users.Add(user);
            _db.UserRoleAssignments.Add(new UserRoleAssignment
            {
                Id = Guid.NewGuid(), UserId = user.Id, RoleId = AppRoles.RequesterId, IsActive = true,
                AssignedAt = DateTime.UtcNow, AssignedByUserId = actorUserId
            });
            _db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = user.Id, RoleId = AppRoles.RequesterId });
            Stage(AuditAction.Created, user, null, Json(new { source = "directory", user.Department }));

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Could not add {User} from the directory", userName);
                return (AdminResult.Conflict("An account with the same login name or email already exists."), null);
            }
            return (AdminResult.Ok("Account created."), await ToProvisionedAsync(user, true));
        }

        // ---------------- helpers ----------------

        private Task<User?> FindByUserNameAsync(string userName)
        {
            var normalized = userName.ToUpperInvariant();
            return _db.Users.FirstOrDefaultAsync(u => u.NormalizedUserName == normalized);
        }

        private async Task<ProvisionedUserDto> ToProvisionedAsync(User user, bool created) => new()
        {
            UserId = user.Id,
            UserName = user.UserName ?? string.Empty,
            FullName = user.FullName,
            Email = user.CorporateEmail ?? user.Email,
            Department = user.Department,
            Created = created,
            Roles = await RoleAssignments.GetActiveRoleNamesAsync(_db, user.Id)
        };

        private void Stage(AuditAction action, User user, string? oldValues, string? newValues)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "User", user.Id, user.UserName, oldValues, newValues,
                actor.IpAddress, actor.UserAgent, AuditModule.Administration);
        }

        private static string Json(object value) => JsonSerializer.Serialize(value);

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;

        private static string Friendly(string? role) => role switch
        {
            AppRoles.CaseWorker => "Case Worker",
            AppRoles.HeadOfUnit => "Head of Unit",
            AppRoles.HOD => "Head of Department",
            AppRoles.SuperAdmin => "Super Admin",
            _ => role ?? string.Empty
        };
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Services\DirectoryService.cs'] = @'
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
'@
$files['tests\ServiceDeskAPI.Tests\Admin\AdminUsersTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Admin
{
    /// <summary>Step 1d: Super Admin management of people and roles (BRD Section 4).</summary>
    public class AdminUsersTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AdminUsersTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        [Fact]
        public async Task Only_a_Super_Admin_can_manage_people()
        {
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.requester")).GetAsync("/api/admin/users")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou")).GetAsync("/api/admin/users")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.superadmin")).GetAsync("/api/admin/users")).StatusCode);
        }

        [Fact]
        public async Task The_list_shows_every_role_and_can_be_filtered()
        {
            var admin = await As("test.superadmin");

            var caseworkers = await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/api/admin/users?search=caseworker");
            var hods = await admin.GetFromJsonAsync<PagedResult<AdminUserDto>>("/api/admin/users?role=HOD");

            Assert.Equal(2, caseworkers!.Total);
            Assert.All(caseworkers.Items, u => Assert.Equal(new[] { AppRoles.CaseWorker, AppRoles.Requester }, u.Roles));
            Assert.Contains(hods!.Items, u => u.UserName == "test.hod");
            Assert.DoesNotContain(hods.Items, u => u.UserName == "test.requester");
        }

        [Fact]
        public async Task The_five_roles_are_listed()
        {
            var roles = await (await As("test.superadmin")).GetFromJsonAsync<List<RoleItemDto>>("/api/admin/roles");
            Assert.Equal(AppRoles.All.OrderBy(r => r), roles!.Select(r => r.Name).OrderBy(r => r));
        }

        [Fact]
        public async Task Giving_a_role_works_once_and_is_audited_and_notified()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.requester");

            var first = await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = AppRoles.HeadOfUnitId });
            var second = await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = AppRoles.HeadOfUnitId });

            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityId == target && a.Action == AuditAction.RoleChanged && a.Module == AuditModule.Administration));
                Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == target && n.Title == "Your Service Desk access changed"));
            }

            // The new role is in the next sign-in, next to the roles the person already had
            var again = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var me = await ApiTestHelpers.Client(_factory).SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/auth/me")
            {
                Headers = { Authorization = new AuthenticationHeaderValue("Bearer", again.AccessToken) }
            });
            var body = await me.Content.ReadAsStringAsync();
            Assert.Contains(AppRoles.HeadOfUnit, body);
            Assert.Contains(AppRoles.Requester, body);
        }

        [Fact]
        public async Task Removing_a_role_keeps_the_history()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.hou");

            var removed = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.HeadOfUnitId}");
            var again = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.HeadOfUnitId}");

            Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var history = await db.UserRoleAssignments.Where(a => a.UserId == target && a.RoleId == AppRoles.HeadOfUnitId).ToListAsync();
            Assert.Contains(history, a => !a.IsActive && a.DisabledAt != null && a.DisabledByUserId != null);
            Assert.DoesNotContain(history, a => a.IsActive);
        }

        [Fact]
        public async Task Requester_cannot_be_removed()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.hod");

            var response = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.RequesterId}");

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        }

        [Fact]
        public async Task The_last_Super_Admin_is_protected()
        {
            var admin = await As("test.superadmin");
            var self = await IdOf("test.superadmin");

            var removeRole = await admin.DeleteAsync($"/api/admin/users/{self}/roles/{AppRoles.SuperAdminId}");
            var deactivate = await admin.PatchAsJsonAsync($"/api/admin/users/{self}/status", new { isActive = false });

            Assert.Equal(HttpStatusCode.BadRequest, removeRole.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, deactivate.StatusCode);
        }

        [Fact]
        public async Task Deactivating_a_person_signs_them_out_and_blocks_sign_in()
        {
            var admin = await As("test.superadmin");
            var person = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");

            var off = await admin.PatchAsJsonAsync($"/api/admin/users/{person.UserId}/status", new { isActive = false });
            Assert.Equal(HttpStatusCode.OK, off.StatusCode);

            var refresh = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/refresh", new { refreshToken = person.RefreshToken });
            var login = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/login", new { username = "test.caseworker2", password = ServiceDeskApiFactory.TestPassword });
            Assert.Equal(HttpStatusCode.Unauthorized, refresh.StatusCode);
            Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);

            var on = await admin.PatchAsJsonAsync($"/api/admin/users/{person.UserId}/status", new { isActive = true });
            Assert.Equal(HttpStatusCode.OK, on.StatusCode);
            var back = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/login", new { username = "test.caseworker2", password = ServiceDeskApiFactory.TestPassword });
            Assert.Equal(HttpStatusCode.OK, back.StatusCode);
        }

        [Fact]
        public async Task Unknown_people_and_roles_are_404()
        {
            var admin = await As("test.superadmin");
            var known = await IdOf("test.hod");

            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/admin/users/{Guid.NewGuid()}/roles", new { roleId = AppRoles.CaseWorkerId })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await admin.PostAsJsonAsync($"/api/admin/users/{known}/roles", new { roleId = Guid.NewGuid() })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsJsonAsync($"/api/admin/users/{known}/roles", new { roleId = Guid.Empty })).StatusCode);
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Admin\DirectoryTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Services;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Admin
{
    /// <summary>The API with a pretend Active Directory: one person, "new.person", and a search that fails on "fail".</summary>
    public class DirectoryApiFactory : ServiceDeskApiFactory
    {
        public sealed class FakeLdap : ILdapAuthService
        {
            public Task<LdapAuthResult> AuthenticateAsync(string username, string password) =>
                Task.FromResult(new LdapAuthResult { Success = false, Message = "Not used in these tests" });

            public Task<LdapUserDetails?> GetUserDetailsAsync(string username) => Task.FromResult(
                string.Equals(username, "new.person", StringComparison.OrdinalIgnoreCase)
                    ? new LdapUserDetails
                    {
                        Username = "new.person", Email = "new.person@test.invalid", DisplayName = "New Person",
                        FirstName = "New", LastName = "Person", Department = "Contribution Processing", Title = "Officer",
                        DistinguishedName = "CN=New Person,OU=Staff,DC=test,DC=local"
                    }
                    : null);

            public Task<List<string>> GetUserGroupsAsync(string username) => Task.FromResult(new List<string>());
        }

        public sealed class FakeDirectory : IDirectoryService
        {
            public Task<List<DirectoryUserDto>> SearchUsersAsync(string query) =>
                query == "fail"
                    ? throw new InvalidOperationException("Directory down (test)")
                    : Task.FromResult(new List<DirectoryUserDto>
                    {
                        new() { SamAccountName = "new.person", DisplayName = "New Person", Email = "new.person@test.invalid", Department = "Contribution Processing", ManagerDn = "CN=Boss" }
                    });
        }

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            base.ConfigureWebHost(builder);
            builder.ConfigureServices(services =>
            {
                foreach (var d in services.Where(d => d.ServiceType == typeof(ILdapAuthService) || d.ServiceType == typeof(IDirectoryService)).ToList())
                    services.Remove(d);
                services.AddScoped<ILdapAuthService, FakeLdap>();
                services.AddScoped<IDirectoryService, FakeDirectory>();
            });
        }
    }

    /// <summary>Step 1d: staff search and adding people from the directory before their first sign-in.</summary>
    public class DirectoryTests : IClassFixture<DirectoryApiFactory>
    {
        private readonly DirectoryApiFactory _factory;

        public DirectoryTests(DirectoryApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        [Fact]
        public async Task Super_Admin_and_Heads_of_Unit_can_search_the_directory()
        {
            var adminResponse = await (await As("test.superadmin")).GetAsync("/api/directory/users/search?query=new");
            var houResponse = await (await As("test.hou")).GetAsync("/api/directory/users/search?query=new");
            var workerResponse = await (await As("test.caseworker1")).GetAsync("/api/directory/users/search?query=new");

            Assert.Equal(HttpStatusCode.OK, adminResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, houResponse.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, workerResponse.StatusCode);
            var body = await adminResponse.Content.ReadAsStringAsync();
            Assert.Contains("new.person", body);
            Assert.DoesNotContain("CN=Boss", body); // the manager link never reaches the browser
        }

        [Fact]
        public async Task An_empty_search_is_400_and_a_directory_failure_is_503()
        {
            var admin = await As("test.superadmin");
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.GetAsync("/api/directory/users/search?query=")).StatusCode);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await admin.GetAsync("/api/directory/users/search?query=fail")).StatusCode);
        }

        [Fact]
        public async Task A_person_from_the_directory_gets_an_account_once_and_can_then_be_given_a_role()
        {
            var admin = await As("test.superadmin");

            var first = await admin.PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "new.person" });
            var created = await first.Content.ReadFromJsonAsync<ProvisionedUserDto>();
            var second = await (await admin.PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "NEW.PERSON" })).Content.ReadFromJsonAsync<ProvisionedUserDto>();
            var unknown = await admin.PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "nobody.here" });

            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            Assert.True(created!.Created);
            Assert.Equal(new[] { AppRoles.Requester }, created.Roles);
            Assert.Equal("Contribution Processing", created.Department);
            Assert.False(second!.Created);
            Assert.Equal(created.UserId, second.UserId);
            Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);

            var grant = await admin.PostAsJsonAsync($"/api/admin/users/{created.UserId}/roles", new { roleId = AppRoles.CaseWorkerId });
            Assert.Equal(HttpStatusCode.OK, grant.StatusCode);
        }

        [Fact]
        public async Task Only_a_Super_Admin_can_add_people_from_the_directory()
        {
            var response = await (await As("test.hou")).PostAsJsonAsync("/api/directory/users/ensure", new { samAccountName = "new.person" });
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }

        [Fact]
        public void Search_text_cannot_change_the_LDAP_filter()
        {
            const string attack = "a*)(cn=*";
            var escaped = DirectoryService.EscapeLdapFilterValue(attack);

            // Every LDAP special character in the search text is escaped, so it can only ever be searched for, never obeyed
            Assert.Equal("a\\2a\\29\\28cn=\\2a", escaped);
            Assert.DoesNotContain("(", escaped);
            Assert.DoesNotContain(")", escaped);
            Assert.DoesNotContain("*", escaped);
            Assert.Contains("(displayName=*" + escaped + "*)", DirectoryService.BuildFilter(attack));
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
function Restore-All {
    foreach ($full in $backup.Keys) {
        if ($null -eq $backup[$full]) { if (Test-Path $full) { Remove-Item $full -Force } }
        else { [System.IO.File]::WriteAllText($full, $backup[$full], $utf8) }
    }
}

Push-Location $root
try {
    Write-Host ("1/2 Writing {0} source and test files..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }

    Write-Host '2/2 Building and running all tests (LocalDB; takes a minute)...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) {
        $t | Where-Object { $_ -match 'Error Message|Assert|Exception' } | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
        throw 'Tests failed.'
    }

    Write-Host ''
    Write-Host 'Done. Step 1d is in place: Step 1 (People Hub plumbing) is complete.' -ForegroundColor Green
    Write-Host 'Try it in Swagger as test.superadmin: GET /api/admin/users, then POST /api/admin/users/{id}/roles.'
    Write-Host 'Staff search needs the Service Desk AD settings (set-secrets.ps1 -LdapOnly); until then it answers 503.'
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
