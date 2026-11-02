# Step 1e - API contract clean-up (the FE-0 "Questions for the backend").
#   - One error shape everywhere: ApiError { message, errors: { field } }, including the automatic "invalid request" answers
#   - Every endpoint declares its responses, so swagger.json has a schema for each (204 for "mark read")
#   - firstName and lastName on GET /api/auth/me
#   - The health check names the platform: "Access Desk" (no department, rule 14)
#   - Tests for all of the above (one fails if any endpoint lacks a response schema)
# No database change. Run from C:\Users\<you>\Desktop\PRO\AccessServiceDesk\Backend\ServiceDesk with the API stopped:
#   .\Scripts\step1e-api-contract.ps1
# On any failure, every file is put back as it was.

$ErrorActionPreference = 'Stop'
$here = (Get-Location).Path
$root = $null
foreach ($candidate in @($here, (Join-Path $here 'ServiceDeskAPI'))) {
    if ((Test-Path (Join-Path $candidate 'ServiceDeskAPI\ServiceDeskAPI.csproj')) -and (Test-Path (Join-Path $candidate 'tests\ServiceDeskAPI.Tests'))) { $root = $candidate; break }
}
if (-not $root) { Write-Host 'Run this from ...\AccessServiceDesk\Backend\ServiceDesk (the folder that contains ServiceDeskAPI, Scripts and docs).' -ForegroundColor Red; return }
Write-Host "  Solution root: $root"

