# Step 3 - Catalogue: the 22 Contribution Processing categories and the skills matrix (BRD Section 7, 5.2, FR-7.1, FR-7.3).
# The requester picks a category and describes the request in the ticket body: categories have no extra form fields (decided 3 Nov 2026).
#
# What it adds:
#   - Categories (owning unit, 24-hour timeline, default priority, order, on/off); 15 Contribution Matching and 7 Refund seeded
#   - Skills matrix: which unit members handle which of the unit's categories; warning when an active category has fewer than two
#   - Leaving a unit, or a category moving to another unit, ends the mapping (history kept)
#   - api/catalogue/categories for everyone; api/admin/categories, api/admin/categories/cover-warnings and api/admin/units/{id}/skills for Super Admin
#   - Development: test.hou, test.caseworker1 and test.caseworker3 handle every Contribution Matching category; test.hou2, test.caseworker2 and test.caseworker4 every Refund category
#   - Fixes from the FE-1 report: Swagger marks nullable fields; role changes on the People page say "Access Desk"
#   - Migration Catalogue, and tests
#
# Run from ...\AccessServiceDesk\Backend\ServiceDesk with the API stopped:
#   .\Scripts\step3-catalogue.ps1
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
if (-not (Test-Path (Join-Path $api 'Domain\Entities\Absence.cs'))) { Write-Host 'Step 2b is not in place. Run step2b-availability.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Domain\Entities\Catalogue.cs')) { Write-Host 'Catalogue.cs already exists: Step 3 looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as the earlier step scripts wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = '3b218e0eca40cbc7bec9f374e64ade0d382f785b567a56e44ed7624b1a25262d'
    'ServiceDeskAPI\Infrastructure\Organisation\OrganisationService.cs' = 'ee55a770bea84febafedf248f406f45fad6d498564afdeb72d142bc95273c321'
    'ServiceDeskAPI\Infrastructure\Services\AdminUserService.cs' = '881bfdaf55c64b2478096b72bf7fbc2238c0ec9775bd0e8aec36df4a953cb318'
    'ServiceDeskAPI\Infrastructure\Services\TestAccountSeeder.cs' = '4de441c0258a9eafcb466a455585d51e0d1cb99cbdda3b5e95e12b51f3bacf96'
    'ServiceDeskAPI\Program.cs' = '04e1e4a717d3d20ca6463320e63a263fe1f07e9b9e378c0bebbe689925819a51'
    'tests\ServiceDeskAPI.Tests\Admin\AdminUsersTests.cs' = '6748a5a6cfa86649c2d1e32ab88fb6b8c8697455724c0f37095958aef31e7615'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed since they were last written by a step script, so Step 3 stopped to avoid overwriting your changes:' -ForegroundColor Red
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
                // Mark nullable fields (string?, nested objects that can be null) as nullable in the contract
                options.SupportNonNullableReferenceTypes();
                options.UseAllOfToExtendReferenceSchemas();
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
            builder.Services.AddScoped<ICatalogueService, ServiceDeskAPI.Infrastructure.Catalogue.CatalogueService>();
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
$files['ServiceDeskAPI\Application\DTOs\CatalogueDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>What a requester chooses from: active categories of active departments (no owning unit or staffing shown).</summary>
    public class CatalogueDepartmentDto
    {
        public Guid DepartmentId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public List<CatalogueCategoryDto> Categories { get; set; } = new();
    }

    public class CatalogueCategoryDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        /// <summary>1 Low, 2 Medium, 3 High, 4 Critical.</summary>
        public TicketPriority DefaultPriority { get; set; }
    }

    /// <summary>A category as the Super Admin manages it, with how many case workers can take it.</summary>
    public class CategoryAdminDto
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public int TimelineHours { get; set; }
        public TicketPriority DefaultPriority { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; }
        /// <summary>Case workers mapped to it who are active members of its unit with an active account.</summary>
        public int EligibleCount { get; set; }
        /// <summary>True for an active category with fewer than two eligible case workers (BRD 5.2).</summary>
        public bool NeedsCover { get; set; }
    }

    public class CreateCategoryRequest
    {
        public Guid UnitId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public int TimelineHours { get; set; } = 24;
        public TicketPriority DefaultPriority { get; set; } = TicketPriority.Medium;
    }

    /// <summary>Leave a field out (null) to keep it. unitId moves the category to another unit of the same department.</summary>
    public class UpdateCategoryRequest
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public Guid? UnitId { get; set; }
        public int? TimelineHours { get; set; }
        public TicketPriority? DefaultPriority { get; set; }
        public int? SortOrder { get; set; }
        public bool? IsActive { get; set; }
    }

    /// <summary>The skills matrix for one unit: its categories (columns) and members (rows).</summary>
    public class UnitSkillsDto
    {
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public List<SkillCategoryDto> Categories { get; set; } = new();
        public List<SkillMemberDto> Members { get; set; } = new();
        /// <summary>Active categories of the unit with fewer than two eligible case workers.</summary>
        public List<CategoryCoverDto> Warnings { get; set; } = new();
    }

    public class SkillCategoryDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public int EligibleCount { get; set; }
    }

    public class SkillMemberDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public StaffCategory StaffCategory { get; set; }
        public bool AccountActive { get; set; }
        public List<Guid> CategoryIds { get; set; } = new();
    }

    public class CategoryCoverDto
    {
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public int EligibleCount { get; set; }
    }

    /// <summary>The categories (of the unit) this person handles. Replaces their current set in that unit.</summary>
    public class SetSkillsRequest
    {
        public List<Guid> CategoryIds { get; set; } = new();
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\ICatalogueService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The service catalogue (BRD Section 7, FR-7.1) and the skills matrix (BRD 5.2, FR-7.3). actorUserId is null for the system
    /// (Development seeding).
    /// </summary>
    public interface ICatalogueService
    {
        /// <summary>Active categories of active departments and units, for anyone raising a ticket.</summary>
        Task<List<CatalogueDepartmentDto>> ListForRequestersAsync();

        Task<List<CategoryAdminDto>> ListAsync(Guid? departmentId);
        Task<(AdminResult Result, CategoryAdminDto? Category)> CreateAsync(CreateCategoryRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateAsync(Guid categoryId, UpdateCategoryRequest request, Guid? actorUserId);

        Task<UnitSkillsDto?> GetUnitSkillsAsync(Guid unitId);
        /// <summary>Sets exactly which of the unit's categories this member handles. The message names categories left short of cover.</summary>
        Task<AdminResult> SetSkillsAsync(Guid unitId, Guid userId, IReadOnlyCollection<Guid> categoryIds, Guid? actorUserId);
        /// <summary>Every active category with fewer than two eligible case workers.</summary>
        Task<List<CategoryCoverDto>> CoverWarningsAsync();

        /// <summary>For automatic assignment (Step 4): mapped, active members of the owning unit with active accounts. Availability is checked separately.</summary>
        Task<List<Guid>> EligibleCaseWorkerIdsAsync(Guid categoryId);
    }
}
'@
$files['ServiceDeskAPI\Controllers\CatalogueController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Super Admin: categories (BRD Section 7, FR-7.1) and the skills matrix (BRD 5.2, FR-7.3).</summary>
    [ApiController]
    [Route("api/admin")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminCatalogueController : ControllerBase
    {
        private readonly ICatalogueService _catalogue;

        public AdminCatalogueController(ICatalogueService catalogue) => _catalogue = catalogue;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        private ActionResult<MessageDto> From(AdminResult result) =>
            result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));

        /// <summary>Categories (all departments, or one), with how many case workers can take each and whether it needs cover.</summary>
        [HttpGet("categories")]
        [ProducesResponseType(typeof(List<CategoryAdminDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CategoryAdminDto>>> Categories([FromQuery] Guid? departmentId) => Ok(await _catalogue.ListAsync(departmentId));

        /// <summary>New category in a unit (and so in that unit's department).</summary>
        [HttpPost("categories")]
        [ProducesResponseType(typeof(CategoryAdminDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CategoryAdminDto>> Create([FromBody] CreateCategoryRequest request)
        {
            if (request.UnitId == Guid.Empty) return BadRequest(new ApiError("Choose the unit that handles it.", "unitId", "Choose a unit."));
            var (result, category) = await _catalogue.CreateAsync(request, Actor());
            return result.Success && category != null ? Ok(category) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename, describe, move to another unit of the department, change timeline, priority or order, switch on or off.</summary>
        [HttpPatch("categories/{categoryId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Update(Guid categoryId, [FromBody] UpdateCategoryRequest request)
            => From(await _catalogue.UpdateAsync(categoryId, request, Actor()));

        /// <summary>Active categories with fewer than two eligible case workers (BRD 5.2).</summary>
        [HttpGet("categories/cover-warnings")]
        [ProducesResponseType(typeof(List<CategoryCoverDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CategoryCoverDto>>> CoverWarnings() => Ok(await _catalogue.CoverWarningsAsync());

        /// <summary>The skills matrix of a unit: its categories, its members and what each handles.</summary>
        [HttpGet("units/{unitId:guid}/skills")]
        [ProducesResponseType(typeof(UnitSkillsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<UnitSkillsDto>> Skills(Guid unitId)
        {
            var skills = await _catalogue.GetUnitSkillsAsync(unitId);
            return skills == null ? NotFound(new ApiError("Unit not found.")) : Ok(skills);
        }

        /// <summary>Sets exactly which of the unit's categories this member handles (an empty list clears them).</summary>
        [HttpPut("units/{unitId:guid}/skills/{userId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> SetSkills(Guid unitId, Guid userId, [FromBody] SetSkillsRequest request)
            => From(await _catalogue.SetSkillsAsync(unitId, userId, request.CategoryIds ?? new List<Guid>(), Actor()));
    }

    /// <summary>The catalogue as any signed-in person sees it when raising a ticket.</summary>
    [ApiController]
    [Route("api/catalogue")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class CatalogueController : ControllerBase
    {
        private readonly ICatalogueService _catalogue;

        public CatalogueController(ICatalogueService catalogue) => _catalogue = catalogue;

        /// <summary>Active departments with the categories a requester can choose. The requester describes the request in the ticket body.</summary>
        [HttpGet("categories")]
        [ProducesResponseType(typeof(List<CatalogueDepartmentDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<CatalogueDepartmentDto>>> Categories() => Ok(await _catalogue.ListForRequestersAsync());
    }
}
'@
$files['ServiceDeskAPI\Domain\Catalogue\CatalogueSeed.cs'] = @'
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Domain.Catalogue
{
    /// <summary>
    /// The Contribution Processing catalogue at launch (BRD Section 7, from ISSUES_RESOLUTION.xlsx): 22 categories, 15 owned by
    /// Contribution Matching and 7 by Refund, each with a 24-hour timeline and Medium default priority. Fixed ids so the seed is stable.
    /// A Super Admin adds, renames, moves or switches off categories afterwards without code changes.
    /// </summary>
    public static class CatalogueSeed
    {
        public sealed record SeedCategory(Guid Id, Guid UnitId, string Name);

        public static readonly IReadOnlyList<SeedCategory> Categories = new List<SeedCategory>
        {
            new(new Guid("5d1a0003-0000-4000-8000-000000000001"), OrgSeed.ContributionMatchingUnitId, "Account Reconciliation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000002"), OrgSeed.ContributionMatchingUnitId, "Accrued Rights"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000003"), OrgSeed.ContributionMatchingUnitId, "Evidence of Remittance"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000004"), OrgSeed.ContributionMatchingUnitId, "Clarification of Narration"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000005"), OrgSeed.ContributionMatchingUnitId, "Employer Narration Change"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000006"), OrgSeed.ContributionMatchingUnitId, "Period Narration Change"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000007"), OrgSeed.ContributionMatchingUnitId, "PPP Payment Confirmation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000008"), OrgSeed.ContributionMatchingUnitId, "Missing Remittance"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000009"), OrgSeed.ContributionMatchingUnitId, "Employer Confirmation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000010"), OrgSeed.ContributionMatchingUnitId, "Excess Remittance Confirmation"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000011"), OrgSeed.ContributionMatchingUnitId, "Fund Movement"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000012"), OrgSeed.RefundUnitId, "Transaction History Request"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000013"), OrgSeed.ContributionMatchingUnitId, "MPS to CPS"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000014"), OrgSeed.ContributionMatchingUnitId, "Schedule Submission"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000015"), OrgSeed.ContributionMatchingUnitId, "PIN Change"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000016"), OrgSeed.ContributionMatchingUnitId, "PPP Refund"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000017"), OrgSeed.RefundUnitId, "Transfer to Other PFAs"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000018"), OrgSeed.RefundUnitId, "Refund to Employers"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000019"), OrgSeed.RefundUnitId, "Correction of Invalid PINs"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000020"), OrgSeed.RefundUnitId, "Provision of Schedules for Multiple PINs Request to BA"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000021"), OrgSeed.RefundUnitId, "Query Resolution"),
            new(new Guid("5d1a0003-0000-4000-8000-000000000022"), OrgSeed.RefundUnitId, "TCF Reconciliation"),
        };
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\Catalogue.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A kind of request a department handles (BRD Section 7, FR-7.1), owned by one of its units. The requester picks a category and
    /// describes the request in the ticket body; categories have no extra form fields (decided 3 Nov 2026).
    /// </summary>
    public class Category
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        /// <summary>The unit whose case workers handle it. Can move to another unit of the same department.</summary>
        public Guid UnitId { get; set; }
        public Unit? Unit { get; set; }
        public string Name { get; set; } = string.Empty;
        /// <summary>Optional one-line help shown to requesters when choosing.</summary>
        public string? Description { get; set; }
        /// <summary>Resolution timeline in business hours (24 at launch).</summary>
        public int TimelineHours { get; set; } = 24;
        public TicketPriority DefaultPriority { get; set; } = TicketPriority.Medium;
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }

        public ICollection<CategorySkill> Skills { get; set; } = new List<CategorySkill>();
    }

    /// <summary>
    /// The skills matrix (BRD 5.2, FR-7.3): this case worker handles this category. Only members of the category's unit.
    /// Ending keeps the row (IsActive false) as history; leaving the unit or moving the category to another unit ends it.
    /// </summary>
    public class CategorySkill
    {
        public Guid Id { get; set; }
        public Guid CategoryId { get; set; }
        public Category? Category { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime AddedAt { get; set; } = DateTime.UtcNow;
        public Guid? AddedByUserId { get; set; }
        public DateTime? RemovedAt { get; set; }
        public Guid? RemovedByUserId { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Domain\Enums\TicketPriority.cs'] = @'
namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Ticket priority (BRD FR-2.2). Workload weights: Critical 3, High 2, Medium 1, Low 1 (FR-3.3).</summary>
    public enum TicketPriority
    {
        Low = 1,
        Medium = 2,
        High = 3,
        Critical = 4
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Catalogue\CatalogueService.cs'] = @'
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Catalogue
{
    /// <summary>
    /// Categories and the skills matrix. Rules:
    /// - a category belongs to one unit (and so one department); names are unique within the department;
    /// - it can move to another active unit of the same department; skills of people who are not in the new unit end;
    /// - only active members of the owning unit can be mapped; leaving the unit ends their skills there (OrganisationService);
    /// - an active category should have at least two eligible case workers: the Super Admin is warned, nothing is blocked.
    /// </summary>
    public class CatalogueService : ICatalogueService
    {
        private const int MinCover = 2;

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly ILogger<CatalogueService> _logger;

        public CatalogueService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, ILogger<CatalogueService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _logger = logger;
        }

        // ---------------- reading ----------------

        public async Task<List<CatalogueDepartmentDto>> ListForRequestersAsync()
        {
            var rows = await _db.Categories.AsNoTracking()
                .Where(c => c.IsActive && c.Unit!.IsActive && c.Department!.IsActive)
                .OrderBy(c => c.Department!.Name).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new
                {
                    c.DepartmentId, DepartmentCode = c.Department!.Code, DepartmentName = c.Department.Name,
                    Category = new CatalogueCategoryDto { Id = c.Id, Name = c.Name, Description = c.Description, DefaultPriority = c.DefaultPriority }
                })
                .ToListAsync();
            return rows.GroupBy(r => new { r.DepartmentId, r.DepartmentCode, r.DepartmentName })
                .Select(g => new CatalogueDepartmentDto
                {
                    DepartmentId = g.Key.DepartmentId, Code = g.Key.DepartmentCode, Name = g.Key.DepartmentName,
                    Categories = g.Select(r => r.Category).ToList()
                })
                .ToList();
        }

        public async Task<List<CategoryAdminDto>> ListAsync(Guid? departmentId)
        {
            var query = _db.Categories.AsNoTracking();
            if (departmentId.HasValue) query = query.Where(c => c.DepartmentId == departmentId.Value);
            var list = await query
                .OrderBy(c => c.Department!.Name).ThenByDescending(c => c.IsActive).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new CategoryAdminDto
                {
                    Id = c.Id, DepartmentId = c.DepartmentId, DepartmentName = c.Department!.Name, UnitId = c.UnitId, UnitName = c.Unit!.Name,
                    Name = c.Name, Description = c.Description, TimelineHours = c.TimelineHours, DefaultPriority = c.DefaultPriority,
                    SortOrder = c.SortOrder, IsActive = c.IsActive
                })
                .ToListAsync();
            var counts = await EligibleCountsAsync(list.Select(c => c.Id).ToList());
            foreach (var c in list)
            {
                c.EligibleCount = counts.GetValueOrDefault(c.Id);
                c.NeedsCover = c.IsActive && c.EligibleCount < MinCover;
            }
            return list;
        }

        public async Task<UnitSkillsDto?> GetUnitSkillsAsync(Guid unitId)
        {
            var unit = await _db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return null;

            var categories = await _db.Categories.AsNoTracking()
                .Where(c => c.UnitId == unitId)
                .OrderByDescending(c => c.IsActive).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new SkillCategoryDto { Id = c.Id, Name = c.Name, IsActive = c.IsActive })
                .ToListAsync();
            var categoryIds = categories.Select(c => c.Id).ToList();
            var counts = await EligibleCountsAsync(categoryIds);
            foreach (var c in categories) c.EligibleCount = counts.GetValueOrDefault(c.Id);

            var members = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive)
                .OrderByDescending(m => m.StaffCategory).ThenBy(m => m.User!.FullName ?? m.User.UserName)
                .Select(m => new SkillMemberDto
                {
                    UserId = m.UserId, UserName = m.User!.UserName ?? string.Empty, FullName = m.User.FullName,
                    StaffCategory = m.StaffCategory, AccountActive = m.User.IsActive
                })
                .ToListAsync();
            var memberIds = members.Select(m => m.UserId).ToList();
            var skills = await _db.CategorySkills.AsNoTracking()
                .Where(s => s.IsActive && memberIds.Contains(s.UserId) && categoryIds.Contains(s.CategoryId))
                .Select(s => new { s.UserId, s.CategoryId })
                .ToListAsync();
            foreach (var m in members)
                m.CategoryIds = skills.Where(s => s.UserId == m.UserId).Select(s => s.CategoryId).ToList();

            return new UnitSkillsDto
            {
                UnitId = unit.Id,
                UnitName = unit.Name,
                Categories = categories,
                Members = members,
                Warnings = unit.IsActive
                    ? categories.Where(c => c.IsActive && c.EligibleCount < MinCover)
                        .Select(c => new CategoryCoverDto { CategoryId = c.Id, CategoryName = c.Name, UnitId = unit.Id, UnitName = unit.Name, EligibleCount = c.EligibleCount })
                        .ToList()
                    : new List<CategoryCoverDto>()
            };
        }

        public async Task<List<CategoryCoverDto>> CoverWarningsAsync()
        {
            var categories = await _db.Categories.AsNoTracking()
                .Where(c => c.IsActive && c.Unit!.IsActive && c.Department!.IsActive)
                .OrderBy(c => c.Unit!.Name).ThenBy(c => c.SortOrder)
                .Select(c => new CategoryCoverDto { CategoryId = c.Id, CategoryName = c.Name, UnitId = c.UnitId, UnitName = c.Unit!.Name })
                .ToListAsync();
            var counts = await EligibleCountsAsync(categories.Select(c => c.CategoryId).ToList());
            foreach (var c in categories) c.EligibleCount = counts.GetValueOrDefault(c.CategoryId);
            return categories.Where(c => c.EligibleCount < MinCover).ToList();
        }

        public async Task<List<Guid>> EligibleCaseWorkerIdsAsync(Guid categoryId) =>
            await EligibleSkills()
                .Where(s => s.CategoryId == categoryId && s.Category!.IsActive)
                .Select(s => s.UserId)
                .Distinct()
                .ToListAsync();

        // ---------------- categories ----------------

        public async Task<(AdminResult Result, CategoryAdminDto? Category)> CreateAsync(CreateCategoryRequest request, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == request.UnitId);
            if (unit == null) return (AdminResult.NotFound("Unit not found."), null);
            if (!unit.IsActive || !unit.Department!.IsActive) return (AdminResult.Invalid("Switch the unit (and its department) on first."), null);

            var name = (request.Name ?? string.Empty).Trim();
            var problem = CheckName(name) ?? CheckDescription(request.Description) ?? CheckTimeline(request.TimelineHours) ?? CheckPriority(request.DefaultPriority);
            if (problem != null) return (AdminResult.Invalid(problem), null);
            if (await _db.Categories.AnyAsync(c => c.DepartmentId == unit.DepartmentId && c.Name == name))
                return (AdminResult.Conflict(unit.Department.Name + " already has a category named " + name + "."), null);

            var nextOrder = (await _db.Categories.Where(c => c.DepartmentId == unit.DepartmentId).MaxAsync(c => (int?)c.SortOrder) ?? 0) + 1;
            var category = new Category
            {
                Id = Guid.NewGuid(), DepartmentId = unit.DepartmentId, UnitId = unit.Id, Name = name, Description = Clean(request.Description),
                TimelineHours = request.TimelineHours, DefaultPriority = request.DefaultPriority, SortOrder = nextOrder, IsActive = true,
                CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId
            };
            _db.Categories.Add(category);
            Stage(AuditAction.Created, "Category", category.Id, name, null,
                new { unit = unit.Code, name, category.TimelineHours, defaultPriority = category.DefaultPriority.ToString() });

            var result = await SaveAsync("Category " + name + " created. Map at least two case workers to it.", "A category with that name already exists.");
            return (result, result.Success ? (await ListAsync(unit.DepartmentId)).First(c => c.Id == category.Id) : null);
        }

        public async Task<AdminResult> UpdateAsync(Guid categoryId, UpdateCategoryRequest request, Guid? actorUserId)
        {
            var category = await _db.Categories.Include(c => c.Unit).Include(c => c.Department).FirstOrDefaultAsync(c => c.Id == categoryId);
            if (category == null) return AdminResult.NotFound("Category not found.");
            var before = new { category.Name, category.Description, unitId = category.UnitId, category.TimelineHours, defaultPriority = category.DefaultPriority.ToString(), category.SortOrder, category.IsActive };
            var notes = new List<string>();

            if (request.Name != null)
            {
                var name = request.Name.Trim();
                var problem = CheckName(name);
                if (problem != null) return AdminResult.Invalid(problem);
                if (await _db.Categories.AnyAsync(c => c.Id != categoryId && c.DepartmentId == category.DepartmentId && c.Name == name))
                    return AdminResult.Conflict(category.Department!.Name + " already has a category named " + name + ".");
                category.Name = name;
            }
            if (request.Description != null)
            {
                var problem = CheckDescription(request.Description);
                if (problem != null) return AdminResult.Invalid(problem);
                category.Description = Clean(request.Description);
            }
            if (request.TimelineHours.HasValue)
            {
                var problem = CheckTimeline(request.TimelineHours.Value);
                if (problem != null) return AdminResult.Invalid(problem);
                category.TimelineHours = request.TimelineHours.Value;
            }
            if (request.DefaultPriority.HasValue)
            {
                var problem = CheckPriority(request.DefaultPriority.Value);
                if (problem != null) return AdminResult.Invalid(problem);
                category.DefaultPriority = request.DefaultPriority.Value;
            }
            if (request.SortOrder.HasValue)
            {
                if (request.SortOrder.Value < 0 || request.SortOrder.Value > 9999) return AdminResult.Invalid("The order must be between 0 and 9999.");
                category.SortOrder = request.SortOrder.Value;
            }
            if (request.UnitId.HasValue && request.UnitId.Value != category.UnitId)
            {
                var target = await _db.Units.FirstOrDefaultAsync(u => u.Id == request.UnitId.Value);
                if (target == null) return AdminResult.NotFound("Unit not found.");
                if (target.DepartmentId != category.DepartmentId) return AdminResult.Invalid("A category stays in its department. Choose a unit of " + category.Department!.Name + ".");
                if (!target.IsActive) return AdminResult.Invalid("Switch " + target.Name + " on first.");

                // Skills belong to the owning unit: anyone who is not in the new unit stops handling it
                var newMembers = await _db.UnitMembers.Where(m => m.UnitId == target.Id && m.IsActive).Select(m => m.UserId).ToListAsync();
                var ending = await _db.CategorySkills.Where(s => s.CategoryId == categoryId && s.IsActive && !newMembers.Contains(s.UserId)).ToListAsync();
                foreach (var skill in ending)
                {
                    skill.IsActive = false;
                    skill.RemovedAt = DateTime.UtcNow;
                    skill.RemovedByUserId = actorUserId;
                }
                category.UnitId = target.Id;
                notes.Add("Moved to " + target.Name + "." + (ending.Count > 0 ? " " + ending.Count + " case worker mapping" + (ending.Count == 1 ? " was" : "s were") + " removed." : string.Empty)
                    + " Map case workers of " + target.Name + " to it.");
            }
            if (request.IsActive.HasValue && request.IsActive.Value != category.IsActive)
            {
                if (request.IsActive.Value)
                {
                    var owner = await _db.Units.Include(u => u.Department).FirstAsync(u => u.Id == category.UnitId);
                    if (!owner.IsActive || !owner.Department!.IsActive) return AdminResult.Invalid("Switch " + owner.Name + " (and its department) on first.");
                }
                category.IsActive = request.IsActive.Value;
                notes.Add(category.IsActive ? "Requesters can choose it again." : "Requesters can no longer choose it.");
            }

            category.UpdatedAt = DateTime.UtcNow;
            category.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Category", category.Id, category.Name, before,
                new { category.Name, category.Description, unitId = category.UnitId, category.TimelineHours, defaultPriority = category.DefaultPriority.ToString(), category.SortOrder, category.IsActive });
            return await SaveAsync(string.Join(" ", new[] { "Category " + category.Name + " updated." }.Concat(notes)), "A category with that name already exists.");
        }

        // ---------------- skills matrix ----------------

        public async Task<AdminResult> SetSkillsAsync(Guid unitId, Guid userId, IReadOnlyCollection<Guid> categoryIds, Guid? actorUserId)
        {
            var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            var member = await _db.UnitMembers.Include(m => m.User).FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive);
            if (member?.User == null) return AdminResult.Invalid("Only members of " + unit.Name + " can handle its categories. Add them to the unit first.");

            var unitCategories = await _db.Categories.Where(c => c.UnitId == unitId).ToListAsync();
            var wanted = categoryIds.Distinct().ToList();
            var foreign = wanted.Where(id => unitCategories.All(c => c.Id != id)).ToList();
            if (foreign.Count > 0) return AdminResult.Invalid("Only categories owned by " + unit.Name + " can be mapped here.");

            var unitCategoryIds = unitCategories.Select(c => c.Id).ToList();
            var current = await _db.CategorySkills.Where(s => s.UserId == userId && s.IsActive && unitCategoryIds.Contains(s.CategoryId)).ToListAsync();
            var adding = wanted.Where(id => current.All(s => s.CategoryId != id)).ToList();
            var ending = current.Where(s => !wanted.Contains(s.CategoryId)).ToList();

            if (adding.Count > 0 && !member.User.IsActive) return AdminResult.Invalid(Name(member.User) + " is blocked.");
            var switchedOff = unitCategories.Where(c => adding.Contains(c.Id) && !c.IsActive).Select(c => c.Name).ToList();
            if (switchedOff.Count > 0) return AdminResult.Invalid("Switched off: " + string.Join(", ", switchedOff) + ". Switch it on first.");
            if (adding.Count == 0 && ending.Count == 0) return AdminResult.Ok("No change.");

            foreach (var id in adding)
                _db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = id, UserId = userId, IsActive = true, AddedAt = DateTime.UtcNow, AddedByUserId = actorUserId });
            foreach (var skill in ending)
            {
                skill.IsActive = false;
                skill.RemovedAt = DateTime.UtcNow;
                skill.RemovedByUserId = actorUserId;
            }

            string NamesOf(IEnumerable<Guid> ids) => string.Join(", ", unitCategories.Where(c => ids.Contains(c.Id)).OrderBy(c => c.SortOrder).Select(c => c.Name));
            Stage(AuditAction.Updated, "CategorySkills", userId, member.User.UserName,
                new { unit = unit.Code, categories = NamesOf(current.Select(s => s.CategoryId)) },
                new { unit = unit.Code, categories = NamesOf(wanted) });
            _notifications.Stage(userId, "Your categories in " + unit.Name + " changed",
                wanted.Count == 0
                    ? "You are no longer mapped to any category in " + unit.Name + "."
                    : "You now handle " + wanted.Count + " categor" + (wanted.Count == 1 ? "y" : "ies") + ": " + NamesOf(wanted) + ".",
                NotificationType.Info, NotificationCategory.System, "CategorySkills", userId, null);

            var saved = await SaveAsync(Name(member.User) + " now handles " + wanted.Count + " categor" + (wanted.Count == 1 ? "y" : "ies") + " in " + unit.Name + ".",
                "The change could not be saved; try again.");
            if (!saved.Success) return saved;

            var counts = await EligibleCountsAsync(unitCategoryIds);
            var short_ = unitCategories.Where(c => c.IsActive && counts.GetValueOrDefault(c.Id) < MinCover).OrderBy(c => c.SortOrder).Select(c => c.Name).ToList();
            return short_.Count == 0 || !unit.IsActive
                ? saved
                : AdminResult.Ok(saved.Message + " Fewer than two case workers handle: " + string.Join(", ", short_) + ".");
        }

        // ---------------- helpers ----------------

        /// <summary>Mapped, still a member of the owning unit, account active, unit active.</summary>
        private IQueryable<CategorySkill> EligibleSkills() =>
            _db.CategorySkills.AsNoTracking().Where(s => s.IsActive && s.User!.IsActive && s.Category!.Unit!.IsActive
                && _db.UnitMembers.Any(m => m.UserId == s.UserId && m.UnitId == s.Category.UnitId && m.IsActive));

        private async Task<Dictionary<Guid, int>> EligibleCountsAsync(List<Guid> categoryIds)
        {
            if (categoryIds.Count == 0) return new Dictionary<Guid, int>();
            return await EligibleSkills()
                .Where(s => categoryIds.Contains(s.CategoryId))
                .GroupBy(s => s.CategoryId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count);
        }

        private async Task<AdminResult> SaveAsync(string okMessage, string conflictMessage)
        {
            try
            {
                await _db.SaveChangesAsync();
                return AdminResult.Ok(okMessage);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Catalogue change refused by the database");
                _db.ChangeTracker.Clear();
                return AdminResult.Conflict(conflictMessage);
            }
        }

        private static string? CheckName(string name) =>
            name.Length < 2 || name.Length > 100 ? "The name must be 2 to 100 characters." : null;

        private static string? CheckDescription(string? description) =>
            description != null && description.Trim().Length > 300 ? "The description must be at most 300 characters." : null;

        private static string? CheckTimeline(int hours) =>
            hours < 1 || hours > 720 ? "The timeline must be between 1 and 720 business hours." : null;

        private static string? CheckPriority(TicketPriority priority) =>
            Enum.IsDefined(priority) ? null : "Choose Low, Medium, High or Critical.";

        private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

        private void Stage(AuditAction action, string entityType, Guid entityId, string? display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, entityType, entityId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Catalogue);
        }

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
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
            // Their categories in this unit end with the membership (Step 3 skills matrix); history kept
            var skills = await _db.CategorySkills.Where(s => s.UserId == userId && s.IsActive && s.Category!.UnitId == unitId).ToListAsync();
            foreach (var skill in skills)
            {
                skill.IsActive = false;
                skill.RemovedAt = DateTime.UtcNow;
                skill.RemovedByUserId = actorUserId;
            }
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
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Enums;
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
        public DbSet<Category> Categories => Set<Category>();
        public DbSet<CategorySkill> CategorySkills => Set<CategorySkill>();

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
            ConfigureCatalogue(builder);
        }

        private static void ConfigureCatalogue(ModelBuilder builder)
        {
            builder.Entity<Category>(e =>
            {
                e.ToTable("Categories");
                e.HasKey(c => c.Id);
                e.Property(c => c.Name).HasMaxLength(100).IsRequired();
                e.Property(c => c.Description).HasMaxLength(300);
                e.HasOne(c => c.Department).WithMany().HasForeignKey(c => c.DepartmentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(c => c.Unit).WithMany().HasForeignKey(c => c.UnitId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(c => new { c.DepartmentId, c.Name }).IsUnique();
                e.HasIndex(c => c.UnitId);
                e.HasData(CatalogueSeed.Categories.Select((c, i) => new Category
                {
                    Id = c.Id, DepartmentId = OrgSeed.ContributionProcessingId, UnitId = c.UnitId, Name = c.Name,
                    TimelineHours = 24, DefaultPriority = TicketPriority.Medium, SortOrder = i + 1, IsActive = true, CreatedAt = SeedDate
                }).ToArray());
            });

            builder.Entity<CategorySkill>(e =>
            {
                e.ToTable("CategorySkills");
                e.HasKey(s => s.Id);
                e.HasOne(s => s.Category).WithMany(c => c.Skills).HasForeignKey(s => s.CategoryId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(s => s.User).WithMany().HasForeignKey(s => s.UserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(s => new { s.CategoryId, s.UserId }).IsUnique().HasFilter("[IsActive] = 1").HasDatabaseName("IX_CategorySkills_CategoryId_UserId_Active");
                e.HasIndex(s => s.UserId);
            });
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
            _notifications.Stage(userId, "Your Access Desk access changed",
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
                return AdminResult.Invalid("Every staff member is a Requester. To stop someone using Access Desk, block their account instead.");
            if (roleId == AppRoles.SuperAdminId && await SuperAdminRules.IsLastAsync(_db, userId))
                return AdminResult.Invalid("This is the last Super Admin. Give the role to someone else first.");

            assignment.IsActive = false;
            assignment.DisabledAt = DateTime.UtcNow;
            assignment.DisabledByUserId = actorUserId;
            var link = await _db.UserRoles.FirstOrDefaultAsync(r => r.UserId == userId && r.RoleId == roleId);
            if (link != null) _db.UserRoles.Remove(link);

            Stage(AuditAction.RoleChanged, assignment.User, Json(new { removed = assignment.Role.Name }), null);
            _notifications.Stage(userId, "Your Access Desk access changed",
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
using Microsoft.EntityFrameworkCore;
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
    /// Their Case Worker / Head of Unit / HOD roles follow from that. Each of them handles every category of their unit (Step 3).
    /// Safe to run on every start.
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

            // Step 3: each test case worker (heads included) handles every active category of their unit, so each category has
            // three eligible people. Only for people with no mapping yet, so changes made on the skills page survive a restart.
            var db = services.GetRequiredService<AppDbContext>();
            var catalogue = services.GetRequiredService<ICatalogueService>();
            var teams = new (Guid UnitId, Guid?[] People)[]
            {
                (OrgSeed.ContributionMatchingUnitId, new[] { hou, cw1, cw3 }),
                (OrgSeed.RefundUnitId, new[] { hou2, cw2, cw4 })
            };
            foreach (var (unitId, people) in teams)
            {
                var categoryIds = await db.Categories.Where(c => c.UnitId == unitId && c.IsActive).Select(c => c.Id).ToListAsync();
                foreach (var person in people)
                {
                    if (!person.HasValue || await db.CategorySkills.AnyAsync(s => s.UserId == person.Value && s.IsActive)) continue;
                    Log(logger, "Categories for a test case worker", await catalogue.SetSkillsAsync(unitId, person.Value, categoryIds, null));
                }
            }
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
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RecipientUserId == target && n.Title == "Your Access Desk access changed"));
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
$files['tests\ServiceDeskAPI.Tests\Catalogue\CatalogueTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Catalogue
{
    /// <summary>Step 3: the 22 categories, managing them, and the skills matrix with its two-per-category warning (BRD 5.2, Section 7).</summary>
    public class CatalogueTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public CatalogueTests(ServiceDeskApiFactory factory) => _factory = factory;

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
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        /// <summary>A new person added to the unit by the Super Admin.</summary>
        private async Task<Guid> NewMemberAsync(Guid unitId)
        {
            Guid id;
            using (var scope = _factory.Services.CreateScope())
            {
                var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var name = "cat." + Guid.NewGuid().ToString("N").Substring(0, 8);
                var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
                var created = await users.CreateAsync(user);
                Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
                await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
                id = user.Id;
            }
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.superadmin")).PostAsJsonAsync($"/api/admin/units/{unitId}/members", new { userId = id })).StatusCode);
            return id;
        }

        private async Task<CategoryAdminDto> NewCategoryAsync(HttpClient admin, Guid unitId)
        {
            var response = await admin.PostAsJsonAsync("/api/admin/categories", new { unitId, name = "Test Category " + Guid.NewGuid().ToString("N").Substring(0, 6), timelineHours = 24, defaultPriority = 2 });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            return (await response.Content.ReadFromJsonAsync<CategoryAdminDto>())!;
        }

        [Fact]
        public async Task The_22_Contribution_Processing_categories_are_seeded_in_their_units()
        {
            var all = await (await As("test.superadmin")).GetFromJsonAsync<List<CategoryAdminDto>>($"/api/admin/categories?departmentId={OrgSeed.ContributionProcessingId}");
            var seeded = all!.Where(c => CatalogueSeed.Categories.Any(s => s.Id == c.Id)).ToList();

            Assert.Equal(22, seeded.Count);
            Assert.Equal(15, seeded.Count(c => c.UnitId == OrgSeed.ContributionMatchingUnitId));
            Assert.Equal(7, seeded.Count(c => c.UnitId == OrgSeed.RefundUnitId));
            Assert.All(seeded, c => Assert.Equal(24, c.TimelineHours));
            Assert.All(seeded, c => Assert.Equal(TicketPriority.Medium, c.DefaultPriority));
            Assert.Equal("Refund", seeded.Single(c => c.Name == "Transaction History Request").UnitName);
            // Development: three test people handle every category of their unit
            Assert.All(seeded, c => Assert.Equal(3, c.EligibleCount));
            Assert.DoesNotContain(seeded, c => c.NeedsCover);
        }

        [Fact]
        public async Task Requesters_see_active_categories_and_only_a_Super_Admin_manages_them()
        {
            var requester = await As("test.requester");

            var catalogue = await requester.GetFromJsonAsync<List<CatalogueDepartmentDto>>("/api/catalogue/categories");
            var cp = Assert.Single(catalogue!, d => d.DepartmentId == OrgSeed.ContributionProcessingId);
            Assert.Equal("Account Reconciliation", cp.Categories.First().Name);
            Assert.True(cp.Categories.Count >= 22);

            Assert.Equal(HttpStatusCode.Forbidden, (await requester.GetAsync("/api/admin/categories")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou")).PostAsJsonAsync("/api/admin/categories", new { unitId = OrgSeed.ContributionMatchingUnitId, name = "Nope" })).StatusCode);
        }

        [Fact]
        public async Task A_Super_Admin_adds_renames_and_switches_off_a_category()
        {
            var admin = await As("test.superadmin");
            var category = await NewCategoryAsync(admin, OrgSeed.ContributionMatchingUnitId);
            Assert.True(category.NeedsCover);
            Assert.Equal(0, category.EligibleCount);

            var duplicate = await admin.PostAsJsonAsync("/api/admin/categories", new { unitId = OrgSeed.RefundUnitId, name = "Fund Movement" });
            var badTimeline = await admin.PostAsJsonAsync("/api/admin/categories", new { unitId = OrgSeed.RefundUnitId, name = "Odd timeline", timelineHours = 0 });
            var noUnit = await admin.PostAsJsonAsync("/api/admin/categories", new { name = "No unit" });
            Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, badTimeline.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, noUnit.StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { name = category.Name + " renamed", defaultPriority = 3 })).StatusCode);
            Assert.Equal(HttpStatusCode.Conflict, (await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { name = "PIN Change" })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { isActive = false })).StatusCode);

            var catalogue = await (await As("test.requester")).GetFromJsonAsync<List<CatalogueDepartmentDto>>("/api/catalogue/categories");
            Assert.DoesNotContain(catalogue!.SelectMany(d => d.Categories), c => c.Id == category.Id);
            var warnings = await admin.GetFromJsonAsync<List<CategoryCoverDto>>("/api/admin/categories/cover-warnings");
            Assert.DoesNotContain(warnings!, w => w.CategoryId == category.Id);
        }

        [Fact]
        public async Task The_matrix_maps_unit_members_to_their_units_categories_and_warns_under_two()
        {
            var admin = await As("test.superadmin");
            var category = await NewCategoryAsync(admin, OrgSeed.RefundUnitId);
            var worker = await IdOf("test.caseworker2");
            var other = await IdOf("test.caseworker4");
            var matchingWorker = await IdOf("test.caseworker1");
            var refundCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.RefundUnitId).Id;
            var matchingCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.ContributionMatchingUnitId).Id;

            var before = await admin.GetFromJsonAsync<UnitSkillsDto>($"/api/admin/units/{OrgSeed.RefundUnitId}/skills");
            Assert.Contains(before!.Warnings, w => w.CategoryId == category.Id);
            var current = before.Members.Single(m => m.UserId == worker).CategoryIds;

            // One person: still short of cover, and the message says so
            var one = await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{worker}", new { categoryIds = current.Append(category.Id) });
            Assert.Equal(HttpStatusCode.OK, one.StatusCode);
            Assert.Contains("Fewer than two", (await one.Content.ReadFromJsonAsync<MessageDto>())!.Message);

            // Two people: covered
            var otherCurrent = before.Members.Single(m => m.UserId == other).CategoryIds;
            Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{other}", new { categoryIds = otherCurrent.Append(category.Id) })).StatusCode);
            var after = await admin.GetFromJsonAsync<UnitSkillsDto>($"/api/admin/units/{OrgSeed.RefundUnitId}/skills");
            Assert.DoesNotContain(after!.Warnings, w => w.CategoryId == category.Id);
            Assert.Equal(2, after.Categories.Single(c => c.Id == category.Id).EligibleCount);

            using (var scope = _factory.Services.CreateScope())
            {
                var eligible = await scope.ServiceProvider.GetRequiredService<ICatalogueService>().EligibleCaseWorkerIdsAsync(category.Id);
                Assert.Equal(new[] { worker, other }.OrderBy(x => x), eligible.OrderBy(x => x));
            }

            // Only the unit's own categories, and only its members
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{worker}", new { categoryIds = new[] { refundCategory, matchingCategory } })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{matchingWorker}", new { categoryIds = new[] { refundCategory } })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.hou2")).PutAsJsonAsync($"/api/admin/units/{OrgSeed.RefundUnitId}/skills/{worker}", new { categoryIds = new[] { refundCategory } })).StatusCode);
        }

        [Fact]
        public async Task Leaving_the_unit_or_moving_the_category_ends_the_mapping()
        {
            var admin = await As("test.superadmin");
            var category = await NewCategoryAsync(admin, OrgSeed.ContributionMatchingUnitId);
            var leaver = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            var stayer = await NewMemberAsync(OrgSeed.ContributionMatchingUnitId);
            foreach (var person in new[] { leaver, stayer })
                Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/skills/{person}", new { categoryIds = new[] { category.Id } })).StatusCode);

            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/units/{OrgSeed.ContributionMatchingUnitId}/members/{leaver}")).StatusCode);
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.False(await db.CategorySkills.AnyAsync(s => s.UserId == leaver && s.IsActive));
                Assert.True(await db.CategorySkills.AnyAsync(s => s.UserId == leaver && !s.IsActive && s.RemovedAt != null));
            }

            var move = await admin.PatchAsJsonAsync($"/api/admin/categories/{category.Id}", new { unitId = OrgSeed.RefundUnitId });
            Assert.Equal(HttpStatusCode.OK, move.StatusCode);
            Assert.Contains("Moved to Refund", (await move.Content.ReadFromJsonAsync<MessageDto>())!.Message);
            var moved = (await admin.GetFromJsonAsync<List<CategoryAdminDto>>("/api/admin/categories"))!.Single(c => c.Id == category.Id);
            Assert.Equal(OrgSeed.RefundUnitId, moved.UnitId);
            Assert.Equal(0, moved.EligibleCount);
            Assert.True(moved.NeedsCover);
        }

        [Fact]
        public async Task Role_changes_on_the_People_page_are_announced_as_Access_Desk()
        {
            var admin = await As("test.superadmin");
            var target = await IdOf("test.requester");
            var roles = await admin.GetFromJsonAsync<List<RoleItemDto>>("/api/admin/roles");
            var superAdmin = roles!.Single(r => r.Name == "SuperAdmin").Id;

            Assert.Equal(HttpStatusCode.OK, (await admin.PostAsJsonAsync($"/api/admin/users/{target}/roles", new { roleId = superAdmin })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.DeleteAsync($"/api/admin/users/{target}/roles/{superAdmin}")).StatusCode);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            Assert.False(await db.InAppNotifications.AnyAsync(n => n.Title.Contains("Service Desk")));
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

    Write-Host '3/4 Creating the Catalogue migration (22 categories seeded)...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'Catalogue', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_Catalogue.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

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
    Write-Host 'Done. Step 3 is in place.' -ForegroundColor Green
    Write-Host 'Start the API once: it adds the Categories and CategorySkills tables, seeds the 22 categories and maps the test case workers.'
    Write-Host 'In Swagger as test.requester: GET /api/catalogue/categories.'
    Write-Host 'As test.superadmin: GET /api/admin/categories/cover-warnings (empty) and GET /api/admin/units/5d1a0002-0000-4000-8000-000000000012/skills (Refund).'
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
