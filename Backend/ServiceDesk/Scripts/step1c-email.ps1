# Step 1c - Email: Infobip, SMTP or Off; the People Hub branded layout; email copies of notifications; Super Admin email page.
# Ported from People Hub (ELM). Code only: EmailLayout.cs is copied from ELM with its namespace renamed and checked for
# written-in secrets. No People Hub key is read or used: the Service Desk's own key goes in with set-secrets.ps1 -Email.
#
# What it adds:
#   - IEmailService with Infobip / Smtp / Off providers (EmailSettings:Provider; Off until you set it up)
#   - Every saved notification is also emailed to the person (after the save succeeds; switch: EmailSettings:Notifications)
#   - Customer-data guard: anything shaped like an RSA PIN is masked in every email
#   - GET api/admin/email/status and POST api/admin/email/test (Super Admin only; the key is never shown)
#   - Tests (no email is really sent: the tests record them)
#
# Run from C:\Users\<you>\Desktop\PRO\ServiceDesk with the API stopped:
#   .\Scripts\step1c-email.ps1
# No database change in this step. On any failure, every file is put back as it was.

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
$sln = @(Get-ChildItem $root -File | Where-Object { $_.Name -like '*.sln' -or $_.Name -like '*.slnx' })[0].FullName
$settingsPath = Join-Path $api 'appsettings.json'
$elmLayout = Join-Path $ElmRoot 'EmployeeLCAPI\Infrastructure\Email\EmailLayout.cs'
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
if (-not (Test-Path (Join-Path $api 'Domain\Entities\AuditLog.cs'))) { Write-Host 'Step 1b is not in place. Run step1b-audit-security-notifications.ps1 first.' -ForegroundColor Red; return }
if (Test-Path (Join-Path $api 'Infrastructure\Email\EmailLayout.cs')) { Write-Host 'EmailLayout.cs already exists: Step 1c looks applied. Nothing changed.' -ForegroundColor Yellow; return }
$expected = [ordered]@{
    'ServiceDeskAPI\Program.cs' = 'ba491e671217151e62f8fcbb421865d49403dc6a84f257e264152edae05a7fc1'
    'tests\ServiceDeskAPI.Tests\Infrastructure\ServiceDeskApiFactory.cs' = 'ab588297f5f4576d6484f6ab869ca89711a80948ab23bf901f94305d853acfda'
}
$changedByYou = @()
foreach ($rel in $expected.Keys) {
    $full = Join-Path $root $rel
    if (-not (Test-Path $full)) { $changedByYou += "$rel (missing)"; continue }
    if ((Get-NormHash $full) -ne $expected[$rel]) { $changedByYou += $rel }
}
if ($changedByYou.Count -gt 0) {
    Write-Host 'These files were changed after Step 1b, so Step 1c stopped to avoid overwriting your changes:' -ForegroundColor Red
    $changedByYou | ForEach-Object { Write-Host "    $_" }
    Write-Host 'Send me those files.'
    return
}
$settingsOld = [System.IO.File]::ReadAllText($settingsPath)
if ($settingsOld -match '"EmailSettings"') { Write-Host 'appsettings.json already has EmailSettings. Nothing changed; send me appsettings.json.' -ForegroundColor Red; return }
$frontendAnchor = [regex]::Match($settingsOld, '(?m)^([ \t]*)"Frontend"\s*:\s*\{')
if (-not $frontendAnchor.Success) { Write-Host 'appsettings.json has no "Frontend" section to place EmailSettings before. Send me appsettings.json.' -ForegroundColor Red; return }

# ---- EmailLayout: code only, from People Hub ----
if (-not (Test-Path $elmLayout)) { Write-Host "People Hub's EmailLayout.cs was not found at $elmLayout (pass -ElmRoot)." -ForegroundColor Red; return }
$layoutText = [System.IO.File]::ReadAllText($elmLayout)
if ($layoutText -notmatch 'namespace EmployeeLCAPI\.Infrastructure\.Email') { Write-Host 'EmailLayout.cs in ELM has a different namespace than expected. Send me the file.' -ForegroundColor Red; return }
$layoutText = $layoutText.Replace('namespace EmployeeLCAPI.Infrastructure.Email', 'namespace ServiceDeskAPI.Infrastructure.Email')
if ($layoutText -match 'EmployeeLCAPI') { Write-Host 'EmailLayout.cs still refers to EmployeeLCAPI after renaming. Send me the file.' -ForegroundColor Red; return }
foreach ($probe in @('class EmailBlock', 'class EmailContent', 'public static string RenderHtml(EmailContent content', 'public static string RenderText(EmailContent content', 'public static string HtmlToText(string html)')) {
    if (-not $layoutText.Contains($probe)) { Write-Host "EmailLayout.cs in ELM no longer contains '$probe'. Send me the file." -ForegroundColor Red; return }
}
$leaks = [regex]::Matches($layoutText, '(?im)^.*\b\w*(Password|Pwd|Secret|ApiKey|Token)\w*\s*=\s*"[^"]+".*$')
if ($leaks.Count -gt 0) {
    Write-Host 'EmailLayout.cs in ELM contains what looks like a written-in secret, so it was not copied. Lines:' -ForegroundColor Red
    $leaks | ForEach-Object { Write-Host ('    ' + $_.Value.Trim()) }
    return
}