$api = Join-Path $root 'ServiceDeskAPI'
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Get-NormHash([string]$path) {
    $t = [System.IO.File]::ReadAllText($path).Replace("`r`n", "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($t)))).Replace('-', '').ToLowerInvariant()
}

if (Test-Path (Join-Path $api 'Infrastructure\Api\ApiErrors.cs')) { Write-Host 'ApiErrors.cs already exists: Step 1e looks applied. Nothing changed.' -ForegroundColor Yellow; return }
$healthPath = Join-Path $api 'Controllers\HealthController.cs'
if (-not (Test-Path $healthPath) -or -not ([System.IO.File]::ReadAllText($healthPath)).Contains('class HealthController')) { Write-Host 'HealthController.cs is not the Step 0 version. Send me the file.' -ForegroundColor Red; return }

$expected = [ordered]@{
    'ServiceDeskAPI\Controllers\AuthController.cs' = '603813c9bbb25dd44023d202f7e099dff521fe58d0f92d34f794d5e707a0b3c3'
    'ServiceDeskAPI\Controllers\NotificationsController.cs' = '750cdc1e5d12733cbb13b76aaf706ca3349b4bc7a673765769898066cca589c0'
    'ServiceDeskAPI\Controllers\AdminEmailController.cs' = '541c76a0a1a8ea02f0be0a68e848e24735371e0645bb7be6ce374a8c77ae23fb'
    'ServiceDeskAPI\Controllers\AdminUsersController.cs' = '82af06b76dbd3cb61c65e2366d2f3c5d50dc976db63b8017782e1cce07d87d1b'
    'ServiceDeskAPI\Controllers\DirectoryController.cs' = 'c2e4e1853abd5384f0a7afb66a770ddc3584fe7c448dfc4b5bc99a2a26f6736e'
    'ServiceDeskAPI\Application\DTOs\AuthDTOs.cs' = 'f420227307fb3dd0baa1c8efcd3860c86dd6c9a6597305960b7765e6e76228eb'
    'ServiceDeskAPI\Application\DTOs\ApiResponse.cs' = '23711cb4f08495945d657e8770795aa7a8fc8e887acd6681e262b3c844b78d66'
    'ServiceDeskAPI\Infrastructure\Identity\AuthService.cs' = '92388792c0e779c0667922cfcd89c70dfad8395773611e999c4fde66ae986cc2'
    'ServiceDeskAPI\Program.cs' = '8e49656855afa4dd59180fd6f4a7b04a3bb51cb91034eb05ed564b097408036e'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed after Step 1d, so Step 1e stopped to avoid overwriting your changes:' -ForegroundColor Red
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
            // [ApiController] "invalid request" answers use the one error shape { message, errors: { field } } (agent rule 6)
            builder.Services.AddControllers()
                .ConfigureApiBehaviorOptions(options => options.InvalidModelStateResponseFactory = ServiceDeskAPI.Infrastructure.Api.ApiErrors.ValidationResponse);
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
$files['ServiceDeskAPI\Application\DTOs\ApiContractDTOs.cs'] = @'
namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>
    /// The one error shape (agent rule 6): { message, errors: { field: "what is wrong" } }. errors is empty when no single field is to blame.
    /// </summary>
    public class ApiError
    {
        public string Message { get; set; } = string.Empty;
        public Dictionary<string, string> Errors { get; set; } = new();

        public ApiError() { }
        public ApiError(string message) => Message = message;
        public ApiError(string message, string field, string fieldMessage)
        {
            Message = message;
            Errors[field] = fieldMessage;
        }
    }

    /// <summary>A plain success message, for actions that return nothing else.</summary>
    public record MessageDto(string Message);

    public record HealthDto(string Status, string App);

    public record UnreadCountDto(int Count);

    public record MarkedDto(int Marked);

    public record EmailTestResultDto(bool Success, string Message);

    public record InfobipStatusDto(string? BaseUrl, string? SenderEmail, string? SenderName, bool ApiKeyConfigured);

    public record SmtpStatusDto(string? Host, string? Port, string? SenderEmail, bool SignsIn);

    /// <summary>GET api/admin/email/status. Never contains a key or password.</summary>
    public record EmailStatusDto(string Provider, InfobipStatusDto Infobip, SmtpStatusDto Smtp, bool NotificationEmails, bool Ready);
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
        /// <summary>Field errors, same shape as ApiError: { field: "what is wrong" }. Empty when none.</summary>
        public Dictionary<string, string> Errors { get; set; } = new();
    }

    /// <summary>Response wrapper with a typed payload, as in People Hub.</summary>
    public class ApiResponse<T>
    {
        public int StatusCode { get; set; }
        public string Message { get; set; } = string.Empty;
        public T? Data { get; set; }
        /// <summary>Field errors, same shape as ApiError: { field: "what is wrong" }. Empty when none.</summary>
        public Dictionary<string, string> Errors { get; set; } = new();
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
        /// <summary>First word of the full name (AD display name), for greetings such as "Welcome, Amaka".</summary>
        public string? FirstName { get; set; }
        /// <summary>The rest of the full name.</summary>
        public string? LastName { get; set; }
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
$files['ServiceDeskAPI\Controllers\AdminEmailController.cs'] = @'
using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    public class SendTestEmailRequest
    {
        /// <summary>Where to send the test message.</summary>
        public string To { get; set; } = string.Empty;
    }

    /// <summary>Super Admin checks that email is set up: which provider is on, and a test message (copied from People Hub).</summary>
    [ApiController]
    [Route("api/admin/email")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminEmailController : ControllerBase
    {
        private readonly IEmailService _email;
        private readonly IConfiguration _configuration;
        private readonly IAuditService _audit;

        public AdminEmailController(IEmailService email, IConfiguration configuration, IAuditService audit)
        {
            _email = email;
            _configuration = configuration;
            _audit = audit;
        }

        /// <summary>Which provider is on and whether it has what it needs. Never returns a key or password.</summary>
        [HttpGet("status")]
        [ProducesResponseType(typeof(EmailStatusDto), StatusCodes.Status200OK)]
        public ActionResult<EmailStatusDto> Status()
        {
            var provider = EmailSetup.Provider(_configuration);
            var infobip = _configuration.GetSection("EmailSettings:Infobip");
            var smtp = _configuration.GetSection("EmailSettings:Smtp");
            var keySet = InfobipEmailService.ApiKey(_configuration).Length > 0;
            var infobipReady = keySet && !string.IsNullOrWhiteSpace(infobip["BaseUrl"]) && !string.IsNullOrWhiteSpace(infobip["SenderEmail"]);
            var smtpReady = !string.IsNullOrWhiteSpace(smtp["Host"]) && !string.IsNullOrWhiteSpace(smtp["SenderEmail"]);
            return Ok(new EmailStatusDto(
                provider,
                new InfobipStatusDto(infobip["BaseUrl"], infobip["SenderEmail"], infobip["SenderName"], keySet),
                new SmtpStatusDto(smtp["Host"], smtp["Port"], smtp["SenderEmail"], !string.IsNullOrWhiteSpace(smtp["Username"])),
                !string.Equals(_configuration["EmailSettings:Notifications:Enabled"], "false", StringComparison.OrdinalIgnoreCase),
                provider switch { "Infobip" => infobipReady, "Smtp" => smtpReady, _ => false }));
        }

        /// <summary>Sends one test message. Always answers 200 with success and a message, so the page can show it.</summary>
        [HttpPost("test")]
        [ProducesResponseType(typeof(EmailTestResultDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<EmailTestResultDto>> Test([FromBody] SendTestEmailRequest request)
        {
            var to = (request?.To ?? string.Empty).Trim();
            if (to.Length == 0 || !MailAddress.TryCreate(to, out _))
                return BadRequest(new ApiError("Enter a valid email address.", "to", "Enter a valid email address."));

            var actor = AuditActor.From(HttpContext);
            var parts = EmailTemplates.Test(actor.DisplayName ?? "a Super Admin");
            var (success, message) = await _email.SendEmailAsync(to, parts.Subject, parts.Html);

            await _audit.LogAsync(actor.UserId, actor.DisplayName, AuditAction.Created, "TestEmail", Guid.NewGuid(), to,
                null, "{\"success\":" + (success ? "true" : "false") + "}", actor.IpAddress, actor.UserAgent, AuditModule.Notifications);
            return Ok(new EmailTestResultDto(success, message));
        }
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
    /// A person can hold several roles; giving and removing are separate calls. Errors use ApiError { message, errors }.
    /// </summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminUsersController : ControllerBase
    {
        private readonly IAdminUserService _service;

        public AdminUsersController(IAdminUserService service) => _service = service;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private ActionResult<MessageDto> From(AdminResult result) =>
            result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>People, with every active role. Search matches login name, name, email or department; role filters by role name.</summary>
        [HttpGet("users")]
        [ProducesResponseType(typeof(PagedResult<AdminUserDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<PagedResult<AdminUserDto>>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20,
            [FromQuery] string? search = null, [FromQuery] string? role = null)
            => Ok(await _service.ListUsersAsync(page, pageSize, search, role));

        [HttpGet("users/{userId:guid}")]
        [ProducesResponseType(typeof(AdminUserDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<AdminUserDto>> Get(Guid userId)
        {
            var user = await _service.GetUserAsync(userId);
            return user == null ? NotFound(new ApiError("Person not found.")) : Ok(user);
        }

        /// <summary>The five roles with their ids, for the role picker.</summary>
        [HttpGet("roles")]
        [ProducesResponseType(typeof(List<RoleItemDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<RoleItemDto>>> Roles() => Ok(await _service.ListRolesAsync());

        /// <summary>Gives a role. 409 when the person already holds it.</summary>
        [HttpPost("users/{userId:guid}/roles")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> AssignRole(Guid userId, [FromBody] AssignRoleRequest request)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            if (request.RoleId == Guid.Empty)
                return BadRequest(new ApiError("Choose a role.", "roleId", "Choose a role."));
            return From(await _service.AssignRoleAsync(userId, request.RoleId, actor));
        }

        /// <summary>Takes a role away. The assignment is kept as history. 400 for Requester and for the last Super Admin.</summary>
        [HttpDelete("users/{userId:guid}/roles/{roleId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> RemoveRole(Guid userId, Guid roleId)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            return From(await _service.RemoveRoleAsync(userId, roleId, actor));
        }

        /// <summary>Lets a person sign in (true) or blocks them and ends their sessions (false).</summary>
        [HttpPatch("users/{userId:guid}/status")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetStatus(Guid userId, [FromBody] UpdateUserStatusRequest request)
        {
            if (Actor() is not Guid actor) return Unauthorized();
            return From(await _service.SetStatusAsync(userId, request.IsActive, actor));
        }
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
    [Produces("application/json")]
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
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status429TooManyRequests)]
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
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiResponse<LoginResponse>), StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status429TooManyRequests)]
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
        [ProducesResponseType(typeof(ApiResponse<UserProfileDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        [ProducesResponseType(typeof(ApiResponse<UserProfileDto>), StatusCodes.Status404NotFound)]
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
        [ProducesResponseType(typeof(ApiResponse<string>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
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
        [ProducesResponseType(typeof(ApiResponse), StatusCodes.Status200OK)]
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
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
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
        [ProducesResponseType(typeof(List<DirectoryUserDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status503ServiceUnavailable)]
        public async Task<ActionResult<List<DirectoryUserDto>>> Search([FromQuery] string? query)
        {
            var text = (query ?? string.Empty).Trim();
            if (text.Length == 0)
                return BadRequest(new ApiError("Type a name, login name or email to search.", "query", "Required."));
            if (text.Length > 256)
                return BadRequest(new ApiError("The search text must not exceed 256 characters.", "query", "Too long."));

            try
            {
                return Ok(await _directory.SearchUsersAsync(text));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Directory search failed for {User}", User.Identity?.Name);
                return StatusCode(503, new ApiError("The staff directory could not be searched right now. Try again, and tell ICT if it keeps happening."));
            }
        }

        /// <summary>Makes a local account (Requester) for someone found in the search, so roles can be given before they first sign in.</summary>
        [HttpPost("users/ensure")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(ProvisionedUserDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<ProvisionedUserDto>> Ensure([FromBody] EnsureUserRequest request)
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var actor)) return Unauthorized();
            var (result, user) = await _admin.EnsureFromDirectoryAsync(request.SamAccountName, actor);
            if (!result.Success || user == null) return StatusCode(result.Status, new ApiError(result.Message));
            return Ok(user);
        }
    }
}
'@
$files['ServiceDeskAPI\Controllers\HealthController.cs'] = @'
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Controllers;

/// <summary>Liveness check. Replaced by the full health checks in a later step.</summary>
[ApiController]
[Route("api/health")]
[Produces("application/json")]
public class HealthController : ControllerBase
{
    [HttpGet]
    [ProducesResponseType(typeof(HealthDto), StatusCodes.Status200OK)]
    public IActionResult Get() => Ok(new HealthDto("ok", "Access Desk"));
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
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class NotificationsController : ControllerBase
    {
        private readonly IInAppNotificationService _service;

        public NotificationsController(IInAppNotificationService service) => _service = service;

        private Guid? CurrentUser() =>
            Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        [HttpGet]
        [ProducesResponseType(typeof(InAppNotificationListDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<InAppNotificationListDto>> List(
            [FromQuery] int page = 1, [FromQuery] int pageSize = 20, [FromQuery] bool unreadOnly = false)
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(await _service.ListAsync(userId, page, pageSize, unreadOnly));
        }

        [HttpGet("unread-count")]
        [ProducesResponseType(typeof(UnreadCountDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<UnreadCountDto>> UnreadCount()
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(new UnreadCountDto(await _service.UnreadCountAsync(userId)));
        }

        /// <summary>Marks one of your notifications read. 204 on success; 404 when it is not yours or does not exist.</summary>
        [HttpPatch("{id:guid}/read")]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<IActionResult> MarkRead(Guid id)
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return await _service.MarkReadAsync(userId, id) ? NoContent() : NotFound(new ApiError("Notification not found."));
        }

        [HttpPatch("read-all")]
        [ProducesResponseType(typeof(MarkedDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MarkedDto>> MarkAllRead()
        {
            if (CurrentUser() is not Guid userId) return Unauthorized();
            return Ok(new MarkedDto(await _service.MarkAllReadAsync(userId)));
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Api\ApiErrors.cs'] = @'
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Api
{
    /// <summary>
    /// Turns the automatic "invalid request" answer of [ApiController] into the one error shape:
    /// { message, errors: { field: "what is wrong" } }, with field names as the web app sends them (camelCase).
    /// </summary>
    public static class ApiErrors
    {
        public const string ValidationMessage = "Some details are missing or not valid. Check the highlighted fields.";

        public static IActionResult ValidationResponse(ActionContext context)
        {
            var error = new ApiError(ValidationMessage);
            foreach (var (key, entry) in context.ModelState)
            {
                if (entry.Errors.Count == 0) continue;
                var field = FieldName(key);
                if (error.Errors.ContainsKey(field)) continue;
                var first = entry.Errors[0];
                error.Errors[field] = !string.IsNullOrWhiteSpace(first.ErrorMessage) ? first.ErrorMessage : "This value is not valid.";
            }
            return new BadRequestObjectResult(error) { ContentTypes = { "application/json" } };
        }

        /// <summary>"Username" -> "username", "$.roleId" -> "roleId", "Items[0].Name" -> "items[0].name", "" or "$" -> "body".</summary>
        public static string FieldName(string key)
        {
            var k = (key ?? string.Empty).Trim();
            if (k.StartsWith("$.")) k = k.Substring(2);
            if (k.Length == 0 || k == "$") return "body";
            var parts = k.Split('.');
            for (var i = 0; i < parts.Length; i++)
                if (parts[i].Length > 0) parts[i] = char.ToLowerInvariant(parts[i][0]) + parts[i].Substring(1);
            return string.Join('.', parts);
        }
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
'@
$files['tests\ServiceDeskAPI.Tests\Api\ApiContractTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using ServiceDeskAPI.Infrastructure.Api;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Api
{
    /// <summary>Step 1e: the API contract the web app relies on (answers to the FE-0 backend questions).</summary>
    public class ApiContractTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public ApiContractTests(ServiceDeskApiFactory factory) => _factory = factory;

        [Fact]
        public async Task An_invalid_request_uses_the_one_error_shape()
        {
            var response = await ApiTestHelpers.Client(_factory).PostAsJsonAsync("/api/auth/login", new { });
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(ApiErrors.ValidationMessage, body.GetProperty("message").GetString());
            var errors = body.GetProperty("errors");
            Assert.Equal(JsonValueKind.Object, errors.ValueKind);
            Assert.True(errors.TryGetProperty("username", out _));
            Assert.True(errors.TryGetProperty("password", out _));
        }

        [Fact]
        public async Task A_business_error_uses_the_same_shape()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.superadmin");
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var response = await client.GetAsync($"/api/admin/users/{Guid.NewGuid()}");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();

            Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
            Assert.False(string.IsNullOrEmpty(body.GetProperty("message").GetString()));
            Assert.Equal(JsonValueKind.Object, body.GetProperty("errors").ValueKind);
        }

        [Fact]
        public async Task Me_has_first_and_last_name()
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, "test.hod");
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);

            var me = (await client.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("data");

            Assert.Equal("Test", me.GetProperty("firstName").GetString());
            Assert.Equal("Head of Department", me.GetProperty("lastName").GetString());
        }

        [Fact]
        public async Task The_health_check_names_the_platform_not_a_department()
        {
            var body = await ApiTestHelpers.Client(_factory).GetFromJsonAsync<JsonElement>("/api/health");
            Assert.Equal("Access Desk", body.GetProperty("app").GetString());
        }

        [Fact]
        public async Task Swagger_describes_every_success_response()
        {
            var doc = await ApiTestHelpers.Client(_factory).GetFromJsonAsync<JsonElement>("/swagger/v1/swagger.json");
            var problems = new List<string>();

            foreach (var path in doc.GetProperty("paths").EnumerateObject())
            foreach (var operation in path.Value.EnumerateObject())
            {
                var name = operation.Name.ToUpperInvariant() + " " + path.Name;
                var responses = operation.Value.GetProperty("responses");
                var successes = responses.EnumerateObject().Where(r => r.Name.StartsWith("2")).ToList();
                if (successes.Count == 0) { problems.Add(name + ": no success response"); continue; }
                foreach (var success in successes.Where(s => s.Name != "204"))
                    if (!success.Value.TryGetProperty("content", out _))
                        problems.Add(name + ": " + success.Name + " has no schema");
            }

            Assert.True(problems.Count == 0, string.Join("\n", problems));

            var markRead = doc.GetProperty("paths").GetProperty("/api/notifications/{id}/read").GetProperty("patch").GetProperty("responses");
            Assert.True(markRead.TryGetProperty("204", out _));
            Assert.False(markRead.TryGetProperty("200", out _));
        }
    }
}
'@

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

try {
    Write-Host ("1/2 Writing {0} files..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }

    Write-Host '2/2 Building and running all tests...'
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $b = & dotnet build $sln -nologo -v q 2>&1 | ForEach-Object { "$_" }; $buildExit = $LASTEXITCODE
    $t = if ($buildExit -eq 0) { & dotnet test $sln --no-build -nologo 2>&1 | ForEach-Object { "$_" } } else { @() }; $testExit = $LASTEXITCODE
    $ErrorActionPreference = $old
    if ($buildExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($testExit -ne 0) { $t | Where-Object { $_ -match 'Error Message|Assert|no schema|no success' } | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Tests failed.' }

    Write-Host ''
    Write-Host 'Done. Step 1e is in place. Start the API, then ask the frontend agent to refresh docs/swagger.json and run npm run check.' -ForegroundColor Green
}
catch {
    Write-Host ('FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    Restore-All
    Write-Host 'Every file was put back as it was. Send me the lines above.' -ForegroundColor Yellow
    exit 1
}
