# Step 2a - Organisation: departments, units, heads, deputies and members (BRD Section 5, FR-7.2).
# Access Desk is company-wide: departments and units are data. Contribution Processing (CP) with Contribution Matching (CM)
# and Refund (RF) is seeded as the first department.
#
# What it adds:
#   - Departments (with HOD), Units (with Head of Unit and optional deputy), UnitMembers (case workers; one unit per person per department)
#   - The Case Worker, Head of Unit and HOD roles now follow the structure automatically (not given by hand on the People page)
#   - Super Admin endpoints under api/admin/departments and api/admin/units; api/org/me and api/org/departments for everyone
#   - Development: test.hod is HOD of CP, test.hou heads CM, test.caseworker1 works in CM, test.caseworker2 in Refund
#   - Migration Organisation, and tests
#
# Run from ...\AccessServiceDesk\Backend\ServiceDesk with the API stopped:
#   .\Scripts\step2a-organisation.ps1
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
if (Test-Path (Join-Path $api 'Domain\Entities\Organisation.cs')) { Write-Host 'Organisation.cs already exists: Step 2a looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as the earlier step scripts wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = 'a04a6336331945016cfc4599893f49a5b127a491388a25c129add9f997d61aea'
    'ServiceDeskAPI\Infrastructure\Services\AdminUserService.cs' = '414529b8819d85b2fd30874319cc09b8a970d8bf7a7f9d6bd751ac7432d2a103'
    'ServiceDeskAPI\Infrastructure\Services\TestAccountSeeder.cs' = '8715773f801647e3ba0323e3a90a217cef85c07fbed6012bc657cdd6680d7e0e'
    'ServiceDeskAPI\Program.cs' = '3427fc1d1066d78ccfeecebc619e2f8b614a2fea8bf745bc99db94f4b74734ac'
    'tests\ServiceDeskAPI.Tests\Admin\AdminUsersTests.cs' = 'a405ddb92a61b3fb9a4339b3c974f1eb984b29ed61e382820659b54dce312306'
    'tests\ServiceDeskAPI.Tests\Admin\DirectoryTests.cs' = '8ab35f55c2ae755b5fc79c5614ce26969c7736dd69685faa65847255cdbb3c11'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed since they were last written by a step script, so Step 2a stopped to avoid overwriting your changes:' -ForegroundColor Red
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
            builder.Services.AddScoped<IOrganisationService, ServiceDeskAPI.Infrastructure.Organisation.OrganisationService>();
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
$files['ServiceDeskAPI\Application\DTOs\OrganisationDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A person shown next to a structure role (head, deputy, HOD).</summary>
    public record PersonRefDto(Guid UserId, string UserName, string? FullName, string? Email);

    public class UnitDto
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public PersonRefDto? Head { get; set; }
        public PersonRefDto? Deputy { get; set; }
        public int MemberCount { get; set; }
    }

    public class DepartmentDto
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public PersonRefDto? Hod { get; set; }
        public List<UnitDto> Units { get; set; } = new();
    }

    public class UnitMemberDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? StaffNo { get; set; }
        public StaffCategory StaffCategory { get; set; }
        public bool IsHead { get; set; }
        public bool IsDeputy { get; set; }
        public bool AccountActive { get; set; }
        public DateTime JoinedAt { get; set; }
        public DateTime? LastAssignedAt { get; set; }
    }

    public class CreateDepartmentRequest
    {
        /// <summary>2 to 10 capital letters, digits or dashes, for example CP. Cannot be changed later.</summary>
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    public class CreateUnitRequest
    {
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
    }

    /// <summary>Change the name and/or switch on or off. Leave a field out (null) to keep it.</summary>
    public class UpdateOrgItemRequest
    {
        public string? Name { get; set; }
        public bool? IsActive { get; set; }
    }

    /// <summary>The person for a structure role, or null to clear it.</summary>
    public class SetPersonRequest
    {
        public Guid? UserId { get; set; }
    }

    public class AddUnitMemberRequest
    {
        public Guid UserId { get; set; }
        public string? StaffNo { get; set; }
    }

    /// <summary>What the signed-in person does in the structure. The web app builds module menus from this.</summary>
    public class MyOrganisationDto
    {
        public List<MyDepartmentDto> Departments { get; set; } = new();
    }

    public class MyDepartmentDto
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsHod { get; set; }
        public List<MyUnitDto> Units { get; set; } = new();
    }

    public class MyUnitDto
    {
        public Guid Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public bool IsHead { get; set; }
        public bool IsDeputy { get; set; }
        public bool IsMember { get; set; }
    }

    /// <summary>Active departments that receive tickets, with their active units (for any signed-in person).</summary>
    public record OrgDepartmentDto(Guid Id, string Code, string Name, List<OrgUnitDto> Units);

    public record OrgUnitDto(Guid Id, string Code, string Name);
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IOrganisationService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Departments, units, heads and members (BRD Section 5, M7 FR-7.2). The Case Worker, Head of Unit and HOD roles follow the
    /// structure automatically (OrgRoleSync); every change, its audit entries and the people's notifications are saved together.
    /// actorUserId is null for the system (Development seeding).
    /// </summary>
    public interface IOrganisationService
    {
        Task<List<DepartmentDto>> ListDepartmentsAsync();
        Task<(AdminResult Result, DepartmentDto? Department)> CreateDepartmentAsync(CreateDepartmentRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateDepartmentAsync(Guid departmentId, UpdateOrgItemRequest request, Guid? actorUserId);
        Task<AdminResult> SetHodAsync(Guid departmentId, Guid? userId, Guid? actorUserId);

        Task<(AdminResult Result, UnitDto? Unit)> CreateUnitAsync(Guid departmentId, CreateUnitRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateUnitAsync(Guid unitId, UpdateOrgItemRequest request, Guid? actorUserId);
        Task<AdminResult> SetUnitHeadAsync(Guid unitId, Guid? userId, Guid? actorUserId);
        Task<AdminResult> SetUnitDeputyAsync(Guid unitId, Guid? userId, Guid? actorUserId);

        Task<List<UnitMemberDto>?> ListMembersAsync(Guid unitId);
        Task<AdminResult> AddMemberAsync(Guid unitId, Guid userId, string? staffNo, Guid? actorUserId);
        Task<AdminResult> RemoveMemberAsync(Guid unitId, Guid userId, Guid? actorUserId);

        Task<MyOrganisationDto> GetMyOrganisationAsync(Guid userId);
        Task<List<OrgDepartmentDto>> ListActiveDepartmentsAsync();
    }
}
'@
$files['ServiceDeskAPI\Controllers\AdminOrganisationController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Super Admin: departments, units, heads and members (BRD Section 5, FR-7.2). The Case Worker, Head of Unit and HOD roles
    /// follow from these settings automatically; they are not given on the People page.
    /// </summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminOrganisationController : ControllerBase
    {
        private readonly IOrganisationService _org;

        public AdminOrganisationController(IOrganisationService org) => _org = org;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private ActionResult<MessageDto> From(AdminResult result) =>
            result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>Every department with its units, heads, deputies and member counts.</summary>
        [HttpGet("departments")]
        [ProducesResponseType(typeof(List<DepartmentDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<DepartmentDto>>> Departments() => Ok(await _org.ListDepartmentsAsync());

        [HttpPost("departments")]
        [ProducesResponseType(typeof(DepartmentDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<DepartmentDto>> CreateDepartment([FromBody] CreateDepartmentRequest request)
        {
            var (result, department) = await _org.CreateDepartmentAsync(request, Actor());
            return result.Success && department != null ? Ok(department) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename and/or switch on or off. A department is switched off only when its units are off.</summary>
        [HttpPatch("departments/{departmentId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> UpdateDepartment(Guid departmentId, [FromBody] UpdateOrgItemRequest request)
            => From(await _org.UpdateDepartmentAsync(departmentId, request, Actor()));

        /// <summary>Sets (or clears, with userId null) the Head of Department. The HOD cannot be a member of a unit in the department.</summary>
        [HttpPut("departments/{departmentId:guid}/hod")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetHod(Guid departmentId, [FromBody] SetPersonRequest request)
            => From(await _org.SetHodAsync(departmentId, request.UserId, Actor()));

        [HttpPost("departments/{departmentId:guid}/units")]
        [ProducesResponseType(typeof(UnitDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<UnitDto>> CreateUnit(Guid departmentId, [FromBody] CreateUnitRequest request)
        {
            var (result, unit) = await _org.CreateUnitAsync(departmentId, request, Actor());
            return result.Success && unit != null ? Ok(unit) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename and/or switch on or off. A unit is switched off only when it has no members.</summary>
        [HttpPatch("units/{unitId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> UpdateUnit(Guid unitId, [FromBody] UpdateOrgItemRequest request)
            => From(await _org.UpdateUnitAsync(unitId, request, Actor()));

        /// <summary>Sets (or clears) the Head of Unit. The head becomes a member of the unit with staff category Head of Unit.</summary>
        [HttpPut("units/{unitId:guid}/head")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> SetHead(Guid unitId, [FromBody] SetPersonRequest request)
            => From(await _org.SetUnitHeadAsync(unitId, request.UserId, Actor()));

        /// <summary>Sets (or clears) the deputy Head of Unit, who must be a member of the unit.</summary>
        [HttpPut("units/{unitId:guid}/deputy")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetDeputy(Guid unitId, [FromBody] SetPersonRequest request)
            => From(await _org.SetUnitDeputyAsync(unitId, request.UserId, Actor()));

        [HttpGet("units/{unitId:guid}/members")]
        [ProducesResponseType(typeof(List<UnitMemberDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<UnitMemberDto>>> Members(Guid unitId)
        {
            var members = await _org.ListMembersAsync(unitId);
            return members == null ? NotFound(new ApiError("Unit not found.")) : Ok(members);
        }

        /// <summary>Adds a case worker to the unit (one unit per person per department).</summary>
        [HttpPost("units/{unitId:guid}/members")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> AddMember(Guid unitId, [FromBody] AddUnitMemberRequest request)
        {
            if (request.UserId == Guid.Empty) return BadRequest(new ApiError("Choose a person.", "userId", "Choose a person."));
            return From(await _org.AddMemberAsync(unitId, request.UserId, request.StaffNo, Actor()));
        }

        /// <summary>Removes a member (history kept). Not the head or the deputy: change those first.</summary>
        [HttpDelete("units/{unitId:guid}/members/{userId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> RemoveMember(Guid unitId, Guid userId)
            => From(await _org.RemoveMemberAsync(unitId, userId, Actor()));
    }

    /// <summary>The organisation as seen by any signed-in person.</summary>
    [ApiController]
    [Route("api/org")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class OrgController : ControllerBase
    {
        private readonly IOrganisationService _org;

        public OrgController(IOrganisationService org) => _org = org;

        /// <summary>The departments and units the signed-in person heads, deputises or works in. The web app builds module menus from this.</summary>
        [HttpGet("me")]
        [ProducesResponseType(typeof(MyOrganisationDto), StatusCodes.Status200OK)]
        public async Task<ActionResult<MyOrganisationDto>> Me()
        {
            if (!Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId)) return Unauthorized();
            return Ok(await _org.GetMyOrganisationAsync(userId));
        }

        /// <summary>Active departments that receive tickets, with their active units.</summary>
        [HttpGet("departments")]
        [ProducesResponseType(typeof(List<OrgDepartmentDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<OrgDepartmentDto>>> Departments() => Ok(await _org.ListActiveDepartmentsAsync());
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\Organisation.cs'] = @'
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A department that receives tickets on Access Desk (a module), with its Head of Department (oversight only).
    /// Requesters' own departments come from AD (User.Department) and are used for reporting only.
    /// </summary>
    public class Department
    {
        public Guid Id { get; set; }
        /// <summary>Short code, also the ticket reference prefix later (for example CP).</summary>
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public Guid? HodUserId { get; set; }
        public User? HodUser { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }

        public ICollection<Unit> Units { get; set; } = new List<Unit>();
    }

    /// <summary>A unit of a department (for example Contribution Matching), with its Head of Unit and an optional deputy.</summary>
    public class Unit
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public Guid? HeadUserId { get; set; }
        public User? HeadUser { get; set; }
        /// <summary>Receives escalations when the Head of Unit is on leave (BRD Section 5). Must be a member of the unit.</summary>
        public Guid? DeputyHeadUserId { get; set; }
        public User? DeputyHeadUser { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }

        public ICollection<UnitMember> Members { get; set; } = new List<UnitMember>();
    }

    /// <summary>
    /// A person working tickets in a unit (case worker; the Head of Unit is a member too, with staff category HeadOfUnit).
    /// One active membership per person per department. Leaving keeps the row (IsActive false) as history.
    /// </summary>
    public class UnitMember
    {
        public Guid Id { get; set; }
        public Guid UnitId { get; set; }
        public Unit? Unit { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public StaffCategory StaffCategory { get; set; } = StaffCategory.Employee;
        public string? StaffNo { get; set; }
        public bool IsActive { get; set; } = true;
        /// <summary>Tie-breaker for automatic assignment (Step 5): least recently assigned first.</summary>
        public DateTime? LastAssignedAt { get; set; }
        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
        public Guid? AddedByUserId { get; set; }
        public DateTime? LeftAt { get; set; }
        public Guid? RemovedByUserId { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Domain\Organisation\OrgSeed.cs'] = @'
namespace ServiceDeskAPI.Domain.Organisation
{
    /// <summary>
    /// The first department on Access Desk, seeded by migration (BRD Section 5). Further departments and units are added by a
    /// Super Admin as data. Fixed ids so the seed never changes between migrations and tests can refer to them.
    /// </summary>
    public static class OrgSeed
    {
        public static readonly Guid ContributionProcessingId = new("5d1a0002-0000-4000-8000-000000000001");
        public static readonly Guid ContributionMatchingUnitId = new("5d1a0002-0000-4000-8000-000000000011");
        public static readonly Guid RefundUnitId = new("5d1a0002-0000-4000-8000-000000000012");

        public const string ContributionProcessingCode = "CP";
        public const string ContributionMatchingCode = "CM";
        public const string RefundCode = "RF";
    }

    /// <summary>A case worker's staff category (BRD 5.4): drives escalation. Set by the structure: HeadOfUnit when the person heads the unit.</summary>
    public enum StaffCategory
    {
        Employee = 1,
        HeadOfUnit = 2
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Organisation\OrgRoleSync.cs'] = @'
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Keeps the structure roles in step with the saved structure (rule: these roles are never given by hand):
    /// CaseWorker = active member of an active unit; HeadOfUnit = head or deputy of an active unit; HOD = HOD of an active department.
    /// Stages role grants and removals, their audit entries and a notification per person; the caller saves.
    /// Run it after the structure change has been saved (inside the same transaction), so it reads the new structure.
    /// </summary>
    public static class OrgRoleSync
    {
        public static readonly IReadOnlyList<string> StructureRoles = new[] { AppRoles.CaseWorker, AppRoles.HeadOfUnit, AppRoles.HOD };

        private static readonly Dictionary<string, Guid> RoleIds = new()
        {
            [AppRoles.CaseWorker] = AppRoles.CaseWorkerId,
            [AppRoles.HeadOfUnit] = AppRoles.HeadOfUnitId,
            [AppRoles.HOD] = AppRoles.HODId
        };

        public static bool IsStructureRole(Guid roleId) => RoleIds.ContainsValue(roleId);

        /// <summary>The structure roles this person should hold now, from the database.</summary>
        public static async Task<HashSet<string>> ExpectedAsync(AppDbContext db, Guid userId)
        {
            var expected = new HashSet<string>();
            if (await db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.IsActive && m.Unit.Department!.IsActive))
                expected.Add(AppRoles.CaseWorker);
            if (await db.Units.AnyAsync(u => u.IsActive && u.Department!.IsActive && (u.HeadUserId == userId || u.DeputyHeadUserId == userId)))
                expected.Add(AppRoles.HeadOfUnit);
            if (await db.Departments.AnyAsync(d => d.IsActive && d.HodUserId == userId))
                expected.Add(AppRoles.HOD);
            return expected;
        }

        /// <summary>Stages the changes for these people. Returns how many role changes were staged.</summary>
        public static async Task<int> StageAsync(AppDbContext db, IEnumerable<Guid> userIds, Guid? actorUserId, AuditActor actor,
            IAuditService audit, IInAppNotificationService notifications)
        {
            var changes = 0;
            var structureRoleIds = RoleIds.Values.ToArray();
            foreach (var userId in userIds.Distinct())
            {
                var expected = await ExpectedAsync(db, userId);
                var active = await db.UserRoleAssignments
                    .Where(a => a.UserId == userId && a.IsActive && structureRoleIds.Contains(a.RoleId))
                    .ToListAsync();
                var granted = new List<string>();
                var removed = new List<string>();

                foreach (var (name, roleId) in RoleIds)
                {
                    var holding = active.FirstOrDefault(a => a.RoleId == roleId);
                    if (expected.Contains(name) && holding == null)
                    {
                        db.UserRoleAssignments.Add(new UserRoleAssignment
                        {
                            Id = Guid.NewGuid(), UserId = userId, RoleId = roleId, IsActive = true,
                            AssignedAt = DateTime.UtcNow, AssignedByUserId = actorUserId
                        });
                        if (!await db.UserRoles.AnyAsync(r => r.UserId == userId && r.RoleId == roleId))
                            db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = userId, RoleId = roleId });
                        granted.Add(name);
                    }
                    else if (!expected.Contains(name) && holding != null)
                    {
                        holding.IsActive = false;
                        holding.DisabledAt = DateTime.UtcNow;
                        holding.DisabledByUserId = actorUserId;
                        var link = await db.UserRoles.FirstOrDefaultAsync(r => r.UserId == userId && r.RoleId == roleId);
                        if (link != null) db.UserRoles.Remove(link);
                        removed.Add(name);
                    }
                }

                if (granted.Count + removed.Count == 0) continue;
                changes += granted.Count + removed.Count;

                var userName = await db.Users.Where(u => u.Id == userId).Select(u => u.UserName).FirstOrDefaultAsync();
                audit.Stage(actor.UserId, actor.DisplayName, AuditAction.RoleChanged, "User", userId, userName,
                    removed.Count > 0 ? JsonSerializer.Serialize(new { removed, reason = "organisation" }) : null,
                    granted.Count > 0 ? JsonSerializer.Serialize(new { granted, reason = "organisation" }) : null,
                    actor.IpAddress, actor.UserAgent, AuditModule.Units);

                var parts = new List<string>();
                if (granted.Count > 0) parts.Add("You now have the " + string.Join(", ", granted.Select(Friendly)) + " role" + (granted.Count > 1 ? "s" : "") + ".");
                if (removed.Count > 0) parts.Add("The " + string.Join(", ", removed.Select(Friendly)) + " role" + (removed.Count > 1 ? "s were" : " was") + " removed.");
                notifications.Stage(userId, "Your Access Desk access changed", string.Join(" ", parts) + " Sign out and back in if you do not see the change yet.",
                    NotificationType.Info, NotificationCategory.System, "User", userId, null);
            }
            return changes;
        }

        public static string Friendly(string role) => role switch
        {
            AppRoles.CaseWorker => "Case Worker",
            AppRoles.HeadOfUnit => "Head of Unit",
            AppRoles.HOD => "Head of Department",
            AppRoles.SuperAdmin => "Super Admin",
            _ => role
        };
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Organisation\OrganisationService.cs'] = @'
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Departments, units, heads and members (BRD Section 5). Rules:
    /// - one active unit per person per department; the Head of Unit is a member of their unit (staff category HeadOfUnit);
    /// - the deputy must be a member of the unit and is not its head;
    /// - the HOD oversees and does not work tickets, so is never a member of a unit in their own department;
    /// - a unit is switched off only when it has no members; a department only when its units are switched off.
    /// Each change is saved with its audit entries; then the structure roles are brought in step (OrgRoleSync) in the same transaction.
    /// </summary>
    public class OrganisationService : IOrganisationService
    {
        private static readonly Regex CodeRule = new("^[A-Z0-9-]{2,10}$", RegexOptions.Compiled);

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly ILogger<OrganisationService> _logger;

        public OrganisationService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, ILogger<OrganisationService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _logger = logger;
        }

        // ---------------- read ----------------

        public async Task<List<DepartmentDto>> ListDepartmentsAsync() =>
            await _db.Departments.AsNoTracking()
                .OrderBy(d => d.Name)
                .Select(d => new DepartmentDto
                {
                    Id = d.Id,
                    Code = d.Code,
                    Name = d.Name,
                    IsActive = d.IsActive,
                    Hod = d.HodUser == null ? null : new PersonRefDto(d.HodUser.Id, d.HodUser.UserName!, d.HodUser.FullName, d.HodUser.CorporateEmail ?? d.HodUser.Email),
                    Units = d.Units.OrderBy(u => u.Name).Select(u => new UnitDto
                    {
                        Id = u.Id,
                        DepartmentId = u.DepartmentId,
                        Code = u.Code,
                        Name = u.Name,
                        IsActive = u.IsActive,
                        Head = u.HeadUser == null ? null : new PersonRefDto(u.HeadUser.Id, u.HeadUser.UserName!, u.HeadUser.FullName, u.HeadUser.CorporateEmail ?? u.HeadUser.Email),
                        Deputy = u.DeputyHeadUser == null ? null : new PersonRefDto(u.DeputyHeadUser.Id, u.DeputyHeadUser.UserName!, u.DeputyHeadUser.FullName, u.DeputyHeadUser.CorporateEmail ?? u.DeputyHeadUser.Email),
                        MemberCount = u.Members.Count(m => m.IsActive)
                    }).ToList()
                })
                .ToListAsync();

        public async Task<List<UnitMemberDto>?> ListMembersAsync(Guid unitId)
        {
            var unit = await _db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return null;
            return await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive)
                .OrderBy(m => m.User!.FullName ?? m.User.UserName)
                .Select(m => new UnitMemberDto
                {
                    UserId = m.UserId,
                    UserName = m.User!.UserName ?? string.Empty,
                    FullName = m.User.FullName,
                    Email = m.User.CorporateEmail ?? m.User.Email,
                    StaffNo = m.StaffNo,
                    StaffCategory = m.StaffCategory,
                    IsHead = unit.HeadUserId == m.UserId,
                    IsDeputy = unit.DeputyHeadUserId == m.UserId,
                    AccountActive = m.User.IsActive,
                    JoinedAt = m.JoinedAt,
                    LastAssignedAt = m.LastAssignedAt
                })
                .ToListAsync();
        }

        public async Task<MyOrganisationDto> GetMyOrganisationAsync(Guid userId)
        {
            var units = await _db.Units.AsNoTracking()
                .Where(u => u.IsActive && u.Department!.IsActive
                    && (u.HeadUserId == userId || u.DeputyHeadUserId == userId || u.Members.Any(m => m.UserId == userId && m.IsActive)))
                .Select(u => new
                {
                    u.DepartmentId,
                    Unit = new MyUnitDto
                    {
                        Id = u.Id,
                        Code = u.Code,
                        Name = u.Name,
                        IsHead = u.HeadUserId == userId,
                        IsDeputy = u.DeputyHeadUserId == userId,
                        IsMember = u.Members.Any(m => m.UserId == userId && m.IsActive)
                    }
                })
                .ToListAsync();
            var departmentIds = units.Select(u => u.DepartmentId).Distinct().ToList();
            var departments = await _db.Departments.AsNoTracking()
                .Where(d => d.IsActive && (d.HodUserId == userId || departmentIds.Contains(d.Id)))
                .OrderBy(d => d.Name)
                .Select(d => new MyDepartmentDto { Id = d.Id, Code = d.Code, Name = d.Name, IsHod = d.HodUserId == userId })
                .ToListAsync();
            foreach (var d in departments)
                d.Units = units.Where(u => u.DepartmentId == d.Id).Select(u => u.Unit).OrderBy(u => u.Name).ToList();
            return new MyOrganisationDto { Departments = departments };
        }

        public async Task<List<OrgDepartmentDto>> ListActiveDepartmentsAsync() =>
            await _db.Departments.AsNoTracking()
                .Where(d => d.IsActive)
                .OrderBy(d => d.Name)
                .Select(d => new OrgDepartmentDto(d.Id, d.Code, d.Name,
                    d.Units.Where(u => u.IsActive).OrderBy(u => u.Name).Select(u => new OrgUnitDto(u.Id, u.Code, u.Name)).ToList()))
                .ToListAsync();

        // ---------------- departments ----------------

        public async Task<(AdminResult Result, DepartmentDto? Department)> CreateDepartmentAsync(CreateDepartmentRequest request, Guid? actorUserId)
        {
            var code = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
            var name = (request.Name ?? string.Empty).Trim();
            if (!CodeRule.IsMatch(code)) return (AdminResult.Invalid("The code must be 2 to 10 capital letters, digits or dashes, for example CP."), null);
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (await _db.Departments.AnyAsync(d => d.Code == code)) return (AdminResult.Conflict("A department with the code " + code + " already exists."), null);
            if (await _db.Departments.AnyAsync(d => d.Name == name)) return (AdminResult.Conflict("A department named " + name + " already exists."), null);

            var department = new Department { Id = Guid.NewGuid(), Code = code, Name = name, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Departments.Add(department);
            Stage(AuditAction.Created, "Department", department.Id, name, null, new { code, name });
            var result = await SaveAsync(Array.Empty<Guid?>(), actorUserId, "Department " + name + " created.", "A department with that code or name already exists.");
            return (result, result.Success ? (await ListDepartmentsAsync()).First(d => d.Id == department.Id) : null);
        }

        public async Task<AdminResult> UpdateDepartmentAsync(Guid departmentId, UpdateOrgItemRequest request, Guid? actorUserId)
        {
            var department = await _db.Departments.Include(d => d.Units).FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return AdminResult.NotFound("Department not found.");
            var before = new { department.Name, department.IsActive };

            if (request.Name != null)
            {
                var name = request.Name.Trim();
                if (name.Length < 2 || name.Length > 100) return AdminResult.Invalid("The name must be 2 to 100 characters.");
                if (await _db.Departments.AnyAsync(d => d.Id != departmentId && d.Name == name)) return AdminResult.Conflict("A department named " + name + " already exists.");
                department.Name = name;
            }
            if (request.IsActive == false && department.IsActive && department.Units.Any(u => u.IsActive))
                return AdminResult.Invalid("Switch off its units first.");
            if (request.IsActive.HasValue) department.IsActive = request.IsActive.Value;

            department.UpdatedAt = DateTime.UtcNow;
            department.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Department", department.Id, department.Name, before, new { department.Name, department.IsActive });
            return await SaveAsync(new[] { department.HodUserId }, actorUserId, "Department " + department.Name + " updated.", "A department with that name already exists.");
        }

        public async Task<AdminResult> SetHodAsync(Guid departmentId, Guid? userId, Guid? actorUserId)
        {
            var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return AdminResult.NotFound("Department not found.");
            if (department.HodUserId == userId) return AdminResult.Ok("No change.");

            string? newName = null;
            if (userId.HasValue)
            {
                var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
                if (user == null) return AdminResult.NotFound("Person not found.");
                if (!user.IsActive) return AdminResult.Invalid(Name(user) + " is blocked and cannot be the Head of Department.");
                var memberOf = await _db.UnitMembers.Where(m => m.UserId == user.Id && m.IsActive && m.Unit!.DepartmentId == departmentId)
                    .Select(m => m.Unit!.Name).FirstOrDefaultAsync();
                if (memberOf != null)
                    return AdminResult.Invalid("The Head of Department oversees and does not work tickets. Remove " + Name(user) + " from " + memberOf + " first.");
                newName = user.UserName;
            }

            var previous = department.HodUserId;
            department.HodUserId = userId;
            department.UpdatedAt = DateTime.UtcNow;
            department.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Department", department.Id, department.Name, new { hodUserId = previous }, new { hodUserId = userId, hod = newName });
            return await SaveAsync(new[] { previous, userId }, actorUserId,
                userId.HasValue ? "Head of Department set." : "Head of Department cleared.", "The change could not be saved; try again.");
        }

        // ---------------- units ----------------

        public async Task<(AdminResult Result, UnitDto? Unit)> CreateUnitAsync(Guid departmentId, CreateUnitRequest request, Guid? actorUserId)
        {
            var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return (AdminResult.NotFound("Department not found."), null);
            if (!department.IsActive) return (AdminResult.Invalid("Switch the department on first."), null);
            var code = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
            var name = (request.Name ?? string.Empty).Trim();
            if (!CodeRule.IsMatch(code)) return (AdminResult.Invalid("The code must be 2 to 10 capital letters, digits or dashes, for example CM."), null);
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (await _db.Units.AnyAsync(u => u.DepartmentId == departmentId && u.Code == code)) return (AdminResult.Conflict(department.Name + " already has a unit with the code " + code + "."), null);
            if (await _db.Units.AnyAsync(u => u.DepartmentId == departmentId && u.Name == name)) return (AdminResult.Conflict(department.Name + " already has a unit named " + name + "."), null);

            var unit = new Unit { Id = Guid.NewGuid(), DepartmentId = departmentId, Code = code, Name = name, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Units.Add(unit);
            Stage(AuditAction.Created, "Unit", unit.Id, name, null, new { department = department.Code, code, name });
            var result = await SaveAsync(Array.Empty<Guid?>(), actorUserId, "Unit " + name + " created.", "A unit with that code or name already exists.");
            return (result, result.Success ? new UnitDto { Id = unit.Id, DepartmentId = departmentId, Code = code, Name = name, IsActive = true } : null);
        }

        public async Task<AdminResult> UpdateUnitAsync(Guid unitId, UpdateOrgItemRequest request, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            var before = new { unit.Name, unit.IsActive };

            if (request.Name != null)
            {
                var name = request.Name.Trim();
                if (name.Length < 2 || name.Length > 100) return AdminResult.Invalid("The name must be 2 to 100 characters.");
                if (await _db.Units.AnyAsync(u => u.Id != unitId && u.DepartmentId == unit.DepartmentId && u.Name == name))
                    return AdminResult.Conflict(unit.Department!.Name + " already has a unit named " + name + ".");
                unit.Name = name;
            }
            if (request.IsActive == false && unit.IsActive && await _db.UnitMembers.AnyAsync(m => m.UnitId == unitId && m.IsActive))
                return AdminResult.Invalid("Remove its members (and its head) first.");
            if (request.IsActive == true && !unit.Department!.IsActive)
                return AdminResult.Invalid("Switch the department on first.");
            if (request.IsActive.HasValue) unit.IsActive = request.IsActive.Value;

            unit.UpdatedAt = DateTime.UtcNow;
            unit.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Unit", unit.Id, unit.Name, before, new { unit.Name, unit.IsActive });
            return await SaveAsync(new[] { unit.HeadUserId, unit.DeputyHeadUserId }, actorUserId, "Unit " + unit.Name + " updated.", "A unit with that name already exists.");
        }

        public async Task<AdminResult> SetUnitHeadAsync(Guid unitId, Guid? userId, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            if (unit.HeadUserId == userId) return AdminResult.Ok("No change.");
            var previousHead = unit.HeadUserId;
            var previousDeputy = unit.DeputyHeadUserId;

            if (userId.HasValue)
            {
                if (!unit.IsActive) return AdminResult.Invalid("Switch the unit on first.");
                var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
                if (user == null) return AdminResult.NotFound("Person not found.");
                if (!user.IsActive) return AdminResult.Invalid(Name(user) + " is blocked and cannot head a unit.");
                if (unit.Department!.HodUserId == user.Id)
                    return AdminResult.Invalid(Name(user) + " is the Head of Department, who oversees and does not work tickets.");
                var otherUnit = await _db.UnitMembers
                    .Where(m => m.UserId == user.Id && m.IsActive && m.UnitId != unitId && m.Unit!.DepartmentId == unit.DepartmentId)
                    .Select(m => m.Unit!.Name).FirstOrDefaultAsync();
                if (otherUnit != null) return AdminResult.Conflict(Name(user) + " is a member of " + otherUnit + ". Remove them there first.");

                // The new head works tickets in the unit, with staff category Head of Unit
                var membership = await _db.UnitMembers.FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == user.Id && m.IsActive);
                if (membership == null)
                {
                    _db.UnitMembers.Add(new UnitMember
                    {
                        Id = Guid.NewGuid(), UnitId = unitId, UserId = user.Id, StaffCategory = StaffCategory.HeadOfUnit,
                        IsActive = true, JoinedAt = DateTime.UtcNow, AddedByUserId = actorUserId
                    });
                }
                else membership.StaffCategory = StaffCategory.HeadOfUnit;

                if (unit.DeputyHeadUserId == user.Id) unit.DeputyHeadUserId = null;
            }

            // The previous head stays in the unit as an ordinary member
            if (previousHead.HasValue)
            {
                var old = await _db.UnitMembers.FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == previousHead.Value && m.IsActive);
                if (old != null) old.StaffCategory = StaffCategory.Employee;
            }

            unit.HeadUserId = userId;
            unit.UpdatedAt = DateTime.UtcNow;
            unit.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Unit", unit.Id, unit.Name, new { headUserId = previousHead, deputyHeadUserId = previousDeputy },
                new { headUserId = userId, unit.DeputyHeadUserId });
            return await SaveAsync(new[] { previousHead, userId, previousDeputy }, actorUserId,
                userId.HasValue ? "Head of " + unit.Name + " set." : "Head of " + unit.Name + " cleared.", "The change could not be saved; try again.");
        }

        public async Task<AdminResult> SetUnitDeputyAsync(Guid unitId, Guid? userId, Guid? actorUserId)
        {
            var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            if (unit.DeputyHeadUserId == userId) return AdminResult.Ok("No change.");
            if (userId.HasValue)
            {
                if (userId == unit.HeadUserId) return AdminResult.Invalid("The Head of Unit cannot also be the deputy.");
                var isMember = await _db.UnitMembers.AnyAsync(m => m.UnitId == unitId && m.UserId == userId.Value && m.IsActive && m.User!.IsActive);
                if (!isMember) return AdminResult.Invalid("The deputy must be an active member of " + unit.Name + ". Add them to the unit first.");
            }

            var previous = unit.DeputyHeadUserId;
            unit.DeputyHeadUserId = userId;
            unit.UpdatedAt = DateTime.UtcNow;
            unit.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Unit", unit.Id, unit.Name, new { deputyHeadUserId = previous }, new { deputyHeadUserId = userId });
            return await SaveAsync(new[] { previous, userId }, actorUserId,
                userId.HasValue ? "Deputy of " + unit.Name + " set." : "Deputy of " + unit.Name + " cleared.", "The change could not be saved; try again.");
        }

        // ---------------- members ----------------

        public async Task<AdminResult> AddMemberAsync(Guid unitId, Guid userId, string? staffNo, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            if (!unit.IsActive) return AdminResult.Invalid("Switch the unit on first.");
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return AdminResult.NotFound("Person not found.");
            if (!user.IsActive) return AdminResult.Invalid(Name(user) + " is blocked and cannot join a unit.");
            if (unit.Department!.HodUserId == userId)
                return AdminResult.Invalid(Name(user) + " is the Head of Department, who oversees and does not work tickets.");
            if (await _db.UnitMembers.AnyAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive))
                return AdminResult.Conflict(Name(user) + " is already a member of " + unit.Name + ".");
            var otherUnit = await _db.UnitMembers
                .Where(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == unit.DepartmentId)
                .Select(m => m.Unit!.Name).FirstOrDefaultAsync();
            if (otherUnit != null) return AdminResult.Conflict(Name(user) + " is a member of " + otherUnit + ". Remove them there first.");

            var number = string.IsNullOrWhiteSpace(staffNo) ? null : staffNo.Trim();
            if (number != null && number.Length > 30) return AdminResult.Invalid("The staff number must be at most 30 characters.");

            var member = new UnitMember
            {
                Id = Guid.NewGuid(), UnitId = unitId, UserId = userId, StaffCategory = StaffCategory.Employee, StaffNo = number,
                IsActive = true, JoinedAt = DateTime.UtcNow, AddedByUserId = actorUserId
            };
            _db.UnitMembers.Add(member);
            Stage(AuditAction.Created, "UnitMember", member.Id, user.UserName, null, new { unit = unit.Code, user = user.UserName, staffNo = number });
            return await SaveAsync(new Guid?[] { userId }, actorUserId, Name(user) + " added to " + unit.Name + ".", Name(user) + " is already a member of " + unit.Name + ".");
        }

        public async Task<AdminResult> RemoveMemberAsync(Guid unitId, Guid userId, Guid? actorUserId)
        {
            var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            var member = await _db.UnitMembers.Include(m => m.User).FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive);
            if (member?.User == null) return AdminResult.NotFound("This person is not a member of " + unit.Name + ".");
            if (unit.HeadUserId == userId) return AdminResult.Invalid(Name(member.User) + " heads " + unit.Name + ". Choose another head (or clear the head) first.");
            if (unit.DeputyHeadUserId == userId) return AdminResult.Invalid(Name(member.User) + " is the deputy of " + unit.Name + ". Clear the deputy first.");

            member.IsActive = false;
            member.LeftAt = DateTime.UtcNow;
            member.RemovedByUserId = actorUserId;
            Stage(AuditAction.Deleted, "UnitMember", member.Id, member.User.UserName, new { unit = unit.Code, user = member.User.UserName }, null);
            return await SaveAsync(new Guid?[] { userId }, actorUserId, Name(member.User) + " removed from " + unit.Name + ".", "The change could not be saved; try again.");
        }

        // ---------------- helpers ----------------

        /// <summary>Saves the staged structure change, then brings the affected people's roles in step, in one transaction.</summary>
        private async Task<AdminResult> SaveAsync(IEnumerable<Guid?> affected, Guid? actorUserId, string okMessage, string conflictMessage)
        {
            var people = affected.Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
            await using var transaction = await _db.Database.BeginTransactionAsync();
            try
            {
                await _db.SaveChangesAsync();
                if (people.Count > 0 && await OrgRoleSync.StageAsync(_db, people, actorUserId, Actor(), _audit, _notifications) > 0)
                    await _db.SaveChangesAsync();
                await transaction.CommitAsync();
                return AdminResult.Ok(okMessage);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Organisation change refused by the database");
                await transaction.RollbackAsync();
                _db.ChangeTracker.Clear();
                return AdminResult.Conflict(conflictMessage);
            }
        }

        private AuditActor Actor() => AuditActor.From(_http.HttpContext);

        private void Stage(AuditAction action, string entityType, Guid entityId, string? display, object? before, object? after)
        {
            var actor = Actor();
            _audit.Stage(actor.UserId, actor.DisplayName, action, entityType, entityId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Units);
        }

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
using ServiceDeskAPI.Infrastructure.Organisation;
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
            if (OrgRoleSync.IsStructureRole(roleId)) return AdminResult.Invalid(StructureRoleMessage(role.Name));
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

            if (OrgRoleSync.IsStructureRole(roleId))
                return AdminResult.Invalid(StructureRoleMessage(assignment.Role.Name));
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

        /// <summary>Case Worker, Head of Unit and HOD follow the organisation set-up (Step 2a); they are not given by hand.</summary>
        private static string StructureRoleMessage(string? role) => role switch
        {
            AppRoles.CaseWorker => "Case Worker follows unit membership: add or remove the person under Administration > Units.",
            AppRoles.HeadOfUnit => "Head of Unit follows the unit set-up: set the head or deputy under Administration > Units.",
            AppRoles.HOD => "Head of Department follows the department set-up: set the HOD under Administration > Units.",
            _ => "This role follows the organisation set-up."
        };

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
    /// test.hod is HOD of Contribution Processing, test.hou heads Contribution Matching, test.caseworker1 works in Contribution Matching
    /// and test.caseworker2 in Refund. Their Case Worker / Head of Unit / HOD roles follow from that. Safe to run on every start.
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
            new("test.hou", "Test Head of Unit", "Contribution Processing", new[] { AppRoles.Requester }),
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

            if (hod.HasValue) Log(logger, "HOD of Contribution Processing", await org.SetHodAsync(OrgSeed.ContributionProcessingId, hod, null));
            if (hou.HasValue) Log(logger, "Head of Contribution Matching", await org.SetUnitHeadAsync(OrgSeed.ContributionMatchingUnitId, hou, null));
            if (cw1.HasValue) Log(logger, "test.caseworker1 in Contribution Matching", await org.AddMemberAsync(OrgSeed.ContributionMatchingUnitId, cw1.Value, null, null));
            if (cw2.HasValue) Log(logger, "test.caseworker2 in Refund", await org.AddMemberAsync(OrgSeed.RefundUnitId, cw2.Value, null, null));
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
        public async Task A_person_from_the_directory_gets_an_account_once_and_can_then_join_a_unit()
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

            // Then a Super Admin can make them a case worker by adding them to a unit (Step 2a)
            var join = await admin.PostAsJsonAsync($"/api/admin/units/{ServiceDeskAPI.Domain.Organisation.OrgSeed.RefundUnitId}/members", new { userId = created.UserId });
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
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
$files['tests\ServiceDeskAPI.Tests\Organisation\OrganisationTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Organisation
{
    /// <summary>Step 2a: departments, units, heads and members (BRD Section 5); structure roles follow automatically.</summary>
    public class OrganisationTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public OrganisationTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        /// <summary>A fresh staff account (as if added from AD), with the Requester role.</summary>
        private async Task<Guid> NewPersonAsync(string prefix)
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = prefix + "." + Guid.NewGuid().ToString("N").Substring(0, 6);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return user.Id;
        }

        private async Task<List<string>> RolesOf(Guid userId)
        {
            using var scope = _factory.Services.CreateScope();
            return await RoleAssignments.GetActiveRoleNamesAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), userId);
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        [Fact]
        public async Task Contribution_Processing_is_seeded_with_its_two_units_and_the_test_people_in_place()
        {
            var departments = await (await As("test.superadmin")).GetFromJsonAsync<List<DepartmentDto>>("/api/admin/departments");

            var cp = Assert.Single(departments!, d => d.Id == OrgSeed.ContributionProcessingId);
            Assert.Equal("CP", cp.Code);
            Assert.Equal("test.hod", cp.Hod!.UserName);
            var matching = Assert.Single(cp.Units, u => u.Id == OrgSeed.ContributionMatchingUnitId);
            Assert.Equal("test.hou", matching.Head!.UserName);
            Assert.Contains(cp.Units, u => u.Id == OrgSeed.RefundUnitId && u.Name == "Refund");

            Assert.Contains(AppRoles.HOD, await RolesOf(await IdOf("test.hod")));
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(await IdOf("test.hou")));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(await IdOf("test.hou")));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(await IdOf("test.caseworker2")));
        }

        [Fact]
        public async Task Only_a_Super_Admin_manages_the_structure()
        {
            var hou = await As("test.hou");
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.GetAsync("/api/admin/departments")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await hou.PostAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/members", new { userId = Guid.NewGuid() })).StatusCode);
        }

        [Fact]
        public async Task Joining_a_unit_makes_a_case_worker_and_leaving_takes_it_away()
        {
            var admin = await As("test.superadmin");
            var person = await NewPersonAsync("member");

            var join = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = person, staffNo = "AP1234" });
            Assert.Equal(HttpStatusCode.OK, join.StatusCode);
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(person));

            var members = await admin.GetFromJsonAsync<List<UnitMemberDto>>($"/api/admin/units/{OrgSeed.RefundUnitId}/members");
            var row = Assert.Single(members!, m => m.UserId == person);
            Assert.Equal("AP1234", row.StaffNo);
            Assert.Equal(StaffCategory.Employee, row.StaffCategory);

            var leave = await admin.DeleteAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members/{person}");
            Assert.Equal(HttpStatusCode.OK, leave.StatusCode);
            Assert.DoesNotContain(AppRoles.CaseWorker, await RolesOf(person));

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.True(await db.UnitMembers.AnyAsync(m => m.UserId == person && !m.IsActive && m.LeftAt != null)); // history kept
            Assert.True(await db.AuditLogs.AnyAsync(a => a.EntityType == "UnitMember" && a.Module == Domain.Enums.AuditModule.Units));
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == person && n.Title == "Your Access Desk access changed"));
        }

        [Fact]
        public async Task A_person_works_in_one_unit_per_department()
        {
            var admin = await As("test.superadmin");
            var person = await NewPersonAsync("onlyone");

            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = person })).StatusCode);
            var second = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/members", new { userId = person });
            var again = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = person });

            Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
            Assert.Contains("Refund", await second.Content.ReadAsStringAsync());
            Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        }

        [Fact]
        public async Task The_HOD_oversees_and_never_works_in_a_unit_of_their_department()
        {
            var admin = await As("test.superadmin");
            var hod = await IdOf("test.hod");
            var worker = await IdOf("test.caseworker1");

            var hodJoins = await admin.PostAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/members", new { userId = hod });
            var workerBecomesHod = await admin.PutAsJsonAsync($"/api/admin/departments/{OrgSeed.ContributionProcessingId}/hod", new { userId = worker });

            Assert.Equal(HttpStatusCode.BadRequest, hodJoins.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, workerBecomesHod.StatusCode);
        }

        [Fact]
        public async Task A_new_head_joins_the_unit_and_the_previous_head_stays_as_a_case_worker()
        {
            var admin = await As("test.superadmin");
            var dept = await admin.PostAsJsonAsync("/api/admin/departments", new { code = "T" + Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant(), name = "Test Dept " + Guid.NewGuid().ToString("N").Substring(0, 6) });
            var department = await dept.Content.ReadFromJsonAsync<DepartmentDto>();
            var unit = await (await admin.PostAsJsonAsync($"/api/admin/departments/{department!.Id}/units", new { code = "U1", name = "Unit One" })).Content.ReadFromJsonAsync<UnitDto>();
            var first = await NewPersonAsync("headone");
            var second = await NewPersonAsync("headtwo");

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{unit!.Id}/head", new { userId = first })).StatusCode);
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(first));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(first));

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = second })).StatusCode);
            Assert.DoesNotContain(AppRoles.HeadOfUnit, await RolesOf(first));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(first));
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(second));

            var members = await admin.GetFromJsonAsync<List<UnitMemberDto>>($"/api/admin/units/{unit.Id}/members");
            Assert.Equal(StaffCategory.Employee, members!.Single(m => m.UserId == first).StaffCategory);
            Assert.Equal(StaffCategory.HeadOfUnit, members.Single(m => m.UserId == second).StaffCategory);
            Assert.True(members.Single(m => m.UserId == second).IsHead);

            // The head cannot simply be removed: choose another head first
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.DeleteAsync($"/api/admin/units/{unit.Id}/members/{second}")).StatusCode);
        }

        [Fact]
        public async Task The_deputy_must_be_a_member_and_gets_Head_of_Unit()
        {
            var admin = await As("test.superadmin");
            var outsider = await NewPersonAsync("outsider");
            var worker = await IdOf("test.caseworker1");

            var refused = await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/deputy", new { userId = outsider });
            Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/deputy", new { userId = worker })).StatusCode);
            Assert.Contains(AppRoles.HeadOfUnit, await RolesOf(worker));

            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/deputy", new { userId = (Guid?)null })).StatusCode);
            Assert.DoesNotContain(AppRoles.HeadOfUnit, await RolesOf(worker));
            Assert.Contains(AppRoles.CaseWorker, await RolesOf(worker));
        }

        [Fact]
        public async Task Departments_and_units_have_unique_codes_and_switch_off_only_when_empty()
        {
            var admin = await As("test.superadmin");

            var duplicate = await admin.PostAsJsonAsync("/api/admin/departments", new { code = "CP", name = "Another" });
            var badCode = await admin.PostAsJsonAsync("/api/admin/departments", new { code = "c p!", name = "Bad Code" });
            var duplicateUnit = await admin.PostAsJsonAsync($"/api/admin/departments/{OrgSeed.ContributionProcessingId}/units", new { code = "CM", name = "Copy" });
            var switchOffBusyUnit = await admin.PatchAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}", new { isActive = false });
            var switchOffBusyDept = await admin.PatchAsJsonAsync($"/api/admin/departments/{OrgSeed.ContributionProcessingId}", new { isActive = false });

            Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, badCode.StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, duplicateUnit.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, switchOffBusyUnit.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, switchOffBusyDept.StatusCode);
        }

        [Fact]
        public async Task Everyone_sees_their_own_place_and_the_departments_they_can_raise_tickets_to()
        {
            var hou = await As("test.hou");
            var requester = await As("test.requester");

            var mine = await hou.GetFromJsonAsync<MyOrganisationDto>("/api/org/me");
            var none = await requester.GetFromJsonAsync<MyOrganisationDto>("/api/org/me");
            var departments = await requester.GetFromJsonAsync<List<OrgDepartmentDto>>("/api/org/departments");

            var cp = Assert.Single(mine!.Departments, d => d.Id == OrgSeed.ContributionProcessingId);
            Assert.False(cp.IsHod);
            var unit = Assert.Single(cp.Units);
            Assert.True(unit.IsHead);
            Assert.True(unit.IsMember);
            Assert.Empty(none!.Departments);
            var listed = Assert.Single(departments!, d => d.Id == OrgSeed.ContributionProcessingId);
            Assert.Equal(2, listed.Units.Count);
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

    Write-Host '3/4 Creating the Organisation migration (Contribution Processing, Contribution Matching, Refund seeded)...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'Organisation', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_Organisation.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

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
    Write-Host 'Done. Step 2a is in place.' -ForegroundColor Green
    Write-Host 'Start the API once: it adds the Departments, Units and UnitMembers tables and seeds Contribution Processing.'
    Write-Host 'The test accounts are placed in the organisation on start (test.hod HOD, test.hou head of Contribution Matching).'
    Write-Host 'In Swagger as test.superadmin: GET /api/admin/departments. As anyone: GET /api/org/me.'
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
