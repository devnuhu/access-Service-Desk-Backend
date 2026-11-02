# Step 2b - Availability: leave and out of office (BRD 5.3), who is available today, unit views for Heads of Unit and the HOD.
#
# What it adds:
#   - Absences (leave / out of office, whole office days in Lagos time); a person is available when their account is active and they are not away today
#   - Who may record or cancel: the person (when in a unit or an HOD); the unit head or deputy for their unit; the HOD for their department; Super Admin for anyone
#   - api/availability/me, POST api/availability/absences, DELETE api/availability/absences/{id},
#     api/availability/units/{unitId} (head, deputy, HOD, Super Admin), api/availability/departments/{id} (HOD, Super Admin)
#   - Development: test.hou2 heads Refund; test.caseworker3 joins Contribution Matching and test.caseworker4 Refund (two case workers per unit)
#   - Swagger title "Access Desk API"; leave dates shown as yyyy-MM-dd
#   - Migration Availability, and tests
# Moving a person's tickets when they go on leave comes with the assignment engine (Step 4).
#
# Run from ...\AccessServiceDesk\Backend\ServiceDesk with the API stopped:
#   .\Scripts\step2b-availability.ps1
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
if (-not (Test-Path (Join-Path $api 'Infrastructure\Api\ApiErrors.cs'))) { Write-Host 'Step 1e is not in place. Run step1e-api-contract.ps1 first.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $api 'Domain\Entities\Organisation.cs'))) { Write-Host 'Step 2a is not in place. Run step2a-organisation.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Domain\Entities\Absence.cs')) { Write-Host 'Absence.cs already exists: Step 2b looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as the earlier step scripts wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = '065a36b4c1f2025c7cfa5d626792e6cd5092628b2f9494077fa42274a7b7de09'
    'ServiceDeskAPI\Infrastructure\Services\TestAccountSeeder.cs' = '37f0c7ec662d7a50135e6796ccfe5b934932d50798903ed29282fff65c6e6294'
    'ServiceDeskAPI\Program.cs' = 'cee49e4c95b2f6c0a14d132dea71c1a7b2238e5eeb94bff661ba2cb95c23e21f'
    'tests\ServiceDeskAPI.Tests\Admin\AdminUsersTests.cs' = 'd472e35c993a3021d2c29c97ffdc86a883e3c5451b55b9ad78589ee6bdb78a6e'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed since they were last written by a step script, so Step 2b stopped to avoid overwriting your changes:' -ForegroundColor Red
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
                options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "Access Desk API", Version = "v1" });
                // Dates without a time (leave days) are plain "yyyy-MM-dd" strings
                options.MapType<DateOnly>(() => new Microsoft.OpenApi.Models.OpenApiSchema { Type = "string", Format = "date" });
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
            builder.Services.AddScoped<IOrganisationService, ServiceDeskAPI.Infrastructure.Organisation.OrganisationService>();
            builder.Services.AddScoped<IAvailabilityService, ServiceDeskAPI.Infrastructure.Organisation.AvailabilityService>();
            builder.Services.AddSingleton(TimeProvider.System);
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
$files['ServiceDeskAPI\Application\DTOs\AvailabilityDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One leave or out-of-office period. Dates are office days in Lagos time, start and end included.</summary>
    public class AbsenceDto
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public AbsenceKind Kind { get; set; }
        public DateOnly StartDate { get; set; }
        public DateOnly EndDate { get; set; }
        public string? Note { get; set; }
        public string? RecordedBy { get; set; }
        public DateTime RecordedAt { get; set; }
    }

    /// <summary>Leave or out of office for yourself (userId left out) or, for a Head of Unit, HOD or Super Admin, for someone else.</summary>
    public class CreateAbsenceRequest
    {
        public Guid? UserId { get; set; }
        /// <summary>1 = Leave, 2 = Out of office.</summary>
        public AbsenceKind Kind { get; set; } = AbsenceKind.Leave;
        public DateOnly? StartDate { get; set; }
        public DateOnly? EndDate { get; set; }
        public string? Note { get; set; }
    }

    /// <summary>The signed-in person's availability.</summary>
    public class MyAvailabilityDto
    {
        /// <summary>Today's office date (Lagos).</summary>
        public DateOnly Today { get; set; }
        /// <summary>True when the person works tickets in a unit, heads one or is an HOD (the people availability matters for).</summary>
        public bool InStructure { get; set; }
        public bool AvailableNow { get; set; }
        public AbsenceDto? Current { get; set; }
        /// <summary>Current and future periods, earliest first.</summary>
        public List<AbsenceDto> Absences { get; set; } = new();
    }

    public class MemberAvailabilityDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public StaffCategory StaffCategory { get; set; }
        public bool IsHead { get; set; }
        public bool IsDeputy { get; set; }
        public bool AccountActive { get; set; }
        /// <summary>Active account and not away today: can be given new tickets.</summary>
        public bool AvailableNow { get; set; }
        public AbsenceDto? Current { get; set; }
        /// <summary>Periods starting after today (next 90 days), earliest first.</summary>
        public List<AbsenceDto> Upcoming { get; set; } = new();
    }

    /// <summary>A unit's people and who is available today (Head of Unit, deputy, HOD of the department, Super Admin).</summary>
    public class UnitAvailabilityDto
    {
        public Guid UnitId { get; set; }
        public Guid DepartmentId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public DateOnly Today { get; set; }
        public int MemberCount { get; set; }
        public int AvailableCount { get; set; }
        public List<MemberAvailabilityDto> Members { get; set; } = new();
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IAvailabilityService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Leave and out of office (BRD 5.3). A person is available when their account is active and they are not away today (Lagos office date).
    /// Who may record or cancel: the person themselves (when they are in the structure); the Head of Unit or deputy for members of their unit;
    /// the HOD for anyone in their department's units; a Super Admin for anyone. Moving tickets off someone going on leave comes with
    /// the assignment engine (Step 4), which uses AvailableMemberIdsAsync.
    /// </summary>
    public interface IAvailabilityService
    {
        /// <summary>Today's office date (Africa/Lagos, UTC+1, no daylight saving).</summary>
        DateOnly Today();

        Task<MyAvailabilityDto> GetMineAsync(Guid userId);
        Task<(AdminResult Result, AbsenceDto? Absence)> CreateAsync(CreateAbsenceRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        /// <summary>Cancels a future period, or ends a current one early (it then ends yesterday).</summary>
        Task<AdminResult> CancelAsync(Guid absenceId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(AdminResult Result, UnitAvailabilityDto? Unit)> GetUnitAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(AdminResult Result, List<UnitAvailabilityDto>? Units)> GetDepartmentAsync(Guid departmentId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<bool> IsAvailableAsync(Guid userId);
        /// <summary>Active members of the unit with an active account and no absence today (for automatic assignment).</summary>
        Task<List<Guid>> AvailableMemberIdsAsync(Guid unitId);
    }
}
'@
$files['ServiceDeskAPI\Controllers\AvailabilityController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Leave and out of office (BRD 5.3). Any signed-in person can call these; who may act for whom is checked against the
    /// organisation in the service (yourself; Head of Unit or deputy for their unit; HOD for their department; Super Admin for anyone).
    /// </summary>
    [ApiController]
    [Route("api/availability")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class AvailabilityController : ControllerBase
    {
        private readonly IAvailabilityService _availability;

        public AvailabilityController(IAvailabilityService availability) => _availability = availability;

        private Guid? Me() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Error(AdminResult result) => StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>My availability today and my current and future leave.</summary>
        [HttpGet("me")]
        [ProducesResponseType(typeof(MyAvailabilityDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MyAvailabilityDto>> Mine()
        {
            var me = Me();
            if (me == null) return Unauthorized();
            return Ok(await _availability.GetMineAsync(me.Value));
        }

        /// <summary>Records leave or out of office: for yourself (leave userId out), or for someone you manage.</summary>
        [HttpPost("absences")]
        [ProducesResponseType(typeof(AbsenceDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<AbsenceDto>> Create([FromBody] CreateAbsenceRequest request)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            if (!request.StartDate.HasValue) return BadRequest(new ApiError("Choose the start date.", "startDate", "Choose the start date."));
            if (!request.EndDate.HasValue) return BadRequest(new ApiError("Choose the end date.", "endDate", "Choose the end date."));
            if (request.EndDate < request.StartDate)
                return BadRequest(new ApiError("The end date must be on or after the start date.", "endDate", "Must be on or after the start date."));

            var (result, absence) = await _availability.CreateAsync(request, me.Value, IsSuperAdmin());
            return result.Success && absence != null ? Ok(absence) : Error(result);
        }

        /// <summary>Cancels a future period, or ends a current one early (it then ends yesterday).</summary>
        [HttpDelete("absences/{absenceId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Cancel(Guid absenceId)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            var result = await _availability.CancelAsync(absenceId, me.Value, IsSuperAdmin());
            return result.Success ? Ok(new MessageDto(result.Message)) : Error(result);
        }

        /// <summary>A unit's people, who is available today and their leave in the next 90 days (unit head or deputy, HOD, Super Admin).</summary>
        [HttpGet("units/{unitId:guid}")]
        [ProducesResponseType(typeof(UnitAvailabilityDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<UnitAvailabilityDto>> UnitView(Guid unitId)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            var (result, unit) = await _availability.GetUnitAsync(unitId, me.Value, IsSuperAdmin());
            return result.Success && unit != null ? Ok(unit) : Error(result);
        }

        /// <summary>Every active unit of a department (HOD, Super Admin).</summary>
        [HttpGet("departments/{departmentId:guid}")]
        [ProducesResponseType(typeof(List<UnitAvailabilityDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<UnitAvailabilityDto>>> DepartmentView(Guid departmentId)
        {
            var me = Me();
            if (me == null) return Unauthorized();
            var (result, units) = await _availability.GetDepartmentAsync(departmentId, me.Value, IsSuperAdmin());
            return result.Success && units != null ? Ok(units) : Error(result);
        }
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\Absence.cs'] = @'
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Domain.Organisation
{
    /// <summary>Why a person is away. Both make them unavailable for automatic assignment (BRD 5.3).</summary>
    public enum AbsenceKind
    {
        Leave = 1,
        OutOfOffice = 2
    }
}

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A period a person is away (leave or out of office), whole office days in Lagos time, start and end included.
    /// Cancelling keeps the row (IsCancelled) as history; ending early moves EndDate back to yesterday.
    /// </summary>
    public class Absence
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public AbsenceKind Kind { get; set; } = AbsenceKind.Leave;
        public DateOnly StartDate { get; set; }
        public DateOnly EndDate { get; set; }
        /// <summary>Optional short note (for example "Annual leave"). Never customer data.</summary>
        public string? Note { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
        public bool IsCancelled { get; set; }
        public DateTime? CancelledAt { get; set; }
        public Guid? CancelledByUserId { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Organisation\AvailabilityService.cs'] = @'
using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Leave and out of office (BRD 5.3). Rules:
    /// - whole office days in Lagos time, start and end included; a period may start up to 30 days back and last at most 366 days;
    /// - one person's periods never overlap; a period that has ended cannot be added or changed;
    /// - the person records their own (when they are in the structure); the Head of Unit or deputy for their unit's members;
    ///   the HOD for members of their department's units; a Super Admin for anyone;
    /// - recording or cancelling someone else's period tells them; the heads of the person's units are told either way.
    /// Authorisation is checked against the structure in the database, not the roles in the token, so it is right straight after a change.
    /// </summary>
    public class AvailabilityService : IAvailabilityService
    {
        /// <summary>Lagos is UTC+1 all year (no daylight saving).</summary>
        private static readonly TimeSpan OfficeOffset = TimeSpan.FromHours(1);
        private const int MaxDaysBack = 30;
        private const int MaxLengthDays = 366;
        private const int UpcomingDays = 90;

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly TimeProvider _time;

        public AvailabilityService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, TimeProvider time)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _time = time;
        }

        public DateOnly Today() => DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime + OfficeOffset);

        // ---------------- reading ----------------

        public async Task<MyAvailabilityDto> GetMineAsync(Guid userId)
        {
            var today = Today();
            var accountActive = await _db.Users.Where(u => u.Id == userId).Select(u => u.IsActive).FirstOrDefaultAsync();
            var absences = await ToDtosAsync(await _db.Absences.AsNoTracking()
                .Where(a => a.UserId == userId && !a.IsCancelled && a.EndDate >= today)
                .OrderBy(a => a.StartDate)
                .ToListAsync());
            var current = absences.FirstOrDefault(a => a.StartDate <= today);
            return new MyAvailabilityDto
            {
                Today = today,
                InStructure = await InStructureAsync(userId),
                AvailableNow = accountActive && current == null,
                Current = current,
                Absences = absences
            };
        }

        public async Task<(AdminResult Result, UnitAvailabilityDto? Unit)> GetUnitAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var unit = await _db.Units.AsNoTracking().Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return (AdminResult.NotFound("Unit not found."), null);
            var allowed = actorIsSuperAdmin || unit.HeadUserId == actorUserId || unit.DeputyHeadUserId == actorUserId || unit.Department!.HodUserId == actorUserId;
            if (!allowed) return (Forbidden("Only the unit's head or deputy, the Head of Department or a Super Admin can see this unit's availability."), null);
            return (AdminResult.Ok("OK"), await BuildUnitAsync(unit));
        }

        public async Task<(AdminResult Result, List<UnitAvailabilityDto>? Units)> GetDepartmentAsync(Guid departmentId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var department = await _db.Departments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return (AdminResult.NotFound("Department not found."), null);
            if (!actorIsSuperAdmin && department.HodUserId != actorUserId)
                return (Forbidden("Only the Head of Department or a Super Admin can see the whole department's availability."), null);

            var units = await _db.Units.AsNoTracking().Include(u => u.Department)
                .Where(u => u.DepartmentId == departmentId && u.IsActive)
                .OrderBy(u => u.Name)
                .ToListAsync();
            var result = new List<UnitAvailabilityDto>();
            foreach (var unit in units) result.Add(await BuildUnitAsync(unit));
            return (AdminResult.Ok("OK"), result);
        }

        public async Task<bool> IsAvailableAsync(Guid userId)
        {
            var today = Today();
            return await _db.Users.AnyAsync(u => u.Id == userId && u.IsActive)
                && !await _db.Absences.AnyAsync(a => a.UserId == userId && !a.IsCancelled && a.StartDate <= today && a.EndDate >= today);
        }

        public async Task<List<Guid>> AvailableMemberIdsAsync(Guid unitId)
        {
            var today = Today();
            return await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive && m.Unit!.IsActive && m.User!.IsActive
                    && !_db.Absences.Any(a => a.UserId == m.UserId && !a.IsCancelled && a.StartDate <= today && a.EndDate >= today))
                .Select(m => m.UserId)
                .ToListAsync();
        }

        // ---------------- recording ----------------

        public async Task<(AdminResult Result, AbsenceDto? Absence)> CreateAsync(CreateAbsenceRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var targetId = request.UserId ?? actorUserId;
            var forSelf = targetId == actorUserId;
            var target = await _db.Users.FirstOrDefaultAsync(u => u.Id == targetId);
            if (target == null) return (AdminResult.NotFound("Person not found."), null);

            if (!forSelf && !actorIsSuperAdmin && !await ManagesAsync(actorUserId, targetId))
                return (Forbidden("You can record leave only for people in the unit you head, or in your department's units if you are its Head of Department."), null);
            if (!await InStructureAsync(targetId))
                return (AdminResult.Invalid(forSelf
                    ? "Leave is recorded here only for people who work in a unit or head a department."
                    : Name(target) + " is not in any unit, so their leave does not affect ticket assignment."), null);

            if (!Enum.IsDefined(request.Kind)) return (AdminResult.Invalid("Choose Leave or Out of office."), null);
            if (!request.StartDate.HasValue || !request.EndDate.HasValue) return (AdminResult.Invalid("Choose the start and end dates."), null);
            var start = request.StartDate.Value;
            var end = request.EndDate.Value;
            var today = Today();
            if (end < start) return (AdminResult.Invalid("The end date must be on or after the start date."), null);
            if (end < today) return (AdminResult.Invalid("This period has already ended, so it does not affect availability."), null);
            if (start < today.AddDays(-MaxDaysBack)) return (AdminResult.Invalid("The start date can be at most " + MaxDaysBack + " days in the past."), null);
            if (end.DayNumber - start.DayNumber + 1 > MaxLengthDays) return (AdminResult.Invalid("A single period can be at most " + MaxLengthDays + " days."), null);
            var note = string.IsNullOrWhiteSpace(request.Note) ? null : EmailSafety.Redact(request.Note.Trim());
            if (note != null && note.Length > 200) return (AdminResult.Invalid("The note must be at most 200 characters."), null);

            var overlap = await _db.Absences
                .Where(a => a.UserId == targetId && !a.IsCancelled && a.StartDate <= end && a.EndDate >= start)
                .OrderBy(a => a.StartDate)
                .FirstOrDefaultAsync();
            if (overlap != null)
                return (AdminResult.Conflict("This overlaps " + KindText(overlap.Kind).ToLowerInvariant() + " from " + Day(overlap.StartDate) + " to " + Day(overlap.EndDate)
                    + ". Cancel that one first or choose other dates."), null);

            var absence = new Absence
            {
                Id = Guid.NewGuid(), UserId = targetId, Kind = request.Kind, StartDate = start, EndDate = end, Note = note,
                CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId
            };
            _db.Absences.Add(absence);
            Stage(AuditAction.Created, absence.Id, target.UserName, null, new { user = target.UserName, kind = absence.Kind.ToString(), start, end });

            var actorName = await NameOfAsync(actorUserId);
            var period = KindText(absence.Kind) + " from " + Day(start) + " to " + Day(end);
            if (!forSelf)
                _notifications.Stage(targetId, "Your availability was updated", actorName + " recorded " + period + " for you.",
                    NotificationType.Info, NotificationCategory.System, "Absence", absence.Id, "/availability");
            await TellHeadsAsync(targetId, actorUserId, Name(target) + ": " + period + ".", absence.Id);

            await _db.SaveChangesAsync();
            var dto = (await ToDtosAsync(new List<Absence> { absence })).Single();
            return (AdminResult.Ok(period + " recorded for " + Name(target) + "."), dto);
        }

        public async Task<AdminResult> CancelAsync(Guid absenceId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var absence = await _db.Absences.Include(a => a.User).FirstOrDefaultAsync(a => a.Id == absenceId && !a.IsCancelled);
            if (absence?.User == null) return AdminResult.NotFound("Leave not found.");
            var forSelf = absence.UserId == actorUserId;
            if (!forSelf && !actorIsSuperAdmin && !await ManagesAsync(actorUserId, absence.UserId))
                return Forbidden("You can change leave only for people in the unit you head, or in your department's units if you are its Head of Department.");

            var today = Today();
            if (absence.EndDate < today) return AdminResult.Invalid("This period has already ended.");

            var before = new { start = absence.StartDate, end = absence.EndDate };
            string message;
            if (absence.StartDate < today)
            {
                // Already started: it ends yesterday, so the days already taken stay on record
                absence.EndDate = today.AddDays(-1);
                absence.UpdatedAt = DateTime.UtcNow;
                absence.UpdatedByUserId = actorUserId;
                Stage(AuditAction.Updated, absence.Id, absence.User.UserName, before, new { start = absence.StartDate, end = absence.EndDate, endedEarly = true });
                message = KindText(absence.Kind) + " ended early; " + Name(absence.User) + " is available from today.";
            }
            else
            {
                absence.IsCancelled = true;
                absence.CancelledAt = DateTime.UtcNow;
                absence.CancelledByUserId = actorUserId;
                Stage(AuditAction.Cancelled, absence.Id, absence.User.UserName, before, null);
                message = KindText(absence.Kind) + " from " + Day(absence.StartDate) + " to " + Day(absence.EndDate) + " cancelled.";
            }

            if (!forSelf)
                _notifications.Stage(absence.UserId, "Your availability was updated", await NameOfAsync(actorUserId) + ": " + message,
                    NotificationType.Info, NotificationCategory.System, "Absence", absence.Id, "/availability");
            await TellHeadsAsync(absence.UserId, actorUserId, Name(absence.User) + ": " + message, absence.Id);

            await _db.SaveChangesAsync();
            return AdminResult.Ok(message);
        }

        // ---------------- helpers ----------------

        /// <summary>Works in an active unit (heads and deputies are members) or is HOD of an active department.</summary>
        private async Task<bool> InStructureAsync(Guid userId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.IsActive)
            || await _db.Departments.AnyAsync(d => d.HodUserId == userId && d.IsActive);

        /// <summary>True when the actor heads or deputises one of the person's units, or is HOD of that unit's department.</summary>
        private async Task<bool> ManagesAsync(Guid actorUserId, Guid targetUserId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == targetUserId && m.IsActive && m.Unit!.IsActive
                && (m.Unit.HeadUserId == actorUserId || m.Unit.DeputyHeadUserId == actorUserId || m.Unit.Department!.HodUserId == actorUserId));

        /// <summary>Tells the heads and deputies of the person's units (not the person, not the one making the change).</summary>
        private async Task TellHeadsAsync(Guid targetUserId, Guid actorUserId, string message, Guid absenceId)
        {
            var units = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UserId == targetUserId && m.IsActive && m.Unit!.IsActive)
                .Select(m => new { m.Unit!.Name, m.Unit.HeadUserId, m.Unit.DeputyHeadUserId })
                .ToListAsync();
            var told = new HashSet<Guid> { targetUserId, actorUserId };
            foreach (var unit in units)
            {
                foreach (var head in new[] { unit.HeadUserId, unit.DeputyHeadUserId })
                {
                    if (!head.HasValue || !told.Add(head.Value)) continue;
                    _notifications.Stage(head.Value, "Availability changed in " + unit.Name, message,
                        NotificationType.Info, NotificationCategory.System, "Absence", absenceId, "/availability");
                }
            }
        }

        private async Task<UnitAvailabilityDto> BuildUnitAsync(Unit unit)
        {
            var today = Today();
            var horizon = today.AddDays(UpcomingDays);
            var members = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unit.Id && m.IsActive)
                .Select(m => new { m.UserId, UserName = m.User!.UserName, m.User.FullName, m.StaffCategory, AccountActive = m.User.IsActive })
                .ToListAsync();
            var ids = members.Select(m => m.UserId).ToList();
            var absences = await ToDtosAsync(await _db.Absences.AsNoTracking()
                .Where(a => ids.Contains(a.UserId) && !a.IsCancelled && a.EndDate >= today && a.StartDate <= horizon)
                .OrderBy(a => a.StartDate)
                .ToListAsync());

            var rows = members.Select(m =>
            {
                var mine = absences.Where(a => a.UserId == m.UserId).ToList();
                var current = mine.FirstOrDefault(a => a.StartDate <= today);
                return new MemberAvailabilityDto
                {
                    UserId = m.UserId,
                    UserName = m.UserName ?? string.Empty,
                    FullName = m.FullName,
                    StaffCategory = m.StaffCategory,
                    IsHead = unit.HeadUserId == m.UserId,
                    IsDeputy = unit.DeputyHeadUserId == m.UserId,
                    AccountActive = m.AccountActive,
                    AvailableNow = m.AccountActive && current == null,
                    Current = current,
                    Upcoming = mine.Where(a => a.StartDate > today).ToList()
                };
            })
            .OrderByDescending(r => r.IsHead).ThenByDescending(r => r.IsDeputy).ThenBy(r => r.FullName ?? r.UserName)
            .ToList();

            return new UnitAvailabilityDto
            {
                UnitId = unit.Id,
                DepartmentId = unit.DepartmentId,
                Code = unit.Code,
                Name = unit.Name,
                Today = today,
                MemberCount = rows.Count,
                AvailableCount = rows.Count(r => r.AvailableNow),
                Members = rows
            };
        }

        private async Task<List<AbsenceDto>> ToDtosAsync(List<Absence> absences)
        {
            var recorderIds = absences.Where(a => a.CreatedByUserId.HasValue).Select(a => a.CreatedByUserId!.Value).Distinct().ToList();
            var names = recorderIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await _db.Users.AsNoTracking().Where(u => recorderIds.Contains(u.Id))
                    .Select(u => new { u.Id, Name = u.FullName ?? u.UserName ?? string.Empty })
                    .ToDictionaryAsync(u => u.Id, u => u.Name);
            return absences.Select(a => new AbsenceDto
            {
                Id = a.Id,
                UserId = a.UserId,
                Kind = a.Kind,
                StartDate = a.StartDate,
                EndDate = a.EndDate,
                Note = a.Note,
                RecordedBy = a.CreatedByUserId.HasValue && names.TryGetValue(a.CreatedByUserId.Value, out var n) ? n : null,
                RecordedAt = a.CreatedAt
            }).ToList();
        }

        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private void Stage(AuditAction action, Guid absenceId, string? display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Absence", absenceId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Units);
        }

        private static AdminResult Forbidden(string message) => new(403, message);

        private static string KindText(AbsenceKind kind) => kind == AbsenceKind.OutOfOffice ? "Out of office" : "Leave";

        private static string Day(DateOnly date) => date.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs'] = @'
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;

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
        public DbSet<Department> Departments => Set<Department>();
        public DbSet<Unit> Units => Set<Unit>();
        public DbSet<UnitMember> UnitMembers => Set<UnitMember>();
        public DbSet<Absence> Absences => Set<Absence>();

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
            ConfigureOrganisation(builder);
        }

        /// <summary>Departments, units and members (Step 2a). Contribution Processing and its two units are seeded.</summary>
        private static void ConfigureOrganisation(ModelBuilder builder)
        {
            builder.Entity<Department>(e =>
            {
                e.ToTable("Departments");
                e.HasKey(d => d.Id);
                e.Property(d => d.Code).HasMaxLength(10).IsRequired();
                e.Property(d => d.Name).HasMaxLength(100).IsRequired();
                e.HasIndex(d => d.Code).IsUnique();
                e.HasIndex(d => d.Name).IsUnique();
                e.HasOne(d => d.HodUser).WithMany().HasForeignKey(d => d.HodUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasData(new Department
                {
                    Id = OrgSeed.ContributionProcessingId,
                    Code = OrgSeed.ContributionProcessingCode,
                    Name = "Contribution Processing",
                    IsActive = true,
                    CreatedAt = SeedDate
                });
            });

            builder.Entity<Unit>(e =>
            {
                e.ToTable("Units");
                e.HasKey(u => u.Id);
                e.Property(u => u.Code).HasMaxLength(10).IsRequired();
                e.Property(u => u.Name).HasMaxLength(100).IsRequired();
                e.HasIndex(u => new { u.DepartmentId, u.Code }).IsUnique();
                e.HasIndex(u => new { u.DepartmentId, u.Name }).IsUnique();
                e.HasOne(u => u.Department).WithMany(d => d.Units).HasForeignKey(u => u.DepartmentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(u => u.HeadUser).WithMany().HasForeignKey(u => u.HeadUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(u => u.DeputyHeadUser).WithMany().HasForeignKey(u => u.DeputyHeadUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasData(
                    new Unit { Id = OrgSeed.ContributionMatchingUnitId, DepartmentId = OrgSeed.ContributionProcessingId, Code = OrgSeed.ContributionMatchingCode, Name = "Contribution Matching", IsActive = true, CreatedAt = SeedDate },
                    new Unit { Id = OrgSeed.RefundUnitId, DepartmentId = OrgSeed.ContributionProcessingId, Code = OrgSeed.RefundCode, Name = "Refund", IsActive = true, CreatedAt = SeedDate });
            });

            builder.Entity<UnitMember>(e =>
            {
                e.ToTable("UnitMembers");
                e.HasKey(m => m.Id);
                e.Property(m => m.StaffNo).HasMaxLength(30);
                e.HasOne(m => m.Unit).WithMany(u => u.Members).HasForeignKey(m => m.UnitId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(m => m.User).WithMany().HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);
                // Each person once per unit while active; one unit per department is checked by OrganisationService
                e.HasIndex(m => new { m.UnitId, m.UserId }).IsUnique().HasFilter("[IsActive] = 1").HasDatabaseName("IX_UnitMembers_UnitId_UserId_Active");
                e.HasIndex(m => m.UserId);
            });

            builder.Entity<Absence>(e =>
            {
                e.ToTable("Absences");
                e.HasKey(a => a.Id);
                e.Property(a => a.Note).HasMaxLength(200);
                e.HasOne(a => a.User).WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Restrict);
                // "Who is away today" and the overlap check both look up a person's periods by date
                e.HasIndex(a => new { a.UserId, a.StartDate, a.EndDate }).HasDatabaseName("IX_Absences_UserId_Dates");
            });
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
$files['ServiceDeskAPI\Infrastructure\Services\TestAccountSeeder.cs'] = @'
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Development-only test accounts that work next to Active Directory (copied from People Hub). Active only when the environment is
    /// Development, TestAccounts:Enabled is true and TestAccounts:Password is set (user secrets, via set-secrets.ps1).
    /// Creates local accounts with a local password and the listed roles, then places them in the organisation (Step 2a):
    /// test.hod is HOD of Contribution Processing; test.hou heads Contribution Matching with test.caseworker1 and test.caseworker3;
    /// test.hou2 heads Refund with test.caseworker2 and test.caseworker4 (Step 2b: two case workers per unit, so assignment can be tested).
    /// Their Case Worker / Head of Unit / HOD roles follow from that. Safe to run on every start.
    /// Never touches an account it did not create.
    /// </summary>
    public class TestAccountSeeder : IHostedService
    {
        public sealed record TestAccountSpec(string UserName, string FullName, string Department, string[] Roles);

        public static readonly IReadOnlyList<TestAccountSpec> Accounts = new List<TestAccountSpec>
        {
            new("test.requester", "Test Requester", "Finance", new[] { AppRoles.Requester }),
            new("test.caseworker1", "Test Case Worker One", "Contribution Processing", new[] { AppRoles.Requester }),
            new("test.caseworker2", "Test Case Worker Two", "Contribution Processing", new[] { AppRoles.Requester }),
            new("test.caseworker3", "Test Case Worker Three", "Contribution Processing", new[] { AppRoles.Requester }),
            new("test.caseworker4", "Test Case Worker Four", "Contribution Processing", new[] { AppRoles.Requester }),
            new("test.hou", "Test Head of Unit", "Contribution Processing", new[] { AppRoles.Requester }),
            new("test.hou2", "Test Head of Unit Two", "Contribution Processing", new[] { AppRoles.Requester }),
            new("test.hod", "Test Head of Department", "Contribution Processing", new[] { AppRoles.Requester }),
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

            await PlaceInOrganisationAsync(scope.ServiceProvider, users, logger);
            logger.LogInformation("Test accounts ready ({Created} created): {Names}.", created, string.Join(", ", Accounts.Select(a => a.UserName)));
        }

        /// <summary>Puts the test accounts into Contribution Processing. Each call is a no-op when already done.</summary>
        private static async Task PlaceInOrganisationAsync(IServiceProvider services, UserManager<User> users, ILogger logger)
        {
            var org = services.GetRequiredService<IOrganisationService>();
            async Task<Guid?> Id(string name) => (await users.FindByNameAsync(name)) is { PasswordHash: not null } u ? u.Id : null;

            var hod = await Id("test.hod");
            var hou = await Id("test.hou");
            var cw1 = await Id("test.caseworker1");
            var cw2 = await Id("test.caseworker2");
            var cw3 = await Id("test.caseworker3");
            var cw4 = await Id("test.caseworker4");
            var hou2 = await Id("test.hou2");

            if (hod.HasValue) Log(logger, "HOD of Contribution Processing", await org.SetHodAsync(OrgSeed.ContributionProcessingId, hod, null));
            if (hou.HasValue) Log(logger, "Head of Contribution Matching", await org.SetUnitHeadAsync(OrgSeed.ContributionMatchingUnitId, hou, null));
            if (cw1.HasValue) Log(logger, "test.caseworker1 in Contribution Matching", await org.AddMemberAsync(OrgSeed.ContributionMatchingUnitId, cw1.Value, null, null));
            if (cw2.HasValue) Log(logger, "test.caseworker2 in Refund", await org.AddMemberAsync(OrgSeed.RefundUnitId, cw2.Value, null, null));
            if (cw3.HasValue) Log(logger, "test.caseworker3 in Contribution Matching", await org.AddMemberAsync(OrgSeed.ContributionMatchingUnitId, cw3.Value, null, null));
            if (cw4.HasValue) Log(logger, "test.caseworker4 in Refund", await org.AddMemberAsync(OrgSeed.RefundUnitId, cw4.Value, null, null));
            if (hou2.HasValue) Log(logger, "Head of Refund", await org.SetUnitHeadAsync(OrgSeed.RefundUnitId, hou2, null));
        }

        private static void Log(ILogger logger, string what, AdminResult result)
        {
            // 409 "already a member" is the normal answer on every start after the first
            if (!result.Success && result.Status != 409)
                logger.LogWarning("Test organisation set-up: {What} not done: {Message}", what, result.Message);
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

            Assert.Equal(4, caseworkers!.Total);
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
        public async Task Giving_and_taking_away_Super_Admin_is_audited_notified_and_keeps_history()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.requester");

            var first = await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = AppRoles.SuperAdminId });
            var second = await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = AppRoles.SuperAdminId });
            Assert.Equal(HttpStatusCode.OK, first.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

            // The new role is in the next sign-in, next to the roles the person already had
            var again = await ApiTestHelpers.SignInAsync(_factory, "test.requester");
            var me = await ApiTestHelpers.Client(_factory).SendAsync(new HttpRequestMessage(HttpMethod.Get, "/api/auth/me")
            {
                Headers = { Authorization = new AuthenticationHeaderValue("Bearer", again.AccessToken) }
            });
            var body = await me.Content.ReadAsStringAsync();
            Assert.Contains(AppRoles.SuperAdmin, body);
            Assert.Contains(AppRoles.Requester, body);

            // Take it away again (test.superadmin stays the only Super Admin for the other tests)
            var removed = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.SuperAdminId}");
            var removedAgain = await admin.DeleteAsync($"/api/admin/users/{target}/roles/{AppRoles.SuperAdminId}");
            Assert.Equal(HttpStatusCode.OK, removed.StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, removedAgain.StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityId == target && a.Action == AuditAction.RoleChanged && a.Module == AuditModule.Administration));
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == target && n.Title == "Your Service Desk access changed"));
            var history = await db.UserRoleAssignments.Where(a => a.UserId == target && a.RoleId == AppRoles.SuperAdminId).ToListAsync();
            Assert.Contains(history, a => !a.IsActive && a.DisabledAt != null && a.DisabledByUserId != null);
            Assert.DoesNotContain(history, a => a.IsActive);
        }

        [Fact]
        public async Task Structure_roles_are_not_given_or_taken_away_by_hand()
        {
            var admin = await As("test.superadmin");
            var requester = await IdOf("test.requester");
            var hou = await IdOf("test.hou");

            var give = await admin.PostAsJsonAsync($"/api/admin/users/{requester}/roles", new { roleId = AppRoles.CaseWorkerId });
            var take = await admin.DeleteAsync($"/api/admin/users/{hou}/roles/{AppRoles.HeadOfUnitId}");

            Assert.Equal(HttpStatusCode.BadRequest, give.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, take.StatusCode);
            Assert.Contains("Units", await give.Content.ReadAsStringAsync());
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
$files['tests\ServiceDeskAPI.Tests\Organisation\AvailabilityTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Organisation
{
    /// <summary>Step 2b: leave and out of office, who is available, and who may see and change it (BRD 5.3).</summary>
    public class AvailabilityTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AvailabilityTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private DateOnly Today()
        {
            using var scope = _factory.Services.CreateScope();
            return scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
        }

        /// <summary>A new person who can sign in (test.* name, test password), added to the unit by the Super Admin.</summary>
        private async Task<(Guid Id, string UserName)> NewMemberAsync(Guid unitId)
        {
            Guid id;
            var name = "test.av" + Guid.NewGuid().ToString("N").Substring(0, 8);
            using (var scope = _factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
                var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
                await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
                id = user.Id;
            }
            var join = await (await As("test.superadmin")).PostAsJsonAsync($"/api/admin/units/{unitId}/members", new { userId = id });
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
            return (id, name);
        }

        private static object Period(DateOnly start, DateOnly end, Guid? userId = null, int kind = 1) =>
            new { userId, kind, startDate = start, endDate = end, note = "Annual leave" };

        private async Task<Absence> AbsenceRow(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Absences.AsNoTracking().SingleAsync(a => a.Id == id);
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        [Fact]
        public async Task Leave_from_today_makes_a_case_worker_unavailable_and_tells_their_head()
        {
            var today = Today();
            var (person, name) = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var client = await As(name);

            var response = await client.PostAsJsonAsync("/api/availability/absences", Period(today, today.AddDays(2)));
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var absence = await response.Content.ReadFromJsonAsync<AbsenceDto>();

            var mine = await client.GetFromJsonAsync<MyAvailabilityDto>("/api/availability/me");
            Assert.True(mine!.InStructure);
            Assert.False(mine.AvailableNow);
            Assert.Equal(absence!.Id, mine.Current!.Id);

            using (var scope = _factory.Services.CreateScope())
            {
                var service = scope.ServiceProvider.GetRequiredService<IAvailabilityService>();
                var available = await service.AvailableMemberIdsAsync(OrgSeed.ContributionMatchingUnitId);
                Assert.DoesNotContain(person, available);
                Assert.Contains(await IdOf("test.caseworker1"), available);
                Assert.False(await service.IsAvailableAsync(person));

                var hou = await IdOf("test.hou");
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == hou && n.RelatedEntityId == absence.Id));
            }

            var unit = await (await As("test.hou")).GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.ContributionMatchingUnitId}");
            var row = Assert.Single(unit!.Members, m => m.UserId == person);
            Assert.False(row.AvailableNow);
            Assert.True(unit.AvailableCount < unit.MemberCount);
        }

        [Fact]
        public async Task Future_leave_keeps_a_person_available_until_it_starts()
        {
            var today = Today();
            var (person, name) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var client = await As(name);

            Assert.Equal(HttpStatusCode.OK, (await client.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(10), today.AddDays(12), kind: 2))).StatusCode);

            var mine = await client.GetFromJsonAsync<MyAvailabilityDto>("/api/availability/me");
            Assert.True(mine!.AvailableNow);
            Assert.Null(mine.Current);
            var only = Assert.Single(mine.Absences);
            Assert.Equal(AbsenceKind.OutOfOffice, only.Kind);

            var unit = await (await As("test.hou2")).GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.RefundUnitId}");
            var row = Assert.Single(unit!.Members, m => m.UserId == person);
            Assert.True(row.AvailableNow);
            Assert.Single(row.Upcoming);
        }

        [Fact]
        public async Task Heads_record_leave_for_their_own_unit_and_the_HOD_for_the_department()
        {
            var today = Today();
            var (matching, _) = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var (refund, _) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var (other, _) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var hou = await As("test.hou");

            var own = await hou.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(2), matching));
            var notMine = await hou.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(2), refund));
            var byHod = await (await As("test.hod")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(2), refund));
            var byWorker = await (await As("test.caseworker1")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(5), today.AddDays(6), matching));
            var bySuperAdmin = await (await As("test.superadmin")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(1), other));
            var requesterOwn = await (await As("test.requester")).PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(1), today.AddDays(1)));

            Assert.Equal(HttpStatusCode.OK, own.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, notMine.StatusCode);
            Assert.Equal(HttpStatusCode.OK, byHod.StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, byWorker.StatusCode);
            Assert.Equal(HttpStatusCode.OK, bySuperAdmin.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, requesterOwn.StatusCode);

            // The person is told when someone else records their leave
            var recorded = await own.Content.ReadFromJsonAsync<AbsenceDto>();
            Assert.Equal("Test Head of Unit", recorded!.RecordedBy);
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == matching && n.RelatedEntityId == recorded.Id));
        }

        [Fact]
        public async Task Dates_are_checked_and_periods_do_not_overlap()
        {
            var today = Today();
            var (_, name) = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var client = await As(name);
            async Task<HttpStatusCode> Post(object body) => (await client.PostAsJsonAsync("/api/availability/absences", body)).StatusCode;

            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(3), today.AddDays(1))));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(-3), today.AddDays(-1))));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(-40), today)));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(1), today.AddDays(400))));
            Assert.Equal(HttpStatusCode.BadRequest, await Post(Period(today.AddDays(1), today.AddDays(2), kind: 9)));

            var missing = await client.PostAsJsonAsync("/api/availability/absences", new { kind = 1, endDate = today });
            Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
            var error = await missing.Content.ReadFromJsonAsync<JsonElement>();
            Assert.True(error.GetProperty("errors").TryGetProperty("startDate", out _));

            Assert.Equal(HttpStatusCode.OK, await Post(Period(today.AddDays(5), today.AddDays(7))));
            Assert.Equal(HttpStatusCode.Conflict, await Post(Period(today.AddDays(7), today.AddDays(9))));
            Assert.Equal(HttpStatusCode.OK, await Post(Period(today.AddDays(8), today.AddDays(9))));
        }

        [Fact]
        public async Task Cancelling_removes_future_leave_and_ending_current_leave_early_keeps_the_days_taken()
        {
            var today = Today();
            var (_, name) = await NewMemberAsync(OrgSeed.RefundUnitId);
            var client = await As(name);
            var current = await (await client.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(-2), today.AddDays(3)))).Content.ReadFromJsonAsync<AbsenceDto>();
            var future = await (await client.PostAsJsonAsync("/api/availability/absences", Period(today.AddDays(20), today.AddDays(21)))).Content.ReadFromJsonAsync<AbsenceDto>();

            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou")).DeleteAsync($"/api/availability/absences/{future!.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.hou2")).DeleteAsync($"/api/availability/absences/{future.Id}")).StatusCode);
            Assert.True((await AbsenceRow(future.Id)).IsCancelled);

            Assert.Equal(HttpStatusCode.OK, (await client.DeleteAsync($"/api/availability/absences/{current!.Id}")).StatusCode);
            var ended = await AbsenceRow(current.Id);
            Assert.False(ended.IsCancelled);
            Assert.Equal(today.AddDays(-1), ended.EndDate);

            var mine = await client.GetFromJsonAsync<MyAvailabilityDto>("/api/availability/me");
            Assert.True(mine!.AvailableNow);
            Assert.Empty(mine.Absences);

            Assert.Equal(HttpStatusCode.BadRequest, (await client.DeleteAsync($"/api/availability/absences/{current.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync($"/api/availability/absences/{future.Id}")).StatusCode);
        }

        [Fact]
        public async Task Only_the_unit_head_the_HOD_and_a_Super_Admin_see_unit_availability()
        {
            var worker = await As("test.caseworker1");
            var hou = await As("test.hou");

            Assert.Equal(HttpStatusCode.Forbidden, (await worker.GetAsync($"/api/availability/units/{OrgSeed.ContributionMatchingUnitId}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.GetAsync($"/api/availability/units/{OrgSeed.RefundUnitId}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.GetAsync($"/api/availability/departments/{OrgSeed.ContributionProcessingId}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await hou.GetAsync($"/api/availability/units/{Guid.NewGuid()}")).StatusCode);

            var matching = await hou.GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.ContributionMatchingUnitId}");
            Assert.Contains(matching!.Members, m => m.UserName == "test.caseworker1");
            Assert.Contains(matching.Members, m => m.UserName == "test.caseworker3");
            Assert.True(matching.Members[0].IsHead);

            var department = await (await As("test.hod")).GetFromJsonAsync<List<UnitAvailabilityDto>>($"/api/availability/departments/{OrgSeed.ContributionProcessingId}");
            Assert.Equal(2, department!.Count);

            var refund = await (await As("test.superadmin")).GetFromJsonAsync<UnitAvailabilityDto>($"/api/availability/units/{OrgSeed.RefundUnitId}");
            Assert.Equal("test.hou2", refund!.Members[0].UserName);
            Assert.Contains(refund.Members, m => m.UserName == "test.caseworker4");
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
    Write-Host ("1/4 Writing {0} source and test files..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }

    Write-Host '2/4 Building...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }

    Write-Host '3/4 Creating the Availability migration (Absences table)...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'Availability', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_Availability.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

    Write-Host '4/4 Building and running all tests (LocalDB; takes a minute)...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed after adding the migration.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) {
        $t | Where-Object { $_ -match 'Error Message|Assert|Exception' } | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
        throw 'Tests failed.'
    }

    Write-Host ''
    Write-Host 'Done. Step 2b is in place.' -ForegroundColor Green
    Write-Host 'Start the API once: it adds the Absences table and places test.hou2 (head of Refund), test.caseworker3 and test.caseworker4.'
    Write-Host 'In Swagger as test.caseworker1: POST /api/availability/absences, then GET /api/availability/me.'
    Write-Host 'As test.hou: GET /api/availability/units/5d1a0002-0000-4000-8000-000000000011 (Contribution Matching).'
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
