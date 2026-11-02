using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Keeps the structure roles in step with the saved structure (rule: these roles are never given by hand):
    /// CaseWorker = active member of an active unit; HeadOfUnit = head or deputy of an active unit; HOD = HOD of an active department.
    /// Stages role grants and removals, their audit entries and a notification per person; the caller saves.
    /// Run it after the structure change has been saved (inside the same transaction), so it reads the new structure.
    /// </summary>
    public static class OrgRoleSync
    {
        public static readonly IReadOnlyList<string> StructureRoles = new[] { AppRoles.CaseWorker, AppRoles.HeadOfUnit, AppRoles.HOD };

        private static readonly Dictionary<string, Guid> RoleIds = new()
        {
            [AppRoles.CaseWorker] = AppRoles.CaseWorkerId,
            [AppRoles.HeadOfUnit] = AppRoles.HeadOfUnitId,
            [AppRoles.HOD] = AppRoles.HODId
        };

        public static bool IsStructureRole(Guid roleId) => RoleIds.ContainsValue(roleId);

        /// <summary>The structure roles this person should hold now, from the database.</summary>
        public static async Task<HashSet<string>> ExpectedAsync(AppDbContext db, Guid userId)
        {
            var expected = new HashSet<string>();
            if (await db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.IsActive && m.Unit.Department!.IsActive))
                expected.Add(AppRoles.CaseWorker);
            if (await db.Units.AnyAsync(u => u.IsActive && u.Department!.IsActive && (u.HeadUserId == userId || u.DeputyHeadUserId == userId)))
                expected.Add(AppRoles.HeadOfUnit);
            if (await db.Departments.AnyAsync(d => d.IsActive && d.HodUserId == userId))
                expected.Add(AppRoles.HOD);
            return expected;
        }

        /// <summary>Stages the changes for these people. Returns how many role changes were staged.</summary>
        public static async Task<int> StageAsync(AppDbContext db, IEnumerable<Guid> userIds, Guid? actorUserId, AuditActor actor,
            IAuditService audit, IInAppNotificationService notifications)
        {
            var changes = 0;
            var structureRoleIds = RoleIds.Values.ToArray();
            foreach (var userId in userIds.Distinct())
            {
                var expected = await ExpectedAsync(db, userId);
                var active = await db.UserRoleAssignments
                    .Where(a => a.UserId == userId && a.IsActive && structureRoleIds.Contains(a.RoleId))
                    .ToListAsync();
                var granted = new List<string>();
                var removed = new List<string>();

                foreach (var (name, roleId) in RoleIds)
                {
                    var holding = active.FirstOrDefault(a => a.RoleId == roleId);
                    if (expected.Contains(name) && holding == null)
                    {
                        db.UserRoleAssignments.Add(new UserRoleAssignment
                        {
                            Id = Guid.NewGuid(), UserId = userId, RoleId = roleId, IsActive = true,
                            AssignedAt = DateTime.UtcNow, AssignedByUserId = actorUserId
                        });
                        if (!await db.UserRoles.AnyAsync(r => r.UserId == userId && r.RoleId == roleId))
                            db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = userId, RoleId = roleId });
                        granted.Add(name);
                    }
                    else if (!expected.Contains(name) && holding != null)
                    {
                        holding.IsActive = false;
                        holding.DisabledAt = DateTime.UtcNow;
                        holding.DisabledByUserId = actorUserId;
                        var link = await db.UserRoles.FirstOrDefaultAsync(r => r.UserId == userId && r.RoleId == roleId);
                        if (link != null) db.UserRoles.Remove(link);
                        removed.Add(name);
                    }
                }

                if (granted.Count + removed.Count == 0) continue;
                changes += granted.Count + removed.Count;

                var userName = await db.Users.Where(u => u.Id == userId).Select(u => u.UserName).FirstOrDefaultAsync();
                audit.Stage(actor.UserId, actor.DisplayName, AuditAction.RoleChanged, "User", userId, userName,
                    removed.Count > 0 ? JsonSerializer.Serialize(new { removed, reason = "organisation" }) : null,
                    granted.Count > 0 ? JsonSerializer.Serialize(new { granted, reason = "organisation" }) : null,
                    actor.IpAddress, actor.UserAgent, AuditModule.Units);

                var parts = new List<string>();
                if (granted.Count > 0) parts.Add("You now have the " + string.Join(", ", granted.Select(Friendly)) + " role" + (granted.Count > 1 ? "s" : "") + ".");
                if (removed.Count > 0) parts.Add("The " + string.Join(", ", removed.Select(Friendly)) + " role" + (removed.Count > 1 ? "s were" : " was") + " removed.");
                notifications.Stage(userId, "Your Access Desk access changed", string.Join(" ", parts) + " Sign out and back in if you do not see the change yet.",
                    NotificationType.Info, NotificationCategory.System, "User", userId, null);
            }
            return changes;
        }

        public static string Friendly(string role) => role switch
        {
            AppRoles.CaseWorker => "Case Worker",
            AppRoles.HeadOfUnit => "Head of Unit",
            AppRoles.HOD => "Head of Department",
            AppRoles.SuperAdmin => "Super Admin",
            _ => role
        };
    }
}