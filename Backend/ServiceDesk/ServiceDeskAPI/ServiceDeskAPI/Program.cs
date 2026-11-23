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
                options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = ServiceDeskAPI.Infrastructure.AppBrand.Name + " API", Version = "v1" });
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
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.IHolidayService, ServiceDeskAPI.Infrastructure.Sla.HolidayService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.ICannedReplyService, ServiceDeskAPI.Infrastructure.Tickets.CannedReplyService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.ICategoryTemplateService, ServiceDeskAPI.Infrastructure.Tickets.CategoryTemplateService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.ITicketLinkService, ServiceDeskAPI.Infrastructure.Tickets.TicketLinkService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.ISlaPolicyService, ServiceDeskAPI.Infrastructure.Sla.SlaPolicyService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.IUnitToolsService, ServiceDeskAPI.Infrastructure.Organisation.UnitToolsService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.ISavedViewService, ServiceDeskAPI.Infrastructure.Tickets.SavedViewService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.IBulkTicketService, ServiceDeskAPI.Infrastructure.Tickets.BulkTicketService>();
builder.Services.AddScoped<ServiceDeskAPI.Application.Interfaces.ITicketReadService, ServiceDeskAPI.Infrastructure.Tickets.TicketReadService>();
builder.Services.AddHostedService<ServiceDeskAPI.Infrastructure.Sla.HolidayLoader>();
            builder.Services.AddScoped<IAssignmentService, ServiceDeskAPI.Infrastructure.Assignment.AssignmentService>();
            builder.Services.AddScoped<IWorkflowService, ServiceDeskAPI.Infrastructure.Tickets.WorkflowService>();
            builder.Services.AddHostedService<ServiceDeskAPI.Infrastructure.Assignment.AssignmentWorker>();
            builder.Services.AddOptions<ServiceDeskAPI.Infrastructure.Sla.SlaOptions>().BindConfiguration("Sla");
            builder.Services.AddScoped<ISlaService, ServiceDeskAPI.Infrastructure.Sla.SlaService>();
            builder.Services.AddHostedService<ServiceDeskAPI.Infrastructure.Sla.SlaWorker>();
            builder.Services.AddOptions<ServiceDeskAPI.Infrastructure.Digest.DigestOptions>().BindConfiguration("Digest");
            builder.Services.AddScoped<IDigestService, ServiceDeskAPI.Infrastructure.Digest.DigestService>();
            builder.Services.AddScoped<IReportService, ServiceDeskAPI.Infrastructure.Reports.ReportService>();
            builder.Services.AddScoped<ISavedReportService, ServiceDeskAPI.Infrastructure.Reports.SavedReportService>();
            builder.Services.AddHostedService<ServiceDeskAPI.Infrastructure.Digest.DigestWorker>();
            builder.Services.AddOptions<ServiceDeskAPI.Infrastructure.Reports.ReportScheduleOptions>().BindConfiguration("ReportSchedules");
            builder.Services.AddScoped<IReportScheduleService, ServiceDeskAPI.Infrastructure.Reports.ReportScheduleService>();
            builder.Services.AddScoped<IPriorityService, ServiceDeskAPI.Infrastructure.Tickets.PriorityService>();
            builder.Services.AddScoped<IReportRunner>(sp => (IReportRunner)sp.GetRequiredService<IReportService>());
            builder.Services.AddScoped<IPerformanceService, ServiceDeskAPI.Infrastructure.Performance.PerformanceService>();
            builder.Services.AddScoped<ICatalogueSuggestionService, ServiceDeskAPI.Infrastructure.Catalogue.CatalogueSuggestionService>();
            builder.Services.AddScoped<IDashboardService, ServiceDeskAPI.Infrastructure.Dashboard.DashboardService>();
            builder.Services.AddHostedService<ServiceDeskAPI.Infrastructure.Reports.ReportScheduleWorker>();
            builder.Services.AddSingleton(TimeProvider.System);
            builder.Services.AddScoped<IDirectoryService>(DirectorySetup.Create);

            // ============ EMAIL (Step 1c): Infobip, Smtp or Off, chosen from EmailSettings:Provider ============
            builder.Services.AddHttpClient(InfobipEmailService.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(30));
            builder.Services.AddScoped<IEmailService>(EmailSetup.Create);
            builder.Services.AddHostedService<NotificationEmailWorker>();

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