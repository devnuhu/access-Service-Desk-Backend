# Step 5 - Automatic assignment and reassignment (BRD M3, FR-3.1 to FR-3.11).
#
# What it adds:
#   - The engine: a new ticket goes straight to the eligible case worker (in the unit, mapped to the category, available today,
#     active account) with the lowest weighted workload (Critical 3, High 2, Medium 1, Low 1 over Assigned, In progress and Reopened
#     tickets); ties go to whoever was assigned least recently. The HOD is never eligible.
#   - Nobody eligible: the ticket stays New, the unit's head and deputy are told once, and the queue is tried again every 5 minutes
#     and as soon as someone comes back from leave, gets the category or joins the unit.
#   - Leave or blocking (FR-3.11): tickets not yet started go back through the engine; started ones stay and the head is told.
#   - Reassignment with a reason: the holder and the unit's head within the unit; the HOD and Super Admin to any unit of the department.
#   - Assignment history with the workloads compared (FR-3.10); GET api/people/search for copying colleagues.
#   - Access notifications no longer say "Sign out and back in" (the web app refreshes itself).
#   - Migration Assignment, and tests
#
# Run from ...\AccessServiceDesk\Backend\ServiceDesk with the API stopped:
#   .\Scripts\step5-assignment.ps1
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
if (-not (Test-Path (Join-Path $api 'Domain\Entities\Ticket.cs'))) { Write-Host 'Step 4 is not in place. Run step4-tickets.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Domain\Entities\TicketAssignment.cs')) { Write-Host 'TicketAssignment.cs already exists: Step 5 looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as the earlier step scripts wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Program.cs' = 'b81866d106dd97b8ad2e08bdcc8e2c675dc805af47af2ef6d140d721b3d28916'
    'ServiceDeskAPI\Domain\Entities\Ticket.cs' = '023388e5be82a2d0e76ee948c272b4b10857ae4be2860bee6c9c4de905e3f0e1'
    'ServiceDeskAPI\Infrastructure\Organisation\OrgRoleSync.cs' = 'd36c450addd74517452c48fd0f0044060089ee7d23b1c238a0b64b55dba63357'
    'ServiceDeskAPI\Infrastructure\Organisation\AvailabilityService.cs' = '1d9937feecc6ae930d248e03d641b2ad85698d58da1be24d2f80378689be58ae'
    'ServiceDeskAPI\Infrastructure\Organisation\OrganisationService.cs' = '49a19610674c8d169ffd2e14a3feed5541ad7b24eed9da3fd3a810e2bc668fc6'
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = 'd6aba452b45fec26740d98d7a046e586f3e399adb76404ce944b8bee9e74fcb7'
    'ServiceDeskAPI\Infrastructure\Tickets\TicketService.cs' = '3f4dd70bfd594619efd8f2a4731bb6cdb91533fc1b9a658ec893a71c29417a3a'
    'ServiceDeskAPI\Infrastructure\Catalogue\CatalogueService.cs' = '32c5c4036295183f31a7d0d46364198b41d8c1994a123f36ef13aed7e294d86f'
    'tests\ServiceDeskAPI.Tests\Tickets\TicketTests.cs' = '156ec14a0830ce34f871de5caa666e1bd2dcca396cce26998af3892da9be5166'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed since they were last written by a step script, so Step 5 stopped to avoid overwriting your changes:' -ForegroundColor Red
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

            // ============ ASSIGNMENT (Step 5): engine, reassignment, and the queue retried every few minutes ============
            builder.Services.AddOptions<ServiceDeskAPI.Infrastructure.Assignment.AssignmentOptions>().BindConfiguration("Assignment");
            builder.Services.AddSingleton<IAssignmentSignal, ServiceDeskAPI.Infrastructure.Assignment.AssignmentSignal>();
            builder.Services.AddScoped<IAssignmentService, ServiceDeskAPI.Infrastructure.Assignment.AssignmentService>();
            builder.Services.AddHostedService<ServiceDeskAPI.Infrastructure.Assignment.AssignmentWorker>();
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
$files['ServiceDeskAPI\Application\DTOs\AssignmentDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Entities;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One eligible case worker's position when the engine chose (FR-3.10).</summary>
    public class CandidateScoreDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        /// <summary>Open tickets weighted by priority: Critical 3, High 2, Medium 1, Low 1 (Assigned, In progress, Reopened).</summary>
        public int Workload { get; set; }
        public int OpenTickets { get; set; }
        public DateTime? LastAssignedAt { get; set; }
        public bool Chosen { get; set; }
    }

    public class TicketAssignmentDto
    {
        public Guid Id { get; set; }
        public DateTime At { get; set; }
        /// <summary>1 Auto, 2 Reassigned.</summary>
        public AssignmentMethod Method { get; set; }
        public string Reason { get; set; } = string.Empty;
        public PersonDto? From { get; set; }
        public PersonDto To { get; set; } = new(Guid.Empty, string.Empty, null);
        public PersonDto? By { get; set; }
        public string FromUnitName { get; set; } = string.Empty;
        public string ToUnitName { get; set; } = string.Empty;
        public List<CandidateScoreDto> Scores { get; set; } = new();
    }

    /// <summary>Who the signed-in person may move this ticket to, and their current workload.</summary>
    public class ReassignOptionsDto
    {
        public bool CanReassign { get; set; }
        /// <summary>Why not, when CanReassign is false.</summary>
        public string? Reason { get; set; }
        public List<ReassignCandidateDto> Candidates { get; set; } = new();
    }

    public class ReassignCandidateDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        /// <summary>Handles this ticket's category (skills matrix).</summary>
        public bool HandlesCategory { get; set; }
        public int Workload { get; set; }
        public bool IsCurrentAssignee { get; set; }
    }

    public class ReassignRequest
    {
        public Guid ToUserId { get; set; }
        /// <summary>Required (FR-3.7, FR-3.8): 5 to 500 characters.</summary>
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>Anyone signed in can look people up to copy them on a ticket: name, login name and department only.</summary>
    public record PersonSearchResultDto(Guid UserId, string UserName, string? FullName, string? Department);
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IAssignmentService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Automatic assignment and reassignment (BRD M3).
    /// Eligible: active members of the ticket's unit, with an active account, available today (not on leave), mapped to the category.
    /// The HOD is never a member of a unit in their department, so never eligible. Lowest weighted workload wins; ties go to the
    /// least recently assigned. Nobody eligible: the ticket stays New, the unit's head and deputy are told once, and the queue is
    /// tried again every few minutes and whenever availability, skills or membership change.
    /// </summary>
    public interface IAssignmentService
    {
        /// <summary>Assigns a New ticket (or one whose assignee is away and has not started it). Returns true when it now has an assignee.</summary>
        Task<bool> AssignAsync(Guid ticketId, string trigger, CancellationToken cancellationToken = default);

        /// <summary>The queue pass: New tickets, Assigned tickets whose assignee became unavailable (FR-3.11), and in-progress ones to flag. Returns how many were assigned.</summary>
        Task<int> ProcessQueueAsync(CancellationToken cancellationToken = default);

        Task<(TicketProblem? Problem, ReassignOptionsDto? Options)> GetReassignOptionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ReassignAsync(Guid ticketId, ReassignRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, List<TicketAssignmentDto>? History)> GetHistoryAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, List<PersonSearchResultDto>? People)> SearchPeopleAsync(string? query);
    }

    /// <summary>Wakes the assignment queue early (someone came back from leave, got new skills or joined a unit). Never blocks.</summary>
    public interface IAssignmentSignal
    {
        void Poke();
        Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken);
    }
}
'@
$files['ServiceDeskAPI\Controllers\AssignmentController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// Reassignment and the assignment history (BRD FR-3.7 to FR-3.10). Department staff and Super Admin only; who may move a
    /// ticket to whom is decided in the service. Requesters and people copied get 403; anyone else 404.
    /// </summary>
    [ApiController]
    [Route("api/tickets/{ticketId:guid}")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class AssignmentController : ControllerBase
    {
        private readonly IAssignmentService _assignment;

        public AssignmentController(IAssignmentService assignment) => _assignment = assignment;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ObjectResult Fail(TicketProblem problem) =>
            StatusCode(problem.Status, problem.Field == null ? new ApiError(problem.Message) : new ApiError(problem.Message, problem.Field, problem.Message));

        /// <summary>Whether the signed-in person can reassign this ticket, and to whom (with each person's current workload).</summary>
        [HttpGet("reassign-options")]
        [ProducesResponseType(typeof(ReassignOptionsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<ReassignOptionsDto>> Options(Guid ticketId)
        {
            var (problem, options) = await _assignment.GetReassignOptionsAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && options != null ? Ok(options) : Fail(problem!);
        }

        /// <summary>Moves the ticket to another case worker, with a reason. It becomes Assigned (a new acknowledgement window).</summary>
        [HttpPost("reassign")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Reassign(Guid ticketId, [FromBody] ReassignRequest request)
        {
            var (problem, message) = await _assignment.ReassignAsync(ticketId, request, Me(), IsSuperAdmin());
            return problem == null && message != null ? Ok(new MessageDto(message)) : Fail(problem!);
        }

        /// <summary>Every assignment of the ticket, oldest first, with the workloads the engine compared.</summary>
        [HttpGet("assignments")]
        [ProducesResponseType(typeof(List<TicketAssignmentDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<List<TicketAssignmentDto>>> History(Guid ticketId)
        {
            var (problem, history) = await _assignment.GetHistoryAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && history != null ? Ok(history) : Fail(problem!);
        }
    }

    /// <summary>Looking people up to copy them on a ticket (any signed-in person): name, login name and department only.</summary>
    [ApiController]
    [Route("api/people")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class PeopleController : ControllerBase
    {
        private readonly IAssignmentService _assignment;

        public PeopleController(IAssignmentService assignment) => _assignment = assignment;

        /// <summary>Active staff whose name or login name contains the text (at least 2 letters; at most 20 results).</summary>
        [HttpGet("search")]
        [ProducesResponseType(typeof(List<PersonSearchResultDto>), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        public async Task<ActionResult<List<PersonSearchResultDto>>> Search([FromQuery] string? query)
        {
            var (problem, people) = await _assignment.SearchPeopleAsync(query);
            if (problem != null) return StatusCode(problem.Status, new ApiError(problem.Message, problem.Field ?? "query", problem.Message));
            return Ok(people);
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
        /// <summary>When the unit's head was told that nobody could take it (once per wait; cleared on assignment).</summary>
        public DateTime? QueueAlertedAt { get; set; }
        /// <summary>When the unit's head was told the assignee is away while the ticket is in progress (cleared on reassignment).</summary>
        public DateTime? AssigneeAwayFlaggedAt { get; set; }
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
$files['ServiceDeskAPI\Domain\Entities\TicketAssignment.cs'] = @'
namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>How a ticket reached its assignee (BRD FR-3.10).</summary>
    public enum AssignmentMethod
    {
        /// <summary>The engine chose (lowest weighted workload, then least recently assigned).</summary>
        Auto = 1,
        /// <summary>A person moved it (the holder, the Head of Unit, the HOD or a Super Admin), with a reason.</summary>
        Reassigned = 2
    }

    /// <summary>
    /// One assignment of a ticket: who had it, who got it, how, why, and (for Auto) the workload of every eligible case worker
    /// at that moment, so any assignment can be explained later (FR-3.10).
    /// </summary>
    public class TicketAssignment
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid? FromUserId { get; set; }
        public Guid ToUserId { get; set; }
        public AssignmentMethod Method { get; set; }
        /// <summary>Auto: what started it (raised, retry, assignee away). Reassigned: the reason given.</summary>
        public string Reason { get; set; } = string.Empty;
        /// <summary>Who reassigned it; null for the engine.</summary>
        public Guid? ByUserId { get; set; }
        public Guid FromUnitId { get; set; }
        public Guid ToUnitId { get; set; }
        /// <summary>JSON list of { userId, userName, workload, openTickets, lastAssignedAt, chosen } for every eligible case worker.</summary>
        public string? ScoresJson { get; set; }
        public DateTime At { get; set; } = DateTime.UtcNow;
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Assignment\AssignmentService.cs'] = @'
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Assignment
{
    /// <summary>
    /// The assignment engine and reassignment (BRD M3, FR-3.1 to FR-3.11). One assignment at a time per API instance (a gate), so
    /// two tickets raised together are not both counted against the same empty workload.
    /// Who may reassign (FR-3.7, FR-3.8):
    /// - the person holding the ticket, and the unit's head or deputy: to an available member of the same unit who handles the category;
    /// - the HOD of the department and a Super Admin: to any available member of any unit of the department (the ticket moves unit).
    /// A reason is always required. Every assignment is recorded with how, why, by whom and the workloads considered (FR-3.10).
    /// </summary>
    public class AssignmentService : IAssignmentService
    {
        private static readonly SemaphoreSlim Gate = new(1, 1);
        private static readonly TicketStatus[] OpenStatuses = { TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Reopened };
        private static readonly TicketStatus[] MovableStatuses = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Reopened };

        private readonly AppDbContext _db;
        private readonly ICatalogueService _catalogue;
        private readonly IAvailabilityService _availability;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly AssignmentOptions _options;
        private readonly ILogger<AssignmentService> _logger;

        public AssignmentService(AppDbContext db, ICatalogueService catalogue, IAvailabilityService availability, IAuditService audit,
            IInAppNotificationService notifications, IHttpContextAccessor http, IOptions<AssignmentOptions> options, ILogger<AssignmentService> logger)
        {
            _db = db;
            _catalogue = catalogue;
            _availability = availability;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _options = options.Value;
            _logger = logger;
        }

        // ---------------- the engine ----------------

        public async Task<bool> AssignAsync(Guid ticketId, string trigger, CancellationToken cancellationToken = default)
        {
            await Gate.WaitAsync(cancellationToken);
            try { return await AssignCoreAsync(ticketId, trigger); }
            finally { Gate.Release(); }
        }

        public async Task<int> ProcessQueueAsync(CancellationToken cancellationToken = default)
        {
            await Gate.WaitAsync(cancellationToken);
            try
            {
                var assigned = 0;
                var today = _availability.Today();

                // 1. Waiting tickets, oldest first
                var waiting = await _db.Tickets.AsNoTracking()
                    .Where(t => t.Status == TicketStatus.New && t.Unit!.IsActive)
                    .OrderBy(t => t.CreatedAt).Select(t => t.Id).Take(200).ToListAsync(cancellationToken);
                foreach (var id in waiting)
                    if (await AssignCoreAsync(id, "retry")) assigned++;

                // 2. Not started, but the assignee is away, blocked or left the unit (FR-3.11)
                var notStarted = await AwayAssignee(_db.Tickets.AsNoTracking().Where(t => t.Status == TicketStatus.Assigned), today)
                    .OrderBy(t => t.AssignedAt).Select(t => t.Id).Take(200).ToListAsync(cancellationToken);
                foreach (var id in notStarted)
                    if (await AssignCoreAsync(id, "assignee unavailable")) assigned++;

                // 3. Already started and the assignee is away: they keep it, the unit's head is told once (FR-3.11)
                var started = await AwayAssignee(_db.Tickets.Include(t => t.Unit).Include(t => t.AssigneeUser)
                        .Where(t => (t.Status == TicketStatus.InProgress || t.Status == TicketStatus.Reopened) && t.AssigneeAwayFlaggedAt == null), today)
                    .Take(200).ToListAsync(cancellationToken);
                foreach (var ticket in started)
                {
                    TellHeads(ticket.Unit!, null, "Ticket " + ticket.Reference + ": assignee unavailable",
                        Name(ticket.AssigneeUser) + " is unavailable and has this ticket in progress. Reassign it if it cannot wait.",
                        NotificationType.Warning, ticket);
                    ticket.AssigneeAwayFlaggedAt = DateTime.UtcNow;
                }
                if (started.Count > 0) await _db.SaveChangesAsync(cancellationToken);
                _db.ChangeTracker.Clear();
                return assigned;
            }
            finally { Gate.Release(); }
        }

        /// <summary>Tickets whose assignee is blocked, no longer in the ticket's unit, or away today.</summary>
        private IQueryable<Ticket> AwayAssignee(IQueryable<Ticket> query, DateOnly today) =>
            query.Where(t => t.AssigneeUserId != null && (
                !t.AssigneeUser!.IsActive
                || !_db.UnitMembers.Any(m => m.UserId == t.AssigneeUserId && m.UnitId == t.UnitId && m.IsActive)
                || _db.Absences.Any(a => a.UserId == t.AssigneeUserId && !a.IsCancelled && a.StartDate <= today && a.EndDate >= today)));

        private async Task<bool> AssignCoreAsync(Guid ticketId, string trigger)
        {
            try
            {
                var ticket = await _db.Tickets.Include(t => t.Unit).Include(t => t.Category).FirstOrDefaultAsync(t => t.Id == ticketId);
                if (ticket == null) return false;
                var assigneeAway = ticket.Status == TicketStatus.Assigned && ticket.AssigneeUserId.HasValue
                    && !await IsWorkingInUnitAsync(ticket.AssigneeUserId.Value, ticket.UnitId);
                if (ticket.Status != TicketStatus.New && !assigneeAway) return ticket.AssigneeUserId.HasValue;

                var scores = await ScoreAsync(ticket.CategoryId, ticket.UnitId, assigneeAway ? ticket.AssigneeUserId : null);
                var link = "/tickets/" + ticket.Reference;
                if (scores.Count == 0)
                {
                    if (ticket.QueueAlertedAt == null)
                    {
                        TellHeads(ticket.Unit!, null, "Ticket " + ticket.Reference + " is waiting",
                            (assigneeAway ? "Its assignee is unavailable and " : string.Empty) + "no case worker in " + ticket.Unit!.Name
                            + " is available for " + ticket.Category!.Name + ". It will be assigned as soon as someone is; you can also assign it yourself.",
                            NotificationType.ActionRequired, ticket);
                        ticket.QueueAlertedAt = DateTime.UtcNow;
                        await _db.SaveChangesAsync();
                    }
                    return false;
                }

                var chosen = scores.OrderBy(s => s.Workload).ThenBy(s => s.LastAssignedAt ?? DateTime.MinValue).ThenBy(s => s.UserName).First();
                chosen.Chosen = true;
                var previous = ticket.AssigneeUserId;
                var now = DateTime.UtcNow;
                await ApplyAsync(ticket, chosen.UserId, ticket.UnitId, now);
                _db.TicketAssignments.Add(new TicketAssignment
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromUserId = previous, ToUserId = chosen.UserId, Method = AssignmentMethod.Auto,
                    Reason = trigger, FromUnitId = ticket.UnitId, ToUnitId = ticket.UnitId, ScoresJson = JsonSerializer.Serialize(scores), At = now
                });
                Stage(AuditAction.Assigned, ticket, previous, chosen.UserId, trigger, scores.Count);

                var chosenName = chosen.FullName ?? chosen.UserName;
                _notifications.Stage(chosen.UserId, "Ticket " + ticket.Reference + " assigned to you",
                    ticket.Category!.Name + ", priority " + ticket.Priority + ". Please acknowledge it and start work.",
                    NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", ticket.Id, link);
                if (previous == null)
                    _notifications.Stage(ticket.RequesterUserId, "Ticket " + ticket.Reference + " picked up",
                        chosenName + " in " + ticket.Unit!.Name + " is handling your " + ticket.Category.Name + " request.",
                        NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);
                else
                    _notifications.Stage(previous.Value, "Ticket " + ticket.Reference + " moved while you are unavailable",
                        "It went to " + chosenName + ".", NotificationType.Info, NotificationCategory.Assignment, "Ticket", ticket.Id, link);

                await _db.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateConcurrencyException)
            {
                // Someone changed the ticket at the same moment; the next queue pass looks again
                return false;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Assigning ticket {TicketId} failed", ticketId);
                return false;
            }
            finally
            {
                _db.ChangeTracker.Clear();
            }
        }

        /// <summary>Eligible case workers with their weighted workload (FR-3.2 to FR-3.4).</summary>
        private async Task<List<CandidateScoreDto>> ScoreAsync(Guid categoryId, Guid unitId, Guid? exclude)
        {
            var mapped = await _catalogue.EligibleCaseWorkerIdsAsync(categoryId);
            var available = await _availability.AvailableMemberIdsAsync(unitId);
            var ids = mapped.Intersect(available).Where(id => id != exclude).ToList();
            if (ids.Count == 0) return new List<CandidateScoreDto>();

            var people = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive && ids.Contains(m.UserId))
                .Select(m => new CandidateScoreDto { UserId = m.UserId, UserName = m.User!.UserName ?? string.Empty, FullName = m.User.FullName, LastAssignedAt = m.LastAssignedAt })
                .ToListAsync();
            var loads = await WorkloadsAsync(ids);
            foreach (var p in people)
            {
                var (workload, count) = loads.GetValueOrDefault(p.UserId);
                p.Workload = workload;
                p.OpenTickets = count;
            }
            return people;
        }

        /// <summary>Open tickets (Assigned, In progress, Reopened) weighted by priority; Pending is not counted (FR-3.3).</summary>
        private async Task<Dictionary<Guid, (int Workload, int Count)>> WorkloadsAsync(List<Guid> userIds)
        {
            var rows = await _db.Tickets.AsNoTracking()
                .Where(t => t.AssigneeUserId != null && userIds.Contains(t.AssigneeUserId.Value) && OpenStatuses.Contains(t.Status))
                .GroupBy(t => new { t.AssigneeUserId, t.Priority })
                .Select(g => new { g.Key.AssigneeUserId, g.Key.Priority, Count = g.Count() })
                .ToListAsync();
            return rows.GroupBy(r => r.AssigneeUserId!.Value)
                .ToDictionary(g => g.Key, g => (g.Sum(r => r.Count * Weight(r.Priority)), g.Sum(r => r.Count)));
        }

        private int Weight(TicketPriority priority) => priority switch
        {
            TicketPriority.Critical => _options.WeightCritical,
            TicketPriority.High => _options.WeightHigh,
            TicketPriority.Medium => _options.WeightMedium,
            _ => _options.WeightLow
        };

        private async Task<bool> IsWorkingInUnitAsync(Guid userId, Guid unitId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.UnitId == unitId && m.IsActive)
            && await _availability.IsAvailableAsync(userId);

        /// <summary>Puts the ticket with this person in this unit: status Assigned, a new acknowledgement window, flags cleared.</summary>
        private async Task ApplyAsync(Ticket ticket, Guid userId, Guid unitId, DateTime now)
        {
            ticket.AssigneeUserId = userId;
            ticket.UnitId = unitId;
            ticket.Status = TicketStatus.Assigned;
            ticket.AssignedAt = now;
            ticket.QueueAlertedAt = null;
            ticket.AssigneeAwayFlaggedAt = null;
            ticket.UpdatedAt = now;
            var member = await _db.UnitMembers.FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive);
            if (member != null) member.LastAssignedAt = now;
        }

        // ---------------- reassignment ----------------

        private enum Scope { None, Unit, Department }

        private static Scope ScopeOf(Ticket ticket, Guid actorUserId, bool actorIsSuperAdmin)
        {
            if (actorIsSuperAdmin || ticket.Department!.HodUserId == actorUserId) return Scope.Department;
            if ((ticket.Unit!.HeadUserId == actorUserId || ticket.Unit.DeputyHeadUserId == actorUserId) && ticket.Unit.IsActive) return Scope.Unit;
            if (ticket.AssigneeUserId == actorUserId) return Scope.Unit;
            return Scope.None;
        }

        private async Task<(TicketProblem? Problem, Ticket? Ticket, Scope Scope)> LoadForStaffAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.Include(t => t.Unit).Include(t => t.Department).Include(t => t.Category).Include(t => t.AssigneeUser)
                .FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null, Scope.None);
            var isStaff = actorIsSuperAdmin || await IsDepartmentStaffAsync(actorUserId, ticket.DepartmentId);
            if (!isStaff)
            {
                var canView = ticket.RequesterUserId == actorUserId || ticket.RaisedByUserId == actorUserId
                    || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticketId && w.UserId == actorUserId);
                return (canView ? new TicketProblem(403, "Only staff of " + ticket.Department!.Name + " can see or change who handles a ticket.")
                                : new TicketProblem(404, "Ticket not found."), null, Scope.None);
            }
            return (null, ticket, ScopeOf(ticket, actorUserId, actorIsSuperAdmin));
        }

        private async Task<List<ReassignCandidateDto>> CandidatesAsync(Ticket ticket, Scope scope)
        {
            var units = scope == Scope.Department
                ? await _db.Units.AsNoTracking().Where(u => u.DepartmentId == ticket.DepartmentId && u.IsActive).Select(u => new { u.Id, u.Name }).ToListAsync()
                : new[] { new { Id = ticket.UnitId, Name = ticket.Unit!.Name } }.ToList();
            var mapped = (await _catalogue.EligibleCaseWorkerIdsAsync(ticket.CategoryId)).ToHashSet();
            var result = new List<ReassignCandidateDto>();
            foreach (var unit in units)
            {
                var available = await _availability.AvailableMemberIdsAsync(unit.Id);
                if (scope == Scope.Unit) available = available.Where(mapped.Contains).ToList();
                if (available.Count == 0) continue;
                var people = await _db.Users.AsNoTracking().Where(u => available.Contains(u.Id))
                    .Select(u => new { u.Id, u.UserName, u.FullName }).ToListAsync();
                result.AddRange(people.Select(p => new ReassignCandidateDto
                {
                    UserId = p.Id, UserName = p.UserName ?? string.Empty, FullName = p.FullName, UnitId = unit.Id, UnitName = unit.Name,
                    HandlesCategory = mapped.Contains(p.Id) && unit.Id == ticket.Category!.UnitId, IsCurrentAssignee = p.Id == ticket.AssigneeUserId
                }));
            }
            var loads = await WorkloadsAsync(result.Select(r => r.UserId).ToList());
            foreach (var r in result) r.Workload = loads.GetValueOrDefault(r.UserId).Workload;
            return result.OrderByDescending(r => r.UnitId == ticket.UnitId).ThenByDescending(r => r.HandlesCategory).ThenBy(r => r.Workload)
                .ThenBy(r => r.FullName ?? r.UserName).ToList();
        }

        public async Task<(TicketProblem? Problem, ReassignOptionsDto? Options)> GetReassignOptionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, scope) = await LoadForStaffAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!MovableStatuses.Contains(ticket!.Status))
                return (null, new ReassignOptionsDto { CanReassign = false, Reason = "A " + StatusText(ticket.Status) + " ticket cannot be reassigned." });
            if (scope == Scope.None)
                return (null, new ReassignOptionsDto { CanReassign = false, Reason = "Only the person handling it, the head of " + ticket.Unit!.Name + ", the Head of Department or a Super Admin can reassign it." });
            return (null, new ReassignOptionsDto { CanReassign = true, Candidates = await CandidatesAsync(ticket, scope) });
        }

        public async Task<(TicketProblem? Problem, string? Message)> ReassignAsync(Guid ticketId, ReassignRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 5 || reason.Length > 500) return (new TicketProblem(400, "Give a reason (5 to 500 characters).", "reason"), null);
            if (request.ToUserId == Guid.Empty) return (new TicketProblem(400, "Choose who should handle it.", "toUserId"), null);

            await Gate.WaitAsync();
            try
            {
                var (problem, ticket, scope) = await LoadForStaffAsync(ticketId, actorUserId, actorIsSuperAdmin);
                if (problem != null) return (problem, null);
                if (scope == Scope.None)
                    return (new TicketProblem(403, "Only the person handling it, the head of " + ticket!.Unit!.Name + ", the Head of Department or a Super Admin can reassign it."), null);
                if (!MovableStatuses.Contains(ticket!.Status))
                    return (new TicketProblem(400, "A " + StatusText(ticket.Status) + " ticket cannot be reassigned."), null);
                if (ticket.AssigneeUserId == request.ToUserId)
                    return (new TicketProblem(400, "They already have this ticket.", "toUserId"), null);

                var target = (await CandidatesAsync(ticket, scope)).FirstOrDefault(c => c.UserId == request.ToUserId);
                if (target == null)
                    return (new TicketProblem(400, scope == Scope.Unit
                        ? "Choose an available member of " + ticket.Unit!.Name + " who handles " + ticket.Category!.Name + "."
                        : "Choose an available member of a unit of " + ticket.Department!.Name + ".", "toUserId"), null);

                var previous = ticket.AssigneeUserId;
                var fromUnitId = ticket.UnitId;
                var now = DateTime.UtcNow;
                await ApplyAsync(ticket, target.UserId, target.UnitId, now);
                _db.TicketAssignments.Add(new TicketAssignment
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromUserId = previous, ToUserId = target.UserId, Method = AssignmentMethod.Reassigned,
                    Reason = reason, ByUserId = actorUserId, FromUnitId = fromUnitId, ToUnitId = target.UnitId, At = now
                });
                Stage(AuditAction.Reassigned, ticket, previous, target.UserId, reason, null);

                var actorName = await NameOfAsync(actorUserId);
                var targetName = target.FullName ?? target.UserName;
                var link = "/tickets/" + ticket.Reference;
                var shortReason = EmailSafety.Redact(reason.Length > 200 ? reason.Substring(0, 200) + "..." : reason);
                if (target.UserId != actorUserId)
                    _notifications.Stage(target.UserId, "Ticket " + ticket.Reference + " assigned to you",
                        actorName + " passed it to you: " + shortReason, NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", ticket.Id, link);
                if (previous.HasValue && previous != actorUserId)
                    _notifications.Stage(previous.Value, "Ticket " + ticket.Reference + " reassigned",
                        actorName + " moved it to " + targetName + ".", NotificationType.Info, NotificationCategory.Assignment, "Ticket", ticket.Id, link);
                if (target.UnitId != fromUnitId)
                {
                    var newUnit = await _db.Units.AsNoTracking().FirstAsync(u => u.Id == target.UnitId);
                    TellHeads(newUnit, actorUserId, "Ticket " + ticket.Reference + " moved to " + newUnit.Name,
                        actorName + " moved it from " + ticket.Unit!.Name + " to " + targetName + ".", NotificationType.Info, ticket);
                }

                try { await _db.SaveChangesAsync(); }
                catch (DbUpdateConcurrencyException)
                {
                    return (new TicketProblem(409, "The ticket changed at the same moment. Reload it and try again."), null);
                }
                return (null, "Ticket " + ticket.Reference + " is now with " + targetName + ".");
            }
            finally
            {
                _db.ChangeTracker.Clear();
                Gate.Release();
            }
        }

        public async Task<(TicketProblem? Problem, List<TicketAssignmentDto>? History)> GetHistoryAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, _, _) = await LoadForStaffAsync(ticketId, actorUserId, actorIsSuperAdmin);
            _db.ChangeTracker.Clear();
            if (problem != null) return (problem, null);

            var rows = await _db.TicketAssignments.AsNoTracking().Where(a => a.TicketId == ticketId).OrderBy(a => a.At).ToListAsync();
            var people = await PeopleAsync(rows.SelectMany(r => new[] { r.FromUserId, r.ByUserId, (Guid?)r.ToUserId }).Where(x => x.HasValue).Select(x => x!.Value));
            var unitIds = rows.SelectMany(r => new[] { r.FromUnitId, r.ToUnitId }).Distinct().ToList();
            var units = await _db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Name);
            return (null, rows.Select(r => new TicketAssignmentDto
            {
                Id = r.Id, At = r.At, Method = r.Method, Reason = r.Reason,
                From = r.FromUserId.HasValue ? people[r.FromUserId.Value] : null,
                To = people[r.ToUserId],
                By = r.ByUserId.HasValue ? people[r.ByUserId.Value] : null,
                FromUnitName = units.GetValueOrDefault(r.FromUnitId) ?? string.Empty,
                ToUnitName = units.GetValueOrDefault(r.ToUnitId) ?? string.Empty,
                Scores = string.IsNullOrEmpty(r.ScoresJson) ? new List<CandidateScoreDto>() : JsonSerializer.Deserialize<List<CandidateScoreDto>>(r.ScoresJson) ?? new List<CandidateScoreDto>()
            }).ToList());
        }

        // ---------------- people search (for copying colleagues) ----------------

        public async Task<(TicketProblem? Problem, List<PersonSearchResultDto>? People)> SearchPeopleAsync(string? query)
        {
            var term = (query ?? string.Empty).Trim();
            if (term.Length < 2) return (new TicketProblem(400, "Type at least 2 letters.", "query"), null);
            if (term.Length > 100) term = term.Substring(0, 100);
            var people = await _db.Users.AsNoTracking()
                .Where(u => u.IsActive && ((u.UserName != null && u.UserName.Contains(term)) || (u.FullName != null && u.FullName.Contains(term))))
                .OrderBy(u => u.FullName ?? u.UserName)
                .Take(20)
                .Select(u => new PersonSearchResultDto(u.Id, u.UserName ?? string.Empty, u.FullName, u.Department))
                .ToListAsync();
            return (null, people);
        }

        // ---------------- helpers ----------------

        private void TellHeads(Unit unit, Guid? except, string title, string message, NotificationType type, Ticket ticket)
        {
            foreach (var head in new[] { unit.HeadUserId, unit.DeputyHeadUserId }.Where(h => h.HasValue && h != except).Distinct())
                _notifications.Stage(head!.Value, title, message, type, NotificationCategory.Assignment, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private async Task<bool> IsDepartmentStaffAsync(Guid userId, Guid departmentId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == departmentId)
            || await _db.Departments.AnyAsync(d => d.Id == departmentId && d.HodUserId == userId);

        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private async Task<Dictionary<Guid, PersonDto>> PeopleAsync(IEnumerable<Guid> ids)
        {
            var list = ids.Distinct().ToList();
            var found = await _db.Users.AsNoTracking().Where(u => list.Contains(u.Id))
                .Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).ToListAsync();
            var map = found.ToDictionary(p => p.UserId);
            foreach (var id in list.Where(id => !map.ContainsKey(id))) map[id] = new PersonDto(id, string.Empty, null);
            return map;
        }

        private void Stage(AuditAction action, Ticket ticket, Guid? from, Guid to, string reason, int? candidates)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName ?? "System", action, "Ticket", ticket.Id, ticket.Reference,
                from.HasValue ? JsonSerializer.Serialize(new { assignee = from }) : null,
                JsonSerializer.Serialize(new { assignee = to, unitId = ticket.UnitId, reason = EmailSafety.Redact(reason), candidates }),
                actor.IpAddress, actor.UserAgent, AuditModule.Assignment);
        }

        private static string StatusText(TicketStatus status) => status switch
        {
            TicketStatus.InProgress => "in-progress",
            _ => status.ToString().ToLowerInvariant()
        };

        private static string Name(User? user) => user == null ? "The assignee" : string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "The assignee" : user.FullName;
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Assignment\AssignmentWorker.cs'] = @'
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Assignment
{
    /// <summary>Settings under "Assignment" (BRD FR-7.4). Defaults follow the BRD.</summary>
    public class AssignmentOptions
    {
        /// <summary>How often the queue is tried again (FR-3.6: 5 minutes).</summary>
        public int RetryMinutes { get; set; } = 5;
        public int WeightCritical { get; set; } = 3;
        public int WeightHigh { get; set; } = 2;
        public int WeightMedium { get; set; } = 1;
        public int WeightLow { get; set; } = 1;
        /// <summary>Turns the background retry off (the engine still runs when a ticket is raised).</summary>
        public bool WorkerEnabled { get; set; } = true;
    }

    /// <summary>A single-slot wake-up: many pokes while the queue is running collapse into one more pass.</summary>
    public sealed class AssignmentSignal : IAssignmentSignal
    {
        private readonly SemaphoreSlim _poked = new(0, 1);

        public void Poke()
        {
            try { _poked.Release(); }
            catch (SemaphoreFullException) { /* already poked */ }
        }

        public Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken) => _poked.WaitAsync(timeout, cancellationToken);
    }

    /// <summary>Runs the assignment queue every RetryMinutes, and soon after a poke.</summary>
    public sealed class AssignmentWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopes;
        private readonly IAssignmentSignal _signal;
        private readonly AssignmentOptions _options;
        private readonly ILogger<AssignmentWorker> _logger;

        public AssignmentWorker(IServiceScopeFactory scopes, IAssignmentSignal signal, Microsoft.Extensions.Options.IOptions<AssignmentOptions> options, ILogger<AssignmentWorker> logger)
        {
            _scopes = scopes;
            _signal = signal;
            _options = options.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.WorkerEnabled) return;
            var interval = TimeSpan.FromMinutes(Math.Clamp(_options.RetryMinutes, 1, 60));
            // Give the app a moment to finish starting (migrations, seeding)
            try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); } catch (OperationCanceledException) { return; }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    using var scope = _scopes.CreateScope();
                    var assigned = await scope.ServiceProvider.GetRequiredService<IAssignmentService>().ProcessQueueAsync(stoppingToken);
                    if (assigned > 0) _logger.LogInformation("Assignment queue: {Count} ticket(s) assigned", assigned);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Assignment queue pass failed; trying again later");
                }

                try { await _signal.WaitAsync(interval, stoppingToken); }
                catch (OperationCanceledException) { return; }
            }
        }
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
        private readonly IAssignmentSignal _assignment;

        public CatalogueService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, ILogger<CatalogueService> logger,
            IAssignmentSignal assignment)
        {
            _assignment = assignment;
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
            // New skills may make waiting tickets assignable (Step 5)
            _assignment.Poke();

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
        private readonly IAssignmentSignal _assignment;

        public AvailabilityService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, TimeProvider time,
            IAssignmentSignal assignment)
        {
            _assignment = assignment;
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
            // Someone went away or came back: the assignment queue looks again (Step 5)
            _assignment.Poke();
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
            // Someone went away or came back: the assignment queue looks again (Step 5)
            _assignment.Poke();
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
                notifications.Stage(userId, "Your Access Desk access changed", string.Join(" ", parts),
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
        private readonly IAssignmentSignal _assignment;

        public OrganisationService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, ILogger<OrganisationService> logger,
            IAssignmentSignal assignment)
        {
            _assignment = assignment;
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
                // A structure change (someone joined, left, was blocked) can change who is eligible (Step 5)
                _assignment.Poke();
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
        public DbSet<TicketAssignment> TicketAssignments => Set<TicketAssignment>();

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

            builder.Entity<TicketAssignment>(e =>
            {
                e.ToTable("TicketAssignments");
                e.HasKey(a => a.Id);
                e.Property(a => a.Reason).HasMaxLength(500).IsRequired();
                e.Property(a => a.ScoresJson).HasColumnType("nvarchar(max)");
                e.HasOne(a => a.Ticket).WithMany().HasForeignKey(a => a.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne<User>().WithMany().HasForeignKey(a => a.ToUserId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(a => new { a.TicketId, a.At });
                e.HasIndex(a => a.ToUserId);
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
    /// Raising, reading and commenting (BRD M2, M4). Tickets are created as New in the unit that owns the category and handed to the
    /// assignment engine straight after they are saved (Step 5); if nobody can take it, the engine tells the unit's head.
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
        private readonly IAssignmentService _assignment;

        public TicketService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http,
            TimeProvider time, ILogger<TicketService> logger, IAssignmentService assignment)
        {
            _assignment = assignment;
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

            // Assign straight away (FR-3.1). If it fails or nobody is free, the ticket stays New and the queue tries again.
            var reference = ticket.Reference;
            _db.ChangeTracker.Clear();
            var assigned = await _assignment.AssignAsync(ticket.Id, "raised");
            return (null, new CreatedTicketDto(ticket.Id, reference, "Ticket " + reference + " raised."
                + (assigned ? string.Empty : " It is waiting for an available case worker.")));
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
$files['tests\ServiceDeskAPI.Tests\Assignment\AssignmentTests.cs'] = @'
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
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Assignment
{
    /// <summary>Step 5: the assignment engine, the waiting queue, leave, reassignment and its history (BRD M3).</summary>
    public class AssignmentTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public AssignmentTests(ServiceDeskApiFactory factory) => _factory = factory;

        /// <summary>A department of its own per test, so tests do not share workloads.</summary>
        private sealed record Lab(Guid DepartmentId, Guid UnitId, Guid HeadId, string HeadName, List<(Guid Id, string Name)> Members, Guid CategoryId);

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private async Task<(Guid Id, string Name)> NewUserAsync()
        {
            using var scope = _factory.Services.CreateScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var name = "test.as" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var user = new User { Id = Guid.NewGuid(), UserName = name, FullName = "Person " + name, IsActive = true, EmailConfirmed = true };
            var created = await users.CreateAsync(user, ServiceDeskApiFactory.TestPassword);
            Assert.True(created.Succeeded, string.Join("; ", created.Errors.Select(e => e.Description)));
            await RoleAssignments.EnsureDefaultRoleAsync(db, user.Id);
            return (user.Id, name);
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        private async Task<Lab> NewLabAsync(int members, bool mapSkills = true)
        {
            var admin = await As("test.superadmin");
            var tag = Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant();
            var department = await Ok<DepartmentDto>(await admin.PostAsJsonAsync("/api/admin/departments", new { code = "L" + tag, name = "Lab " + tag }));
            var unit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{department.Id}/units", new { code = "U1", name = "Lab Unit " + tag }));
            var head = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/head", new { userId = head.Id }));
            var people = new List<(Guid Id, string Name)>();
            for (var i = 0; i < members; i++)
            {
                var person = await NewUserAsync();
                await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{unit.Id}/members", new { userId = person.Id }));
                people.Add(person);
            }
            var category = await Ok<CategoryAdminDto>(await admin.PostAsJsonAsync("/api/admin/categories",
                new { unitId = unit.Id, name = "Lab category " + tag, timelineHours = 24, defaultPriority = 2 }));
            if (mapSkills)
                foreach (var person in people)
                    await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{unit.Id}/skills/{person.Id}", new { categoryIds = new[] { category.Id } }));
            return new Lab(department.Id, unit.Id, head.Id, head.Name, people, category.Id);
        }

        private async Task<CreatedTicketDto> RaiseAsync(Guid categoryId, int priority = 2)
        {
            var form = new MultipartFormDataContent
            {
                { new StringContent(categoryId.ToString()), "categoryId" },
                { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
                { new StringContent(priority.ToString()), "priority" },
                { new StringContent("Assignment test"), "subject" },
                { new StringContent("<p>Please help.</p>"), "descriptionHtml" }
            };
            return await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", form));
        }

        private async Task<Ticket> TicketAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        private async Task ProcessQueueAsync()
        {
            using var scope = _factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<IAssignmentService>().ProcessQueueAsync();
        }

        private async Task<bool> NotifiedAsync(Guid userId, Guid ticketId, string titleStart)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().InAppNotifications
                .AnyAsync(n => n.RecipientUserId == userId && n.RelatedEntityId == ticketId && n.Title.StartsWith(titleStart));
        }

        private DateOnly Today()
        {
            using var scope = _factory.Services.CreateScope();
            return scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
        }

        [Fact]
        public async Task The_lowest_weighted_workload_wins_and_ties_go_to_the_least_recently_assigned()
        {
            var lab = await NewLabAsync(2);

            var first = await RaiseAsync(lab.CategoryId, priority: 4); // Critical = 3
            var x = (await TicketAsync(first.Id)).AssigneeUserId!.Value;
            var y = lab.Members.Select(m => m.Id).Single(id => id != x);

            var order = new List<Guid>();
            for (var i = 0; i < 4; i++) order.Add((await TicketAsync((await RaiseAsync(lab.CategoryId)).Id)).AssigneeUserId!.Value);

            // y: 0 -> 1 -> 2 -> 3 while x stays at 3; at 3 each, x was assigned longer ago
            Assert.Equal(new[] { y, y, y, x }, order);

            var firstTicket = await TicketAsync(first.Id);
            Assert.Equal(TicketStatus.Assigned, firstTicket.Status);
            Assert.NotNull(firstTicket.AssignedAt);
            var history = await Ok<List<TicketAssignmentDto>>(await (await As(lab.HeadName)).GetAsync($"/api/tickets/{first.Id}/assignments"));
            var auto = Assert.Single(history);
            Assert.Equal(AssignmentMethod.Auto, auto.Method);
            Assert.Equal("raised", auto.Reason);
            Assert.Equal(2, auto.Scores.Count);
            Assert.Equal(x, auto.Scores.Single(s => s.Chosen).UserId);
            Assert.True(await NotifiedAsync(x, first.Id, "Ticket " + first.Reference + " assigned to you"));
            Assert.True(await NotifiedAsync((await TicketAsync(first.Id)).RequesterUserId, first.Id, "Ticket " + first.Reference + " picked up"));
        }

        [Fact]
        public async Task With_nobody_eligible_the_ticket_waits_the_head_is_told_and_it_is_assigned_once_someone_can_take_it()
        {
            var lab = await NewLabAsync(1, mapSkills: false);

            var raised = await RaiseAsync(lab.CategoryId);
            Assert.Contains("waiting", raised.Message);
            var waiting = await TicketAsync(raised.Id);
            Assert.Equal(TicketStatus.New, waiting.Status);
            Assert.Null(waiting.AssigneeUserId);
            Assert.True(await NotifiedAsync(lab.HeadId, raised.Id, "Ticket " + raised.Reference + " is waiting"));

            var admin = await As("test.superadmin");
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/units/{lab.UnitId}/skills/{lab.Members[0].Id}", new { categoryIds = new[] { lab.CategoryId } }));
            await ProcessQueueAsync();

            var assigned = await TicketAsync(raised.Id);
            Assert.Equal(TicketStatus.Assigned, assigned.Status);
            Assert.Equal(lab.Members[0].Id, assigned.AssigneeUserId);
            Assert.Null(assigned.QueueAlertedAt);
        }

        [Fact]
        public async Task Leave_moves_tickets_not_started_and_flags_started_ones_to_the_head()
        {
            var lab = await NewLabAsync(2);
            var head = await As(lab.HeadName);
            var today = Today();

            var notStarted = await RaiseAsync(lab.CategoryId);
            var away = (await TicketAsync(notStarted.Id)).AssigneeUserId!.Value;
            var other = lab.Members.Select(m => m.Id).Single(id => id != away);
            await Ok<AbsenceDto>(await head.PostAsJsonAsync("/api/availability/absences", new { userId = away, kind = 1, startDate = today, endDate = today.AddDays(2) }));
            await ProcessQueueAsync();

            var moved = await TicketAsync(notStarted.Id);
            Assert.Equal(other, moved.AssigneeUserId);
            Assert.Equal(TicketStatus.Assigned, moved.Status);
            Assert.True(await NotifiedAsync(away, notStarted.Id, "Ticket " + notStarted.Reference + " moved while you are unavailable"));

            // A ticket already in progress stays with its assignee when they go away; the head is told once
            var started = await RaiseAsync(lab.CategoryId);
            Assert.Equal(other, (await TicketAsync(started.Id)).AssigneeUserId);
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var row = await db.Tickets.SingleAsync(t => t.Id == started.Id);
                row.Status = TicketStatus.InProgress;
                await db.SaveChangesAsync();
            }
            await Ok<AbsenceDto>(await head.PostAsJsonAsync("/api/availability/absences", new { userId = other, kind = 2, startDate = today, endDate = today }));
            await ProcessQueueAsync();

            var flagged = await TicketAsync(started.Id);
            Assert.Equal(other, flagged.AssigneeUserId);
            Assert.Equal(TicketStatus.InProgress, flagged.Status);
            Assert.NotNull(flagged.AssigneeAwayFlaggedAt);
            Assert.True(await NotifiedAsync(lab.HeadId, started.Id, "Ticket " + started.Reference + ": assignee unavailable"));
        }

        [Fact]
        public async Task Reassignment_follows_who_is_asking_and_always_needs_a_reason()
        {
            var lab = await NewLabAsync(2);
            var admin = await As("test.superadmin");
            var otherUnit = await Ok<UnitDto>(await admin.PostAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/units", new { code = "U2", name = "Lab Unit Two " + Guid.NewGuid().ToString("N").Substring(0, 4) }));
            var stranger = await NewUserAsync();
            await Ok<MessageDto>(await admin.PostAsJsonAsync($"/api/admin/units/{otherUnit.Id}/members", new { userId = stranger.Id }));

            var raised = await RaiseAsync(lab.CategoryId);
            var holderId = (await TicketAsync(raised.Id)).AssigneeUserId!.Value;
            var holder = await As(lab.Members.Single(m => m.Id == holderId).Name);
            var colleague = lab.Members.Single(m => m.Id != holderId);
            var url = $"/api/tickets/{raised.Id}/reassign";

            // Requesters and outsiders cannot
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.requester")).PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "Please move it" })).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await (await As((await NewUserAsync()).Name)).PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "Please move it" })).StatusCode);

            // The holder: only within the unit, to someone who handles the category, with a reason
            var options = await Ok<ReassignOptionsDto>(await holder.GetAsync($"/api/tickets/{raised.Id}/reassign-options"));
            Assert.True(options.CanReassign);
            Assert.Contains(options.Candidates, c => c.UserId == colleague.Id && c.HandlesCategory);
            Assert.DoesNotContain(options.Candidates, c => c.UserId == stranger.Id);
            var noReason = await holder.PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "" });
            Assert.Equal(HttpStatusCode.BadRequest, noReason.StatusCode);
            Assert.True((await noReason.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("reason", out _));
            Assert.Equal(HttpStatusCode.BadRequest, (await holder.PostAsJsonAsync(url, new { toUserId = stranger.Id, reason = "Other unit please" })).StatusCode);
            await Ok<MessageDto>(await holder.PostAsJsonAsync(url, new { toUserId = colleague.Id, reason = "I am out tomorrow" }));
            Assert.Equal(colleague.Id, (await TicketAsync(raised.Id)).AssigneeUserId);
            Assert.True(await NotifiedAsync(colleague.Id, raised.Id, "Ticket " + raised.Reference + " assigned to you"));

            // The HOD: any unit of the department; the ticket moves unit
            var hod = await NewUserAsync();
            await Ok<MessageDto>(await admin.PutAsJsonAsync($"/api/admin/departments/{lab.DepartmentId}/hod", new { userId = hod.Id }));
            await Ok<MessageDto>(await (await As(hod.Name)).PostAsJsonAsync(url, new { toUserId = stranger.Id, reason = "Miscategorised; belongs to unit two" }));
            var movedTicket = await TicketAsync(raised.Id);
            Assert.Equal(stranger.Id, movedTicket.AssigneeUserId);
            Assert.Equal(otherUnit.Id, movedTicket.UnitId);
            Assert.Equal(TicketStatus.Assigned, movedTicket.Status);

            var history = await Ok<List<TicketAssignmentDto>>(await admin.GetAsync($"/api/tickets/{raised.Id}/assignments"));
            Assert.Equal(new[] { AssignmentMethod.Auto, AssignmentMethod.Reassigned, AssignmentMethod.Reassigned }, history.Select(h => h.Method));
            Assert.Equal("I am out tomorrow", history[1].Reason);
            Assert.Equal(holderId, history[1].By!.UserId);
            Assert.Equal(otherUnit.Name, history[2].ToUnitName);
            Assert.Equal(HttpStatusCode.Forbidden, (await (await As("test.requester")).GetAsync($"/api/tickets/{raised.Id}/assignments")).StatusCode);
        }

        [Fact]
        public async Task Anyone_can_look_up_colleagues_to_copy_by_name_only()
        {
            var requester = await As("test.requester");

            var found = await Ok<List<JsonElement>>(await requester.GetAsync("/api/people/search?query=caseworker"));
            var tooShort = await requester.GetAsync("/api/people/search?query=a");

            Assert.Contains(found, p => p.GetProperty("userName").GetString() == "test.caseworker1");
            Assert.All(found, p => Assert.False(p.TryGetProperty("email", out _)));
            Assert.Equal(HttpStatusCode.BadRequest, tooShort.StatusCode);
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
            // Step 5: assigned straight away to one of the three Contribution Matching case workers
            Assert.Equal(TicketStatus.Assigned, ticket!.Status);
            Assert.NotNull(ticket.Assignee);
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
            Assert.Contains(told, n => n.RecipientUserId == ticket.Assignee!.UserId && n.Title == "Ticket " + created.Reference + " assigned to you");
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

            // The requester's reply reached the assignee; the internal note did not reach the requester
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var assignee = staffView.Assignee!.UserId;
            Assert.True(assignee == await IdOf("test.caseworker1")
                || await db.InAppNotifications.AnyAsync(n => n.RelatedEntityId == created.Id && n.RecipientUserId == assignee && n.Title == "New comment on " + created.Reference));
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
            var refundQueue = await (await As("test.caseworker2")).GetFromJsonAsync<TicketPageDto>($"/api/tickets?view=department&departmentId={OrgSeed.ContributionProcessingId}&unitId={OrgSeed.RefundUnitId}&status=2");
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

    Write-Host '3/4 Creating the Assignment migration (assignment history)...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'Assignment', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_Assignment.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

    Write-Host '4/4 Building and running all tests (LocalDB; takes a minute)...'
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
    Write-Host 'Done. Step 5 is in place.' -ForegroundColor Green
    Write-Host 'Start the API once: it adds the TicketAssignments table and starts the assignment queue (every 5 minutes).'
    Write-Host 'Tickets that were New before this step are assigned on the first queue pass, about 10 seconds after start.'
    Write-Host 'In Swagger as test.requester: raise a ticket; it comes back Assigned. As test.hou: GET /api/tickets/{id}/assignments.'
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
