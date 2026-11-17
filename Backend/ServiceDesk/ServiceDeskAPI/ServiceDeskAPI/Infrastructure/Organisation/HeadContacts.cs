using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Who is told about things that go to a unit's head (step 6e): the head, and the Department Admin as well while the head is away.
    /// Away = on leave or out of office today (Lagos), no account that works, or the unit has no head. Never the same person twice.
    /// </summary>
    public static class HeadContacts
    {
        /// <summary>Today's office date (Africa/Lagos, UTC+1, no daylight saving).</summary>
        public static DateOnly OfficeToday() => DateOnly.FromDateTime(DateTime.UtcNow.AddHours(1));

        public static List<Guid> For(AppDbContext db, Guid unitId, DateOnly? today = null)
        {
            var day = today ?? OfficeToday();
            var unit = db.Units.AsNoTracking().Where(u => u.Id == unitId)
                .Select(u => new { u.HeadUserId, Admin = u.Department!.AdminUserId }).FirstOrDefault();
            var result = new List<Guid>();
            if (unit == null) return result;
            if (unit.HeadUserId.HasValue) result.Add(unit.HeadUserId.Value);
            var away = !unit.HeadUserId.HasValue
                || !db.Users.Any(u => u.Id == unit.HeadUserId && u.IsActive)
                || db.Absences.Any(a => a.UserId == unit.HeadUserId && !a.IsCancelled && a.StartDate <= day && a.EndDate >= day);
            if (away && unit.Admin.HasValue && !result.Contains(unit.Admin.Value)) result.Add(unit.Admin.Value);
            return result;
        }

        public static async Task<List<Guid>> ForAsync(AppDbContext db, Guid unitId, DateOnly? today = null, CancellationToken cancellationToken = default)
        {
            var day = today ?? OfficeToday();
            var unit = await db.Units.AsNoTracking().Where(u => u.Id == unitId)
                .Select(u => new { u.HeadUserId, Admin = u.Department!.AdminUserId }).FirstOrDefaultAsync(cancellationToken);
            var result = new List<Guid>();
            if (unit == null) return result;
            if (unit.HeadUserId.HasValue) result.Add(unit.HeadUserId.Value);
            var away = !unit.HeadUserId.HasValue
                || !await db.Users.AnyAsync(u => u.Id == unit.HeadUserId && u.IsActive, cancellationToken)
                || await db.Absences.AnyAsync(a => a.UserId == unit.HeadUserId && !a.IsCancelled && a.StartDate <= day && a.EndDate >= day, cancellationToken);
            if (away && unit.Admin.HasValue && !result.Contains(unit.Admin.Value)) result.Add(unit.Admin.Value);
            return result;
        }
    }
}
