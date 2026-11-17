using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Leave and out of office (BRD 5.3). Rules:
    /// - whole office days in Lagos time, start and end included; a period may start up to 30 days back and last at most 366 days;
    /// - one person's periods never overlap; a period that has ended cannot be added or changed;
    /// - the person records their own (when they are in the structure); the Head of Unit for their unit's members;
    ///   the HOD for members of their department's units; a Super Admin for anyone;
    /// - recording or cancelling someone else's period tells them; the heads of the person's units are told either way.
    /// Authorisation is checked against the structure in the database, not the roles in the token, so it is right straight after a change.
    /// </summary>
    public class AvailabilityService : IAvailabilityService
    {
        /// <summary>Lagos is UTC+1 all year (no daylight saving).</summary>
        private static readonly TimeSpan OfficeOffset = TimeSpan.FromHours(1);
        private const int MaxDaysBack = 30;
        private const int MaxLengthDays = 366;
        private const int UpcomingDays = 90;

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly TimeProvider _time;
        private readonly IAssignmentSignal _assignment;

        public AvailabilityService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, TimeProvider time,
            IAssignmentSignal assignment)
        {
            _assignment = assignment;
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _time = time;
        }

        public DateOnly Today() => DateOnly.FromDateTime(_time.GetUtcNow().UtcDateTime + OfficeOffset);

        // ---------------- reading ----------------

        public async Task<MyAvailabilityDto> GetMineAsync(Guid userId)
        {
            var today = Today();
            var accountActive = await _db.Users.Where(u => u.Id == userId).Select(u => u.IsActive).FirstOrDefaultAsync();
            var absences = await ToDtosAsync(await _db.Absences.AsNoTracking()
                .Where(a => a.UserId == userId && !a.IsCancelled && a.EndDate >= today)
                .OrderBy(a => a.StartDate)
                .ToListAsync());
            var current = absences.FirstOrDefault(a => a.StartDate <= today);
            return new MyAvailabilityDto
            {
                Today = today,
                InStructure = await InStructureAsync(userId),
                AvailableNow = accountActive && current == null,
                Current = current,
                Absences = absences
            };
        }

        public async Task<(AdminResult Result, UnitAvailabilityDto? Unit)> GetUnitAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var unit = await _db.Units.AsNoTracking().Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return (AdminResult.NotFound("Unit not found."), null);
            var allowed = actorIsSuperAdmin || unit.HeadUserId == actorUserId || unit.Department!.HodUserId == actorUserId || unit.Department.AdminUserId == actorUserId;
            if (!allowed) return (Forbidden("Only the unit's head, the Head of Department or a Super Admin can see this unit's availability."), null);
            return (AdminResult.Ok("OK"), await BuildUnitAsync(unit));
        }

        public async Task<(AdminResult Result, List<UnitAvailabilityDto>? Units)> GetDepartmentAsync(Guid departmentId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var department = await _db.Departments.AsNoTracking().FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return (AdminResult.NotFound("Department not found."), null);
            if (!actorIsSuperAdmin && department.HodUserId != actorUserId && department.AdminUserId != actorUserId)
                return (Forbidden("Only the Head of Department, the Department Admin or a Super Admin can see the whole department's availability."), null);

            var units = await _db.Units.AsNoTracking().Include(u => u.Department)
                .Where(u => u.DepartmentId == departmentId && u.IsActive)
                .OrderBy(u => u.Name)
                .ToListAsync();
            var result = new List<UnitAvailabilityDto>();
            foreach (var unit in units) result.Add(await BuildUnitAsync(unit));
            return (AdminResult.Ok("OK"), result);
        }

        public async Task<bool> IsAvailableAsync(Guid userId)
        {
            var today = Today();
            return await _db.Users.AnyAsync(u => u.Id == userId && u.IsActive)
                && !await _db.Absences.AnyAsync(a => a.UserId == userId && !a.IsCancelled && a.StartDate <= today && a.EndDate >= today);
        }

        public async Task<List<Guid>> AvailableMemberIdsAsync(Guid unitId)
        {
            var today = Today();
            return await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive && m.Unit!.IsActive && m.User!.IsActive
                    && !_db.Absences.Any(a => a.UserId == m.UserId && !a.IsCancelled && a.StartDate <= today && a.EndDate >= today))
                .Select(m => m.UserId)
                .ToListAsync();
        }

        // ---------------- recording ----------------

        public async Task<(AdminResult Result, AbsenceDto? Absence)> CreateAsync(CreateAbsenceRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var targetId = request.UserId ?? actorUserId;
            var forSelf = targetId == actorUserId;
            var target = await _db.Users.FirstOrDefaultAsync(u => u.Id == targetId);
            if (target == null) return (AdminResult.NotFound("Person not found."), null);

            if (!forSelf && !actorIsSuperAdmin && !await ManagesAsync(actorUserId, targetId))
                return (Forbidden("You can record leave only for people in the unit you head, or in your department's units if you are its Head of Department."), null);
            if (!await InStructureAsync(targetId))
                return (AdminResult.Invalid(forSelf
                    ? "Leave is recorded here only for people who work in a unit or head a department."
                    : Name(target) + " is not in any unit, so their leave does not affect ticket assignment."), null);

            if (!Enum.IsDefined(request.Kind)) return (AdminResult.Invalid("Choose Leave or Out of office."), null);
            if (!request.StartDate.HasValue || !request.EndDate.HasValue) return (AdminResult.Invalid("Choose the start and end dates."), null);
            var start = request.StartDate.Value;
            var end = request.EndDate.Value;
            var today = Today();
            if (end < start) return (AdminResult.Invalid("The end date must be on or after the start date."), null);
            if (end < today) return (AdminResult.Invalid("This period has already ended, so it does not affect availability."), null);
            if (start < today.AddDays(-MaxDaysBack)) return (AdminResult.Invalid("The start date can be at most " + MaxDaysBack + " days in the past."), null);
            if (end.DayNumber - start.DayNumber + 1 > MaxLengthDays) return (AdminResult.Invalid("A single period can be at most " + MaxLengthDays + " days."), null);
            var note = string.IsNullOrWhiteSpace(request.Note) ? null : EmailSafety.Redact(request.Note.Trim());
            if (note != null && note.Length > 200) return (AdminResult.Invalid("The note must be at most 200 characters."), null);

            var overlap = await _db.Absences
                .Where(a => a.UserId == targetId && !a.IsCancelled && a.StartDate <= end && a.EndDate >= start)
                .OrderBy(a => a.StartDate)
                .FirstOrDefaultAsync();
            if (overlap != null)
                return (AdminResult.Conflict("This overlaps " + KindText(overlap.Kind).ToLowerInvariant() + " from " + Day(overlap.StartDate) + " to " + Day(overlap.EndDate)
                    + ". Cancel that one first or choose other dates."), null);

            var absence = new Absence
            {
                Id = Guid.NewGuid(), UserId = targetId, Kind = request.Kind, StartDate = start, EndDate = end, Note = note,
                CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId
            };
            _db.Absences.Add(absence);
            Stage(AuditAction.Created, absence.Id, target.UserName, null, new { user = target.UserName, kind = absence.Kind.ToString(), start, end });

            var actorName = await NameOfAsync(actorUserId);
            var period = KindText(absence.Kind) + " from " + Day(start) + " to " + Day(end);
            if (!forSelf)
                _notifications.Stage(targetId, "Your availability was updated", actorName + " recorded " + period + " for you.",
                    NotificationType.Info, NotificationCategory.System, "Absence", absence.Id, "/availability");
            await TellHeadsAsync(targetId, actorUserId, Name(target) + ": " + period + ".", absence.Id);

            await _db.SaveChangesAsync();
            // Someone went away or came back: the assignment queue looks again (Step 5)
            _assignment.Poke();
            var dto = (await ToDtosAsync(new List<Absence> { absence })).Single();
            return (AdminResult.Ok(period + " recorded for " + Name(target) + "."), dto);
        }

        public async Task<AdminResult> CancelAsync(Guid absenceId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var absence = await _db.Absences.Include(a => a.User).FirstOrDefaultAsync(a => a.Id == absenceId && !a.IsCancelled);
            if (absence?.User == null) return AdminResult.NotFound("Leave not found.");
            var forSelf = absence.UserId == actorUserId;
            if (!forSelf && !actorIsSuperAdmin && !await ManagesAsync(actorUserId, absence.UserId))
                return Forbidden("You can change leave only for people in the unit you head, or in your department's units if you are its Head of Department.");

            var today = Today();
            if (absence.EndDate < today) return AdminResult.Invalid("This period has already ended.");

            var before = new { start = absence.StartDate, end = absence.EndDate };
            string message;
            if (absence.StartDate < today)
            {
                // Already started: it ends yesterday, so the days already taken stay on record
                absence.EndDate = today.AddDays(-1);
                absence.UpdatedAt = DateTime.UtcNow;
                absence.UpdatedByUserId = actorUserId;
                Stage(AuditAction.Updated, absence.Id, absence.User.UserName, before, new { start = absence.StartDate, end = absence.EndDate, endedEarly = true });
                message = KindText(absence.Kind) + " ended early; " + Name(absence.User) + " is available from today.";
            }
            else
            {
                absence.IsCancelled = true;
                absence.CancelledAt = DateTime.UtcNow;
                absence.CancelledByUserId = actorUserId;
                Stage(AuditAction.Cancelled, absence.Id, absence.User.UserName, before, null);
                message = KindText(absence.Kind) + " from " + Day(absence.StartDate) + " to " + Day(absence.EndDate) + " cancelled.";
            }

            if (!forSelf)
                _notifications.Stage(absence.UserId, "Your availability was updated", await NameOfAsync(actorUserId) + ": " + message,
                    NotificationType.Info, NotificationCategory.System, "Absence", absence.Id, "/availability");
            await TellHeadsAsync(absence.UserId, actorUserId, Name(absence.User) + ": " + message, absence.Id);

            await _db.SaveChangesAsync();
            // Someone went away or came back: the assignment queue looks again (Step 5)
            _assignment.Poke();
            return AdminResult.Ok(message);
        }

        // ---------------- helpers ----------------

        /// <summary>Works in an active unit (heads and deputies are members) or is HOD of an active department.</summary>
        private async Task<bool> InStructureAsync(Guid userId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.IsActive)
            || await _db.Departments.AnyAsync(d => d.HodUserId == userId && d.IsActive);

        /// <summary>True when the actor heads or deputises one of the person's units, or is HOD of that unit's department.</summary>
        private async Task<bool> ManagesAsync(Guid actorUserId, Guid targetUserId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == targetUserId && m.IsActive && m.Unit!.IsActive
                && (m.Unit.HeadUserId == actorUserId || m.Unit.Department!.HodUserId == actorUserId || m.Unit.Department.AdminUserId == actorUserId));

        /// <summary>Tells the heads and deputies of the person's units (not the person, not the one making the change).</summary>
        private async Task TellHeadsAsync(Guid targetUserId, Guid actorUserId, string message, Guid absenceId)
        {
            var units = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UserId == targetUserId && m.IsActive && m.Unit!.IsActive)
                .Select(m => new { m.Unit!.Name, m.Unit.HeadUserId })
                .ToListAsync();
            var told = new HashSet<Guid> { targetUserId, actorUserId };
            foreach (var unit in units)
            {
                foreach (var head in new[] { unit.HeadUserId })
                {
                    if (!head.HasValue || !told.Add(head.Value)) continue;
                    _notifications.Stage(head.Value, "Availability changed in " + unit.Name, message,
                        NotificationType.Info, NotificationCategory.System, "Absence", absenceId, "/availability");
                }
            }
        }

        private async Task<UnitAvailabilityDto> BuildUnitAsync(Unit unit)
        {
            var today = Today();
            var horizon = today.AddDays(UpcomingDays);
            var members = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unit.Id && m.IsActive)
                .Select(m => new { m.UserId, UserName = m.User!.UserName, m.User.FullName, m.StaffCategory, AccountActive = m.User.IsActive })
                .ToListAsync();
            var ids = members.Select(m => m.UserId).ToList();
            var absences = await ToDtosAsync(await _db.Absences.AsNoTracking()
                .Where(a => ids.Contains(a.UserId) && !a.IsCancelled && a.EndDate >= today && a.StartDate <= horizon)
                .OrderBy(a => a.StartDate)
                .ToListAsync());

            var rows = members.Select(m =>
            {
                var mine = absences.Where(a => a.UserId == m.UserId).ToList();
                var current = mine.FirstOrDefault(a => a.StartDate <= today);
                return new MemberAvailabilityDto
                {
                    UserId = m.UserId,
                    UserName = m.UserName ?? string.Empty,
                    FullName = m.FullName,
                    StaffCategory = m.StaffCategory,
                    IsHead = unit.HeadUserId == m.UserId,
                    AccountActive = m.AccountActive,
                    AvailableNow = m.AccountActive && current == null,
                    Current = current,
                    Upcoming = mine.Where(a => a.StartDate > today).ToList()
                };
            })
            .OrderByDescending(r => r.IsHead).ThenBy(r => r.FullName ?? r.UserName)
            .ToList();

            return new UnitAvailabilityDto
            {
                UnitId = unit.Id,
                DepartmentId = unit.DepartmentId,
                Code = unit.Code,
                Name = unit.Name,
                Today = today,
                MemberCount = rows.Count,
                AvailableCount = rows.Count(r => r.AvailableNow),
                Members = rows
            };
        }

        private async Task<List<AbsenceDto>> ToDtosAsync(List<Absence> absences)
        {
            var recorderIds = absences.Where(a => a.CreatedByUserId.HasValue).Select(a => a.CreatedByUserId!.Value).Distinct().ToList();
            var names = recorderIds.Count == 0
                ? new Dictionary<Guid, string>()
                : await _db.Users.AsNoTracking().Where(u => recorderIds.Contains(u.Id))
                    .Select(u => new { u.Id, Name = u.FullName ?? u.UserName ?? string.Empty })
                    .ToDictionaryAsync(u => u.Id, u => u.Name);
            return absences.Select(a => new AbsenceDto
            {
                Id = a.Id,
                UserId = a.UserId,
                Kind = a.Kind,
                StartDate = a.StartDate,
                EndDate = a.EndDate,
                Note = a.Note,
                RecordedBy = a.CreatedByUserId.HasValue && names.TryGetValue(a.CreatedByUserId.Value, out var n) ? n : null,
                RecordedAt = a.CreatedAt
            }).ToList();
        }

        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private void Stage(AuditAction action, Guid absenceId, string? display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Absence", absenceId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Units);
        }

        private static AdminResult Forbidden(string message) => new(403, message);

        private static string KindText(AbsenceKind kind) => kind == AbsenceKind.OutOfOffice ? "Out of office" : "Leave";

        private static string Day(DateOnly date) => date.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
    }
}