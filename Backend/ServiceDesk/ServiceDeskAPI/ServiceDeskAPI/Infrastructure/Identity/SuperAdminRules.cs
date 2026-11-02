using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Identity
{
    /// <summary>Rules for the Super Admin role (copied from People Hub): the system must always keep one active Super Admin.</summary>
    public static class SuperAdminRules
    {
        /// <summary>True when the user is an active Super Admin and no other active account holds the role.</summary>
        public static async Task<bool> IsLastAsync(AppDbContext ctx, Guid userId)
        {
            var holds = await ctx.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.IsActive && a.RoleId == AppRoles.SuperAdminId);
            if (!holds) return false;
            var others = await ctx.UserRoleAssignments.AnyAsync(a => a.UserId != userId && a.IsActive
                && a.RoleId == AppRoles.SuperAdminId && a.User!.IsActive);
            return !others;
        }
    }
}