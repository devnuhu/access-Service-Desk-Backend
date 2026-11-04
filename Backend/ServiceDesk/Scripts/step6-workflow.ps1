# Step 6 - The ticket workflow (BRD Section 8, FR-4.2 to FR-4.6), plus the FE-3/FE-4 backend answers.
#
# What it adds:
#   - Acknowledge (Assigned or Reopened -> In progress), Pending with a reason (requester / third party), Resume, Resolve with a
#     resolution code and note, Confirm (-> Closed), Reopen with a reason (back to the same case worker, or through the engine if
#     they are unavailable), Cancel (requester before work starts; Super Admin any open ticket). GET api/tickets/{id}/actions.
#   - A requester's public reply resumes a ticket waiting on them. Notes and reasons are posted as public comments.
#   - Every status change is recorded (TicketStatusChanges) for the SLA clock in Step 7.
#   - Lists: open=true, and departmentId / unitId narrow every view; tickets carry assignedAt and the workflow fields.
#   - Ticket and comment forms report every wrong field at once; GET api/catalogue/mine; the people search leaves you out.
#   - The last "Sign out and back in" text is gone from role notifications.
#   - Migration Workflow, and tests
#
# Run from ...\AccessServiceDesk\Backend\ServiceDesk with the API stopped:
#   .\Scripts\step6-workflow.ps1
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
if (-not (Test-Path (Join-Path $api 'Domain\Entities\TicketAssignment.cs'))) { Write-Host 'Step 5 is not in place. Run step5-assignment.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Domain\Entities\TicketWorkflow.cs')) { Write-Host 'TicketWorkflow.cs already exists: Step 6 looks applied. Nothing changed.' -ForegroundColor Yellow; return }
if (-not (Get-ChildItem $migrationsDir -Filter '*_InitialIdentity.cs' -ErrorAction SilentlyContinue)) { Write-Host 'The InitialIdentity migration is missing. Send me the list of files in Infrastructure\Persistence\Migrations.' -ForegroundColor Red; return }
if (-not (Test-Path (Join-Path $root '.config\dotnet-tools.json')) -and -not (Test-Path (Join-Path $root 'dotnet-tools.json'))) { Write-Host 'The dotnet-ef tool manifest is missing. Send me the folder listing of the solution root.' -ForegroundColor Red; return }

