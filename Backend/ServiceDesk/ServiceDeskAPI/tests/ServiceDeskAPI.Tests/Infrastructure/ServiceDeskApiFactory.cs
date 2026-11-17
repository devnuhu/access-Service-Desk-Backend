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
                ["TestAccounts:Password"] = TestPassword, ["Sla:WorkerEnabled"] = "false",
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