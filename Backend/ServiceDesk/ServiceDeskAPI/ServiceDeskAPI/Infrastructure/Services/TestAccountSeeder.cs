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