# The files this step replaces must be exactly as the earlier step scripts wrote them, so no change of yours is lost.
$expected = [ordered]@{
    'ServiceDeskAPI\Program.cs' = '34781b4631b482ce22cdad150dff9cceaef9668f9cdf0de78e0d5de6842f4e93'
    'ServiceDeskAPI\Application\DTOs\TicketDTOs.cs' = '6a19568b088dc6832424e84eaa752c3b7bcbd293cfa16f78d698d3d32b9ed0ca'
    'ServiceDeskAPI\Application\Interfaces\IAssignmentService.cs' = '33fdb6a6e9c0a0f805560b7e5038c782e46ce18b695c9d4d0a7b84edf3e30585'
    'ServiceDeskAPI\Application\Interfaces\ICatalogueService.cs' = '8c8b76bee0209c6e00409228576dfb37d9e9074ec0eb9621704b9dee7fec567d'
    'ServiceDeskAPI\Application\Interfaces\ITicketService.cs' = 'aa8361bd3cbbdb5fdac0cc61f0a499d91bd7d129315b001be83242d6a18a76fb'
    'ServiceDeskAPI\Controllers\AssignmentController.cs' = '26abd6d6704b5030a9aa37bd514dedcb136ce437d61d24ca966547a9f14120d4'
    'ServiceDeskAPI\Controllers\CatalogueController.cs' = '29ad7d8684c5ba96c8e5c9156c20ca698829d3b0e1c3f6de85c170ca68a5dc2b'
    'ServiceDeskAPI\Controllers\TicketsController.cs' = 'd26f9a2e9e5da9e006bae0959a55d8ac125d4e3cdcc140504166213faa80c936'
    'ServiceDeskAPI\Domain\Entities\Ticket.cs' = '46ccd73ea2dfdc2d31454940b3caac76b98aca96d98427fe9349956a29d8757c'
    'ServiceDeskAPI\Infrastructure\Assignment\AssignmentService.cs' = '18df77428376158c5a344847427d0e34a33a370b14292cc6ef207b8c874cf265'
    'ServiceDeskAPI\Infrastructure\Catalogue\CatalogueService.cs' = '4f76286be69a3082140592cfe5b4cafa72e56a8ac0b70f22eb5b8c7fba4b9f1d'
    'ServiceDeskAPI\Infrastructure\Persistence\AppDbContext.cs' = 'bf9ef84ebccc0e387711cf409384a4cc9a611bbdd4ed709d9e30db62f586c32a'
    'ServiceDeskAPI\Infrastructure\Services\AdminUserService.cs' = 'eded50a9cbe752da4e8d52c837549d2843469653ea6cbd4d8950dfd30e9db389'
    'ServiceDeskAPI\Infrastructure\Tickets\TicketService.cs' = '1974f092df6ee71770b483138484ef5e6f385fa54e4b49cee5c693238bfa9b51'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed since they were last written by a step script, so Step 6 stopped to avoid overwriting your changes:' -ForegroundColor Red
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
            builder.Services.AddScoped<IWorkflowService, ServiceDeskAPI.Infrastructure.Tickets.WorkflowService>();
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
$files['ServiceDeskAPI\Application\DTOs\TicketDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Entities;
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
        /// <summary>When the current assignee got it (Step 6).</summary>
        public DateTime? AssignedAt { get; set; }
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

        // ---- workflow (Step 6); what the signed-in person may do: GET /api/tickets/{id}/actions ----
        public DateTime? AcknowledgedAt { get; set; }
        /// <summary>1 waiting on the requester, 2 waiting on a third party.</summary>
        public PendingReason? PendingReason { get; set; }
        public DateTime? PendingSince { get; set; }
        public DateTime? ResolvedAt { get; set; }
        /// <summary>1 Completed, 2 Information provided, 3 Referred elsewhere, 4 Duplicate, 5 No action required.</summary>
        public ResolutionCode? ResolutionCode { get; set; }
        public string? ResolutionNote { get; set; }
        public DateTime? ClosedAt { get; set; }
        public DateTime? CancelledAt { get; set; }
        public int ReopenCount { get; set; }
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
$files['ServiceDeskAPI\Application\DTOs\WorkflowDTOs.cs'] = @'
using ServiceDeskAPI.Domain.Entities;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>What the signed-in person may do with the ticket now (BRD Section 8). The server checks again on every action.</summary>
    public class TicketActionsDto
    {
        public bool CanAcknowledge { get; set; }
        public bool CanSetPending { get; set; }
        public bool CanResume { get; set; }
        public bool CanResolve { get; set; }
        public bool CanConfirm { get; set; }
        public bool CanReopen { get; set; }
        public bool CanCancel { get; set; }
        public List<ResolutionCodeDto> ResolutionCodes { get; set; } = new();
    }

    public record ResolutionCodeDto(ResolutionCode Code, string Label);

    /// <summary>reason: 1 waiting on the requester (their reply resumes it), 2 waiting on a third party. note: 5 to 2000 characters, posted as a public comment.</summary>
    public class SetPendingRequest
    {
        public PendingReason Reason { get; set; }
        public string Note { get; set; } = string.Empty;
    }

    /// <summary>code: see ResolutionCodes. note: 10 to 4000 characters, posted as a public comment.</summary>
    public class ResolveRequest
    {
        public ResolutionCode Code { get; set; }
        public string Note { get; set; } = string.Empty;
    }

    /// <summary>For reopen (5 to 2000 characters, posted as a public comment) and cancel (3 to 500).</summary>
    public class WorkflowReasonRequest
    {
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>The categories the signed-in person handles, per unit (the skills matrix, read-only).</summary>
    public class MyCategoriesDto
    {
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public string DepartmentName { get; set; } = string.Empty;
        public List<MyCategoryDto> Categories { get; set; } = new();
    }

    public record MyCategoryDto(Guid Id, string Name, bool IsActive);
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

        /// <summary>The person searching is left out of their own results.</summary>
        Task<(TicketProblem? Problem, List<PersonSearchResultDto>? People)> SearchPeopleAsync(string? query, Guid actorUserId);
    }

    /// <summary>Wakes the assignment queue early (someone came back from leave, got new skills or joined a unit). Never blocks.</summary>
    public interface IAssignmentSignal
    {
        void Poke();
        Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken);
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

        /// <summary>The categories this person handles, per unit they are an active member of (Step 6).</summary>
        Task<List<MyCategoriesDto>> MineAsync(Guid userId);

        /// <summary>For automatic assignment (Step 4): mapped, active members of the owning unit with active accounts. Availability is checked separately.</summary>
        Task<List<Guid>> EligibleCaseWorkerIdsAsync(Guid categoryId);
    }
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

    /// <summary>A failed ticket action: HTTP status, message, the first field to blame and (Step 6) every field to blame.</summary>
    public sealed record TicketProblem(int Status, string Message, string? Field = null, IReadOnlyDictionary<string, string>? Errors = null);

    /// <summary>
    /// Raising, reading and commenting on tickets (BRD M2, M4). Visibility: the requester, whoever raised it, the people copied, staff of
    /// the ticket's department (unit members and its HOD) and Super Admins. Anyone else gets 404, so references cannot be probed.
    /// Internal notes and their files: department staff and Super Admins only.
    /// </summary>
    public interface ITicketService
    {
        Task<(TicketProblem? Problem, CreatedTicketDto? Ticket)> CreateAsync(CreateTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, DuplicateCheckDto? Result)> CheckDuplicatesAsync(DuplicateCheckRequest request, Guid actorUserId);

        /// <summary>
        /// view: mine (raised by or for me), copied, assigned (to me), department (departmentId; staff of it or Super Admin).
        /// departmentId and unitId narrow every view; open=true keeps New, Assigned, In progress, Pending and Reopened.
        /// </summary>
        Task<(TicketProblem? Problem, TicketPageDto? Page)> ListAsync(string? view, Guid? departmentId, Guid? unitId, TicketStatus? status, bool? open, string? search,
            int page, int pageSize, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, TicketDetailDto? Ticket)> GetAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<Guid?> FindIdByReferenceAsync(string reference);

        Task<(TicketProblem? Problem, TicketCommentDto? Comment)> AddCommentAsync(Guid ticketId, AddCommentRequest request, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(TicketProblem? Problem, string? FileName, string? ContentType, byte[]? Data)> GetAttachmentAsync(Guid ticketId, Guid attachmentId,
            Guid actorUserId, bool actorIsSuperAdmin);
    }
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IWorkflowService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The ticket workflow (BRD Section 8, FR-4.2 to FR-4.6). Who does what:
    /// - the assignee: acknowledge (Assigned or Reopened to In progress), set Pending with a reason, resume, resolve with a code and a note;
    /// - the requester (or whoever raised it): confirm or reopen a Resolved ticket; cancel it before work starts (New or Assigned);
    /// - a Super Admin: cancel any ticket that is not finished (FR-7.6).
    /// A requester's public reply resumes a ticket waiting on them (TicketService). Auto-close after 3 business days comes with Step 7.
    /// Anyone who cannot see the ticket gets 404; someone who can see it but may not do this gets 403.
    /// </summary>
    public interface IWorkflowService
    {
        Task<(TicketProblem? Problem, TicketActionsDto? Actions)> GetActionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> AcknowledgeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> SetPendingAsync(Guid ticketId, SetPendingRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ResumeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ResolveAsync(Guid ticketId, ResolveRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ConfirmAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> ReopenAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(TicketProblem? Problem, string? Message)> CancelAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin);
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
            var (problem, people) = await _assignment.SearchPeopleAsync(query, Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value));
            if (problem != null) return StatusCode(problem.Status, new ApiError(problem.Message, problem.Field ?? "query", problem.Message));
            return Ok(people);
        }
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

        /// <summary>The categories I handle, per unit (empty for people who are not in a unit).</summary>
        [HttpGet("mine")]
        [ProducesResponseType(typeof(List<MyCategoriesDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<MyCategoriesDto>>> Mine() =>
            Ok(await _catalogue.MineAsync(Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value)));
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

        private ObjectResult Fail(TicketProblem problem)
        {
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

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

        /// <summary>view = mine (default), copied, assigned, or department (with departmentId). departmentId and unitId narrow any view; open=true: New, Assigned, In progress, Pending, Reopened. Newest first.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(TicketPageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        public async Task<ActionResult<TicketPageDto>> List([FromQuery] string? view, [FromQuery] Guid? departmentId, [FromQuery] Guid? unitId,
            [FromQuery] TicketStatus? status, [FromQuery] bool? open, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
        {
            var (problem, result) = await _tickets.ListAsync(view, departmentId, unitId, status, open, search, page, pageSize, Me(), IsSuperAdmin());
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
$files['ServiceDeskAPI\Controllers\WorkflowController.cs'] = @'
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>
    /// The ticket workflow (BRD Section 8). GET actions says what the signed-in person may do now; each POST checks again.
    /// 404: cannot see the ticket. 403: can see it but not the right person. 400: right person, wrong status or a field to fix.
    /// 409: the ticket changed at the same moment.
    /// </summary>
    [ApiController]
    [Route("api/tickets/{ticketId:guid}")]
    [Authorize]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public class WorkflowController : ControllerBase
    {
        private readonly IWorkflowService _workflow;

        public WorkflowController(IWorkflowService workflow) => _workflow = workflow;

        private Guid Me() => Guid.Parse(User.FindFirst(ClaimTypes.NameIdentifier)!.Value);

        private bool IsSuperAdmin() => User.IsInRole(AppRoles.SuperAdmin);

        private ActionResult<MessageDto> Answer((TicketProblem? Problem, string? Message) result)
        {
            if (result.Problem == null && result.Message != null) return Ok(new MessageDto(result.Message));
            var problem = result.Problem ?? new TicketProblem(500, "Something went wrong.");
            var error = new ApiError(problem.Message);
            if (problem.Errors != null) foreach (var (field, message) in problem.Errors) error.Errors[field] = message;
            else if (problem.Field != null) error.Errors[problem.Field] = problem.Message;
            return StatusCode(problem.Status, error);
        }

        /// <summary>What I may do with this ticket now, and the resolution codes.</summary>
        [HttpGet("actions")]
        [ProducesResponseType(typeof(TicketActionsDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<TicketActionsDto>> Actions(Guid ticketId)
        {
            var (problem, actions) = await _workflow.GetActionsAsync(ticketId, Me(), IsSuperAdmin());
            return problem == null && actions != null ? Ok(actions) : StatusCode(problem!.Status, new ApiError(problem.Message));
        }

        /// <summary>The assignee starts work: Assigned or Reopened to In progress.</summary>
        [HttpPost("acknowledge")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Acknowledge(Guid ticketId) => Answer(await _workflow.AcknowledgeAsync(ticketId, Me(), IsSuperAdmin()));

        /// <summary>The assignee waits on the requester (their reply resumes it) or on a third party. The note is posted as a public comment.</summary>
        [HttpPost("pending")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Pending(Guid ticketId, [FromBody] SetPendingRequest request) =>
            Answer(await _workflow.SetPendingAsync(ticketId, request, Me(), IsSuperAdmin()));

        /// <summary>The assignee resumes a Pending ticket.</summary>
        [HttpPost("resume")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Resume(Guid ticketId) => Answer(await _workflow.ResumeAsync(ticketId, Me(), IsSuperAdmin()));

        /// <summary>The assignee resolves it with a code and a note (posted as a public comment).</summary>
        [HttpPost("resolve")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Resolve(Guid ticketId, [FromBody] ResolveRequest request) =>
            Answer(await _workflow.ResolveAsync(ticketId, request, Me(), IsSuperAdmin()));

        /// <summary>The requester accepts the resolution: Resolved to Closed.</summary>
        [HttpPost("confirm")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Confirm(Guid ticketId) => Answer(await _workflow.ConfirmAsync(ticketId, Me(), IsSuperAdmin()));

        /// <summary>The requester rejects the resolution, with a reason: back to the same case worker, or the next available one.</summary>
        [HttpPost("reopen")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Reopen(Guid ticketId, [FromBody] WorkflowReasonRequest request) =>
            Answer(await _workflow.ReopenAsync(ticketId, request, Me(), IsSuperAdmin()));

        /// <summary>The requester withdraws it before work starts; a Super Admin can cancel any open ticket. A reason is required.</summary>
        [HttpPost("cancel")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status403Forbidden)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<MessageDto>> Cancel(Guid ticketId, [FromBody] WorkflowReasonRequest request) =>
            Answer(await _workflow.CancelAsync(ticketId, request, Me(), IsSuperAdmin()));
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

        // ---- workflow (Step 6, BRD Section 8) ----
        /// <summary>When the current assignee acknowledged it (Assigned or Reopened to In progress); cleared on every new assignment.</summary>
        public DateTime? AcknowledgedAt { get; set; }
        public PendingReason? PendingReason { get; set; }
        public DateTime? PendingSince { get; set; }
        public DateTime? ResolvedAt { get; set; }
        public Guid? ResolvedByUserId { get; set; }
        public ResolutionCode? ResolutionCode { get; set; }
        /// <summary>Plain text; also posted as a public comment.</summary>
        public string? ResolutionNote { get; set; }
        public DateTime? ClosedAt { get; set; }
        public DateTime? CancelledAt { get; set; }
        public int ReopenCount { get; set; }
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
$files['ServiceDeskAPI\Domain\Entities\TicketWorkflow.cs'] = @'
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>Why a ticket is Pending (FR-4.3). The SLA clock pauses while Pending (Step 7).</summary>
    public enum PendingReason
    {
        /// <summary>Waiting on the requester; their public reply resumes the ticket automatically.</summary>
        Requester = 1,
        /// <summary>Waiting on a third party, for example an employer or another PFA; the case worker resumes it.</summary>
        ThirdParty = 2
    }

    /// <summary>How a ticket was resolved (FR-4.4).</summary>
    public enum ResolutionCode
    {
        Completed = 1,
        InformationProvided = 2,
        ReferredElsewhere = 3,
        Duplicate = 4,
        NoActionRequired = 5
    }

    /// <summary>
    /// Every status change of a ticket, with who made it and why. Source for the SLA clock (Step 7) and the ticket's timeline.
    /// </summary>
    public class TicketStatusChange
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public TicketStatus FromStatus { get; set; }
        public TicketStatus ToStatus { get; set; }
        /// <summary>Null when the system made it (for example a requester's reply resuming a Pending ticket is still the requester).</summary>
        public Guid? ByUserId { get; set; }
        public string? Reason { get; set; }
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

                // 2. Not started (Assigned, or Reopened and not yet acknowledged), but the assignee is away, blocked or left the unit (FR-3.11)
                var notStarted = await AwayAssignee(_db.Tickets.AsNoTracking().Where(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened), today)
                    .OrderBy(t => t.AssignedAt).Select(t => t.Id).Take(200).ToListAsync(cancellationToken);
                foreach (var id in notStarted)
                    if (await AssignCoreAsync(id, "assignee unavailable")) assigned++;

                // 3. Already started (In progress or Pending) and the assignee is away: they keep it, the unit's head is told once (FR-3.11)
                var started = await AwayAssignee(_db.Tickets.Include(t => t.Unit).Include(t => t.AssigneeUser)
                        .Where(t => (t.Status == TicketStatus.InProgress || t.Status == TicketStatus.Pending) && t.AssigneeAwayFlaggedAt == null), today)
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
                var assigneeAway = (ticket.Status == TicketStatus.Assigned || ticket.Status == TicketStatus.Reopened) && ticket.AssigneeUserId.HasValue
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
                await ApplyAsync(ticket, chosen.UserId, ticket.UnitId, now, null, "Automatic assignment (" + trigger + ")");
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

        /// <summary>
        /// Puts the ticket with this person in this unit: status Assigned (a reopened ticket stays Reopened), a new acknowledgement
        /// window (FR-5.11), flags cleared. The status change is recorded for the SLA clock.
        /// </summary>
        private async Task ApplyAsync(Ticket ticket, Guid userId, Guid unitId, DateTime now, Guid? byUserId = null, string? why = null)
        {
            var newStatus = ticket.Status == TicketStatus.Reopened ? TicketStatus.Reopened : TicketStatus.Assigned;
            if (newStatus != ticket.Status)
                _db.TicketStatusChanges.Add(new TicketStatusChange
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = ticket.Status, ToStatus = newStatus, ByUserId = byUserId,
                    Reason = why == null ? null : (why.Length > 500 ? why.Substring(0, 500) : why), At = now
                });
            ticket.AssigneeUserId = userId;
            ticket.UnitId = unitId;
            ticket.Status = newStatus;
            ticket.AssignedAt = now;
            ticket.AcknowledgedAt = null;
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
                await ApplyAsync(ticket, target.UserId, target.UnitId, now, actorUserId, reason);
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

        public async Task<(TicketProblem? Problem, List<PersonSearchResultDto>? People)> SearchPeopleAsync(string? query, Guid actorUserId)
        {
            var term = (query ?? string.Empty).Trim();
            if (term.Length < 2) return (new TicketProblem(400, "Type at least 2 letters.", "query"), null);
            if (term.Length > 100) term = term.Substring(0, 100);
            var people = await _db.Users.AsNoTracking()
                .Where(u => u.IsActive && u.Id != actorUserId && ((u.UserName != null && u.UserName.Contains(term)) || (u.FullName != null && u.FullName.Contains(term))))
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

        public async Task<List<MyCategoriesDto>> MineAsync(Guid userId)
        {
            var units = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UserId == userId && m.IsActive && m.Unit!.IsActive)
                .OrderBy(m => m.Unit!.Department!.Name).ThenBy(m => m.Unit!.Name)
                .Select(m => new MyCategoriesDto { UnitId = m.UnitId, UnitName = m.Unit!.Name, DepartmentName = m.Unit.Department!.Name })
                .ToListAsync();
            if (units.Count == 0) return units;
            var unitIds = units.Select(u => u.UnitId).ToList();
            var skills = await _db.CategorySkills.AsNoTracking()
                .Where(s => s.UserId == userId && s.IsActive && unitIds.Contains(s.Category!.UnitId))
                .OrderBy(s => s.Category!.SortOrder).ThenBy(s => s.Category!.Name)
                .Select(s => new { s.Category!.UnitId, s.CategoryId, s.Category.Name, s.Category.IsActive })
                .ToListAsync();
            foreach (var unit in units)
                unit.Categories = skills.Where(s => s.UnitId == unit.UnitId).Select(s => new MyCategoryDto(s.CategoryId, s.Name, s.IsActive)).ToList();
            return units;
        }

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
        public DbSet<TicketStatusChange> TicketStatusChanges => Set<TicketStatusChange>();

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
                e.Property(t => t.ResolutionNote).HasMaxLength(4000);
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

            builder.Entity<TicketStatusChange>(e =>
            {
                e.ToTable("TicketStatusChanges");
                e.HasKey(c => c.Id);
                e.Property(c => c.Reason).HasMaxLength(500);
                e.HasOne(c => c.Ticket).WithMany().HasForeignKey(c => c.TicketId).OnDelete(DeleteBehavior.Restrict);
                e.HasIndex(c => new { c.TicketId, c.At });
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
                "You now have the " + Friendly(role.Name) + " role.",
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
        private static readonly TicketStatus[] OpenStatuses = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };

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

            // Every field is checked, and every problem reported at once (Step 6)
            var errors = new Dictionary<string, string>();
            var category = await _db.Categories.Include(c => c.Unit).Include(c => c.Department)
                .FirstOrDefaultAsync(c => c.Id == request.CategoryId);
            if (category == null || !category.IsActive || !category.Unit!.IsActive || !category.Department!.IsActive)
                errors["categoryId"] = "Choose one of the listed categories.";
            var location = await _db.Locations.FirstOrDefaultAsync(l => l.Id == request.LocationId && l.IsActive);
            if (location == null) errors["locationId"] = "Choose your location.";
            var priority = request.Priority ?? category?.DefaultPriority ?? TicketPriority.Medium;
            if (!Enum.IsDefined(priority)) errors["priority"] = "Choose Low, Medium, High or Critical.";

            var subject = (request.Subject ?? string.Empty).Trim();
            if (subject.Length < 3 || subject.Length > TicketSeed.MaxSubjectChars)
                errors["subject"] = "The subject must be 3 to " + TicketSeed.MaxSubjectChars + " characters.";
            var (html, text, descriptionProblem) = CleanBody(request.DescriptionHtml, "descriptionHtml", "Describe the request.");
            if (descriptionProblem != null) errors["descriptionHtml"] = descriptionProblem.Message;

            // Copied colleagues
            var cc = (request.CcUserIds ?? new List<Guid>()).Where(id => id != Guid.Empty && id != requesterId).Distinct().ToList();
            if (cc.Count > MaxCc) errors["ccUserIds"] = "Copy at most " + MaxCc + " people.";
            else if (cc.Count > 0)
            {
                var found = await _db.Users.Where(u => cc.Contains(u.Id) && u.IsActive).Select(u => u.Id).ToListAsync();
                if (found.Count != cc.Count) errors["ccUserIds"] = "Some of the people to copy were not found or are blocked.";
            }

            var (fileProblem, files) = await AttachmentRules.CheckAsync(request.Files);
            if (fileProblem != null) errors["files"] = fileProblem;

            if (errors.Count > 0 || category == null || location == null)
                return (Invalid(errors), null);

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
            bool? open, string? search, int page, int pageSize, Guid actorUserId, bool actorIsSuperAdmin)
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
                    staffView = true;
                    break;
                default:
                    return (new TicketProblem(400, "view must be mine, copied, assigned or department.", "view"), null);
            }

            // These narrow every view (Step 6)
            if (departmentId.HasValue) query = query.Where(t => t.DepartmentId == departmentId.Value);
            if (unitId.HasValue) query = query.Where(t => t.UnitId == unitId.Value);
            if (status.HasValue) query = query.Where(t => t.Status == status.Value);
            if (open == true) query = query.Where(t => OpenStatuses.Contains(t.Status));
            else if (open == false) query = query.Where(t => !OpenStatuses.Contains(t.Status));
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
                Assignee = x.Assignee, AssignedAt = x.AssignedAt, CreatedAt = x.CreatedAt, UpdatedAt = x.UpdatedAt,
                AcknowledgedAt = ticket.AcknowledgedAt, PendingReason = ticket.PendingReason, PendingSince = ticket.PendingSince,
                ResolvedAt = ticket.ResolvedAt, ResolutionCode = ticket.ResolutionCode, ResolutionNote = ticket.ResolutionNote,
                ClosedAt = ticket.ClosedAt, CancelledAt = ticket.CancelledAt, ReopenCount = ticket.ReopenCount
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

            var errors = new Dictionary<string, string>();
            var (html, text, bodyProblem) = CleanBody(request.BodyHtml, "bodyHtml", "Write a comment.");
            if (bodyProblem != null) errors["bodyHtml"] = bodyProblem.Message;
            var (fileProblem, files) = await AttachmentRules.CheckAsync(request.Files);
            if (fileProblem != null) errors["files"] = fileProblem;
            if (errors.Count > 0) return (Invalid(errors), null);

            var now = DateTime.UtcNow;
            var comment = new TicketComment { Id = Guid.NewGuid(), TicketId = ticketId, AuthorUserId = actorUserId, BodyHtml = html, BodyText = text, IsInternal = request.IsInternal, CreatedAt = now };
            _db.TicketComments.Add(comment);
            AddFiles(ticketId, comment.Id, files, actorUserId, now);
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Created, "TicketComment", comment.Id, ticket.Reference, null, new { ticket = ticket.Reference, internalNote = request.IsInternal, files = files.Count });

            // Waiting on the requester and the requester answered: back to In progress (BRD Section 8)
            var resumed = false;
            if (!request.IsInternal && ticket.Status == TicketStatus.Pending && ticket.PendingReason == PendingReason.Requester
                && (actorUserId == ticket.RequesterUserId || actorUserId == ticket.RaisedByUserId))
            {
                _db.TicketStatusChanges.Add(new TicketStatusChange
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = TicketStatus.Pending, ToStatus = TicketStatus.InProgress,
                    ByUserId = actorUserId, Reason = "The requester replied", At = now
                });
                ticket.Status = TicketStatus.InProgress;
                ticket.PendingReason = null;
                ticket.PendingSince = null;
                resumed = true;
            }

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
            if (resumed && ticket.AssigneeUserId.HasValue && ticket.AssigneeUserId != actorUserId)
            {
                recipients.Remove(ticket.AssigneeUserId.Value);
                _notifications.Stage(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + " resumed",
                    who + " replied, so the ticket is back in progress.", NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
            }
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
                AssignedAt = t.AssigneeUserId == null ? null : t.AssignedAt,
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

        private static TicketProblem Invalid(Dictionary<string, string> errors)
        {
            if (errors.Count == 0) errors["form"] = "Check the form.";
            var first = errors.First();
            return new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors);
        }

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
$files['ServiceDeskAPI\Infrastructure\Tickets\WorkflowService.cs'] = @'
using System.Net;
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
    /// <summary>
    /// Moves tickets through the workflow (BRD Section 8). Every change is recorded in TicketStatusChanges (the SLA clock in Step 7
    /// reads it), audited, and announced. Notes and reasons are posted on the ticket as public comments so the requester sees them;
    /// notifications never carry them (rule 13).
    /// </summary>
    public class WorkflowService : IWorkflowService
    {
        private static readonly TicketStatus[] Unfinished =
            { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened, TicketStatus.Resolved };

        private static readonly Dictionary<ResolutionCode, string> CodeLabels = new()
        {
            [ResolutionCode.Completed] = "Completed",
            [ResolutionCode.InformationProvided] = "Information provided",
            [ResolutionCode.ReferredElsewhere] = "Referred elsewhere",
            [ResolutionCode.Duplicate] = "Duplicate",
            [ResolutionCode.NoActionRequired] = "No action required"
        };

        private readonly AppDbContext _db;
        private readonly IAssignmentService _assignment;
        private readonly IAvailabilityService _availability;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;

        public WorkflowService(AppDbContext db, IAssignmentService assignment, IAvailabilityService availability, IAuditService audit,
            IInAppNotificationService notifications, IHttpContextAccessor http)
        {
            _db = db;
            _assignment = assignment;
            _availability = availability;
            _audit = audit;
            _notifications = notifications;
            _http = http;
        }

        // ---------------- what may I do ----------------

        private sealed record Who(bool IsAssignee, bool IsRequester, bool IsSuperAdmin);

        private static bool CanAcknowledge(Ticket t, Who w) => w.IsAssignee && t.Status is TicketStatus.Assigned or TicketStatus.Reopened;
        private static bool CanSetPending(Ticket t, Who w) => w.IsAssignee && t.Status == TicketStatus.InProgress;
        private static bool CanResume(Ticket t, Who w) => w.IsAssignee && t.Status == TicketStatus.Pending;
        private static bool CanResolve(Ticket t, Who w) => w.IsAssignee && t.Status is TicketStatus.InProgress or TicketStatus.Pending;
        private static bool CanConfirm(Ticket t, Who w) => w.IsRequester && t.Status == TicketStatus.Resolved;
        private static bool CanReopen(Ticket t, Who w) => w.IsRequester && t.Status == TicketStatus.Resolved;
        private static bool CanCancel(Ticket t, Who w) =>
            (w.IsRequester && t.Status is TicketStatus.New or TicketStatus.Assigned) || (w.IsSuperAdmin && Unfinished.Contains(t.Status));

        public async Task<(TicketProblem? Problem, TicketActionsDto? Actions)> GetActionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, track: false);
            if (problem != null) return (problem, null);
            return (null, new TicketActionsDto
            {
                CanAcknowledge = CanAcknowledge(ticket!, who!),
                CanSetPending = CanSetPending(ticket!, who!),
                CanResume = CanResume(ticket!, who!),
                CanResolve = CanResolve(ticket!, who!),
                CanConfirm = CanConfirm(ticket!, who!),
                CanReopen = CanReopen(ticket!, who!),
                CanCancel = CanCancel(ticket!, who!),
                ResolutionCodes = CodeLabels.Select(c => new ResolutionCodeDto(c.Key, c.Value)).ToList()
            });
        }

        // ---------------- the assignee ----------------

        public async Task<(TicketProblem? Problem, string? Message)> AcknowledgeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanAcknowledge(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can acknowledge it, while it is Assigned or Reopened."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.InProgress, actorUserId, "Acknowledged", now);
            ticket!.AcknowledgedAt = now;
            Stage(AuditAction.Acknowledged, ticket, null);
            var assignee = await NameOfAsync(actorUserId);
            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " in progress",
                assignee + " has started on your " + ticket.Category!.Name + " request.", NotificationType.Info);
            return await SaveAsync("Acknowledged. " + ticket.Reference + " is in progress.");
        }

        public async Task<(TicketProblem? Problem, string? Message)> SetPendingAsync(Guid ticketId, SetPendingRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var errors = new Dictionary<string, string>();
            if (!Enum.IsDefined(request.Reason)) errors["reason"] = "Choose who it is waiting on: the requester or a third party.";
            var note = (request.Note ?? string.Empty).Trim();
            if (note.Length < 5 || note.Length > 2000) errors["note"] = "Say what you are waiting for (5 to 2000 characters).";
            if (errors.Count > 0) return (Invalid(errors), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanSetPending(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can set it to Pending, while it is in progress."), null);

            var now = DateTime.UtcNow;
            var onRequester = request.Reason == PendingReason.Requester;
            Change(ticket!, TicketStatus.Pending, actorUserId, onRequester ? "Waiting on the requester" : "Waiting on a third party", now);
            ticket!.PendingReason = request.Reason;
            ticket.PendingSince = now;
            Comment(ticket, actorUserId, onRequester ? "Waiting on you" : "Waiting on a third party", note, now);
            Stage(AuditAction.StatusChanged, ticket, new { to = "Pending", reason = request.Reason.ToString() });
            var assignee = await NameOfAsync(actorUserId);
            Tell(ticket.RequesterUserId, actorUserId, ticket,
                onRequester ? "Ticket " + ticket.Reference + " needs your reply" : "Ticket " + ticket.Reference + " is waiting on a third party",
                onRequester ? assignee + " needs more information from you. Reply on the ticket to continue." : assignee + " is waiting on a third party. You will be told when it moves on.",
                onRequester ? NotificationType.ActionRequired : NotificationType.Info);
            return await SaveAsync(ticket.Reference + " is Pending (" + (onRequester ? "waiting on the requester" : "waiting on a third party") + ").");
        }

        public async Task<(TicketProblem? Problem, string? Message)> ResumeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanResume(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can resume it, while it is Pending."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.InProgress, actorUserId, "Resumed", now);
            ticket!.PendingReason = null;
            ticket.PendingSince = null;
            Stage(AuditAction.StatusChanged, ticket, new { to = "InProgress", resumed = true });
            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " back in progress",
                "Work on your " + ticket.Category!.Name + " request has resumed.", NotificationType.Info);
            return await SaveAsync(ticket.Reference + " is back in progress.");
        }

        public async Task<(TicketProblem? Problem, string? Message)> ResolveAsync(Guid ticketId, ResolveRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var errors = new Dictionary<string, string>();
            if (!Enum.IsDefined(request.Code)) errors["code"] = "Choose a resolution code.";
            var note = (request.Note ?? string.Empty).Trim();
            if (note.Length < 10 || note.Length > 4000) errors["note"] = "Describe the resolution (10 to 4000 characters).";
            if (errors.Count > 0) return (Invalid(errors), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanResolve(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can resolve it, while it is in progress or Pending."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Resolved, actorUserId, "Resolved: " + CodeLabels[request.Code], now);
            ticket!.ResolvedAt = now;
            ticket.ResolvedByUserId = actorUserId;
            ticket.ResolutionCode = request.Code;
            ticket.ResolutionNote = note;
            ticket.PendingReason = null;
            ticket.PendingSince = null;
            Comment(ticket, actorUserId, "Resolved: " + CodeLabels[request.Code], note, now);
            Stage(AuditAction.Resolved, ticket, new { code = request.Code.ToString() });

            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " resolved",
                "Your " + ticket.Category!.Name + " request has been resolved. Check the answer, then confirm it or reopen the ticket.", NotificationType.ActionRequired);
            foreach (var watcher in await _db.TicketWatchers.Where(w => w.TicketId == ticket.Id).Select(w => w.UserId).ToListAsync())
                if (watcher != ticket.RequesterUserId)
                    Tell(watcher, actorUserId, ticket, "Ticket " + ticket.Reference + " resolved", "A ticket you are copied on has been resolved.", NotificationType.Info);
            return await SaveAsync(ticket.Reference + " resolved. The requester can now confirm or reopen it.");
        }

        // ---------------- the requester ----------------

        public async Task<(TicketProblem? Problem, string? Message)> ConfirmAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanConfirm(ticket!, who!)) return (Refuse(ticket!, who!.IsRequester, "Only the requester can confirm it, while it is Resolved."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Closed, actorUserId, "Confirmed by the requester", now);
            ticket!.ClosedAt = now;
            Stage(AuditAction.StatusChanged, ticket, new { to = "Closed", confirmed = true });
            if (ticket.AssigneeUserId.HasValue)
                Tell(ticket.AssigneeUserId.Value, actorUserId, ticket, "Ticket " + ticket.Reference + " closed",
                    await NameOfAsync(actorUserId) + " confirmed the resolution.", NotificationType.Success);
            return await SaveAsync("Thank you. " + ticket.Reference + " is closed.");
        }

        public async Task<(TicketProblem? Problem, string? Message)> ReopenAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 5 || reason.Length > 2000)
                return (Invalid(new Dictionary<string, string> { ["reason"] = "Say why it is not resolved (5 to 2000 characters)." }), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanReopen(ticket!, who!)) return (Refuse(ticket!, who!.IsRequester, "Only the requester can reopen it, while it is Resolved."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Reopened, actorUserId, "Reopened by the requester", now);
            ticket!.ReopenCount++;
            ticket.AcknowledgedAt = null;
            ticket.ResolvedAt = null;
            ticket.ResolvedByUserId = null;
            ticket.ResolutionCode = null;
            ticket.ResolutionNote = null;
            Comment(ticket, actorUserId, "Reopened", reason, now);
            Stage(AuditAction.Reopened, ticket, new { count = ticket.ReopenCount });
            if (ticket.AssigneeUserId.HasValue)
                Tell(ticket.AssigneeUserId.Value, actorUserId, ticket, "Ticket " + ticket.Reference + " reopened",
                    await NameOfAsync(actorUserId) + " says it is not resolved yet. Please acknowledge it and pick it up again.", NotificationType.ActionRequired);
            var (saveProblem, message) = await SaveAsync(ticket.Reference + " is reopened and back with " + (ticket.AssigneeUserId.HasValue ? await NameOfAsync(ticket.AssigneeUserId.Value) : "the team") + ".");
            if (saveProblem != null) return (saveProblem, null);

            // Back to the same case worker, unless they are unavailable: then through the engine (FR-4.6)
            var assigneeId = ticket.AssigneeUserId;
            var unitId = ticket.UnitId;
            _db.ChangeTracker.Clear();
            if (assigneeId.HasValue && !(await _availability.IsAvailableAsync(assigneeId.Value)
                && await _db.UnitMembers.AnyAsync(m => m.UserId == assigneeId.Value && m.UnitId == unitId && m.IsActive)))
            {
                var moved = await _assignment.AssignAsync(ticketId, "reopened while the assignee is unavailable");
                message = ticket.Reference + " is reopened. " + (moved ? "Its case worker is unavailable, so it went to someone else." : "Its case worker is unavailable; it will go to the next available one.");
            }
            return (null, message);
        }

        public async Task<(TicketProblem? Problem, string? Message)> CancelAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 3 || reason.Length > 500)
                return (Invalid(new Dictionary<string, string> { ["reason"] = "Say why it is cancelled (3 to 500 characters)." }), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanCancel(ticket!, who!))
                return (Refuse(ticket!, who!.IsRequester || who.IsSuperAdmin,
                    "The requester can cancel it before work starts (New or Assigned); a Super Admin can cancel any open ticket."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Cancelled, actorUserId, "Cancelled", now);
            ticket!.CancelledAt = now;
            Comment(ticket, actorUserId, "Cancelled", reason, now);
            Stage(AuditAction.Cancelled, ticket, null);
            var actorName = await NameOfAsync(actorUserId);
            if (ticket.AssigneeUserId.HasValue)
                Tell(ticket.AssigneeUserId.Value, actorUserId, ticket, "Ticket " + ticket.Reference + " cancelled", actorName + " cancelled it. No further work is needed.", NotificationType.Info);
            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " cancelled", actorName + " cancelled your " + ticket.Category!.Name + " request.", NotificationType.Info);
            return await SaveAsync(ticket.Reference + " is cancelled.");
        }

        // ---------------- helpers ----------------

        private async Task<(TicketProblem? Problem, Ticket? Ticket, Who? Who)> LoadAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin, bool track = true)
        {
            var query = _db.Tickets.Include(t => t.Category).AsQueryable();
            if (!track) query = query.AsNoTracking();
            var ticket = await query.FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null, null);
            var isRequester = ticket.RequesterUserId == actorUserId || ticket.RaisedByUserId == actorUserId;
            var canView = actorIsSuperAdmin || isRequester
                || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticketId && w.UserId == actorUserId)
                || await _db.UnitMembers.AnyAsync(m => m.UserId == actorUserId && m.IsActive && m.Unit!.DepartmentId == ticket.DepartmentId)
                || await _db.Departments.AnyAsync(d => d.Id == ticket.DepartmentId && d.HodUserId == actorUserId);
            if (!canView) return (new TicketProblem(404, "Ticket not found."), null, null);
            return (null, ticket, new Who(ticket.AssigneeUserId == actorUserId, isRequester, actorIsSuperAdmin));
        }

        /// <summary>403 when the person is not the one who may do it; 400 when they are, but the ticket is in the wrong status.</summary>
        private static TicketProblem Refuse(Ticket ticket, bool rightPerson, string rule) =>
            rightPerson ? new TicketProblem(400, "Not possible while the ticket is " + StatusText(ticket.Status) + ". " + rule)
                        : new TicketProblem(403, rule);

        private void Change(Ticket ticket, TicketStatus to, Guid actorUserId, string reason, DateTime now)
        {
            _db.TicketStatusChanges.Add(new TicketStatusChange
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = ticket.Status, ToStatus = to, ByUserId = actorUserId, Reason = reason, At = now
            });
            ticket.Status = to;
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;
            if (to != TicketStatus.InProgress && to != TicketStatus.Pending) ticket.AssigneeAwayFlaggedAt = null;
        }

        /// <summary>Posts the note as a public comment: a bold label, then the text with its line breaks.</summary>
        private void Comment(Ticket ticket, Guid authorUserId, string label, string text, DateTime now)
        {
            var body = string.Join("<br>", text.Replace("\r", string.Empty).Split('\n').Select(WebUtility.HtmlEncode));
            _db.TicketComments.Add(new TicketComment
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, AuthorUserId = authorUserId, IsInternal = false, CreatedAt = now,
                BodyHtml = "<p><strong>" + WebUtility.HtmlEncode(label) + "</strong></p><p>" + body + "</p>",
                BodyText = label + "\n" + text
            });
        }

        private void Tell(Guid recipient, Guid actorUserId, Ticket ticket, string title, string message, NotificationType type)
        {
            if (recipient == actorUserId) return;
            _notifications.Stage(recipient, title, message, type, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private async Task<(TicketProblem? Problem, string? Message)> SaveAsync(string message)
        {
            try
            {
                await _db.SaveChangesAsync();
                return (null, message);
            }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket changed at the same moment. Reload it and try again."), null);
            }
        }

        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private void Stage(AuditAction action, Ticket ticket, object? detail)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Ticket", ticket.Id, ticket.Reference, null,
                JsonSerializer.Serialize(new { status = ticket.Status.ToString(), detail }), actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }

        private static TicketProblem Invalid(Dictionary<string, string> errors)
        {
            var first = errors.First();
            return new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors);
        }

        private static string StatusText(TicketStatus status) => status switch
        {
            TicketStatus.InProgress => "in progress",
            _ => status.ToString().ToLowerInvariant()
        };
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Tickets\WorkflowTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
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
    /// <summary>Step 6: acknowledge, pending and resume, resolve, confirm, reopen, cancel; plus the list and form changes.</summary>
    public class WorkflowTests : IClassFixture<ServiceDeskApiFactory>
    {
        private static readonly Guid MatchingCategory = CatalogueSeed.Categories.First(c => c.UnitId == OrgSeed.ContributionMatchingUnitId).Id;

        private readonly ServiceDeskApiFactory _factory;

        public WorkflowTests(ServiceDeskApiFactory factory) => _factory = factory;

        private async Task<HttpClient> As(string userName)
        {
            var signIn = await ApiTestHelpers.SignInAsync(_factory, userName);
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", signIn.AccessToken);
            return client;
        }

        private static async Task<T> Ok<T>(HttpResponseMessage response)
        {
            Assert.True(response.IsSuccessStatusCode, response.StatusCode + ": " + await response.Content.ReadAsStringAsync());
            return (await response.Content.ReadFromJsonAsync<T>())!;
        }

        private static MultipartFormDataContent Form(Guid category, string subject = "Workflow test", string html = "<p>Please help with this.</p>") => new()
        {
            { new StringContent(category.ToString()), "categoryId" },
            { new StringContent(TicketSeed.HeadquartersLocationId.ToString()), "locationId" },
            { new StringContent(subject), "subject" },
            { new StringContent(html), "descriptionHtml" }
        };

        /// <summary>Raises a ticket as test.requester and returns it with a client signed in as its assignee.</summary>
        private async Task<(CreatedTicketDto Ticket, HttpClient Assignee, Guid AssigneeId)> RaiseAsync()
        {
            var created = await Ok<CreatedTicketDto>(await (await As("test.requester")).PostAsync("/api/tickets", Form(MatchingCategory)));
            using var scope = _factory.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var assigneeId = await db.Tickets.Where(t => t.Id == created.Id).Select(t => t.AssigneeUserId!.Value).SingleAsync();
            var name = await db.Users.Where(u => u.Id == assigneeId).Select(u => u.UserName!).SingleAsync();
            return (created, await As(name), assigneeId);
        }

        private async Task<Ticket> TicketAsync(Guid id)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Tickets.AsNoTracking().SingleAsync(t => t.Id == id);
        }

        private async Task<bool> NotifiedAsync(Guid userId, Guid ticketId, string title)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().InAppNotifications
                .AnyAsync(n => n.RecipientUserId == userId && n.RelatedEntityId == ticketId && n.Title == title);
        }

        private async Task<Guid> IdOf(string userName)
        {
            using var scope = _factory.Services.CreateScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.Where(u => u.UserName == userName).Select(u => u.Id).SingleAsync();
        }

        private static string Url(Guid id, string action) => $"/api/tickets/{id}/{action}";

        [Fact]
        public async Task A_ticket_goes_from_assigned_to_closed_and_every_step_is_recorded()
        {
            var requester = await As("test.requester");
            var requesterId = await IdOf("test.requester");
            var (ticket, assignee, assigneeId) = await RaiseAsync();

            var actions = await Ok<TicketActionsDto>(await assignee.GetAsync(Url(ticket.Id, "actions")));
            Assert.True(actions.CanAcknowledge);
            Assert.False(actions.CanResolve);
            Assert.Equal(5, actions.ResolutionCodes.Count);
            Assert.True((await Ok<TicketActionsDto>(await requester.GetAsync(Url(ticket.Id, "actions")))).CanCancel);

            await Ok<MessageDto>(await assignee.PostAsync(Url(ticket.Id, "acknowledge"), null));
            Assert.Equal(TicketStatus.InProgress, (await TicketAsync(ticket.Id)).Status);
            Assert.True(await NotifiedAsync(requesterId, ticket.Id, "Ticket " + ticket.Reference + " in progress"));

            await Ok<MessageDto>(await assignee.PostAsJsonAsync(Url(ticket.Id, "pending"), new { reason = 1, note = "Please send the employer's schedule for March." }));
            var pending = await TicketAsync(ticket.Id);
            Assert.Equal(TicketStatus.Pending, pending.Status);
            Assert.Equal(PendingReason.Requester, pending.PendingReason);
            Assert.True(await NotifiedAsync(requesterId, ticket.Id, "Ticket " + ticket.Reference + " needs your reply"));

            // The requester's public reply resumes it
            var reply = new MultipartFormDataContent { { new StringContent("<p>Schedule attached as asked.</p>"), "bodyHtml" }, { new StringContent("false"), "isInternal" } };
            await Ok<TicketCommentDto>(await requester.PostAsync($"/api/tickets/{ticket.Id}/comments", reply));
            Assert.Equal(TicketStatus.InProgress, (await TicketAsync(ticket.Id)).Status);
            Assert.True(await NotifiedAsync(assigneeId, ticket.Id, "Ticket " + ticket.Reference + " resumed"));

            await Ok<MessageDto>(await assignee.PostAsJsonAsync(Url(ticket.Id, "resolve"), new { code = 1, note = "Matched the March remittance to the member's account." }));
            var requesterActions = await Ok<TicketActionsDto>(await requester.GetAsync(Url(ticket.Id, "actions")));
            Assert.True(requesterActions.CanConfirm);
            Assert.True(requesterActions.CanReopen);
            Assert.False(requesterActions.CanCancel);
            Assert.True(await NotifiedAsync(requesterId, ticket.Id, "Ticket " + ticket.Reference + " resolved"));

            await Ok<MessageDto>(await requester.PostAsync(Url(ticket.Id, "confirm"), null));
            var detail = await Ok<TicketDetailDto>(await requester.GetAsync($"/api/tickets/{ticket.Id}"));
            Assert.Equal(TicketStatus.Closed, detail.Status);
            Assert.Equal(ResolutionCode.Completed, detail.ResolutionCode);
            Assert.NotNull(detail.AcknowledgedAt);
            Assert.NotNull(detail.AssignedAt);
            Assert.NotNull(detail.ClosedAt);
            Assert.False(detail.CanComment);
            Assert.Contains(detail.Comments, c => c.BodyHtml.Contains("Waiting on you"));
            Assert.Contains(detail.Comments, c => c.BodyHtml.Contains("Resolved: Completed"));

            using var scope = _factory.Services.CreateScope();
            var changes = await scope.ServiceProvider.GetRequiredService<AppDbContext>().TicketStatusChanges.AsNoTracking()
                .Where(c => c.TicketId == ticket.Id).OrderBy(c => c.At).Select(c => c.ToStatus).ToListAsync();
            Assert.Equal(new[] { TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.InProgress, TicketStatus.Resolved, TicketStatus.Closed }, changes);
        }

        [Fact]
        public async Task The_wrong_person_gets_403_the_wrong_status_400_and_every_bad_field_is_named()
        {
            var requester = await As("test.requester");
            var (ticket, assignee, _) = await RaiseAsync();

            Assert.Equal(HttpStatusCode.Forbidden, (await requester.PostAsync(Url(ticket.Id, "acknowledge"), null)).StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, (await assignee.PostAsJsonAsync(Url(ticket.Id, "resolve"), new { code = 1, note = "Too early to resolve this." })).StatusCode);
            Assert.Equal(HttpStatusCode.Forbidden, (await assignee.PostAsync(Url(ticket.Id, "confirm"), null)).StatusCode);
            Assert.Equal(HttpStatusCode.NotFound, (await (await As("test.hou2")).GetAsync(Url(Guid.NewGuid(), "actions"))).StatusCode);

            var bad = await assignee.PostAsJsonAsync(Url(ticket.Id, "pending"), new { reason = 9, note = "" });
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            var errors = (await bad.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
            Assert.True(errors.TryGetProperty("reason", out _));
            Assert.True(errors.TryGetProperty("note", out _));

            // Raising: every wrong field at once
            var form = await requester.PostAsync("/api/tickets", Form(Guid.Empty, subject: "Hi", html: "<p></p>"));
            var formErrors = (await form.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors");
            Assert.True(formErrors.TryGetProperty("categoryId", out _));
            Assert.True(formErrors.TryGetProperty("subject", out _));
            Assert.True(formErrors.TryGetProperty("descriptionHtml", out _));
        }

        [Fact]
        public async Task Reopening_goes_back_to_the_same_case_worker_or_through_the_engine_if_they_are_away()
        {
            var requester = await As("test.requester");
            var admin = await As("test.superadmin");

            // Same case worker
            var (first, assignee, assigneeId) = await RaiseAsync();
            await Ok<MessageDto>(await assignee.PostAsync(Url(first.Id, "acknowledge"), null));
            await Ok<MessageDto>(await assignee.PostAsJsonAsync(Url(first.Id, "resolve"), new { code = 2, note = "The balance is shown in the statement." }));
            Assert.Equal(HttpStatusCode.BadRequest, (await requester.PostAsJsonAsync(Url(first.Id, "reopen"), new { reason = "" })).StatusCode);
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(first.Id, "reopen"), new { reason = "The statement does not show March." }));
            var reopened = await TicketAsync(first.Id);
            Assert.Equal(TicketStatus.Reopened, reopened.Status);
            Assert.Equal(assigneeId, reopened.AssigneeUserId);
            Assert.Equal(1, reopened.ReopenCount);
            Assert.Null(reopened.ResolutionCode);
            Assert.True(await NotifiedAsync(assigneeId, first.Id, "Ticket " + first.Reference + " reopened"));
            await Ok<MessageDto>(await assignee.PostAsync(Url(first.Id, "acknowledge"), null));
            Assert.Equal(TicketStatus.InProgress, (await TicketAsync(first.Id)).Status);

            // The case worker is away when it is reopened
            var (second, secondAssignee, awayId) = await RaiseAsync();
            await Ok<MessageDto>(await secondAssignee.PostAsync(Url(second.Id, "acknowledge"), null));
            await Ok<MessageDto>(await secondAssignee.PostAsJsonAsync(Url(second.Id, "resolve"), new { code = 1, note = "Done and confirmed with the employer." }));
            DateOnly today;
            using (var scope = _factory.Services.CreateScope()) today = scope.ServiceProvider.GetRequiredService<IAvailabilityService>().Today();
            await Ok<AbsenceDto>(await admin.PostAsJsonAsync("/api/availability/absences", new { userId = awayId, kind = 1, startDate = today, endDate = today }));
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(second.Id, "reopen"), new { reason = "Still not reflecting on my side." }));
            var moved = await TicketAsync(second.Id);
            Assert.Equal(TicketStatus.Reopened, moved.Status);
            Assert.NotEqual(awayId, moved.AssigneeUserId);
            Assert.NotNull(moved.AssigneeUserId);
        }

        [Fact]
        public async Task The_requester_cancels_before_work_starts_and_a_Super_Admin_any_time()
        {
            var requester = await As("test.requester");
            var (early, _, earlyAssignee) = await RaiseAsync();
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(early.Id, "cancel"), new { reason = "Raised by mistake" }));
            Assert.Equal(TicketStatus.Cancelled, (await TicketAsync(early.Id)).Status);
            Assert.True(await NotifiedAsync(earlyAssignee, early.Id, "Ticket " + early.Reference + " cancelled"));

            var (late, assignee, _) = await RaiseAsync();
            await Ok<MessageDto>(await assignee.PostAsync(Url(late.Id, "acknowledge"), null));
            Assert.Equal(HttpStatusCode.BadRequest, (await requester.PostAsJsonAsync(Url(late.Id, "cancel"), new { reason = "Changed my mind" })).StatusCode);
            await Ok<MessageDto>(await (await As("test.superadmin")).PostAsJsonAsync(Url(late.Id, "cancel"), new { reason = "Duplicate of another request" }));
            Assert.Equal(TicketStatus.Cancelled, (await TicketAsync(late.Id)).Status);
        }

        [Fact]
        public async Task Lists_filter_open_tickets_and_narrow_every_view()
        {
            var requester = await As("test.requester");
            var (open, assignee, _) = await RaiseAsync();
            var (closed, _, _) = await RaiseAsync();
            await Ok<MessageDto>(await requester.PostAsJsonAsync(Url(closed.Id, "cancel"), new { reason = "Not needed" }));

            var mineOpen = await Ok<TicketPageDto>(await requester.GetAsync("/api/tickets?view=mine&open=true&pageSize=100"));
            Assert.Contains(mineOpen.Items, t => t.Id == open.Id);
            Assert.DoesNotContain(mineOpen.Items, t => t.Id == closed.Id);
            Assert.All(mineOpen.Items, t => Assert.NotEqual(TicketStatus.Cancelled, t.Status));
            Assert.NotNull(mineOpen.Items.Single(t => t.Id == open.Id).AssignedAt);

            var assignedHere = await Ok<TicketPageDto>(await assignee.GetAsync($"/api/tickets?view=assigned&departmentId={OrgSeed.ContributionProcessingId}&open=true"));
            var assignedElsewhere = await Ok<TicketPageDto>(await assignee.GetAsync($"/api/tickets?view=assigned&departmentId={Guid.NewGuid()}"));
            Assert.Contains(assignedHere.Items, t => t.Id == open.Id);
            Assert.Empty(assignedElsewhere.Items);
        }

        [Fact]
        public async Task People_see_their_own_categories_and_are_left_out_of_their_own_search()
        {
            var worker = await As("test.caseworker1");

            var mine = await Ok<List<MyCategoriesDto>>(await worker.GetAsync("/api/catalogue/mine"));
            var none = await Ok<List<MyCategoriesDto>>(await (await As("test.requester")).GetAsync("/api/catalogue/mine"));
            var search = await Ok<List<PersonSearchResultDto>>(await worker.GetAsync("/api/people/search?query=caseworker"));

            var unit = Assert.Single(mine);
            Assert.Equal(OrgSeed.ContributionMatchingUnitId, unit.UnitId);
            Assert.True(unit.Categories.Count >= 15);
            Assert.Empty(none);
            Assert.DoesNotContain(search, p => p.UserName == "test.caseworker1");
            Assert.Contains(search, p => p.UserName == "test.caseworker2");
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

    Write-Host '3/4 Creating the Workflow migration (status history and workflow fields)...'
    $o = Invoke-Dotnet @('tool', 'run', 'dotnet-ef', 'migrations', 'add', 'Workflow', '--project', $projPath, '--startup-project', $projPath,
                         '--output-dir', 'Infrastructure\Persistence\Migrations', '--no-build')
    if ($script:lastExit -ne 0) { $o | Select-Object -Last 25 | ForEach-Object { Write-Host "  $_" }; throw 'dotnet ef migrations add failed.' }
    if (-not (Get-ChildItem $migrationsDir -Filter '*_Workflow.cs' -ErrorAction SilentlyContinue)) { throw 'The migration file was not created.' }

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
    Write-Host 'Done. Step 6 is in place.' -ForegroundColor Green
    Write-Host 'Start the API once: it adds the TicketStatusChanges table and the workflow fields.'
    Write-Host 'In Swagger as the assignee of a ticket: GET /api/tickets/{id}/actions, then POST acknowledge, pending, resolve.'
    Write-Host 'As test.requester: confirm or reopen it.'
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
