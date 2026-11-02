using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Tests.Infrastructure;
using Xunit;

namespace ServiceDeskAPI.Tests.Persistence
{
    /// <summary>Step 1a: users and roles (BRD Section 4). Runs on a real migrated LocalDB database.</summary>
    public class IdentitySchemaTests : IClassFixture<DatabaseFixture>
    {
        private readonly TestDatabase _db;

        public IdentitySchemaTests(DatabaseFixture fixture) => _db = fixture.Db;

        private static string NewName(string prefix) => prefix + "." + Guid.NewGuid().ToString("N").Substring(0, 8);

        [Fact]
        public async Task The_five_BRD_roles_are_seeded()
        {
            await using var ctx = _db.CreateContext();
            var names = await ctx.Roles.Select(r => r.Name!).OrderBy(n => n).ToListAsync();
            Assert.Equal(AppRoles.All.OrderBy(n => n).ToList(), names);
        }

        [Fact]
        public async Task A_person_can_hold_several_active_roles()
        {
            var id = await _db.AddUserWithRolesAsync(NewName("multi"), AppRoles.Requester, AppRoles.CaseWorker, AppRoles.HeadOfUnit);
            await using var ctx = _db.CreateContext();
            var roles = await RoleAssignments.GetActiveRoleNamesAsync(ctx, id);
            Assert.Equal(new[] { AppRoles.CaseWorker, AppRoles.HeadOfUnit, AppRoles.Requester }, roles);
        }

        [Fact]
        public async Task The_same_role_cannot_be_active_twice_but_history_is_kept()
        {
            var id = await _db.AddUserWithRolesAsync(NewName("dup"), AppRoles.CaseWorker);
            await Assert.ThrowsAnyAsync<Exception>(() => _db.AddRoleAssignmentAsync(id, AppRoles.CaseWorker, active: true));
            await _db.AddRoleAssignmentAsync(id, AppRoles.CaseWorker, active: false); // a past, disabled assignment is allowed
            await using var ctx = _db.CreateContext();
            Assert.Equal(2, await ctx.UserRoleAssignments.CountAsync(a => a.UserId == id));
        }

        [Fact]
        public async Task First_sign_in_gives_Requester_once()
        {
            var id = await _db.AddUserAsync(NewName("first"));
            await using var ctx = _db.CreateContext();
            Assert.True(await RoleAssignments.EnsureDefaultRoleAsync(ctx, id));
            Assert.False(await RoleAssignments.EnsureDefaultRoleAsync(ctx, id));
            Assert.Equal(new[] { AppRoles.Requester }, await RoleAssignments.GetActiveRoleNamesAsync(ctx, id));
            Assert.Equal(1, await ctx.UserRoles.CountAsync(r => r.UserId == id)); // Identity table kept in step
        }

        [Fact]
        public async Task A_person_who_already_has_a_role_does_not_get_Requester_added()
        {
            var id = await _db.AddUserWithRolesAsync(NewName("hod"), AppRoles.HOD);
            await using var ctx = _db.CreateContext();
            Assert.False(await RoleAssignments.EnsureDefaultRoleAsync(ctx, id));
            Assert.Equal(new[] { AppRoles.HOD }, await RoleAssignments.GetActiveRoleNamesAsync(ctx, id));
        }
    }
}