using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Identity;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Development-only test accounts that work next to Active Directory (copied from People Hub). Active only when the environment is
    /// Development, TestAccounts:Enabled is true and TestAccounts:Password is set (user secrets, via set-secrets.ps1).
    /// Creates local accounts with a local password and the listed roles. Safe to run on every start. Never touches an account it did not create.
    /// </summary>
    public class TestAccountSeeder : IHostedService
    {
        public sealed record TestAccountSpec(string UserName, string FullName, string Department, string[] Roles);

        public static readonly IReadOnlyList<TestAccountSpec> Accounts = new List<TestAccountSpec>
        {
            new("test.requester", "Test Requester", "Finance", new[] { AppRoles.Requester }),
            new("test.caseworker1", "Test Case Worker One", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.CaseWorker }),
            new("test.caseworker2", "Test Case Worker Two", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.CaseWorker }),
            new("test.hou", "Test Head of Unit", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.HeadOfUnit }),
            new("test.hod", "Test Head of Department", "Contribution Processing", new[] { AppRoles.Requester, AppRoles.HOD }),
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

            logger.LogInformation("Test accounts ready ({Created} created): {Names}.", created, string.Join(", ", Accounts.Select(a => a.UserName)));
        }
    }
}