using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>
    /// Reads and grants roles. UserRoleAssignments is the source of truth; the Identity UserRoles table is kept in step
    /// so UserManager role checks agree. A person may hold several roles.
    /// </summary>
    public static class RoleAssignments
    {
        public static async Task<List<string>> GetActiveRoleNamesAsync(AppDbContext db, Guid userId) =>
            await db.UserRoleAssignments
                .AsNoTracking()
                .Where(a => a.UserId == userId && a.IsActive && a.Role != null && a.Role.Name != null)
                .Select(a => a.Role!.Name!)
                .Distinct()
                .OrderBy(n => n)
                .ToListAsync();

        /// <summary>Grants the role if the person does not already hold it. Returns true when it was granted now.</summary>
        public static async Task<bool> EnsureRoleAsync(AppDbContext db, Guid userId, string roleName, Guid? assignedByUserId)
        {
            var normalized = roleName.ToUpperInvariant();
            var roleId = await db.Roles.Where(r => r.NormalizedName == normalized).Select(r => (Guid?)r.Id).FirstOrDefaultAsync()
                ?? throw new InvalidOperationException("Role " + roleName + " does not exist.");

            if (await HoldsAsync(db, userId, roleId))
                return false;

            var assignment = new UserRoleAssignment
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                RoleId = roleId,
                IsActive = true,
                AssignedAt = DateTime.UtcNow,
                AssignedByUserId = assignedByUserId
            };
            db.UserRoleAssignments.Add(assignment);

            IdentityUserRole<Guid>? link = null;
            if (!await db.UserRoles.AnyAsync(r => r.UserId == userId && r.RoleId == roleId))
            {
                link = new IdentityUserRole<Guid> { UserId = userId, RoleId = roleId };
                db.UserRoles.Add(link);
            }

            try
            {
                await db.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateException)
            {
                // Two sign-ins at the same moment: the unique index lets only one through. Forget ours and keep theirs.
                db.Entry(assignment).State = EntityState.Detached;
                if (link != null) db.Entry(link).State = EntityState.Detached;
                if (await HoldsAsync(db, userId, roleId)) return false;
                throw;
            }
        }

        /// <summary>First sign-in: a person with no active role becomes a Requester (any staff member may raise tickets).</summary>
        public static async Task<bool> EnsureDefaultRoleAsync(AppDbContext db, Guid userId)
        {
            if (await db.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.IsActive))
                return false;
            return await EnsureRoleAsync(db, userId, AppRoles.Requester, null);
        }

        private static Task<bool> HoldsAsync(AppDbContext db, Guid userId, Guid roleId) =>
            db.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.RoleId == roleId && a.IsActive);
    }
}