$indent = $frontendAnchor.Groups[1].Value
$emailBlock = @'
"EmailSettings": {
  "Provider": "Off",
  "Infobip": {
    "BaseUrl": "",
    "SenderEmail": "",
    "SenderName": ""
  },
  "Smtp": {
    "Host": "",
    "Port": 587,
    "EnableSsl": true,
    "SenderEmail": "",
    "SenderName": ""
  },
  "Brand": {
    "CompanyName": "Access Pensions",
    "LegalName": "Access ARM Pensions Plc",
    "TeamName": "Contribution Processing",
    "AppName": "Access Pensions Service Desk",
    "LogoUrl": "",
    "PrimaryColor": "#003883",
    "AccentColor": "#FF8200",
    "SecondaryColor": "#8DC63F",
    "SupportEmail": "servicedesk@accesspensions.ng"
  },
  "Notifications": {
    "Enabled": true,
    "ExcludeCategories": ""
  }
},
'@
$emailBlock = ($emailBlock.Replace("`r`n", "`n").TrimEnd("`n").Split("`n") | ForEach-Object { $indent + $_ }) -join "`r`n"
$settingsNew = $settingsOld.Insert($frontendAnchor.Index, $emailBlock + "`r`n")

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
$files['ServiceDeskAPI\Application\DTOs\EmailAttachment.cs'] = @'
namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A file sent with an email (for example an exported report).</summary>
    public sealed record EmailAttachment(string FileName, byte[] Content, string ContentType = "application/octet-stream");
}
'@
$files['ServiceDeskAPI\Application\Interfaces\IEmailService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Sends one finished email (copied from People Hub, without the HR-specific messages). What the emails say is in
    /// EmailTemplates and NotificationEmail; how they look is in EmailLayout. Sending never throws: the result says whether it worked.
    /// </summary>
    public interface IEmailService
    {
        Task<(bool Success, string Message)> SendEmailAsync(string to, string subject, string htmlBody);

        Task<(bool Success, string Message)> SendEmailWithAttachmentsAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment> attachments);
    }
}
'@
$files['ServiceDeskAPI\Controllers\AdminEmailController.cs'] = @'
using System.Net.Mail;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
        public IActionResult Status()
        {
            var provider = EmailSetup.Provider(_configuration);
            var infobip = _configuration.GetSection("EmailSettings:Infobip");
            var smtp = _configuration.GetSection("EmailSettings:Smtp");
            var keySet = InfobipEmailService.ApiKey(_configuration).Length > 0;
            var infobipReady = keySet && !string.IsNullOrWhiteSpace(infobip["BaseUrl"]) && !string.IsNullOrWhiteSpace(infobip["SenderEmail"]);
            var smtpReady = !string.IsNullOrWhiteSpace(smtp["Host"]) && !string.IsNullOrWhiteSpace(smtp["SenderEmail"]);
            return Ok(new
            {
                provider,
                infobip = new { baseUrl = infobip["BaseUrl"], senderEmail = infobip["SenderEmail"], senderName = infobip["SenderName"], apiKeyConfigured = keySet },
                smtp = new { host = smtp["Host"], port = smtp["Port"], senderEmail = smtp["SenderEmail"], signsIn = !string.IsNullOrWhiteSpace(smtp["Username"]) },
                notificationEmails = !string.Equals(_configuration["EmailSettings:Notifications:Enabled"], "false", StringComparison.OrdinalIgnoreCase),
                ready = provider switch { "Infobip" => infobipReady, "Smtp" => smtpReady, _ => false }
            });
        }

        /// <summary>Sends one test message. Always answers 200 with success and a message, so the page can show it.</summary>
        [HttpPost("test")]
        public async Task<IActionResult> Test([FromBody] SendTestEmailRequest request)
        {
            var to = (request?.To ?? string.Empty).Trim();
            if (to.Length == 0 || !MailAddress.TryCreate(to, out _))
                return BadRequest(new { message = "Enter a valid email address", errors = new { to = "Enter a valid email address" } });

            var actor = AuditActor.From(HttpContext);
            var parts = EmailTemplates.Test(actor.DisplayName ?? "a Super Admin");
            var (success, message) = await _email.SendEmailAsync(to, parts.Subject, parts.Html);

            await _audit.LogAsync(actor.UserId, actor.DisplayName, AuditAction.Created, "TestEmail", Guid.NewGuid(), to,
                null, "{\"success\":" + (success ? "true" : "false") + "}", actor.IpAddress, actor.UserAgent, AuditModule.Notifications);
            return Ok(new { success, message });
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\EmailBrand.cs'] = @'
using System.Text.RegularExpressions;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// How the emails look and who they come from (copied from People Hub, Service Desk defaults). Read at start-up from
    /// EmailSettings:Brand. Colours and addresses are checked, so a bad setting falls back to the default instead of breaking the layout.
    /// </summary>
    public sealed class EmailBrand
    {
        public string CompanyName { get; init; } = "Access Pensions";
        public string LegalName { get; init; } = "Access ARM Pensions Plc";
        /// <summary>Signs the emails and is the default sender name.</summary>
        public string TeamName { get; init; } = "Contribution Processing";
        /// <summary>The application name in the header and in automatic-message footers.</summary>
        public string AppName { get; init; } = "Access Pensions Service Desk";
        /// <summary>Public address of the logo image (PNG). Empty means a text wordmark.</summary>
        public string LogoUrl { get; init; } = string.Empty;
        public string PrimaryColor { get; init; } = "#003883";
        public string AccentColor { get; init; } = "#FF8200";
        public string SecondaryColor { get; init; } = "#8DC63F";
        /// <summary>Kept for compatibility with the People Hub layout; not used by the Service Desk.</summary>
        public string CareersUrl { get; init; } = string.Empty;
        /// <summary>Shown in the footer as the address to tell if a message arrived by mistake. Set EmailSettings:Brand:SupportEmail.</summary>
        public string SupportEmail { get; init; } = "servicedesk@accesspensions.ng";

        /// <summary>The brand used by every email. Set once at start-up; the defaults apply until then.</summary>
        public static EmailBrand Current { get; set; } = new EmailBrand();

        private static readonly Regex Colour = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);

        public static EmailBrand FromConfiguration(IConfiguration configuration)
        {
            var section = configuration.GetSection("EmailSettings:Brand");
            var d = new EmailBrand();

            string Text(string key, string fallback)
            {
                var value = section[key];
                return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
            }
            string Hex(string key, string fallback)
            {
                var value = section[key];
                return !string.IsNullOrWhiteSpace(value) && Colour.IsMatch(value.Trim()) ? value.Trim() : fallback;
            }
            string Url(string key, string fallback)
            {
                var value = section[key];
                if (string.IsNullOrWhiteSpace(value)) return fallback;
                return Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
                    ? uri.ToString() : fallback;
            }

            return new EmailBrand
            {
                CompanyName = Text("CompanyName", d.CompanyName),
                LegalName = Text("LegalName", d.LegalName),
                TeamName = Text("TeamName", d.TeamName),
                AppName = Text("AppName", d.AppName),
                LogoUrl = Url("LogoUrl", string.Empty),
                PrimaryColor = Hex("PrimaryColor", d.PrimaryColor),
                AccentColor = Hex("AccentColor", d.AccentColor),
                SecondaryColor = Hex("SecondaryColor", d.SecondaryColor),
                CareersUrl = Url("CareersUrl", d.CareersUrl),
                SupportEmail = Text("SupportEmail", d.SupportEmail)
            };
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\EmailServiceBase.cs'] = @'
using System.Net.Mail;
using System.Text.RegularExpressions;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// What every provider shares: the recipient check and the customer-data guard. A provider only delivers the finished message.
    /// </summary>
    public abstract class EmailServiceBase : IEmailService
    {
        public Task<(bool Success, string Message)> SendEmailAsync(string to, string subject, string htmlBody)
            => SendCoreAsync(to, subject, htmlBody, null);

        public Task<(bool Success, string Message)> SendEmailWithAttachmentsAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment> attachments)
            => SendCoreAsync(to, subject, htmlBody, attachments);

        private Task<(bool Success, string Message)> SendCoreAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            var recipient = (to ?? string.Empty).Trim();
            if (recipient.Length == 0 || !MailAddress.TryCreate(recipient, out _))
                return Task.FromResult((false, "The recipient address is not valid"));
            return DeliverAsync(recipient, EmailSafety.Redact(subject ?? string.Empty), EmailSafety.Redact(htmlBody ?? string.Empty), attachments);
        }

        /// <summary>Delivers one message. Must not throw.</summary>
        protected abstract Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments);
    }

    /// <summary>
    /// Agent rule 3: customer data never goes into an email. As a last line of defence, anything shaped like an RSA PIN
    /// (PEN followed by 12 digits) is masked in the subject and body before any provider sees it.
    /// </summary>
    public static class EmailSafety
    {
        private static readonly Regex RsaPin = new(@"\bPEN\d{12}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

        public static string Redact(string text) => RsaPin.Replace(text, "PEN************");
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\EmailSetup.cs'] = @'
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// Picks the email provider from EmailSettings:Provider when the service is first needed: Infobip, Smtp, or Off (the default,
    /// until email is set up). Read at run time, so a settings change applies on the next start without code changes.
    /// </summary>
    public static class EmailSetup
    {
        public static string Provider(IConfiguration configuration)
        {
            var value = (configuration["EmailSettings:Provider"] ?? string.Empty).Trim();
            if (value.Equals("Infobip", StringComparison.OrdinalIgnoreCase)) return "Infobip";
            if (value.Equals("Smtp", StringComparison.OrdinalIgnoreCase)) return "Smtp";
            return "Off";
        }

        public static IEmailService Create(IServiceProvider services)
        {
            var configuration = services.GetRequiredService<IConfiguration>();
            return Provider(configuration) switch
            {
                "Infobip" => new InfobipEmailService(
                    services.GetRequiredService<IHttpClientFactory>().CreateClient(InfobipEmailService.HttpClientName),
                    configuration,
                    services.GetRequiredService<ILogger<InfobipEmailService>>()),
                "Smtp" => new SmtpEmailService(configuration, services.GetRequiredService<ILogger<SmtpEmailService>>()),
                _ => new NullEmailService(services.GetRequiredService<ILogger<NullEmailService>>())
            };
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\EmailTemplates.cs'] = @'
using System.Globalization;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>A finished email: subject, HTML and plain text.</summary>
    public sealed record EmailMessageParts(string Subject, string Html, string Text);

    /// <summary>
    /// The wording of the Service Desk's own emails (copied from People Hub's EmailTemplates; the HR messages were left out).
    /// Ticket emails are added in Step 8. Change the words here; the look is in EmailLayout.
    /// </summary>
    public static class EmailTemplates
    {
        private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-GB");

        /// <summary>A stored UTC time written in Lagos time (WAT, UTC+1, no daylight saving), as the BRD requires.</summary>
        public static string LagosText(DateTime utc) => utc.AddHours(1).ToString("dddd, d MMMM yyyy 'at' HH:mm", Culture) + " WAT";

        public static EmailMessageParts Build(EmailContent content, EmailBrand? brand = null)
            => new(content.Subject, EmailLayout.RenderHtml(content, brand), EmailLayout.RenderText(content, brand));

        public static EmailMessageParts Test(string requestedBy, EmailBrand? brand = null)
        {
            var b = brand ?? EmailBrand.Current;
            return Build(new EmailContent
            {
                Subject = "Test email from " + b.AppName,
                Heading = "Email is working",
                Preheader = "This is a test message from " + b.AppName + ".",
                Greeting = "Hello,",
                Automatic = true,
                Blocks =
                {
                    EmailBlock.Callout("Your " + b.AppName + " email setup works. This message was sent by **" + requestedBy + "** as a test.", "success"),
                    EmailBlock.Details(("Sent by", requestedBy), ("Sent at", LagosText(DateTime.UtcNow)))
                }
            }, b);
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\InfobipEmailService.cs'] = @'
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// Sends email through Infobip (Email API v3), ported from People Hub. Settings: EmailSettings:Infobip:BaseUrl, SenderEmail, SenderName.
    /// The API key is the Service Desk's own: EmailSettings:Infobip:ApiKey (user secrets, via set-secrets.ps1 -Email) or the
    /// SERVICEDESK_INFOBIP_API_KEY environment variable on a server. People Hub's INFOBIP_API_KEY is never read.
    /// The key is never written to a file, a log or a response. Sending never throws.
    /// </summary>
    public class InfobipEmailService : EmailServiceBase
    {
        public const string HttpClientName = "infobip";
        public const string ApiKeyVariable = "SERVICEDESK_INFOBIP_API_KEY";

        private readonly HttpClient _http;
        private readonly ILogger<InfobipEmailService> _logger;
        private readonly string _baseUrl;
        private readonly string _senderEmail;
        private readonly string _senderName;
        private readonly string _apiKey;

        public InfobipEmailService(HttpClient http, IConfiguration configuration, ILogger<InfobipEmailService> logger)
        {
            _http = http;
            _logger = logger;

            var section = configuration.GetSection("EmailSettings:Infobip");
            _baseUrl = (section["BaseUrl"] ?? string.Empty).Trim()
                .Replace("https://", string.Empty, StringComparison.OrdinalIgnoreCase)
                .Replace("http://", string.Empty, StringComparison.OrdinalIgnoreCase)
                .TrimEnd('/');
            _senderEmail = (section["SenderEmail"] ?? string.Empty).Trim();
            var senderName = (section["SenderName"] ?? string.Empty).Trim();
            _senderName = senderName.Length > 0 ? senderName : EmailBrand.Current.TeamName;
            _apiKey = ApiKey(configuration);
        }

        /// <summary>The Service Desk's own key: settings first, then SERVICEDESK_INFOBIP_API_KEY.</summary>
        public static string ApiKey(IConfiguration configuration)
        {
            var fromSettings = configuration["EmailSettings:Infobip:ApiKey"];
            if (!string.IsNullOrWhiteSpace(fromSettings)) return fromSettings.Trim();
            return (Environment.GetEnvironmentVariable(ApiKeyVariable) ?? string.Empty).Trim();
        }

        protected override async Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(_apiKey))
                    return Fail("Infobip is not set up: the Service Desk API key is missing (run set-secrets.ps1 -Email, or set " + ApiKeyVariable + ")");
                if (string.IsNullOrWhiteSpace(_baseUrl) || string.IsNullOrWhiteSpace(_senderEmail))
                    return Fail("Infobip is not set up: the base URL or sender address is missing");

                using var form = new MultipartFormDataContent();
                form.Add(new StringContent(_senderName + " <" + _senderEmail + ">", Encoding.UTF8), "from");
                form.Add(new StringContent(to, Encoding.UTF8), "to");
                form.Add(new StringContent(subject, Encoding.UTF8), "subject");
                form.Add(new StringContent(htmlBody, Encoding.UTF8), "html");
                form.Add(new StringContent(EmailLayout.HtmlToText(htmlBody), Encoding.UTF8), "text");
                foreach (var file in attachments ?? Array.Empty<EmailAttachment>())
                {
                    var part = new ByteArrayContent(file.Content);
                    part.Headers.ContentType = new MediaTypeHeaderValue(file.ContentType);
                    form.Add(part, "attachment", file.FileName);
                }

                using var request = new HttpRequestMessage(HttpMethod.Post, "https://" + _baseUrl + "/email/3/send") { Content = form };
                request.Headers.Authorization = new AuthenticationHeaderValue("App", _apiKey);
                request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

                using var response = await _http.SendAsync(request);
                var body = await response.Content.ReadAsStringAsync();

                if (!response.IsSuccessStatusCode)
                {
                    var detail = Shorten(body);
                    _logger.LogWarning("Infobip refused the email to {Email} ({Status}): {Detail}", to, (int)response.StatusCode, detail);
                    return (false, "Infobip refused the email (" + (int)response.StatusCode + "): " + detail);
                }

                // 200 means Infobip accepted the request. A message-level status can still say it was rejected.
                var rejected = RejectedReason(body);
                if (rejected != null)
                {
                    _logger.LogWarning("Infobip rejected the email to {Email}: {Detail}", to, rejected);
                    return (false, "Infobip rejected the email: " + rejected);
                }

                _logger.LogInformation("Email accepted by Infobip for {Email} with subject '{Subject}'", to, subject);
                return (true, "Email sent");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Sending an email through Infobip failed");
                return (false, "Failed to send email: " + ex.Message);
            }
        }

        private (bool, string) Fail(string message)
        {
            _logger.LogWarning("Email not sent: {Message}", message);
            return (false, message);
        }

        private static string Shorten(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return "no details";
            var flat = text.Replace("\r", " ").Replace("\n", " ").Trim();
            return flat.Length <= 300 ? flat : flat.Substring(0, 300) + "...";
        }

        private static string? RejectedReason(string body)
        {
            try
            {
                using var doc = JsonDocument.Parse(body);
                if (!doc.RootElement.TryGetProperty("messages", out var messages) || messages.ValueKind != JsonValueKind.Array) return null;
                foreach (var message in messages.EnumerateArray())
                {
                    if (!message.TryGetProperty("status", out var status)) continue;
                    var group = status.TryGetProperty("groupName", out var g) ? g.GetString() : null;
                    if (string.Equals(group, "REJECTED", StringComparison.OrdinalIgnoreCase) || string.Equals(group, "UNDELIVERABLE", StringComparison.OrdinalIgnoreCase))
                        return status.TryGetProperty("description", out var d) ? d.GetString() ?? group : group;
                }
            }
            catch (JsonException)
            {
                // Not JSON: the HTTP status already said it worked.
            }
            return null;
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\NotificationMail.cs'] = @'
using System.Runtime.CompilerServices;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>One in-app notification that should also reach the person's inbox (copied from People Hub).</summary>
    public sealed record NotificationMail(Guid UserId, string Title, string Message, NotificationType Type, NotificationCategory Category, string? Link)
    {
        public static NotificationMail From(InAppNotification n) => new(n.RecipientUserId, n.Title, n.Message, n.Type, n.Category, n.DeepLinkUrl);
    }

    /// <summary>Holds notifications waiting to be emailed. Best effort and in memory: the in-app copy is the record.</summary>
    public sealed class NotificationMailQueue
    {
        private readonly Channel<NotificationMail> _channel = Channel.CreateBounded<NotificationMail>(
            new BoundedChannelOptions(5000) { FullMode = BoundedChannelFullMode.DropWrite, SingleReader = true });

        public bool Enqueue(NotificationMail mail) => _channel.Writer.TryWrite(mail);

        public IAsyncEnumerable<NotificationMail> ReadAllAsync(CancellationToken cancellationToken) => _channel.Reader.ReadAllAsync(cancellationToken);
    }

    /// <summary>
    /// Watches every save. Notifications added in the save are queued for email only after the save succeeded,
    /// so nobody is emailed about something that was rolled back.
    /// </summary>
    public sealed class NotificationMailInterceptor : SaveChangesInterceptor
    {
        private readonly NotificationMailQueue _queue;
        private readonly ConditionalWeakTable<DbContext, List<NotificationMail>> _pending = new();

        public NotificationMailInterceptor(NotificationMailQueue queue) => _queue = queue;

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
            Flush(eventData.Context);
            return result;
        }

        public override ValueTask<int> SavedChangesAsync(SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            Flush(eventData.Context);
            return ValueTask.FromResult(result);
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData) => Discard(eventData.Context);

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
        {
            Discard(eventData.Context);
            return Task.CompletedTask;
        }

        private void Collect(DbContext? context)
        {
            if (context == null) return;
            var list = _pending.GetOrCreateValue(context);
            list.Clear();
            foreach (var entry in context.ChangeTracker.Entries<InAppNotification>())
                if (entry.State == EntityState.Added)
                    list.Add(NotificationMail.From(entry.Entity));
        }

        private void Flush(DbContext? context)
        {
            if (context == null || !_pending.TryGetValue(context, out var list)) return;
            foreach (var mail in list) _queue.Enqueue(mail);
            list.Clear();
        }

        private void Discard(DbContext? context)
        {
            if (context != null && _pending.TryGetValue(context, out var list)) list.Clear();
        }
    }

    /// <summary>Settings: EmailSettings:Notifications:Enabled (default true) and :ExcludeCategories (comma list, for example "Report,System").</summary>
    public static class NotificationMailPolicy
    {
        public static bool ShouldSend(IConfiguration config, NotificationCategory category)
        {
            var enabled = config["EmailSettings:Notifications:Enabled"];
            if (!string.IsNullOrWhiteSpace(enabled) && enabled.Trim().Equals("false", StringComparison.OrdinalIgnoreCase)) return false;
            var excluded = (config["EmailSettings:Notifications:ExcludeCategories"] ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            return !excluded.Any(x => x.Equals(category.ToString(), StringComparison.OrdinalIgnoreCase));
        }
    }

    /// <summary>The wording of the email copy of a notification. The look comes from EmailLayout.</summary>
    public static class NotificationEmail
    {
        /// <summary>Turns an in-app route such as /tickets/123 into a full address. Full addresses are kept as they are.</summary>
        public static string? LinkFor(string? link, string frontendUrl)
        {
            if (string.IsNullOrWhiteSpace(link)) return null;
            var value = link.Trim();
            if (value.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || value.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                return value;
            return frontendUrl.TrimEnd('/') + (value.StartsWith('/') ? value : "/" + value);
        }

        private static string FirstName(string? name) =>
            (name ?? string.Empty).Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;

        public static EmailMessageParts Build(string recipientName, string title, string message, NotificationType type,
            NotificationCategory category, string? link, string frontendUrl, EmailBrand? brand = null)
        {
            var b = brand ?? EmailBrand.Current;
            var preview = message.Length > 140 ? message.Substring(0, 140) + "..." : message;
            var blocks = new List<EmailBlock> { EmailBlock.Paragraph(message) };
            if (type == NotificationType.ActionRequired)
                blocks.Add(EmailBlock.Callout("**Action needed.** Please open the ticket and complete your part.", "warning"));
            else if (type == NotificationType.Warning)
                blocks.Add(EmailBlock.Callout("Please review this when you can.", "warning"));
            var url = LinkFor(link, frontendUrl);
            if (url != null) blocks.Add(EmailBlock.Button("Open in " + b.AppName, url));
            blocks.Add(EmailBlock.Note("You are receiving this because you have a part in this ticket. This is an automatic message."));

            var first = FirstName(recipientName);
            return EmailTemplates.Build(new EmailContent
            {
                Subject = (type == NotificationType.ActionRequired ? "Action required: " : string.Empty) + title,
                Heading = title,
                Preheader = preview,
                Greeting = first.Length > 0 ? "Hello " + first + "," : "Hello,",
                Automatic = true,
                Blocks = blocks
            }, b);
        }
    }

    /// <summary>Sends the queued notification emails one by one in the background. A failure is logged and never reaches the caller.</summary>
    public sealed class NotificationMailWorker : BackgroundService
    {
        private readonly NotificationMailQueue _queue;
        private readonly IServiceScopeFactory _scopes;
        private readonly IConfiguration _config;
        private readonly ILogger<NotificationMailWorker> _logger;

        public NotificationMailWorker(NotificationMailQueue queue, IServiceScopeFactory scopes, IConfiguration config, ILogger<NotificationMailWorker> logger)
        {
            _queue = queue;
            _scopes = scopes;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            try
            {
                await foreach (var mail in _queue.ReadAllAsync(stoppingToken))
                {
                    try { await SendAsync(mail, stoppingToken); }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
                    catch (Exception ex) { _logger.LogWarning(ex, "A notification email could not be sent."); }
                }
            }
            catch (OperationCanceledException)
            {
                // The app is stopping.
            }
        }

        private async Task SendAsync(NotificationMail mail, CancellationToken ct)
        {
            if (!NotificationMailPolicy.ShouldSend(_config, mail.Category)) return;

            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var person = await db.Users.AsNoTracking()
                .Where(u => u.Id == mail.UserId && u.IsActive)
                .Select(u => new { u.FullName, u.UserName, u.CorporateEmail, u.Email })
                .FirstOrDefaultAsync(ct);
            if (person == null) return;

            var to = (!string.IsNullOrWhiteSpace(person.CorporateEmail) ? person.CorporateEmail : person.Email)?.Trim();
            if (string.IsNullOrWhiteSpace(to) || !to.Contains('@')) return;

            var frontend = (_config["Frontend:Url"] ?? "http://localhost:5174").Split(',')[0].Trim();
            var parts = NotificationEmail.Build(person.FullName ?? person.UserName ?? string.Empty, mail.Title, mail.Message, mail.Type, mail.Category, mail.Link, frontend);

            var email = scope.ServiceProvider.GetRequiredService<IEmailService>();
            var (ok, message) = await email.SendEmailAsync(to, parts.Subject, parts.Html);
            if (!ok)
                _logger.LogWarning("The notification email to user {UserId} was not sent: {Message}", mail.UserId, message);
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\NullEmailService.cs'] = @'
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>Used when EmailSettings:Provider is Off (the default until email is set up). Nothing is sent; callers are told so and carry on.</summary>
    public class NullEmailService : EmailServiceBase
    {
        private readonly ILogger<NullEmailService> _logger;

        public NullEmailService(ILogger<NullEmailService> logger) => _logger = logger;

        protected override Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            _logger.LogInformation("Email sending is switched off (EmailSettings:Provider). Not sent: '{Subject}'", subject);
            return Task.FromResult((false, "Email sending is switched off"));
        }
    }
}
'@
$files['ServiceDeskAPI\Infrastructure\Email\SmtpEmailService.cs'] = @'
using System.Net;
using System.Net.Mail;
using System.Net.Mime;
using System.Text;
using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Email
{
    /// <summary>
    /// SMTP delivery (EmailSettings:Provider = Smtp), ported from People Hub. Settings: EmailSettings:Smtp:Host, Port, EnableSsl,
    /// SenderEmail, SenderName, and optionally Username/Password (user secrets) or SERVICEDESK_SMTP_USERNAME / SERVICEDESK_SMTP_PASSWORD.
    /// Without a username it sends without signing in (an internal relay). There is no built-in host: an empty Host means not set up.
    /// </summary>
    public class SmtpEmailService : EmailServiceBase
    {
        public const string UsernameVariable = "SERVICEDESK_SMTP_USERNAME";
        public const string PasswordVariable = "SERVICEDESK_SMTP_PASSWORD";

        private readonly ILogger<SmtpEmailService> _logger;
        private readonly string _senderEmail;
        private readonly string _senderName;
        private readonly string _host;
        private readonly int _port;
        private readonly bool _enableSsl;
        private readonly string _username;
        private readonly string _password;

        public SmtpEmailService(IConfiguration configuration, ILogger<SmtpEmailService> logger)
        {
            _logger = logger;
            var s = configuration.GetSection("EmailSettings:Smtp");
            _senderEmail = (s["SenderEmail"] ?? string.Empty).Trim();
            var senderName = (s["SenderName"] ?? string.Empty).Trim();
            _senderName = senderName.Length > 0 ? senderName : EmailBrand.Current.TeamName;
            _host = (s["Host"] ?? string.Empty).Trim();
            _port = int.TryParse(s["Port"], out var port) ? port : 587;
            _enableSsl = !bool.TryParse(s["EnableSsl"], out var ssl) || ssl;
            _username = FirstFilled(s["Username"], Environment.GetEnvironmentVariable(UsernameVariable));
            _password = FirstFilled(s["Password"], Environment.GetEnvironmentVariable(PasswordVariable));
        }

        private static string FirstFilled(string? a, string? b) => !string.IsNullOrWhiteSpace(a) ? a.Trim() : (b ?? string.Empty).Trim();

        protected override async Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
        {
            if (_host.Length == 0 || _senderEmail.Length == 0)
            {
                _logger.LogWarning("Email not sent: SMTP is not set up (EmailSettings:Smtp:Host or SenderEmail is empty)");
                return (false, "SMTP is not set up: the host or sender address is missing");
            }

            try
            {
                using var client = new SmtpClient(_host, _port) { EnableSsl = _enableSsl };
                if (_username.Length > 0)
                    client.Credentials = new NetworkCredential(_username, _password);

                using var msg = new MailMessage
                {
                    From = new MailAddress(_senderEmail, _senderName),
                    Subject = subject,
                    SubjectEncoding = Encoding.UTF8,
                    BodyEncoding = Encoding.UTF8
                };
                msg.To.Add(new MailAddress(to));
                msg.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(EmailLayout.HtmlToText(htmlBody), Encoding.UTF8, MediaTypeNames.Text.Plain));
                msg.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(htmlBody, Encoding.UTF8, MediaTypeNames.Text.Html));
                foreach (var file in attachments ?? Array.Empty<EmailAttachment>())
                    msg.Attachments.Add(new Attachment(new MemoryStream(file.Content), file.FileName, file.ContentType));

                await client.SendMailAsync(msg);
                _logger.LogInformation("Email sent to {Email} with subject '{Subject}'", to, subject);
                return (true, "Email sent");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send email to {Email}", to);
                return (false, "Failed to send email: " + ex.Message);
            }
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Email\EmailTests.cs'] = @'
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Email
{
    /// <summary>Step 1c: email layout, safety rules, providers, notification emails and the Super Admin email page.</summary>
    public class EmailTests : IClassFixture<ServiceDeskApiFactory>
    {
        private readonly ServiceDeskApiFactory _factory;

        public EmailTests(ServiceDeskApiFactory factory) => _factory = factory;

        private static IConfiguration Config(params (string Key, string? Value)[] values) =>
            new ConfigurationBuilder().AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value))).Build();

        /// <summary>Records what a provider would deliver, after the shared checks of EmailServiceBase.</summary>
        private sealed class CapturingProvider : EmailServiceBase
        {
            public string? Subject;
            public string? Html;

            protected override Task<(bool Success, string Message)> DeliverAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment>? attachments)
            {
                Subject = subject;
                Html = htmlBody;
                return Task.FromResult((true, "captured"));
            }
        }

        [Fact]
        public void Names_and_messages_cannot_inject_markup()
        {
            var parts = NotificationEmail.Build("<script>alert(1)</script>", "Title <b>x</b>", "Body <img src=x onerror=alert(1)>",
                NotificationType.Info, NotificationCategory.Ticket, "/tickets/1", "https://servicedesk.test");

            Assert.DoesNotContain("<script>", parts.Html);
            Assert.DoesNotContain("<img src=x", parts.Html);
            Assert.Contains("https://servicedesk.test/tickets/1", parts.Html);
        }

        [Fact]
        public async Task An_RSA_PIN_never_leaves_in_an_email()
        {
            var provider = new CapturingProvider();

            var (ok, _) = await provider.SendEmailAsync("someone@test.invalid", "About PEN100012345678", "<p>Customer PEN100012345678 called</p>");

            Assert.True(ok);
            Assert.DoesNotContain("100012345678", provider.Subject);
            Assert.DoesNotContain("100012345678", provider.Html);
        }

        [Fact]
        public async Task An_invalid_recipient_is_refused_before_any_provider()
        {
            var provider = new CapturingProvider();
            var (ok, _) = await provider.SendEmailAsync("not-an-address", "Subject", "<p>Body</p>");
            Assert.False(ok);
            Assert.Null(provider.Html);
        }

        [Fact]
        public async Task Infobip_never_uses_the_People_Hub_key()
        {
            var old = Environment.GetEnvironmentVariable("INFOBIP_API_KEY");
            Environment.SetEnvironmentVariable("INFOBIP_API_KEY", "people-hub-key-must-not-be-used");
            try
            {
                var service = new InfobipEmailService(new HttpClient(),
                    Config(("EmailSettings:Infobip:BaseUrl", "example.invalid"), ("EmailSettings:Infobip:SenderEmail", "sd@test.invalid")),
                    NullLogger<InfobipEmailService>.Instance);

                var (ok, message) = await service.SendEmailAsync("someone@test.invalid", "Subject", "<p>Body</p>");

                Assert.False(ok);
                Assert.Contains("not set up", message);
            }
            finally
            {
                Environment.SetEnvironmentVariable("INFOBIP_API_KEY", old);
            }
        }

        [Fact]
        public async Task Smtp_without_a_host_is_reported_as_not_set_up()
        {
            var service = new SmtpEmailService(Config(("EmailSettings:Smtp:SenderEmail", "sd@test.invalid")), NullLogger<SmtpEmailService>.Instance);
            var (ok, message) = await service.SendEmailAsync("someone@test.invalid", "Subject", "<p>Body</p>");
            Assert.False(ok);
            Assert.Contains("not set up", message);
        }

        [Fact]
        public void The_provider_is_Off_unless_set()
        {
            Assert.Equal("Off", EmailSetup.Provider(Config()));
            Assert.Equal("Off", EmailSetup.Provider(Config(("EmailSettings:Provider", "something else"))));
            Assert.Equal("Infobip", EmailSetup.Provider(Config(("EmailSettings:Provider", "infobip"))));
            Assert.Equal("Smtp", EmailSetup.Provider(Config(("EmailSettings:Provider", "SMTP"))));
        }

        [Fact]
        public void Notification_emails_can_be_switched_off_or_limited_by_category()
        {
            Assert.True(NotificationMailPolicy.ShouldSend(Config(), NotificationCategory.Ticket));
            Assert.False(NotificationMailPolicy.ShouldSend(Config(("EmailSettings:Notifications:Enabled", "false")), NotificationCategory.Ticket));
            var limited = Config(("EmailSettings:Notifications:ExcludeCategories", "Report, System"));
            Assert.False(NotificationMailPolicy.ShouldSend(limited, NotificationCategory.Report));
            Assert.True(NotificationMailPolicy.ShouldSend(limited, NotificationCategory.Escalation));
        }

        [Fact]
        public async Task A_saved_notification_is_emailed_to_the_recipient()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker1");
            const string title = "Ticket CP-TEST assigned to you";
            using (var scope = _factory.Services.CreateScope())
            {
                scope.ServiceProvider.GetRequiredService<IInAppNotificationService>()
                    .Stage(me.UserId, title, "A new ticket is waiting for you.", NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", Guid.NewGuid(), "/tickets/test");
                await scope.ServiceProvider.GetRequiredService<AppDbContext>().SaveChangesAsync();
            }

            var mail = await _factory.Emails.WaitForAsync(m => m.Subject.Contains(title), TimeSpan.FromSeconds(15));

            Assert.NotNull(mail);
            Assert.Equal("test.caseworker1@test.invalid", mail!.To);
            Assert.StartsWith("Action required: ", mail.Subject);
        }

        [Fact]
        public async Task A_notification_that_was_not_saved_is_not_emailed()
        {
            var me = await ApiTestHelpers.SignInAsync(_factory, "test.caseworker2");
            const string title = "Rolled back notification";
            using (var scope = _factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                scope.ServiceProvider.GetRequiredService<IInAppNotificationService>()
                    .Stage(me.UserId, title, "Should never be sent.", NotificationType.Info, NotificationCategory.Ticket, null, null, null);
                // Same save fails on purpose: a role assignment for a role that does not exist breaks the foreign key.
                db.UserRoleAssignments.Add(new Domain.Entities.UserRoleAssignment { Id = Guid.NewGuid(), UserId = me.UserId, RoleId = Guid.NewGuid(), IsActive = true });
                await Assert.ThrowsAnyAsync<Exception>(() => db.SaveChangesAsync());
            }

            var mail = await _factory.Emails.WaitForAsync(m => m.Subject.Contains(title), TimeSpan.FromSeconds(3));
            Assert.Null(mail);
        }

        private HttpClient Bearer(string token)
        {
            var client = ApiTestHelpers.Client(_factory);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        [Fact]
        public async Task The_email_status_is_for_Super_Admin_only_and_never_shows_the_key()
        {
            var admin = await ApiTestHelpers.SignInAsync(_factory, "test.superadmin");
            var requester = await ApiTestHelpers.SignInAsync(_factory, "test.requester");

            var denied = await Bearer(requester.AccessToken).GetAsync("/api/admin/email/status");
            var allowed = await Bearer(admin.AccessToken).GetAsync("/api/admin/email/status");
            var body = await allowed.Content.ReadAsStringAsync();

            Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
            Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
            Assert.Contains("\"apiKeyConfigured\":true", body);
            Assert.DoesNotContain(ServiceDeskApiFactory.FakeEmailKey, body);
        }

        [Fact]
        public async Task A_Super_Admin_can_send_a_test_email()
        {
            var admin = await ApiTestHelpers.SignInAsync(_factory, "test.superadmin");

            var response = await Bearer(admin.AccessToken).PostAsJsonAsync("/api/admin/email/test", new { to = "check@test.invalid" });
            var bad = await Bearer(admin.AccessToken).PostAsJsonAsync("/api/admin/email/test", new { to = "nonsense" });

            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
            Assert.NotNull(await _factory.Emails.WaitForAsync(m => m.To == "check@test.invalid" && m.Subject.StartsWith("Test email from"), TimeSpan.FromSeconds(5)));
        }
    }
}
'@
$files['tests\ServiceDeskAPI.Tests\Infrastructure\RecordingEmailService.cs'] = @'
using System.Collections.Concurrent;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>Stands in for the email provider in API tests: keeps every message and reports it as sent.</summary>
    public class RecordingEmailService : IEmailService
    {
        public sealed record SentEmail(string To, string Subject, string Html);

        private readonly ConcurrentQueue<SentEmail> _sent = new();

        public IReadOnlyList<SentEmail> Sent => _sent.ToList();

        public Task<(bool Success, string Message)> SendEmailAsync(string to, string subject, string htmlBody)
        {
            _sent.Enqueue(new SentEmail(to, subject, htmlBody));
            return Task.FromResult((true, "Recorded"));
        }

        public Task<(bool Success, string Message)> SendEmailWithAttachmentsAsync(string to, string subject, string htmlBody, IReadOnlyList<EmailAttachment> attachments)
            => SendEmailAsync(to, subject, htmlBody);

        /// <summary>Waits (up to the timeout) for an email that matches; null if none arrives.</summary>
        public async Task<SentEmail?> WaitForAsync(Func<SentEmail, bool> match, TimeSpan timeout)
        {
            var until = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < until)
            {
                var hit = _sent.FirstOrDefault(match);
                if (hit != null) return hit;
                await Task.Delay(100);
            }
            return _sent.FirstOrDefault(match);
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
using ServiceDeskAPI.Application.Interfaces;
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
        public const string FakeEmailKey = "fake-key-for-tests-only-0000";

        /// <summary>Every email the API tried to send during this test class.</summary>
        public RecordingEmailService Emails { get; } = new();

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
                ["RateLimiting:Enabled"] = "false", // many sign-ins per minute in tests; RateLimitingTests checks the counter directly
                // Made-up values: the tests check that the status endpoint never shows the key. No real key is used.
                ["EmailSettings:Provider"] = "Infobip",
                ["EmailSettings:Infobip:ApiKey"] = FakeEmailKey,
                ["EmailSettings:Infobip:BaseUrl"] = "example.invalid",
                ["EmailSettings:Infobip:SenderEmail"] = "servicedesk@test.invalid"
            }));
            builder.ConfigureServices(services =>
            {
                // The tests seed the accounts themselves (below), so the background seeder is not needed.
                foreach (var d in services.Where(d => !d.IsKeyedService && d.ImplementationType == typeof(TestAccountSeeder)).ToList())
                    services.Remove(d);

                // Emails are recorded, never sent.
                foreach (var d in services.Where(d => d.ServiceType == typeof(IEmailService)).ToList())
                    services.Remove(d);
                services.AddSingleton(Emails);
                services.AddScoped<IEmailService>(sp => sp.GetRequiredService<RecordingEmailService>());
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
$files['ServiceDeskAPI\Infrastructure\Email\EmailLayout.cs'] = $layoutText

# ---------------- backups (for the automatic undo) ----------------
$backup = @{}
foreach ($rel in $files.Keys) {
    $full = Join-Path $root $rel
    $backup[$full] = if (Test-Path $full) { [System.IO.File]::ReadAllText($full) } else { $null }
}
$backup[$settingsPath] = $settingsOld

function Restore-All {
    foreach ($full in $backup.Keys) {
        if ($null -eq $backup[$full]) { if (Test-Path $full) { Remove-Item $full -Force } }
        else { [System.IO.File]::WriteAllText($full, $backup[$full], $utf8) }
    }
}

Push-Location $root
try {
    Write-Host ("1/3 Writing {0} source and test files, and copying EmailLayout.cs from People Hub (code only)..." -f $files.Count)
    foreach ($rel in $files.Keys) {
        $full = Join-Path $root $rel
        $dir = Split-Path $full -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $text = if ($rel -like '*EmailLayout.cs') { $files[$rel] } else { $files[$rel].Replace("`r`n", "`n").Replace("`n", "`r`n") }
        [System.IO.File]::WriteAllText($full, $text, $utf8)
    }

    Write-Host '2/3 Adding EmailSettings to appsettings.json (names and the provider Off; no keys)...'
    [System.IO.File]::WriteAllText($settingsPath, $settingsNew, $utf8)
    try { $null = $settingsNew | ConvertFrom-Json } catch { throw 'appsettings.json would not be valid JSON after the change.' }

    Write-Host '3/3 Building and running all tests (LocalDB; takes a minute)...'
    $b = Invoke-Dotnet @('build', $sln, '-nologo', '-v', 'q')
    if ($script:lastExit -ne 0) { $b | Where-Object { $_ -match ': error ' } | Select-Object -Unique -First 30 | ForEach-Object { Write-Host "  $_" }; throw 'Build failed.' }
    $t = Invoke-Dotnet @('test', $sln, '--no-build', '-nologo')
    $t | Where-Object { $_ -match 'Passed!|Failed!|^\s*Failed ' } | ForEach-Object { Write-Host "  $_" }
    if ($script:lastExit -ne 0) {
        $t | Where-Object { $_ -match 'Error Message|Assert|Exception' } | Select-Object -First 30 | ForEach-Object { Write-Host "  $_" }
        throw 'Tests failed.'
    }

    Write-Host ''
    Write-Host 'Done. Step 1c is in place. Email is Off until you set it up.' -ForegroundColor Green
    Write-Host 'When you have the Service Desk sender details: .\Scripts\set-secrets.ps1 -Email, restart the API,'
    Write-Host 'then sign in as test.superadmin in Swagger and use GET /api/admin/email/status and POST /api/admin/email/test.'
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
