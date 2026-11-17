using System.Globalization;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Infrastructure.Digest
{
    /// <summary>Settings under "Digest". Working days, holidays and the Lagos offset are the Sla settings.</summary>
    public class DigestOptions
    {
        public bool WorkerEnabled { get; set; } = true;
        /// <summary>Local hour (Lagos) from which the digests go out.</summary>
        public int SendHour { get; set; } = 8;
        /// <summary>How many hours after SendHour a late start can still send (so a restart at 09:30 does not lose the day).</summary>
        public int WindowHours { get; set; } = 4;
        public int CheckMinutes { get; set; } = 5;
        /// <summary>Where the notification opens in the web app.</summary>
        public string LinkPath { get; set; } = "/";
    }

    /// <summary>
    /// Builds the digests. Daily: unit heads (their unit) and the Department Admin (the department), on working days.
    /// Weekly: the Head of Department, on the first working day of the week. Nothing is sent on a quiet day.
    /// "Already sent" is read from the notification itself, so a person gets one digest per department and period.
    /// </summary>
    public sealed class DigestService : IDigestService
    {
        private static readonly TicketStatus[] Open = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };

        public sealed class Counts
        {
            public Guid UnitId { get; set; }
            public int Open { get; set; }
            public int Waiting { get; set; }
            public int Unassigned { get; set; }
            public int Overdue { get; set; }
            public int FarPast { get; set; }
            public int Escalated { get; set; }
        }

        private sealed class Target
        {
            public Guid UserId { get; set; }
            public Guid DepartmentId { get; set; }
            public bool Weekly { get; set; }
            public HashSet<Guid> UnitIds { get; } = new();
        }

        private readonly AppDbContext _db;
        private readonly IInAppNotificationService _notifications;
        private readonly SlaOptions _sla;
        private readonly DigestOptions _options;

        public DigestService(AppDbContext db, IInAppNotificationService notifications, IOptions<SlaOptions> sla, IOptions<DigestOptions> options)
        {
            _db = db;
            _notifications = notifications;
            _sla = sla.Value;
            _options = options.Value;
        }

        public async Task<int> RunAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        {
            var clock = BusinessClock.From(_sla);
            var local = nowUtc.AddHours(_sla.UtcOffsetHours);
            var today = local.Date;
            if (!clock.IsWorkingDay(today)) return 0;
            var sendHour = Math.Clamp(_options.SendHour, 0, 23);
            if (local.Hour < sendHour || local.Hour >= sendHour + Math.Clamp(_options.WindowHours, 1, 12)) return 0;

            var dailyKey = "Digest-D-" + today.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
            string? weeklyKey = IsFirstWorkingDayOfWeek(clock, today)
                ? "Digest-W-" + ISOWeek.GetYear(today).ToString(CultureInfo.InvariantCulture) + ISOWeek.GetWeekOfYear(today).ToString("00", CultureInfo.InvariantCulture)
                : null;

            var departments = await _db.Departments.AsNoTracking().Where(d => d.IsActive)
                .Select(d => new { d.Id, d.Name, d.HodUserId, d.AdminUserId }).ToListAsync(cancellationToken);
            var units = await _db.Units.AsNoTracking().Where(u => u.IsActive && u.Department!.IsActive)
                .Select(u => new { u.Id, u.DepartmentId, u.Name, u.HeadUserId }).ToListAsync(cancellationToken);

            var targets = new Dictionary<(Guid User, Guid Department, bool Weekly), Target>();
            void Add(Guid? user, Guid department, bool weekly, IEnumerable<Guid> unitIds)
            {
                if (!user.HasValue) return;
                var key = (user.Value, department, weekly);
                if (!targets.TryGetValue(key, out var t))
                    targets[key] = t = new Target { UserId = user.Value, DepartmentId = department, Weekly = weekly };
                foreach (var id in unitIds) t.UnitIds.Add(id);
            }
            foreach (var d in departments)
            {
                var deptUnits = units.Where(u => u.DepartmentId == d.Id).ToList();
                if (deptUnits.Count == 0) continue;
                Add(d.AdminUserId, d.Id, false, deptUnits.Select(u => u.Id));
                foreach (var u in deptUnits) Add(u.HeadUserId, d.Id, false, new[] { u.Id });
                if (weeklyKey != null) Add(d.HodUserId, d.Id, true, deptUnits.Select(u => u.Id));
            }
            if (targets.Count == 0) return 0;

            var userIds = targets.Keys.Select(k => k.User).Distinct().ToList();
            var active = (await _db.Users.AsNoTracking().Where(u => u.IsActive && userIds.Contains(u.Id)).Select(u => u.Id).ToListAsync(cancellationToken)).ToHashSet();
            var weeklyLookup = weeklyKey ?? "-";
            var sent = await _db.InAppNotifications.AsNoTracking()
                .Where(n => (n.RelatedEntityType == dailyKey || n.RelatedEntityType == weeklyLookup) && userIds.Contains(n.RecipientUserId))
                .Select(n => new { n.RecipientUserId, n.RelatedEntityType, n.RelatedEntityId }).ToListAsync(cancellationToken);

            var counts = (await _db.Tickets.AsNoTracking().Where(t => Open.Contains(t.Status))
                .GroupBy(t => t.UnitId)
                .Select(g => new Counts
                {
                    UnitId = g.Key,
                    Open = g.Count(),
                    Waiting = g.Count(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened),
                    Unassigned = g.Count(t => t.AssigneeUserId == null),
                    Overdue = g.Count(t => t.SlaBreachedAt != null && t.SlaL2At == null),
                    FarPast = g.Count(t => t.SlaL2At != null),
                    Escalated = g.Count(t => t.EscalatedToHeadAt != null)
                }).ToListAsync(cancellationToken)).ToDictionary(c => c.UnitId);

            var link = string.IsNullOrWhiteSpace(_options.LinkPath) ? "/" : _options.LinkPath.Trim();
            var staged = 0;
            foreach (var t in targets.Values)
            {
                if (!active.Contains(t.UserId)) continue;
                var key = t.Weekly ? weeklyKey! : dailyKey;
                if (sent.Any(s => s.RecipientUserId == t.UserId && s.RelatedEntityType == key && s.RelatedEntityId == t.DepartmentId)) continue;

                var scope = units.Where(u => t.UnitIds.Contains(u.Id)).OrderBy(u => u.Name).ToList();
                var total = new Counts();
                var perUnit = new List<(string Name, Counts C)>();
                foreach (var u in scope)
                {
                    var c = counts.TryGetValue(u.Id, out var found) ? found : new Counts { UnitId = u.Id };
                    perUnit.Add((u.Name, c));
                    total.Open += c.Open; total.Waiting += c.Waiting; total.Unassigned += c.Unassigned;
                    total.Overdue += c.Overdue; total.FarPast += c.FarPast; total.Escalated += c.Escalated;
                }
                var attention = total.Waiting + total.Unassigned + total.Overdue + total.FarPast + total.Escalated;
                if (t.Weekly ? total.Open == 0 : attention == 0) continue; // a quiet day sends nothing

                var departmentName = departments.First(d => d.Id == t.DepartmentId).Name;
                var title = (t.Weekly ? "Weekly ticket summary: " : "Daily ticket summary: ") + departmentName;
                var message = Compose(total, perUnit);
                var type = total.Overdue + total.FarPast > 0 ? NotificationType.Warning : NotificationType.Info;
                _notifications.Stage(t.UserId, title, message, type, NotificationCategory.System, key, t.DepartmentId, link);
                staged++;
            }
            if (staged > 0) await _db.SaveChangesAsync(cancellationToken);
            return staged;
        }

        private static string Compose(Counts total, List<(string Name, Counts C)> perUnit)
        {
            var sb = new StringBuilder();
            sb.Append("Open: ").Append(total.Open).Append('\n');
            sb.Append("Waiting to start: ").Append(total.Waiting).Append('\n');
            sb.Append("Unassigned: ").Append(total.Unassigned).Append('\n');
            sb.Append("Overdue: ").Append(total.Overdue).Append('\n');
            sb.Append("Far past deadline: ").Append(total.FarPast).Append('\n');
            sb.Append("Escalated to the unit head: ").Append(total.Escalated);
            if (perUnit.Count > 1)
            {
                sb.Append("\n\nBy unit:");
                foreach (var (name, c) in perUnit)
                    sb.Append('\n').Append(name).Append(": ").Append(c.Open).Append(" open, ").Append(c.Waiting).Append(" waiting, ")
                      .Append(c.Unassigned).Append(" unassigned, ").Append(c.Overdue).Append(" overdue, ").Append(c.FarPast).Append(" far past, ")
                      .Append(c.Escalated).Append(" escalated");
            }
            return sb.ToString();
        }

        /// <summary>True when no earlier day of the same week (Monday first) was a working day, for example after a Monday holiday.</summary>
        private static bool IsFirstWorkingDayOfWeek(BusinessClock clock, DateTime today)
        {
            var monday = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
            for (var d = monday; d < today; d = d.AddDays(1))
                if (clock.IsWorkingDay(d)) return false;
            return true;
        }
    }
}
