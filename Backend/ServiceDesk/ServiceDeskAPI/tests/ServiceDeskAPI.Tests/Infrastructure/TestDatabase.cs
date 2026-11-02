using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Tests.Infrastructure
{
    /// <summary>
    /// A throwaway LocalDB database built from the real EF migrations (copied from People Hub). MigrateAsync throws if the
    /// model has drifted from the migrations, so tests that use this also guard against drift.
    /// Rows are inserted with plain SQL so tests check the database rules themselves, not only the C# code.
    /// </summary>
    public sealed class TestDatabase : IAsyncDisposable
    {
        private readonly string _name = $"ServiceDesk_Test_{Guid.NewGuid():N}";

        public string ConnectionString =>
            $"Server=(localdb)\\mssqllocaldb;Database={_name};Integrated Security=true;TrustServerCertificate=true";

        public static async Task<TestDatabase> CreateAsync()
        {
            var db = new TestDatabase();
            await using var ctx = db.CreateContext();
            await ctx.Database.MigrateAsync();
            return db;
        }

        public AppDbContext CreateContext() =>
            new(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(ConnectionString).Options);

        public async Task<Guid> AddUserAsync(string userName)
        {
            var id = Guid.NewGuid();
            var normalized = userName.ToUpperInvariant();
            var stamp1 = Guid.NewGuid().ToString();
            var stamp2 = Guid.NewGuid().ToString();
            await using var ctx = CreateContext();
            await ctx.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO Users (Id, UserName, NormalizedUserName, FullName, IsActive, CreatedAt, EmailConfirmed, PhoneNumberConfirmed,
                   TwoFactorEnabled, LockoutEnabled, AccessFailedCount, SecurityStamp, ConcurrencyStamp)
VALUES ({id}, {userName}, {normalized}, {userName}, 1, {DateTime.UtcNow}, 1, 0, 0, 0, 0, {stamp1}, {stamp2})");
            return id;
        }

        public async Task AddRoleAssignmentAsync(Guid userId, string roleName, bool active)
        {
            var normalizedRole = roleName.ToUpperInvariant();
            var assignmentId = Guid.NewGuid();
            await using var ctx = CreateContext();
            await ctx.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO UserRoleAssignments (Id, UserId, RoleId, IsActive, AssignedAt)
SELECT {assignmentId}, {userId}, Id, {active}, {DateTime.UtcNow} FROM Roles WHERE NormalizedName = {normalizedRole}");
        }

        public async Task<Guid> AddUserWithRolesAsync(string userName, params string[] roleNames)
        {
            var userId = await AddUserAsync(userName);
            foreach (var role in roleNames)
                await AddRoleAssignmentAsync(userId, role, active: true);
            return userId;
        }

        public async ValueTask DisposeAsync()
        {
            SqlConnection.ClearAllPools();
            await using var ctx = CreateContext();
            try { await ctx.Database.EnsureDeletedAsync(); } catch { /* best effort */ }
        }
    }
}