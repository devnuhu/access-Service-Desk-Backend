# Step 4 - Tickets: raise, read, comment, files and locations (BRD M2, M4; decisions of 3 Nov 2026).
#
# What it adds:
#   - Tickets with reference DEPT-YYYY-000001 (CP-2026-000001), created as New in the unit that owns the category
#     (automatic assignment is Step 5; until then the unit's head and deputy are told about each new ticket)
#   - Rich-text description and comments (cleaned on the server with the HtmlSanitizer package: no scripts, images or unsafe links)
#   - Attachments: 0 to 6 files per ticket or comment, each at most 1 MB (PDF, DOCX, XLSX, CSV, JPG, PNG), checked by content
#   - Copying colleagues (CC), raising for someone else (Super Admin), the duplicate check (same category and RSA PIN, last 7 days)
#   - Public comments and internal notes; who can see a ticket: requester, people copied, the department's staff, Super Admin
#   - Locations (HQ seeded; Super Admin keeps the list), pre-selected from the person's last ticket
#   - Migration Tickets, and tests
#
# Run from ...\AccessServiceDesk\Backend\ServiceDesk with the API stopped (needs nuget.org for the HtmlSanitizer package):
#   .\Scripts\step4-tickets.ps1
# On any failure, every file (and the project file) is put back as it was.

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

# ---------------- the API must not be running (it locks the program file) ----------------
$running = @(Get-Process ServiceDeskAPI -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    Write-Host ('The API is running (process ' + (($running | ForEach-Object { $_.Id }) -join ', ') + '). Stop it first, then run this again:') -ForegroundColor Red
    Write-Host '    Get-Process ServiceDeskAPI | Stop-Process'
    return
}

