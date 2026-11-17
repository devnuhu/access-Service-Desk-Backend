using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// The one rule for which staff may see and work which tickets (decided 17 Nov 2026):
    /// a case worker or head sees only their own unit's tickets; the Head of Department and the Department Admin see the whole
    /// department. Super Admin is handled by the callers. Requesters, raisers and copied people are handled by the callers too.
    /// </summary>
    public static class TicketAccess
    {
        /// <summary>HOD or Department Admin of the department.</summary>
        public static Task<bool> IsDepartmentWideAsync(AppDbContext db, Guid userId, Guid departmentId) =>
            db.Departments.AnyAsync(d => d.Id == departmentId && (d.HodUserId == userId || d.AdminUserId == userId));

        /// <summary>The units of this department the person works in (heads and deputies are members).</summary>
        public static Task<List<Guid>> UnitIdsAsync(AppDbContext db, Guid userId, Guid departmentId) =>
            db.UnitMembers.Where(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == departmentId)
                .Select(m => m.UnitId).Distinct().ToListAsync();

        /// <summary>Staff for this ticket: works in the ticket's unit, or is HOD or Department Admin of its department.</summary>
        public static async Task<bool> IsStaffForTicketAsync(AppDbContext db, Guid userId, Guid departmentId, Guid unitId) =>
            await db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.UnitId == unitId)
            || await IsDepartmentWideAsync(db, userId, departmentId);
    }
}