# ---------------- anchor checks (nothing is changed until all pass) ----------------
if (-not (Test-Path (Join-Path $api 'Infrastructure\Persistence\AppDbContext.cs'))) { Write-Host 'Step 1a is not in place (no AppDbContext.cs). Run step1a-identity-auth.ps1 first.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $api 'Infrastructure\Api\ApiErrors.cs'))) { Write-Host 'Step 1e is not in place. Run step1e-api-contract.ps1 first.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $api 'Domain\Entities\Catalogue.cs'))) { Write-Host 'Step 3 is not in place. Run step3-catalogue.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Domain\Entities\Ticket.cs')) { Write-Host 'Ticket.cs already exists: Step 4 looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as the earlier step scripts wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = 'f757fd6bd18524af4e30787b636a276413beb7483fd780bbd11ef4925dc418b9'
    'ServiceDeskAPI\Program.cs' = '3dabfd0ac2c75f62fb65632fda6ee5b6cb0e969e629413bfbfe908f36b9d2055'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed since they were last written by a step script, so Step 4 stopped to avoid overwriting your changes:' -ForegroundColor Red
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
                // File downloads are described as binary, not JSON
                options.OperationFilter<ServiceDeskAPI.Infrastructure.Api.FileDownloadOperationFilter>();
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
            builder.Services.AddScoped<ILocationService, ServiceDeskAPI.Infrastructure.Tickets.LocationService>();
            builder.Services.AddScoped<ITicketService, ServiceDeskAPI.Infrastructure.Tickets.TicketService>();
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
$files['ServiceDeskAPI\Application\DTOs\TicketDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    // ---------------- locations ----------------

    public record LocationDto(Guid Id, string Name, int SortOrder, bool IsActive);

    /// <summary>Active locations for the ticket form, and the one to pre-select (the person's last ticket's location, or the only one).</summary>
    public class LocationChoicesDto
    {
        public List<LocationDto> Locations { get; set; } = new();
        public Guid? DefaultLocationId { get; set; }
    }

    public class SaveLocationRequest
    {
        public string? Name { get; set; }
        public int? SortOrder { get; set; }
        public bool? IsActive { get; set; }
    }

    // ---------------- raising ----------------

    /// <summary>
    /// Sent as multipart/form-data: the fields below plus 0 to 6 files named "files" (each at most 1 MB; PDF, DOCX, XLSX, CSV, JPG, PNG).
    /// descriptionHtml comes from the rich-text editor and is cleaned on the server.
    /// </summary>
    public class CreateTicketRequest
    {
        public Guid CategoryId { get; set; }
        public Guid LocationId { get; set; }
        /// <summary>1 Low, 2 Medium, 3 High, 4 Critical. Left out: the category's default.</summary>
        public TicketPriority? Priority { get; set; }
        public string Subject { get; set; } = string.Empty;
        public string DescriptionHtml { get; set; } = string.Empty;
        /// <summary>Colleagues to copy (FR-2.6).</summary>
        public List<Guid> CcUserIds { get; set; } = new();
        /// <summary>Super Admin only: raise it for this person (FR-2.8).</summary>
        public Guid? RequesterUserId { get; set; }
        public List<IFormFile> Files { get; set; } = new();
    }

    /// <summary>Possible duplicates (FR-2.7): same category, an RSA PIN found in the subject or description, raised in the last 7 days and still open.</summary>
    public class DuplicateCheckRequest
    {
        public Guid CategoryId { get; set; }
        public string? Subject { get; set; }
        public string? DescriptionHtml { get; set; }
    }

    public class DuplicateCheckDto
    {
        /// <summary>The RSA PINs found, masked except the last four digits.</summary>
        public List<string> PinsFound { get; set; } = new();
        public List<DuplicateTicketDto> Matches { get; set; } = new();
    }

    public record DuplicateTicketDto(string Reference, TicketStatus Status, DateTime CreatedAt, bool IsYours);

    // ---------------- reading ----------------

    public record PersonDto(Guid UserId, string UserName, string? FullName);

    public class TicketListItemDto
    {
        public Guid Id { get; set; }
        public string Reference { get; set; } = string.Empty;
        public string Subject { get; set; } = string.Empty;
        public string DepartmentCode { get; set; } = string.Empty;
        public string CategoryName { get; set; } = string.Empty;
        public string UnitName { get; set; } = string.Empty;
        public string LocationName { get; set; } = string.Empty;
        public TicketPriority Priority { get; set; }
        public TicketStatus Status { get; set; }
        public PersonDto Requester { get; set; } = new(Guid.Empty, string.Empty, null);
        public PersonDto? Assignee { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }

    public class TicketPageDto
    {
        public List<TicketListItemDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }

    public class TicketAttachmentDto
    {
        public Guid Id { get; set; }
        public Guid? CommentId { get; set; }
        public string FileName { get; set; } = string.Empty;
        public string ContentType { get; set; } = string.Empty;
        public long SizeBytes { get; set; }
        public PersonDto UploadedBy { get; set; } = new(Guid.Empty, string.Empty, null);
        public DateTime UploadedAt { get; set; }
    }

    public class TicketCommentDto
    {
        public Guid Id { get; set; }
        public PersonDto Author { get; set; } = new(Guid.Empty, string.Empty, null);
        public string BodyHtml { get; set; } = string.Empty;
        public bool IsInternal { get; set; }
        public DateTime CreatedAt { get; set; }
        public List<TicketAttachmentDto> Attachments { get; set; } = new();
    }

    public class TicketDetailDto : TicketListItemDto
    {
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
        public Guid CategoryId { get; set; }
        public Guid UnitId { get; set; }
        public Guid LocationId { get; set; }
        public string? RequesterDepartment { get; set; }
        public PersonDto RaisedBy { get; set; } = new(Guid.Empty, string.Empty, null);
        public string DescriptionHtml { get; set; } = string.Empty;
        public List<PersonDto> Cc { get; set; } = new();
        /// <summary>Files sent with the ticket itself (comment files are under each comment).</summary>
        public List<TicketAttachmentDto> Attachments { get; set; } = new();
        /// <summary>Oldest first. Internal notes only for department staff and Super Admin.</summary>
        public List<TicketCommentDto> Comments { get; set; } = new();
        /// <summary>The signed-in person works in the ticket's department (or is Super Admin): sees internal notes.</summary>
        public bool IsStaffView { get; set; }
        public bool CanComment { get; set; }
        public bool CanAddInternalNote { get; set; }
    }

    /// <summary>multipart/form-data: bodyHtml, isInternal, and 0 to 6 files named "files".</summary>
    public class AddCommentRequest
    {
        public string BodyHtml { get; set; } = string.Empty;
        public bool IsInternal { get; set; }
        public List<IFormFile> Files { get; set; } = new();
    }

    public record CreatedTicketDto(Guid Id, string Reference, string Message);
}
'@
$files['ServiceDeskAPI\Application\Interfaces\ITicketService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Locations for the ticket form (HQ at launch; a Super Admin keeps the list).</summary>
    public interface ILocationService
    {
        /// <summary>Active locations, and the one to pre-select for this person (their last ticket's location, or the only one).</summary>
        Task<LocationChoicesDto> GetChoicesAsync(Guid userId);
        Task<List<LocationDto>> ListAsync();
        Task<(AdminResult Result, LocationDto? Location)> CreateAsync(SaveLocationRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateAsync(Guid locationId, SaveLocationRequest request, Guid? actorUserId);
    }

    /// <summary>A failed ticket action: HTTP status, message and (when one field is to blame) its name.</summary>
    public sealed record TicketProblem(int Status, string Message, string? Field = null);

    /// <summary>
    /// Raising, reading and commenting on tickets (BRD M2, M4). Visibility: the requester, whoever raised it, the people copied, staff of
    /// the ticket's department (unit members and its HOD) and Super Admins. Anyone else gets 404, so references cannot be probed.
    /// Internal notes and their files: department staff and Super Admins only.
    /// </summary>
    public interface ITicketService
    {
        Task<(TicketProblem? Problem, CreatedTicketDto? Ticket)> CreateAsync(CreateTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, DuplicateCheckDto? Result)> CheckDuplicatesAsync(DuplicateCheckRequest request, Guid actorUserId);

        /// <summary>view: mine (raised by or for me), copied, assigned (to me), department (departmentId; staff of it or Super Admin; optional unitId).</summary>
        Task<(TicketProblem? Problem, TicketPageDto? Page)> ListAsync(string? view, Guid? departmentId, Guid? unitId, TicketStatus? status, string? search,
            int page, int pageSize, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, TicketDetailDto? Ticket)> GetAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<Guid?> FindIdByReferenceAsync(string reference);

        Task<(TicketProblem? Problem, TicketCommentDto? Comment)> AddCommentAsync(Guid ticketId, AddCommentRequest request, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, string? FileName, string? ContentType, byte[]? Data)> GetAttachmentAsync(Guid ticketId, Guid attachmentId,
            Guid actorUserId, bool actorIsSuperAdmin);
    }
}
'@
$files['ServiceDeskAPI\Controllers\TicketsController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Api;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Tickets (BRD M2, M4): raise, list, read, comment, download files. Any signed-in person; who may see what is decided in the
    /// service (requester, people copied, the department's staff, Super Admin). A ticket you cannot see answers 404.
    /// </summary>
    [ApiController]
    [Route("api/tickets")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class TicketsController : ControllerBase
    {
        /// <summary>6 files of 1 MB plus the form and its formatted text.</summary>
        private const long MaxRequestBytes = 8 * 1024 * 1024;

        private readonly ITicketService _tickets;

        public TicketsController(ITicketService tickets) => _tickets = tickets;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>Raises a ticket. multipart/form-data: categoryId, locationId, priority (optional), subject, descriptionHtml, ccUserIds (repeat), requesterUserId (Super Admin only), files (0 to 6, each at most 1 MB).</summary>
        [HttpPost]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(MaxRequestBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes)]
        [ProducesResponseType(typeof(CreatedTicketDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<CreatedTicketDto>> Create([FromForm] CreateTicketRequest request)
        {
            var (problem, ticket) = await _tickets.CreateAsync(request, Me(), IsSuperAdmin());
            return problem == null && ticket != null ? Ok(ticket) : Fail(problem!);
        }

        /// <summary>Before submitting: open tickets in the same category from the last 7 days that mention the same RSA PIN (FR-2.7).</summary>
        [HttpPost("duplicate-check")]
        [ProducesResponseType(typeof(DuplicateCheckDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<DuplicateCheckDto>> DuplicateCheck([FromBody] DuplicateCheckRequest request)
        {
            var (problem, result) = await _tickets.CheckDuplicatesAsync(request, Me());
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }

        /// <summary>view = mine (default), copied, assigned, or department (with departmentId; optional unitId). Newest first.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(TicketPageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<TicketPageDto>> List([FromQuery] string? view, [FromQuery] Guid? departmentId, [FromQuery] Guid? unitId,
            [FromQuery] TicketStatus? status, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
        {
            var (problem, result) = await _tickets.ListAsync(view, departmentId, unitId, status, search, page, pageSize, Me(), IsSuperAdmin());
            return problem == null && result != null ? Ok(result) : Fail(problem!);
        }

        [HttpGet("{ticketId:guid}")]
        [ProducesResponseType(typeof(TicketDetailDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketDetailDto>> Get(Guid ticketId)
        {
            var (problem, ticket) = await _tickets.GetAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && ticket != null ? Ok(ticket) : Fail(problem!);
        }

        /// <summary>The same as GET {id}, by reference (for example CP-2026-000123), for links in notifications.</summary>
        [HttpGet("by-reference/{reference}")]
        [ProducesResponseType(typeof(TicketDetailDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketDetailDto>> GetByReference(string reference)
        {
            var id = await _tickets.FindIdByReferenceAsync(reference);
            if (id == null) return NotFound(new ApiError("Ticket not found."));
            return await Get(id.Value);
        }

        /// <summary>Adds a public comment or (department staff) an internal note. multipart/form-data: bodyHtml, isInternal, files (0 to 6, each at most 1 MB).</summary>
        [HttpPost("{ticketId:guid}/comments")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(MaxRequestBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxRequestBytes)]
        [ProducesResponseType(typeof(TicketCommentDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<TicketCommentDto>> AddComment(Guid ticketId, [FromForm] AddCommentRequest request)
        {
            var (problem, comment) = await _tickets.AddCommentAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && comment != null ? Ok(comment) : Fail(problem!);
        }

        /// <summary>Downloads a file (always as a download, never shown inline).</summary>
        [HttpGet("{ticketId:guid}/attachments/{attachmentId:guid}")]
        [FileDownload]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<IActionResult> Download(Guid ticketId, Guid attachmentId)
        {
            var (problem, name, type, data) = await _tickets.GetAttachmentAsync(ticketId, attachmentId, Me(), IsSuperAdmin());
            if (problem != null || data == null) return Fail(problem ?? new TicketProblem(404, "File not found."));
            Response.Headers.CacheControl = "private, no-store";
            return File(data, type ?? "application/octet-stream", name);
        }
    }

    /// <summary>Locations for the ticket form, and their upkeep by the Super Admin.</summary>
    [ApiController]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class LocationsController : ControllerBase
    {
        private readonly ILocationService _locations;

        public LocationsController(ILocationService locations) => _locations = locations;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        /// <summary>Active locations and the one to pre-select. forUserId (Super Admin raising for someone): that person's default.</summary>
        [HttpGet("api/locations")]
        [Authorize]
        [ProducesResponseType(typeof(LocationChoicesDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<LocationChoicesDto>> Choices([FromQuery] Guid? forUserId)
        {
            if (forUserId.HasValue && forUserId.Value != Me() && !User.IsInRole(AppRoles.SuperAdmin)) return Forbid();
            return Ok(await _locations.GetChoicesAsync(forUserId ?? Me()));
        }

        [HttpGet("api/admin/locations")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(List<LocationDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<List<LocationDto>>> List() => Ok(await _locations.ListAsync());

        [HttpPost("api/admin/locations")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(LocationDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<LocationDto>> Create([FromBody] SaveLocationRequest request)
        {
            var (result, location) = await _locations.CreateAsync(request, Me());
            return result.Success && location != null ? Ok(location) : StatusCode(result.Status, new ApiError(result.Message));
        }

        /// <summary>Rename, reorder, switch on or off (at least one stays on).</summary>
        [HttpPatch("api/admin/locations/{locationId:guid}")]
        [Authorize(Policy = Policies.SuperAdminOnly)]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Update(Guid locationId, [FromBody] SaveLocationRequest request)
        {
            var result = await _locations.UpdateAsync(locationId, request, Me());
            return result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));
        }
    }
}
'@
$files['ServiceDeskAPI\Domain\Entities\Ticket.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>Where the requester works (HQ at launch). Kept by the Super Admin; chosen on every ticket.</summary>
    public class Location
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
    }

    /// <summary>
    /// A request to a department (BRD Section 10). Reference is DEPT-YYYY-000001 per department and year (FR-2.5).
    /// The description is cleaned HTML from the rich-text editor; DescriptionText is its plain-text copy for search and the duplicate check.
    /// Assignment, SLA and workflow fields are added by later steps.
    /// </summary>
    public class Ticket
    {
        public Guid Id { get; set; }
        public string Reference { get; set; } = string.Empty;
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        /// <summary>The unit that owned the category when the ticket was raised (routing target).</summary>
        public Guid UnitId { get; set; }
        public Unit? Unit { get; set; }
        public Guid CategoryId { get; set; }
        public Category? Category { get; set; }
        public Guid LocationId { get; set; }
        public Location? Location { get; set; }
        public Guid RequesterUserId { get; set; }
        public User? RequesterUser { get; set; }
        /// <summary>Who submitted it: the requester, or a Super Admin raising it on their behalf (FR-2.8).</summary>
        public Guid RaisedByUserId { get; set; }
        /// <summary>The requester's own department from AD at the time (reporting only).</summary>
        public string? RequesterDepartment { get; set; }
        public string Subject { get; set; } = string.Empty;
        public string DescriptionHtml { get; set; } = string.Empty;
        public string DescriptionText { get; set; } = string.Empty;
        public TicketPriority Priority { get; set; } = TicketPriority.Medium;
        public TicketStatus Status { get; set; } = TicketStatus.New;
        public Guid? AssigneeUserId { get; set; }
        public User? AssigneeUser { get; set; }
        public DateTime? AssignedAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
        /// <summary>Optimistic concurrency (two people changing the same ticket).</summary>
        public byte[] RowVersion { get; set; } = Array.Empty<byte>();

        public ICollection<TicketWatcher> Watchers { get; set; } = new List<TicketWatcher>();
        public ICollection<TicketComment> Comments { get; set; } = new List<TicketComment>();
        public ICollection<TicketAttachment> Attachments { get; set; } = new List<TicketAttachment>();
    }

    /// <summary>A colleague copied on the ticket (FR-2.6): notified and able to view it.</summary>
    public class TicketWatcher
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public DateTime AddedAt { get; set; } = DateTime.UtcNow;
        public Guid? AddedByUserId { get; set; }
    }

    /// <summary>A public comment (seen by the requester and those copied) or an internal note (department staff only) (FR-4.1).</summary>
    public class TicketComment
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid AuthorUserId { get; set; }
        public User? AuthorUser { get; set; }
        public string BodyHtml { get; set; } = string.Empty;
        public string BodyText { get; set; } = string.Empty;
        public bool IsInternal { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>File details. The bytes live in TicketAttachmentContents so lists never load them.</summary>
    public class TicketAttachment
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        /// <summary>Set when the file came with a comment (an internal note's files are internal too).</summary>
        public Guid? CommentId { get; set; }
        public TicketComment? Comment { get; set; }
        public string FileName { get; set; } = string.Empty;
        public string ContentType { get; set; } = string.Empty;
        public long SizeBytes { get; set; }
        public string Sha256 { get; set; } = string.Empty;
        public Guid UploadedByUserId { get; set; }
        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    }

    public class TicketAttachmentContent
    {
        public Guid AttachmentId { get; set; }
        public byte[] Data { get; set; } = Array.Empty<byte>();
    }

    /// <summary>The last reference number used per department and year.</summary>
    public class TicketSequence
    {
        public Guid DepartmentId { get; set; }
        public int Year { get; set; }
        public int LastNumber { get; set; }
    }
}
'@
$files['ServiceDeskAPI\Domain\Enums\TicketStatus.cs'] = @'
namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>The eight ticket statuses (BRD Section 8). Step 4 creates tickets as New; later steps move them on.</summary>
    public enum TicketStatus
    {
        New = 1,
        Assigned = 2,
        InProgress = 3,
        Pending = 4,
        Resolved = 5,
        Reopened = 6,
        Closed = 7,
        Cancelled = 8
    }
}
'@
$files['ServiceDeskAPI\Domain\Tickets\TicketSeed.cs'] = @'
namespace ServiceDeskAPI.Domain.Tickets
{
    /// <summary>Fixed ids and limits for tickets (decisions of 3 Nov 2026).</summary>
    public static class TicketSeed
    {
        /// <summary>The one location at launch; a Super Admin adds the rest.</summary>
        public static readonly Guid HeadquartersLocationId = new("5d1a0004-0000-4000-8000-000000000001");
        public const string HeadquartersName = "HQ";

        /// <summary>Attachments per ticket form or per comment (0 to 6), each at most 1 MB.</summary>
        public const int MaxFilesPerSubmission = 6;
        public const long MaxFileBytes = 1024 * 1024;

        /// <summary>Formatted description or comment after cleaning.</summary>
        public const int MaxHtmlChars = 200_000;
        public const int MaxSubjectChars = 200;
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Api\FileDownload.cs'] = @'
using System.Reflection;
using Microsoft.OpenApi.Models;
using Swashbuckle.AspNetCore.SwaggerGen;

namespace ServiceDeskAPI.Infrastructure.Api
{
    /// <summary>Marks an action that answers 200 with a file download, so Swagger describes it as binary (not JSON).</summary>
    [AttributeUsage(AttributeTargets.Method)]
    public sealed class FileDownloadAttribute : Attribute
    {
    }

    /// <summary>
    /// Swagger only lists response types an output formatter can write, and none writes raw files, so a download's 200 would
    /// have no schema. This filter writes it as application/octet-stream, string/binary.
    /// </summary>
    public sealed class FileDownloadOperationFilter : IOperationFilter
    {
        public void Apply(OpenApiOperation operation, OperationFilterContext context)
        {
            if (context.MethodInfo.GetCustomAttribute<FileDownloadAttribute>() == null) return;
            operation.Responses["200"] = new OpenApiResponse
            {
                Description = "The file, always sent as a download.",
                Content =
                {
                    ["application/octet-stream"] = new OpenApiMediaType { Schema = new OpenApiSchema { Type = "string", Format = "binary" } }
                }
            };
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
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;

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
        public DbSet<Location> Locations => Set<Location>();
        public DbSet<Ticket> Tickets => Set<Ticket>();
        public DbSet<TicketWatcher> TicketWatchers => Set<TicketWatcher>();
        public DbSet<TicketComment> TicketComments => Set<TicketComment>();
        public DbSet<TicketAttachment> TicketAttachments => Set<TicketAttachment>();
        public DbSet<TicketAttachmentContent> TicketAttachmentContents => Set<TicketAttachmentContent>();
        public DbSet<TicketSequence> TicketSequences => Set<TicketSequence>();

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
            ConfigureTickets(builder);
        }

        private static void ConfigureTickets(ModelBuilder builder)
        {
            builder.Entity<Location>(e =>
            {
                e.ToTable("Locations");
                e.HasKey(l => l.Id);
                e.Property(l => l.Name).HasMaxLength(100).IsRequired();
                e.HasIndex(l => l.Name).IsUnique();
                e.HasData(new Location { Id = TicketSeed.HeadquartersLocationId, Name = TicketSeed.HeadquartersName, SortOrder = 1, IsActive = true, CreatedAt = SeedDate });
            });

            builder.Entity<Ticket>(e =>
            {
                e.ToTable("Tickets");
                e.HasKey(t => t.Id);
                e.Property(t => t.Reference).HasMaxLength(30).IsRequired();
                e.HasIndex(t => t.Reference).IsUnique();
                e.Property(t => t.Subject).HasMaxLength(TicketSeed.MaxSubjectChars).IsRequired();
                e.Property(t => t.DescriptionHtml).HasColumnType("nvarchar(max)").IsRequired();
                e.Property(t => t.DescriptionText).HasColumnType("nvarchar(max)").IsRequired();
                e.Property(t => t.RequesterDepartment).HasMaxLength(200);
                e.Property(t => t.RowVersion).IsRowVersion();
                e.HasOne(t => t.Department).WithMany().HasForeignKey(t => t.DepartmentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Unit).WithMany().HasForeignKey(t => t.UnitId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Category).WithMany().HasForeignKey(t => t.CategoryId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.Location).WithMany().HasForeignKey(t => t.LocationId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.RequesterUser).WithMany().HasForeignKey(t => t.RequesterUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne<User>().WithMany().HasForeignKey(t => t.RaisedByUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(t => t.AssigneeUser).WithMany().HasForeignKey(t => t.AssigneeUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(t => new { t.RequesterUserId, t.CreatedAt });
                e.HasIndex(t => new { t.UnitId, t.Status });
                e.HasIndex(t => new { t.DepartmentId, t.Status });
                e.HasIndex(t => new { t.AssigneeUserId, t.Status });
                e.HasIndex(t => new { t.CategoryId, t.CreatedAt });
            });

            builder.Entity<TicketWatcher>(e =>
            {
                e.ToTable("TicketWatchers");
                e.HasKey(w => w.Id);
                e.HasOne(w => w.Ticket).WithMany(t => t.Watchers).HasForeignKey(w => w.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(w => w.User).WithMany().HasForeignKey(w => w.UserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(w => new { w.TicketId, w.UserId }).IsUnique();
                e.HasIndex(w => w.UserId);
            });

            builder.Entity<TicketComment>(e =>
            {
                e.ToTable("TicketComments");
                e.HasKey(c => c.Id);
                e.Property(c => c.BodyHtml).HasColumnType("nvarchar(max)").IsRequired();
                e.Property(c => c.BodyText).HasColumnType("nvarchar(max)").IsRequired();
                e.HasOne(c => c.Ticket).WithMany(t => t.Comments).HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(c => c.AuthorUser).WithMany().HasForeignKey(c => c.AuthorUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(c => new { c.TicketId, c.CreatedAt });
            });

            builder.Entity<TicketAttachment>(e =>
            {
                e.ToTable("TicketAttachments");
                e.HasKey(a => a.Id);
                e.Property(a => a.FileName).HasMaxLength(255).IsRequired();
                e.Property(a => a.ContentType).HasMaxLength(100).IsRequired();
                e.Property(a => a.Sha256).HasMaxLength(64).IsRequired();
                e.HasOne(a => a.Ticket).WithMany(t => t.Attachments).HasForeignKey(a => a.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(a => a.Comment).WithMany().HasForeignKey(a => a.CommentId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne<User>().WithMany().HasForeignKey(a => a.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(a => a.TicketId);
            });

            builder.Entity<TicketAttachmentContent>(e =>
            {
                e.ToTable("TicketAttachmentContents");
                e.HasKey(c => c.AttachmentId);
                e.Property(c => c.Data).HasColumnType("varbinary(max)").IsRequired();
                e.HasOne<TicketAttachment>().WithOne().HasForeignKey<TicketAttachmentContent>(c => c.AttachmentId).OnDelete(DeleteBehavior.Cascade);
            });

            builder.Entity<TicketSequence>(e =>
            {
                e.ToTable("TicketSequences");
                e.HasKey(q => new { q.DepartmentId, q.Year });
                e.HasOne<Department>().WithMany().HasForeignKey(q => q.DepartmentId).OnDelete(DeleteBehavior.Restrict);
            });
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
$files['ServiceDeskAPI\Infrastructure\Tickets\AttachmentRules.cs'] = @'
using System.Security.Cryptography;
using ServiceDeskAPI.Domain.Tickets;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Attachment checks (decision of 3 Nov 2026): 0 to 6 files per ticket form or comment, each at most 1 MB, only PDF, DOCX, XLSX,
    /// CSV, JPG and PNG. The type is decided from the extension AND the file's first bytes, never from what the browser claims.
    /// Virus scanning (BRD FR-2.4) is added in the security hardening step; until then only these checks run.
    /// </summary>
    public static class AttachmentRules
    {
        public sealed record CheckedFile(string FileName, string ContentType, byte[] Data, string Sha256);

        private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
        {
            [".pdf"] = "application/pdf",
            [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".csv"] = "text/csv",
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png"
        };

        public const string Allowed = "PDF, DOCX, XLSX, CSV, JPG or PNG";

        /// <summary>Reads and checks the files. Returns the error message for the "files" field, or the checked files.</summary>
        public static async Task<(string? Error, List<CheckedFile> Files)> CheckAsync(IReadOnlyCollection<IFormFile>? files)
        {
            var result = new List<CheckedFile>();
            if (files == null || files.Count == 0) return (null, result);
            if (files.Count > TicketSeed.MaxFilesPerSubmission)
                return ("Attach at most " + TicketSeed.MaxFilesPerSubmission + " files.", result);

            foreach (var file in files)
            {
                var name = SafeName(file.FileName);
                if (file.Length == 0) return (name + " is empty.", result);
                if (file.Length > TicketSeed.MaxFileBytes) return (name + " is larger than 1 MB.", result);
                var extension = Path.GetExtension(name);
                if (!Types.TryGetValue(extension, out var contentType)) return (name + ": only " + Allowed + " files can be attached.", result);

                byte[] data;
                await using (var stream = file.OpenReadStream())
                using (var memory = new MemoryStream())
                {
                    await stream.CopyToAsync(memory);
                    data = memory.ToArray();
                }
                if (data.Length == 0 || data.Length > TicketSeed.MaxFileBytes) return (name + " is empty or larger than 1 MB.", result);
                if (!LooksLike(extension, data)) return (name + " is not a real " + extension.TrimStart('.').ToUpperInvariant() + " file.", result);

                result.Add(new CheckedFile(name, contentType, data, Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant()));
            }
            return (null, result);
        }

        /// <summary>The file name without any folder, control or path characters, at most 255 characters.</summary>
        public static string SafeName(string? fileName)
        {
            var name = Path.GetFileName((fileName ?? string.Empty).Replace('\\', '/'));
            var cleaned = new string(name.Where(c => !char.IsControl(c) && c != '"' && c != '/' && c != ':' && c != '*' && c != '?' && c != '<' && c != '>' && c != '|').ToArray()).Trim();
            if (string.IsNullOrWhiteSpace(cleaned)) cleaned = "file";
            if (cleaned.Length > 255)
            {
                var extension = Path.GetExtension(cleaned);
                cleaned = cleaned.Substring(0, 255 - extension.Length) + extension;
            }
            return cleaned;
        }

        private static bool LooksLike(string extension, byte[] data)
        {
            bool Starts(params byte[] signature) => data.Length >= signature.Length && data.AsSpan(0, signature.Length).SequenceEqual(signature);
            switch (extension.ToLowerInvariant())
            {
                case ".pdf": return Starts(0x25, 0x50, 0x44, 0x46, 0x2D); // %PDF-
                case ".docx":
                case ".xlsx": return Starts(0x50, 0x4B, 0x03, 0x04); // zip container
                case ".jpg":
                case ".jpeg": return Starts(0xFF, 0xD8, 0xFF);
                case ".png": return Starts(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
                case ".csv":
                    // Text only (Excel may save UTF-8 or ANSI): no NUL bytes, and not one of the binary types above
                    return Array.IndexOf(data, (byte)0) < 0 && !Starts(0x50, 0x4B, 0x03, 0x04) && !Starts(0x4D, 0x5A);
                default: return false;
            }
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Tickets\LocationService.cs'] = @'
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>Locations (decision of 3 Nov 2026): required on every ticket, pre-filled from the person's last ticket. HQ seeded.</summary>
    public class LocationService : ILocationService
    {
        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IHttpContextAccessor _http;

        public LocationService(AppDbContext db, IAuditService audit, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _http = http;
        }

        public async Task<LocationChoicesDto> GetChoicesAsync(Guid userId)
        {
            var active = await _db.Locations.AsNoTracking().Where(l => l.IsActive).OrderBy(l => l.SortOrder).ThenBy(l => l.Name)
                .Select(l => new LocationDto(l.Id, l.Name, l.SortOrder, l.IsActive)).ToListAsync();
            var last = await _db.Tickets.AsNoTracking().Where(t => t.RequesterUserId == userId)
                .OrderByDescending(t => t.CreatedAt).Select(t => (Guid?)t.LocationId).FirstOrDefaultAsync();
            Guid? preferred = last.HasValue && active.Any(l => l.Id == last.Value) ? last
                : active.Count == 1 ? active[0].Id : null;
            return new LocationChoicesDto { Locations = active, DefaultLocationId = preferred };
        }

        public async Task<List<LocationDto>> ListAsync() =>
            await _db.Locations.AsNoTracking().OrderByDescending(l => l.IsActive).ThenBy(l => l.SortOrder).ThenBy(l => l.Name)
                .Select(l => new LocationDto(l.Id, l.Name, l.SortOrder, l.IsActive)).ToListAsync();

        public async Task<(AdminResult Result, LocationDto? Location)> CreateAsync(SaveLocationRequest request, Guid? actorUserId)
        {
            var name = (request.Name ?? string.Empty).Trim();
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (await _db.Locations.AnyAsync(l => l.Name == name)) return (AdminResult.Conflict("A location named " + name + " already exists."), null);
            var order = request.SortOrder ?? (await _db.Locations.MaxAsync(l => (int?)l.SortOrder) ?? 0) + 1;
            var location = new Location { Id = Guid.NewGuid(), Name = name, SortOrder = order, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Locations.Add(location);
            Stage(AuditAction.Created, location.Id, name, null, new { name, order });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (AdminResult.Conflict("A location named " + name + " already exists."), null); }
            return (AdminResult.Ok("Location " + name + " added."), new LocationDto(location.Id, name, order, true));
        }

        public async Task<AdminResult> UpdateAsync(Guid locationId, SaveLocationRequest request, Guid? actorUserId)
        {
            var location = await _db.Locations.FirstOrDefaultAsync(l => l.Id == locationId);
            if (location == null) return AdminResult.NotFound("Location not found.");
            var before = new { location.Name, location.SortOrder, location.IsActive };
            if (request.Name != null)
            {
                var name = request.Name.Trim();
                if (name.Length < 2 || name.Length > 100) return AdminResult.Invalid("The name must be 2 to 100 characters.");
                if (await _db.Locations.AnyAsync(l => l.Id != locationId && l.Name == name)) return AdminResult.Conflict("A location named " + name + " already exists.");
                location.Name = name;
            }
            if (request.SortOrder.HasValue)
            {
                if (request.SortOrder.Value < 0 || request.SortOrder.Value > 9999) return AdminResult.Invalid("The order must be between 0 and 9999.");
                location.SortOrder = request.SortOrder.Value;
            }
            if (request.IsActive == false && location.IsActive && !await _db.Locations.AnyAsync(l => l.Id != locationId && l.IsActive))
                return AdminResult.Invalid("At least one location must stay on: tickets need one.");
            if (request.IsActive.HasValue) location.IsActive = request.IsActive.Value;
            location.UpdatedAt = DateTime.UtcNow;
            location.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, location.Id, location.Name, before, new { location.Name, location.SortOrder, location.IsActive });
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return AdminResult.Conflict("A location with that name already exists."); }
            return AdminResult.Ok("Location " + location.Name + " updated.");
        }

        private void Stage(AuditAction action, Guid id, string display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Location", id, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Administration);
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Tickets\RichText.cs'] = @'
using System.Text;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using Ganss.Xss;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Cleans HTML from the rich-text editor (TipTap) before it is stored, and makes the plain-text copy used for search and the
    /// duplicate check. Allowlist only: formatting, lists, headings, links (http, https, mailto), code and tables, with colour,
    /// highlight, alignment and column widths. Everything else (scripts, event handlers, images, iframes, forms, data: links,
    /// other styles) is removed; the text inside removed formatting tags is kept. The web app shows this HTML, so this is what
    /// stops one ticket from attacking everyone who opens it.
    /// </summary>
    public static class RichText
    {
        private static readonly string[] Tags =
        {
            "p", "br", "hr", "div", "span", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup", "mark",
            "h1", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "pre", "code", "a",
            "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "caption"
        };
        private static readonly string[] Attributes = { "href", "style", "colspan", "rowspan", "colwidth", "start" };
        private static readonly string[] CssProperties = { "color", "background-color", "text-align", "width", "min-width" };
        private static readonly string[] Schemes = { "http", "https", "mailto" };
        private static readonly HashSet<string> BlockTags = new(StringComparer.OrdinalIgnoreCase)
        {
            "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "blockquote", "pre", "table", "caption", "hr"
        };
        private static readonly Regex BlankLines = new(@"\n{3,}", RegexOptions.Compiled);
        private static readonly Regex Spaces = new(@"[ \t\u00A0]+", RegexOptions.Compiled);

        /// <summary>Returns cleaned HTML (empty when there is nothing left).</summary>
        public static string Clean(string? html)
        {
            if (string.IsNullOrWhiteSpace(html)) return string.Empty;
            var sanitizer = new HtmlSanitizer();
            sanitizer.AllowedTags.Clear();
            foreach (var tag in Tags) sanitizer.AllowedTags.Add(tag);
            sanitizer.AllowedAttributes.Clear();
            foreach (var attribute in Attributes) sanitizer.AllowedAttributes.Add(attribute);
            sanitizer.AllowedCssProperties.Clear();
            foreach (var property in CssProperties) sanitizer.AllowedCssProperties.Add(property);
            sanitizer.AllowedSchemes.Clear();
            foreach (var scheme in Schemes) sanitizer.AllowedSchemes.Add(scheme);
            sanitizer.AllowedAtRules.Clear();
            sanitizer.AllowDataAttributes = false;
            sanitizer.KeepChildNodes = true;
            sanitizer.PostProcessNode += (_, e) =>
            {
                // Links open in a new tab and never pass the page or a referrer to the other site
                if (e.Node is IElement element && string.Equals(element.LocalName, "a", StringComparison.OrdinalIgnoreCase))
                {
                    element.SetAttribute("target", "_blank");
                    element.SetAttribute("rel", "noopener noreferrer nofollow");
                }
            };
            return sanitizer.Sanitize(html).Trim();
        }

        /// <summary>Plain text of cleaned HTML: paragraphs and rows on their own lines, table cells separated by tabs.</summary>
        public static string ToText(string cleanHtml)
        {
            if (string.IsNullOrWhiteSpace(cleanHtml)) return string.Empty;
            var document = new HtmlParser().ParseDocument("<!doctype html><html><body>" + cleanHtml + "</body></html>");
            var text = new StringBuilder();
            if (document.Body != null) Walk(document.Body, text);
            var lines = text.ToString().Replace("\r", string.Empty).Split('\n').Select(l => Spaces.Replace(l, " ").Trim());
            return BlankLines.Replace(string.Join("\n", lines), "\n\n").Trim();
        }

        private static void Walk(INode node, StringBuilder text)
        {
            foreach (var child in node.ChildNodes)
            {
                if (child is IText t)
                {
                    text.Append(t.Data);
                }
                else if (child is IElement element)
                {
                    var tag = element.LocalName;
                    if (tag == "br") { text.Append('\n'); continue; }
                    Walk(element, text);
                    if (tag is "td" or "th") text.Append('\t');
                    else if (BlockTags.Contains(tag)) text.Append('\n');
                }
            }
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Tickets\TicketService.cs'] = @'
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Raising, reading and commenting (BRD M2, M4). Tickets are created as New in the unit that owns the category; automatic
    /// assignment comes in Step 5, so until then the unit's head and deputy are told about each new ticket.
    /// Notifications and emails name the reference and category only, never the subject or description (rule 13).
    /// </summary>
    public class TicketService : ITicketService
    {
        private const int MaxCc = 10;
        private const int DuplicateDays = 7;
        private static readonly Regex RsaPin = new(@"\bPEN\d{12}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly TicketStatus[] FinishedStatuses = { TicketStatus.Resolved, TicketStatus.Closed, TicketStatus.Cancelled };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly TimeProvider _time;
        private readonly ILogger<TicketService> _logger;

        public TicketService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http,
            TimeProvider time, ILogger<TicketService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _time = time;
            _logger = logger;
        }

        // ---------------- raising ----------------

        public async Task<(TicketProblem? Problem, CreatedTicketDto? Ticket)> CreateAsync(CreateTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            // Who it is for
            var requesterId = request.RequesterUserId ?? actorUserId;
            if (requesterId != actorUserId && !actorIsSuperAdmin)
                return (new TicketProblem(403, "Only a Super Admin can raise a ticket for someone else.", "requesterUserId"), null);
            var requester = await _db.Users.FirstOrDefaultAsync(u => u.Id == requesterId);
            if (requester == null) return (new TicketProblem(404, "Person not found.", "requesterUserId"), null);
            if (!requester.IsActive) return (new TicketProblem(400, Name(requester) + " is blocked.", "requesterUserId"), null);

            // What and where
            var category = await _db.Categories.Include(c => c.Unit).Include(c => c.Department)
                .FirstOrDefaultAsync(c => c.Id == request.CategoryId);
            if (category == null || !category.IsActive || !category.Unit!.IsActive || !category.Department!.IsActive)
                return (new TicketProblem(400, "Choose one of the listed categories.", "categoryId"), null);
            var location = await _db.Locations.FirstOrDefaultAsync(l => l.Id == request.LocationId && l.IsActive);
            if (location == null) return (new TicketProblem(400, "Choose your location.", "locationId"), null);
            var priority = request.Priority ?? category.DefaultPriority;
            if (!Enum.IsDefined(priority)) return (new TicketProblem(400, "Choose Low, Medium, High or Critical.", "priority"), null);

            var subject = (request.Subject ?? string.Empty).Trim();
            if (subject.Length < 3 || subject.Length > TicketSeed.MaxSubjectChars)
                return (new TicketProblem(400, "The subject must be 3 to " + TicketSeed.MaxSubjectChars + " characters.", "subject"), null);
            var (html, text, descriptionProblem) = CleanBody(request.DescriptionHtml, "descriptionHtml", "Describe the request.");
            if (descriptionProblem != null) return (descriptionProblem, null);

            // Copied colleagues
            var cc = (request.CcUserIds ?? new List<Guid>()).Where(id => id != Guid.Empty && id != requesterId).Distinct().ToList();
            if (cc.Count > MaxCc) return (new TicketProblem(400, "Copy at most " + MaxCc + " people.", "ccUserIds"), null);
            if (cc.Count > 0)
            {
                var found = await _db.Users.Where(u => cc.Contains(u.Id) && u.IsActive).Select(u => u.Id).ToListAsync();
                if (found.Count != cc.Count) return (new TicketProblem(400, "Some of the people to copy were not found or are blocked.", "ccUserIds"), null);
            }

            var (fileProblem, files) = await AttachmentRules.CheckAsync(request.Files);
            if (fileProblem != null) return (new TicketProblem(400, fileProblem, "files"), null);

            var now = DateTime.UtcNow;
            var ticket = new Ticket
            {
                Id = Guid.NewGuid(), DepartmentId = category.DepartmentId, UnitId = category.UnitId, CategoryId = category.Id, LocationId = location.Id,
                RequesterUserId = requesterId, RaisedByUserId = actorUserId, RequesterDepartment = Trim(requester.Department, 200),
                Subject = subject, DescriptionHtml = html, DescriptionText = text, Priority = priority, Status = TicketStatus.New, CreatedAt = now
            };

            await using var transaction = await _db.Database.BeginTransactionAsync();
            try
            {
                ticket.Reference = await NextReferenceAsync(category.Department!.Code, category.DepartmentId);
                _db.Tickets.Add(ticket);
                foreach (var userId in cc)
                    _db.TicketWatchers.Add(new TicketWatcher { Id = Guid.NewGuid(), TicketId = ticket.Id, UserId = userId, AddedAt = now, AddedByUserId = actorUserId });
                AddFiles(ticket.Id, null, files, actorUserId, now);

                Stage(AuditAction.Created, "Ticket", ticket.Id, ticket.Reference, null, new
                {
                    category = category.Name, unit = category.Unit!.Code, priority = priority.ToString(), location = location.Name,
                    requester = requester.UserName, onBehalf = requesterId != actorUserId, cc = cc.Count, files = files.Count
                });

                var link = "/tickets/" + ticket.Reference;
                _notifications.Stage(requesterId, "Ticket " + ticket.Reference + " received",
                    "Your " + category.Name + " request was received by " + category.Department.Name + ". You will be told when someone picks it up.",
                    NotificationType.Success, NotificationCategory.Ticket, "Ticket", ticket.Id, link);
                foreach (var userId in cc)
                    _notifications.Stage(userId, "You were copied on " + ticket.Reference,
                        Name(requester) + " copied you on a " + category.Name + " request. You can follow it in Access Desk.",
                        NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);
                // Until automatic assignment (Step 5), the unit's head and deputy hear about every new ticket
                foreach (var head in new[] { category.Unit.HeadUserId, category.Unit.DeputyHeadUserId }.Where(h => h.HasValue && h != actorUserId).Distinct())
                    _notifications.Stage(head!.Value, "New ticket in " + category.Unit.Name + ": " + ticket.Reference,
                        category.Name + ", priority " + priority + ".", NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", ticket.Id, link);

                await _db.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex, "Ticket could not be saved");
                await transaction.RollbackAsync();
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket could not be saved. Try again."), null);
            }

            return (null, new CreatedTicketDto(ticket.Id, ticket.Reference, "Ticket " + ticket.Reference + " raised."));
        }

        public async Task<(TicketProblem? Problem, DuplicateCheckDto? Result)> CheckDuplicatesAsync(DuplicateCheckRequest request, Guid actorUserId)
        {
            if (!await _db.Categories.AnyAsync(c => c.Id == request.CategoryId))
                return (new TicketProblem(400, "Choose one of the listed categories.", "categoryId"), null);

            var text = (request.Subject ?? string.Empty) + "\n" + RichText.ToText(RichText.Clean(request.DescriptionHtml));
            var pins = RsaPin.Matches(text).Select(m => m.Value.ToUpperInvariant()).Distinct().Take(5).ToList();
            var result = new DuplicateCheckDto { PinsFound = pins.Select(p => "PEN********" + p.Substring(p.Length - 4)).ToList() };
            if (pins.Count == 0) return (null, result);

            var since = DateTime.UtcNow.AddDays(-DuplicateDays);
            var seen = new HashSet<Guid>();
            foreach (var pin in pins)
            {
                var matches = await _db.Tickets.AsNoTracking()
                    .Where(t => t.CategoryId == request.CategoryId && t.CreatedAt >= since && !FinishedStatuses.Contains(t.Status)
                        && (t.Subject.Contains(pin) || t.DescriptionText.Contains(pin)))
                    .OrderByDescending(t => t.CreatedAt)
                    .Select(t => new { t.Id, t.Reference, t.Status, t.CreatedAt, t.RequesterUserId })
                    .Take(10)
                    .ToListAsync();
                foreach (var m in matches.Where(m => seen.Add(m.Id)))
                    result.Matches.Add(new DuplicateTicketDto(m.Reference, m.Status, m.CreatedAt, m.RequesterUserId == actorUserId));
            }
            return (null, result);
        }

        // ---------------- reading ----------------

        public async Task<(TicketProblem? Problem, TicketPageDto? Page)> ListAsync(string? view, Guid? departmentId, Guid? unitId, TicketStatus? status,
            string? search, int page, int pageSize, Guid actorUserId, bool actorIsSuperAdmin)
        {
            page = Math.Max(1, page);
            pageSize = pageSize <= 0 ? 20 : Math.Min(pageSize, 100);
            var query = _db.Tickets.AsNoTracking();
            var staffView = false;

            switch ((view ?? "mine").Trim().ToLowerInvariant())
            {
                case "mine":
                    query = query.Where(t => t.RequesterUserId == actorUserId || t.RaisedByUserId == actorUserId);
                    break;
                case "copied":
                    query = query.Where(t => t.Watchers.Any(w => w.UserId == actorUserId));
                    break;
                case "assigned":
                    query = query.Where(t => t.AssigneeUserId == actorUserId);
                    break;
                case "department":
                    if (!departmentId.HasValue) return (new TicketProblem(400, "Choose a department.", "departmentId"), null);
                    if (!actorIsSuperAdmin && !await IsDepartmentStaffAsync(actorUserId, departmentId.Value))
                        return (new TicketProblem(403, "Only staff of this department can see its tickets."), null);
                    query = query.Where(t => t.DepartmentId == departmentId.Value);
                    if (unitId.HasValue) query = query.Where(t => t.UnitId == unitId.Value);
                    staffView = true;
                    break;
                default:
                    return (new TicketProblem(400, "view must be mine, copied, assigned or department.", "view"), null);
            }

            if (status.HasValue) query = query.Where(t => t.Status == status.Value);
            var term = (search ?? string.Empty).Trim();
            if (term.Length > 0)
            {
                if (term.Length > 100) term = term.Substring(0, 100);
                query = staffView
                    ? query.Where(t => t.Reference.Contains(term) || t.Subject.Contains(term) || t.DescriptionText.Contains(term))
                    : query.Where(t => t.Reference.Contains(term) || t.Subject.Contains(term));
            }

            var total = await query.CountAsync();
            var items = await Project(query.OrderByDescending(t => t.CreatedAt).Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync();
            return (null, new TicketPageDto { Items = items, Total = total, Page = page, PageSize = pageSize });
        }

        public async Task<Guid?> FindIdByReferenceAsync(string reference)
        {
            var value = (reference ?? string.Empty).Trim().ToUpperInvariant();
            if (value.Length == 0 || value.Length > 30) return null;
            return await _db.Tickets.AsNoTracking().Where(t => t.Reference == value).Select(t => (Guid?)t.Id).FirstOrDefaultAsync();
        }

        public async Task<(TicketProblem? Problem, TicketDetailDto? Ticket)> GetAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (NotFound(), null);
            var (canView, isStaff) = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!canView) return (NotFound(), null);

            var x = await Project(_db.Tickets.AsNoTracking().Where(t => t.Id == ticketId)).SingleAsync();
            var detail = new TicketDetailDto
            {
                Id = x.Id, Reference = x.Reference, Subject = x.Subject, DepartmentCode = x.DepartmentCode, CategoryName = x.CategoryName,
                UnitName = x.UnitName, LocationName = x.LocationName, Priority = x.Priority, Status = x.Status, Requester = x.Requester,
                Assignee = x.Assignee, CreatedAt = x.CreatedAt, UpdatedAt = x.UpdatedAt
            };
            var extra = await _db.Tickets.AsNoTracking().Where(t => t.Id == ticketId)
                .Select(t => new { t.DepartmentId, DepartmentName = t.Department!.Name, t.CategoryId, t.UnitId, t.LocationId, t.RequesterDepartment, t.RaisedByUserId, t.DescriptionHtml })
                .SingleAsync();
            detail.DepartmentId = extra.DepartmentId;
            detail.DepartmentName = extra.DepartmentName;
            detail.CategoryId = extra.CategoryId;
            detail.UnitId = extra.UnitId;
            detail.LocationId = extra.LocationId;
            detail.RequesterDepartment = extra.RequesterDepartment;
            detail.DescriptionHtml = extra.DescriptionHtml;
            detail.RaisedBy = await PersonAsync(extra.RaisedByUserId);

            detail.Cc = await _db.TicketWatchers.AsNoTracking().Where(w => w.TicketId == ticketId)
                .OrderBy(w => w.AddedAt)
                .Select(w => new PersonDto(w.UserId, w.User!.UserName ?? string.Empty, w.User.FullName))
                .ToListAsync();

            var comments = await _db.TicketComments.AsNoTracking()
                .Where(c => c.TicketId == ticketId && (isStaff || !c.IsInternal))
                .OrderBy(c => c.CreatedAt)
                .Select(c => new TicketCommentDto
                {
                    Id = c.Id, BodyHtml = c.BodyHtml, IsInternal = c.IsInternal, CreatedAt = c.CreatedAt,
                    Author = new PersonDto(c.AuthorUserId, c.AuthorUser!.UserName ?? string.Empty, c.AuthorUser.FullName)
                })
                .ToListAsync();
            var visibleCommentIds = comments.Select(c => c.Id).ToList();
            var files = await _db.TicketAttachments.AsNoTracking()
                .Where(a => a.TicketId == ticketId && (a.CommentId == null || visibleCommentIds.Contains(a.CommentId.Value)))
                .OrderBy(a => a.UploadedAt)
                .Select(a => new { a.CommentId, Dto = new TicketAttachmentDto { Id = a.Id, CommentId = a.CommentId, FileName = a.FileName, ContentType = a.ContentType, SizeBytes = a.SizeBytes, UploadedAt = a.UploadedAt }, a.UploadedByUserId })
                .ToListAsync();
            var uploaders = await PeopleAsync(files.Select(f => f.UploadedByUserId));
            foreach (var f in files) f.Dto.UploadedBy = uploaders[f.UploadedByUserId];
            detail.Attachments = files.Where(f => f.CommentId == null).Select(f => f.Dto).ToList();
            foreach (var c in comments) c.Attachments = files.Where(f => f.CommentId == c.Id).Select(f => f.Dto).ToList();
            detail.Comments = comments;

            detail.IsStaffView = isStaff;
            detail.CanComment = ticket.Status is not (TicketStatus.Closed or TicketStatus.Cancelled);
            detail.CanAddInternalNote = isStaff && detail.CanComment;
            return (null, detail);
        }

        public async Task<(TicketProblem? Problem, string? FileName, string? ContentType, byte[]? Data)> GetAttachmentAsync(Guid ticketId, Guid attachmentId,
            Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (NotFound(), null, null, null);
            var (canView, isStaff) = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!canView) return (NotFound(), null, null, null);

            var file = await _db.TicketAttachments.AsNoTracking()
                .Where(a => a.Id == attachmentId && a.TicketId == ticketId)
                .Select(a => new { a.FileName, a.ContentType, Internal = a.Comment != null && a.Comment.IsInternal })
                .FirstOrDefaultAsync();
            if (file == null || (file.Internal && !isStaff)) return (new TicketProblem(404, "File not found."), null, null, null);
            var data = await _db.TicketAttachmentContents.AsNoTracking().Where(c => c.AttachmentId == attachmentId).Select(c => c.Data).FirstOrDefaultAsync();
            if (data == null) return (new TicketProblem(404, "File not found."), null, null, null);

            Stage(AuditAction.Downloaded, "TicketAttachment", attachmentId, ticket.Reference + " / " + file.FileName, null, null);
            await _db.SaveChangesAsync();
            return (null, file.FileName, file.ContentType, data);
        }

        // ---------------- comments ----------------

        public async Task<(TicketProblem? Problem, TicketCommentDto? Comment)> AddCommentAsync(Guid ticketId, AddCommentRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.Include(t => t.Unit).FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (NotFound(), null);
            var (canView, isStaff) = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!canView) return (NotFound(), null);
            if (ticket.Status is TicketStatus.Closed or TicketStatus.Cancelled)
                return (new TicketProblem(400, "This ticket is " + ticket.Status.ToString().ToLowerInvariant() + ", so it takes no more comments."), null);
            if (request.IsInternal && !isStaff)
                return (new TicketProblem(403, "Only staff of the department can add internal notes.", "isInternal"), null);

            var (html, text, bodyProblem) = CleanBody(request.BodyHtml, "bodyHtml", "Write a comment.");
            if (bodyProblem != null) return (bodyProblem, null);
            var (fileProblem, files) = await AttachmentRules.CheckAsync(request.Files);
            if (fileProblem != null) return (new TicketProblem(400, fileProblem, "files"), null);

            var now = DateTime.UtcNow;
            var comment = new TicketComment { Id = Guid.NewGuid(), TicketId = ticketId, AuthorUserId = actorUserId, BodyHtml = html, BodyText = text, IsInternal = request.IsInternal, CreatedAt = now };
            _db.TicketComments.Add(comment);
            AddFiles(ticketId, comment.Id, files, actorUserId, now);
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Created, "TicketComment", comment.Id, ticket.Reference, null, new { ticket = ticket.Reference, internalNote = request.IsInternal, files = files.Count });

            // Who hears about it: public comments go to everyone on the ticket; internal notes to the assignee and the unit's heads
            var author = await PersonAsync(actorUserId);
            var recipients = new HashSet<Guid>();
            if (!request.IsInternal)
            {
                recipients.Add(ticket.RequesterUserId);
                foreach (var w in await _db.TicketWatchers.Where(w => w.TicketId == ticketId).Select(w => w.UserId).ToListAsync()) recipients.Add(w);
            }
            if (ticket.AssigneeUserId.HasValue) recipients.Add(ticket.AssigneeUserId.Value);
            if (request.IsInternal || !ticket.AssigneeUserId.HasValue)
                foreach (var head in new[] { ticket.Unit!.HeadUserId, ticket.Unit.DeputyHeadUserId }.Where(h => h.HasValue)) recipients.Add(head!.Value);
            recipients.Remove(actorUserId);
            var who = author.FullName ?? author.UserName;
            foreach (var userId in recipients)
                _notifications.Stage(userId,
                    (request.IsInternal ? "Internal note on " : "New comment on ") + ticket.Reference,
                    who + (request.IsInternal ? " added an internal note." : " commented.") + (files.Count > 0 ? " Files attached: " + files.Count + "." : string.Empty),
                    NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket changed while you were writing. Reload it and try again."), null);
            }

            var uploader = author;
            return (null, new TicketCommentDto
            {
                Id = comment.Id, Author = author, BodyHtml = html, IsInternal = comment.IsInternal, CreatedAt = now,
                Attachments = _db.ChangeTracker.Entries<TicketAttachment>().Select(e => e.Entity).Where(a => a.CommentId == comment.Id)
                    .Select(a => new TicketAttachmentDto { Id = a.Id, CommentId = a.CommentId, FileName = a.FileName, ContentType = a.ContentType, SizeBytes = a.SizeBytes, UploadedAt = a.UploadedAt, UploadedBy = uploader })
                    .ToList()
            });
        }

        // ---------------- helpers ----------------

        /// <summary>Requester, raiser, copied people, department staff (unit members and HOD) and Super Admins can view; staff also see internal notes.</summary>
        private async Task<(bool CanView, bool IsStaff)> AccessAsync(Ticket ticket, Guid userId, bool isSuperAdmin)
        {
            var isStaff = isSuperAdmin || await IsDepartmentStaffAsync(userId, ticket.DepartmentId);
            if (isStaff) return (true, true);
            var canView = ticket.RequesterUserId == userId || ticket.RaisedByUserId == userId
                || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticket.Id && w.UserId == userId);
            return (canView, false);
        }

        private async Task<bool> IsDepartmentStaffAsync(Guid userId, Guid departmentId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == departmentId)
            || await _db.Departments.AnyAsync(d => d.Id == departmentId && d.HodUserId == userId);

        private static IQueryable<TicketListItemDto> Project(IQueryable<Ticket> query) =>
            query.Select(t => new TicketListItemDto
            {
                Id = t.Id, Reference = t.Reference, Subject = t.Subject, DepartmentCode = t.Department!.Code, CategoryName = t.Category!.Name,
                UnitName = t.Unit!.Name, LocationName = t.Location!.Name, Priority = t.Priority, Status = t.Status,
                Requester = new PersonDto(t.RequesterUserId, t.RequesterUser!.UserName ?? string.Empty, t.RequesterUser.FullName),
                Assignee = t.AssigneeUserId == null ? null : new PersonDto(t.AssigneeUserId.Value, t.AssigneeUser!.UserName ?? string.Empty, t.AssigneeUser.FullName),
                CreatedAt = t.CreatedAt, UpdatedAt = t.UpdatedAt
            });

        /// <summary>DEPT-YYYY-000001: the next number for the department and (Lagos) year, taken inside the caller's transaction.</summary>
        private async Task<string> NextReferenceAsync(string departmentCode, Guid departmentId)
        {
            var year = (_time.GetUtcNow().UtcDateTime + TimeSpan.FromHours(1)).Year;
            var numbers = await _db.Database.SqlQuery<int>($@"MERGE dbo.TicketSequences WITH (HOLDLOCK) AS target
USING (SELECT {departmentId} AS DepartmentId, {year} AS [Year]) AS source
ON target.DepartmentId = source.DepartmentId AND target.[Year] = source.[Year]
WHEN MATCHED THEN UPDATE SET LastNumber = target.LastNumber + 1
WHEN NOT MATCHED THEN INSERT (DepartmentId, [Year], LastNumber) VALUES (source.DepartmentId, source.[Year], 1)
OUTPUT inserted.LastNumber AS [Value];").ToListAsync();
            return departmentCode + "-" + year + "-" + numbers.Single().ToString("D6");
        }

        private (string Html, string Text, TicketProblem? Problem) CleanBody(string? raw, string field, string emptyMessage)
        {
            if (raw != null && raw.Length > TicketSeed.MaxHtmlChars * 2)
                return (string.Empty, string.Empty, new TicketProblem(400, "The text is too long. Attach large tables as files.", field));
            var html = RichText.Clean(raw);
            var text = RichText.ToText(html);
            if (text.Length == 0) return (string.Empty, string.Empty, new TicketProblem(400, emptyMessage, field));
            if (html.Length > TicketSeed.MaxHtmlChars) return (string.Empty, string.Empty, new TicketProblem(400, "The text is too long. Attach large tables as files.", field));
            return (html, text, null);
        }

        private void AddFiles(Guid ticketId, Guid? commentId, List<AttachmentRules.CheckedFile> files, Guid uploadedBy, DateTime now)
        {
            foreach (var file in files)
            {
                var attachment = new TicketAttachment
                {
                    Id = Guid.NewGuid(), TicketId = ticketId, CommentId = commentId, FileName = file.FileName, ContentType = file.ContentType,
                    SizeBytes = file.Data.Length, Sha256 = file.Sha256, UploadedByUserId = uploadedBy, UploadedAt = now
                };
                _db.TicketAttachments.Add(attachment);
                _db.TicketAttachmentContents.Add(new TicketAttachmentContent { AttachmentId = attachment.Id, Data = file.Data });
            }
        }

        private async Task<PersonDto> PersonAsync(Guid userId) =>
            await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).FirstOrDefaultAsync()
            ?? new PersonDto(userId, string.Empty, null);

        private async Task<Dictionary<Guid, PersonDto>> PeopleAsync(IEnumerable<Guid> ids)
        {
            var list = ids.Distinct().ToList();
            var found = await _db.Users.AsNoTracking().Where(u => list.Contains(u.Id))
                .Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).ToListAsync();
            var map = found.ToDictionary(p => p.UserId);
            foreach (var id in list.Where(id => !map.ContainsKey(id))) map[id] = new PersonDto(id, string.Empty, null);
            return map;
        }

        private static TicketProblem NotFound() => new(404, "Ticket not found.");

        private void Stage(AuditAction action, string entityType, Guid entityId, string? display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, entityType, entityId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }

        private static string? Trim(string? value, int max) => string.IsNullOrWhiteSpace(value) ? null : value.Length > max ? value.Substring(0, max) : value;

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Tickets\RichTextTests.cs'] = @'
using ServiceDeskAPI.Infrastructure.Tickets;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>The rich-text cleaner: what the editor needs survives, anything that could run code does not.</summary>
    public class RichTextTests
    {
        [Fact]
        public void Formatting_lists_links_and_tables_survive()
        {
            var html = RichText.Clean(
                "<h2>Request</h2><p><strong>Bold</strong> <em>it</em> <u>u</u> <s>s</s> <mark>hi</mark> <span style=\"color: #ff0000\">red</span></p>" +
                "<ul><li>one</li></ul><ol start=\"3\"><li>three</li></ol><p style=\"text-align: center\"><a href=\"https://www.accessarmpensions.com\">site</a></p>" +
                "<table><colgroup><col style=\"width: 120px\"></colgroup><tbody><tr><th colspan=\"2\">Head</th></tr><tr><td>A1</td><td>B1</td></tr></tbody></table>");

            Assert.Contains("<h2>Request</h2>", html);
            Assert.Contains("<strong>Bold</strong>", html);
            Assert.Contains("<mark>hi</mark>", html);
            Assert.Contains("color: rgba(255, 0, 0, 1)", html.Replace("#ff0000", "rgba(255, 0, 0, 1)"));
            Assert.Contains("<ol start=\"3\">", html);
            Assert.Contains("text-align: center", html);
            Assert.Contains("href=\"https://www.accessarmpensions.com\"", html);
            Assert.Contains("rel=\"noopener noreferrer nofollow\"", html);
            Assert.Contains("<th colspan=\"2\">Head</th>", html);
            Assert.Contains("<td>A1</td>", html);
        }

        [Fact]
        public void Scripts_handlers_images_and_dangerous_links_are_removed()
        {
            var html = RichText.Clean(
                "<p onclick=\"alert(1)\">Hi<script>alert(2)</script></p><img src=\"x\" onerror=\"alert(3)\">" +
                "<a href=\"javascript:alert(4)\">bad</a><a href=\"data:text/html;base64,PHNjcmlwdD4=\">data</a>" +
                "<iframe src=\"https://evil.example\"></iframe><form><input value=\"x\"></form>" +
                "<p style=\"position: fixed; background-image: url(https://evil.example/x.png); color: blue\">styled</p>");

            Assert.DoesNotContain("script", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("onclick", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("onerror", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("<img", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("javascript:", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("data:", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("iframe", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("<input", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("position", html, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("url(", html, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("Hi", html);
            Assert.Contains("styled", html);
        }

        [Fact]
        public void Plain_text_keeps_lines_and_table_cells()
        {
            var text = RichText.ToText(RichText.Clean("<p>First line</p><p>Second<br>line</p><table><tr><td>A1</td><td>B1</td></tr><tr><td>A2</td><td>B2</td></tr></table>"));

            Assert.Equal("First line\nSecond\nline\nA1 B1\nA2 B2", text);
        }

        [Fact]
        public void Empty_editor_output_has_no_text()
        {
            Assert.Equal(string.Empty, RichText.ToText(RichText.Clean("<p></p><p> </p><p><br></p>")));
            Assert.Equal(string.Empty, RichText.Clean(null));
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Tickets\TicketTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Domain.Catalogue;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Tickets
{
    /// <summary>Step 4: raising, reading, commenting, files, locations and the duplicate check (BRD M2, M4).</summary>
    public class TicketTests : IClassFixture<ServiceDeskApiFactory>
    {
        private static readonly Guid MatchingCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.ContributionMatchingUnitId).Id;
        private static readonly Guid RefundCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.RefundUnitId).Id;
        private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");

        private readonly ServiceDeskApiFactory _factory;

        public TicketTests(ServiceDeskApiFactory factory) => _factory = factory;

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

        /// <summary>A new staff member outside Contribution Processing who can sign in.</summary>
        private async Task<string> NewOutsiderAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.out" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Outsider " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return name;
        }

        private static MultipartFormDataContent Form(Guid category, string subject = "Remittance not reflecting", string html = "<p>Please check the <strong>March</strong> remittance.</p>",
            Guid? location = null, IEnumerable<(string Name, byte[] Data)>? files = null, IEnumerable<Guid>? cc = null, Guid? requester = null, int? priority = null)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(category.ToString()), "categoryId" },
                { new StringContent((location ?? TicketSeed.HeadquartersLocationId).ToString()), "locationId" },
                { new StringContent(subject), "subject" },
                { new StringContent(html), "descriptionHtml" }
            };
            if (priority.HasValue) form.Add(new StringContent(priority.Value.ToString()), "priority");
            if (requester.HasValue) form.Add(new StringContent(requester.Value.ToString()), "requesterUserId");
            foreach (var id in cc ?? Array.Empty<Guid>()) form.Add(new StringContent(id.ToString()), "ccUserIds");
            foreach (var (name, data) in files ?? Array.Empty<(string, byte[])>())
            {
                var file = new ByteArrayContent(data);
                file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                form.Add(file, "files", name);
            }
            return form;
        }

        private static async Task<CreatedTicketDto> RaiseAsync(HttpClient client, MultipartFormDataContent form)
        {
            var response = await client.PostAsync("/api/tickets", form);
            Assert.True(response.StatusCode == HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<CreatedTicketDto>())!;
        }

        private static async Task<string?> FieldError(HttpResponseMessage response, string field)
        {
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("errors").TryGetProperty(field, out var value) ? value.GetString() : null;
        }

        [Fact]
        public async Task A_requester_raises_a_ticket_with_a_file_and_a_colleague_copied()
        {
            var requester = await As("test.requester");
            var copied = await IdOf("test.caseworker2");

            var created = await RaiseAsync(requester, Form(MatchingCategory, files: new[] { ("schedule.pdf", Pdf) }, cc: new[] { copied }));

            Assert.Matches(new Regex(@"^CP-\d{4}-\d{6}$"), created.Reference);
            var ticket = await requester.GetFromJsonAsync<TicketDetailDto>($"/api/tickets/{created.Id}");
            Assert.Equal(TicketStatus.New, ticket!.Status);
            Assert.Equal(TicketPriority.Medium, ticket.Priority);
            Assert.Equal("Contribution Matching", ticket.UnitName);
            Assert.Equal(TicketSeed.HeadquartersName, ticket.LocationName);
            Assert.Equal("test.requester", ticket.Requester.UserName);
            Assert.Contains("<strong>March</strong>", ticket.DescriptionHtml);
            Assert.Contains(ticket.Cc, p => p.UserId == copied);
            var file = Assert.Single(ticket.Attachments);
            Assert.Equal("schedule.pdf", file.FileName);
            Assert.Equal("application/pdf", file.ContentType);
            Assert.False(ticket.IsStaffView);

            var download = await requester.GetAsync($"/api/tickets/{created.Id}/attachments/{file.Id}");
            Assert.Equal(HttpStatusCode.OK, download.StatusCode);
            Assert.Equal(Pdf, await download.Content.ReadAsByteArrayAsync());
            Assert.Equal("attachment", download.Content.Headers.ContentDisposition!.DispositionType);

            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var told = await db.InAppNotifications.Where(n => n.RelatedEntityId == created.Id).Select(n => new { n.RecipientUserId, n.Title, n.Message }).ToListAsync();
            Assert.Contains(told, n => n.RecipientUserId == ticket.Requester.UserId && n.Title == "Ticket " + created.Reference + " received");
            Assert.Contains(told, n => n.RecipientUserId == copied && n.Title.StartsWith("You were copied"));
            Assert.Contains(told, n => n.RecipientUserId == ticket.Requester.UserId);
            var hou = await IdOf("test.hou");
            Assert.Contains(told, n => n.RecipientUserId == hou && n.Title.StartsWith("New ticket in Contribution Matching"));
            // Notifications never carry the subject or description
            Assert.DoesNotContain(told, n => n.Message.Contains("Remittance not reflecting") || n.Message.Contains("March"));
        }

        [Fact]
        public async Task References_count_up_per_department_and_year()
        {
            var requester = await As("test.requester");
            var first = await RaiseAsync(requester, Form(RefundCategory));
            var second = await RaiseAsync(requester, Form(MatchingCategory));

            var a = int.Parse(first.Reference.Substring(first.Reference.LastIndexOf('-') + 1));
            var b = int.Parse(second.Reference.Substring(second.Reference.LastIndexOf('-') + 1));
            Assert.Equal(a + 1, b);
            Assert.Equal(first.Reference.Substring(0, 8), second.Reference.Substring(0, 8));
        }

        [Fact]
        public async Task The_description_is_cleaned_before_it_is_stored()
        {
            var requester = await As("test.requester");
            var created = await RaiseAsync(requester, Form(MatchingCategory,
                html: "<p onclick=\"steal()\">See table<script>steal()</script></p><table><tr><td>PIN</td><td>Amount</td></tr></table><img src=x onerror=steal()><a href=\"javascript:steal()\">x</a>"));

            using var scope = _factory.Services.CreateScope();
            var stored = await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == created.Id);
            Assert.DoesNotContain("onclick", stored.DescriptionHtml);
            Assert.DoesNotContain("onerror", stored.DescriptionHtml);
            Assert.DoesNotContain("<script", stored.DescriptionHtml);
            Assert.DoesNotContain("<img", stored.DescriptionHtml);
            Assert.DoesNotContain("javascript:", stored.DescriptionHtml);
            Assert.Contains("<td>Amount</td>", stored.DescriptionHtml);
            Assert.Contains("PIN Amount", stored.DescriptionText);
        }

        [Fact]
        public async Task Bad_forms_are_refused_with_the_field_to_blame()
        {
            var requester = await As("test.requester");
            var someoneElse = await IdOf("test.caseworker1");

            var noCategory = await requester.PostAsync("/api/tickets", Form(Guid.Empty));
            var empty = await requester.PostAsync("/api/tickets", Form(MatchingCategory, html: "<p> </p><p><br></p>"));
            var shortSubject = await requester.PostAsync("/api/tickets", Form(MatchingCategory, subject: "Hi"));
            var badLocation = await requester.PostAsync("/api/tickets", Form(MatchingCategory, location: Guid.NewGuid()));
            var sevenFiles = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: Enumerable.Range(1, 7).Select(i => ($"f{i}.pdf", Pdf))));
            var tooBig = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: new[] { ("big.pdf", Pdf.Concat(new byte[1024 * 1024]).ToArray()) }));
            var fakePdf = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: new[] { ("fake.pdf", Encoding.ASCII.GetBytes("not a pdf")) }));
            var exe = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: new[] { ("tool.exe", new byte[] { 0x4D, 0x5A, 0, 0 }) }));
            var forSomeoneElse = await requester.PostAsync("/api/tickets", Form(MatchingCategory, requester: someoneElse));

            Assert.Equal(HttpStatusCode.BadRequest, noCategory.StatusCode);
            Assert.NotNull(await FieldError(noCategory, "categoryId"));
            Assert.NotNull(await FieldError(empty, "descriptionHtml"));
            Assert.NotNull(await FieldError(shortSubject, "subject"));
            Assert.NotNull(await FieldError(badLocation, "locationId"));
            Assert.Contains("6", await FieldError(sevenFiles, "files"));
            Assert.Contains("1 MB", await FieldError(tooBig, "files"));
            Assert.NotNull(await FieldError(fakePdf, "files"));
            Assert.NotNull(await FieldError(exe, "files"));
            Assert.Equal(HttpStatusCode.Forbidden, forSomeoneElse.StatusCode);

            // Six files of up to 1 MB are fine
            var six = await requester.PostAsync("/api/tickets", Form(MatchingCategory, files: Enumerable.Range(1, 6).Select(i => ($"f{i}.pdf", Pdf))));
            Assert.Equal(HttpStatusCode.OK, six.StatusCode);
        }

        [Fact]
        public async Task Only_people_on_the_ticket_and_department_staff_can_see_it_and_internal_notes_stay_internal()
        {
            var requester = await As("test.requester");
            var copiedName = await NewOutsiderAsync();
            var created = await RaiseAsync(requester, Form(MatchingCategory, cc: new[] { await IdOf(copiedName) }));
            var outsider = await As(await NewOutsiderAsync());
            var worker = await As("test.caseworker1");

            Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/tickets/{created.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await outsider.GetAsync($"/api/tickets/by-reference/{created.Reference}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As(copiedName)).GetAsync($"/api/tickets/{created.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await (await As("test.hod")).GetAsync($"/api/tickets/{created.Id}")).StatusCode);

            // An internal note with a file
            var note = new MultipartFormDataContent { { new StringContent("<p>Checked the schedule.</p>"), "bodyHtml" }, { new StringContent("true"), "isInternal" } };
            var noteFile = new ByteArrayContent(Pdf);
            noteFile.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
            note.Add(noteFile, "files", "internal.pdf");
            var noteResponse = await worker.PostAsync($"/api/tickets/{created.Id}/comments", note);
            Assert.Equal(HttpStatusCode.OK, noteResponse.StatusCode);
            var added = await noteResponse.Content.ReadFromJsonAsync<TicketCommentDto>();
            var internalFile = Assert.Single(added!.Attachments);

            // A public reply from the requester
            var reply = await requester.PostAsync($"/api/tickets/{created.Id}/comments",
                new MultipartFormDataContent { { new StringContent("<p>Thanks</p>"), "bodyHtml" }, { new StringContent("false"), "isInternal" } });
            Assert.Equal(HttpStatusCode.OK, reply.StatusCode);
            var sneaky = await requester.PostAsync($"/api/tickets/{created.Id}/comments",
                new MultipartFormDataContent { { new StringContent("<p>Let me in</p>"), "bodyHtml" }, { new StringContent("true"), "isInternal" } });
            Assert.Equal(HttpStatusCode.Forbidden, sneaky.StatusCode);

            var staffView = await (await As("test.hou")).GetFromJsonAsync<TicketDetailDto>($"/api/tickets/{created.Id}");
            var requesterView = await requester.GetFromJsonAsync<TicketDetailDto>($"/api/tickets/by-reference/{created.Reference}");
            Assert.True(staffView!.IsStaffView);
            Assert.True(staffView.CanAddInternalNote);
            Assert.Equal(2, staffView.Comments.Count);
            Assert.Single(requesterView!.Comments);
            Assert.False(requesterView.Comments[0].IsInternal);
            Assert.False(requesterView.CanAddInternalNote);
            Assert.Equal(HttpStatusCode.NotFound, (await requester.GetAsync($"/api/tickets/{created.Id}/attachments/{internalFile.Id}")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await worker.GetAsync($"/api/tickets/{created.Id}/attachments/{internalFile.Id}")).StatusCode);

            // The requester's reply reached the unit's head (no assignee yet); the internal note did not reach the requester
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var hou = await IdOf("test.hou");
            Assert.True(await db.InAppNotifications.AnyAsync(n => n.RelatedEntityId == created.Id && n.RecipientUserId == hou && n.Title == "New comment on " + created.Reference));
            Assert.False(await db.InAppNotifications.AnyAsync(n => n.RelatedEntityId == created.Id && n.RecipientUserId == requesterView.Requester.UserId && n.Title.StartsWith("Internal note")));
        }

        [Fact]
        public async Task Lists_show_my_copied_and_department_tickets()
        {
            var requester = await As("test.requester");
            var copiedName = await NewOutsiderAsync();
            var created = await RaiseAsync(requester, Form(RefundCategory, subject: "Refund list check", cc: new[] { await IdOf(copiedName) }));

            var mine = await requester.GetFromJsonAsync<TicketPageDto>("/api/tickets?view=mine&search=Refund%20list");
            var copied = await (await As(copiedName)).GetFromJsonAsync<TicketPageDto>("/api/tickets?view=copied");
            var refundQueue = await (await As("test.caseworker2")).GetFromJsonAsync<TicketPageDto>($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}&unitId={OrgSeed.RefundUnitId}&status=1");
            var matchingQueue = await (await As("test.hod")).GetFromJsonAsync<TicketPageDto>($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}&unitId={OrgSeed.ContributionMatchingUnitId}");
            var refused = await requester.GetAsync($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}");

            Assert.Contains(mine!.Items, t => t.Id == created.Id);
            Assert.Contains(copied!.Items, t => t.Id == created.Id);
            Assert.Contains(refundQueue!.Items, t => t.Id == created.Id);
            Assert.DoesNotContain(matchingQueue!.Items, t => t.Id == created.Id);
            Assert.Equal(HttpStatusCode.Forbidden, refused.StatusCode);
        }

        [Fact]
        public async Task A_Super_Admin_raises_a_ticket_for_someone_else()
        {
            var admin = await As("test.superadmin");
            var requesterId = await IdOf("test.requester");

            var created = await RaiseAsync(admin, Form(MatchingCategory, requester: requesterId, priority: 3));

            var ticket = await (await As("test.requester")).GetFromJsonAsync<TicketDetailDto>($"/api/tickets/{created.Id}");
            Assert.Equal(requesterId, ticket!.Requester.UserId);
            Assert.Equal("test.superadmin", ticket.RaisedBy.UserName);
            Assert.Equal(TicketPriority.High, ticket.Priority);
        }

        [Fact]
        public async Task Location_is_preselected_from_the_last_ticket_and_kept_by_the_Super_Admin()
        {
            var admin = await As("test.superadmin");
            var newcomerName = await NewOutsiderAsync();
            var newcomer = await As(newcomerName);

            var branch = await admin.PostAsJsonAsync("/api/admin/locations", new { name = "Branch " + Guid.NewGuid().ToString("N").Substring(0, 5) });
            Assert.Equal(HttpStatusCode.OK, branch.StatusCode);
            var branchId = (await branch.Content.ReadFromJsonAsync<LocationDto>())!.Id;

            var before = await newcomer.GetFromJsonAsync<LocationChoicesDto>("/api/locations");
            Assert.True(before!.Locations.Count >= 2);
            Assert.Null(before.DefaultLocationId);

            await RaiseAsync(newcomer, Form(MatchingCategory, location: branchId));
            var after = await newcomer.GetFromJsonAsync<LocationChoicesDto>("/api/locations");
            Assert.Equal(branchId, after!.DefaultLocationId);

            Assert.Equal(HttpStatusCode.Forbidden, (await newcomer.GetAsync($"/api/locations?forUserId={await IdOf("test.requester")}")).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await newcomer.PostAsJsonAsync("/api/admin/locations", new { name = "Mine" })).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await admin.PatchAsJsonAsync($"/api/admin/locations/{branchId}", new { isActive = false })).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await admin.PatchAsJsonAsync($"/api/admin/locations/{TicketSeed.HeadquartersLocationId}", new { isActive = false })).StatusCode);
            var afterOff = await newcomer.GetFromJsonAsync<LocationChoicesDto>("/api/locations");
            Assert.Equal(TicketSeed.HeadquartersLocationId, afterOff!.DefaultLocationId);
        }

        [Fact]
        public async Task The_duplicate_check_finds_open_tickets_with_the_same_PIN_in_the_same_category()
        {
            var requester = await As("test.requester");
            var pin = "PEN" + Random.Shared.NextInt64(100000000000, 999999999999);
            await RaiseAsync(requester, Form(MatchingCategory, html: $"<p>Member {pin} has a missing remittance.</p>"));

            var same = await requester.PostAsJsonAsync("/api/tickets/duplicate-check", new { categoryId = MatchingCategory, subject = "Again for " + pin.ToLowerInvariant() });
            var other = await requester.PostAsJsonAsync("/api/tickets/duplicate-check", new { categoryId = RefundCategory, descriptionHtml = $"<p>{pin}</p>" });
            var none = await requester.PostAsJsonAsync("/api/tickets/duplicate-check", new { categoryId = MatchingCategory, subject = "No PIN here" });

            var sameResult = await same.Content.ReadFromJsonAsync<DuplicateCheckDto>();
            var match = Assert.Single(sameResult!.Matches);
            Assert.True(match.IsYours);
            Assert.Equal("PEN********" + pin.Substring(pin.Length - 4), Assert.Single(sameResult.PinsFound));
            Assert.Empty((await other.Content.ReadFromJsonAsync<DuplicateCheckDto>())!.Matches);
            Assert.Empty((await none.Content.ReadFromJsonAsync<DuplicateCheckDto>())!.PinsFound);
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

$backup[$projPath] = [System.IO.File]::ReadAllText($projPath)

Push-Location $root
try {
    Write-Host ("1/5 Writing {0} source and test files..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        [System.IO.File]::WriteAllText($full, $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n"), $utf8)
    }

    Write-Host '2/5 Adding the HtmlSanitizer package (cleans formatted ticket text)...'
    if ([System.IO.File]::ReadAllText($projPath) -notmatch 'Include="HtmlSanitizer"') {
        $p = Invoke-Dotnet @('add', $projPath, 'package', 'HtmlSanitizer')
        if ($script:lastExit -ne 0) { $p | Select-Object -Last 15 | ForEach-Object { Write-Host "  $_" }; throw 'Adding the HtmlSanitizer package failed (is nuget.org reachable from this computer?).' }
    }
    $sanitizerVersion = [regex]::Match([System.IO.File]::ReadAllText($projPath), 'Include="HtmlSanitizer"\s+Version="([^"]+)"').Groups[1].Value
    Write-Host "  HtmlSanitizer $sanitizerVersion"

    Write-Host '3/5 Building...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }

    Write-Host '4/5 Creating the Tickets migration (HQ location seeded)...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'Tickets', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_Tickets.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

    Write-Host '5/5 Building and running all tests (LocalDB; takes a minute)...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed after adding the migration.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) {
        # Show each failing test's message (the lines between "Error Message:" and "Stack Trace:")
        $show = $false; $shown = 0
        foreach ($line in $t) {
            if ($line -match 'Error Message:') { $show = $true }
            elseif ($line -match 'Stack Trace:') { $show = $false }
            if ($show -and $shown -lt 60) { Write-Host "  $line"; $shown++ }
        }
        throw 'Tests failed.'
    }

    Write-Host ''
    Write-Host 'Done. Step 4 is in place.' -ForegroundColor Green
    Write-Host 'Start the API once: it adds the ticket tables and the HQ location.'
    Write-Host 'In Swagger as test.requester: GET /api/locations, then POST /api/tickets (form: categoryId, locationId, subject, descriptionHtml),'
    Write-Host 'then GET /api/tickets?view=mine. As test.hou: GET /api/tickets?view=department&departmentId=5d1a0002-0000-4000-8000-000000000001'
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
