using System.Globalization;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Infrastructure.Performance
{
    public sealed class PerformanceService : IPerformanceService
    {
        private readonly AppDbContext _db;
        private readonly IReportRunner _runner;
        private readonly double _offsetHours;

        public PerformanceService(AppDbContext db, IReportRunner runner, Microsoft.Extensions.Options.IOptions<SlaOptions>? sla = null)
        {
            _db = db;
            _runner = runner;
            _offsetHours = sla?.Value.UtcOffsetHours ?? 1;
        }

        // ---------------- reading a report result ----------------

        private sealed class Table
        {
            private readonly Dictionary<string, int> _index;
            public List<List<object?>> Rows { get; }
            public List<object?>? Totals { get; }
            public string? From { get; }
            public string? To { get; }

            public Table(ReportResultDto result)
            {
                _index = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < result.Columns.Count; i++) _index[result.Columns[i].Key] = i;
                Rows = result.Rows;
                Totals = result.Totals;
                From = result.From;
                To = result.To;
            }

            public double? Value(List<object?>? row, string key) =>
                row != null && _index.TryGetValue(key, out var i) && i < row.Count && row[i] != null ? Convert.ToDouble(row[i], CultureInfo.InvariantCulture) : null;

            public int Count(List<object?>? row, string key) => (int)Math.Round(Value(row, key) ?? 0);

            public static string Label(List<object?> row) => row.Count > 0 ? Convert.ToString(row[0], CultureInfo.InvariantCulture) ?? string.Empty : string.Empty;

            /// <summary>The single line of an ungrouped result.</summary>
            public List<object?>? Only => Rows.FirstOrDefault();
        }

        private async Task<(TicketProblem? Problem, Table? Table)> RunAsync(PerformanceQuery query, string dateField, string groupBy, string[] measures,
            Guid? assigneeId = null, List<Guid>? unitIds = null)
        {
            var spec = new ReportSpec { Title = "Performance", Source = "tickets", Mode = "summary", DateField = dateField, GroupBy = groupBy, Measures = measures.ToList() };
            if (!string.IsNullOrWhiteSpace(query.From) || !string.IsNullOrWhiteSpace(query.To)) { spec.From = query.From; spec.To = query.To; }
            else spec.Preset = string.IsNullOrWhiteSpace(query.Preset) ? "thismonth" : query.Preset;
            if (assigneeId.HasValue) spec.AssigneeIds = new List<Guid> { assigneeId.Value };
            if (unitIds != null) spec.UnitIds = unitIds;
            var (problem, result) = await _runner.RunTrustedAsync(spec);
            if (problem != null || result == null) return (new TicketProblem(problem?.Status ?? 500, problem?.Message ?? "The figures could not be worked out."), null);
            return (null, new Table(result));
        }

        // ---------------- the series ----------------

        private static string BucketFor(string? from, string? to)
        {
            if (!DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var f)
                || !DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return "month";
            var days = t.DayNumber - f.DayNumber + 1;
            return days <= 31 ? "day" : days <= 183 ? "week" : "month";
        }

        private static string KeyOf(string label) => label.StartsWith("Week of ", StringComparison.Ordinal) ? label.Substring("Week of ".Length) : label;

        private static List<string> Keys(string bucket, string? from, string? to)
        {
            var keys = new List<string>();
            if (!DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var f)
                || !DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t)) return keys;
            if (bucket == "day")
                for (var d = f; d <= t; d = d.AddDays(1)) keys.Add(d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            else if (bucket == "week")
                for (var d = f.AddDays(-(((int)f.DayOfWeek + 6) % 7)); d <= t; d = d.AddDays(7)) keys.Add(d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            else
                for (var d = new DateOnly(f.Year, f.Month, 1); d <= t; d = d.AddMonths(1)) keys.Add(d.ToString("yyyy-MM", CultureInfo.InvariantCulture));
            return keys;
        }

        private static List<PerformancePoint> Series(Table table, string bucket)
        {
            var found = new Dictionary<string, PerformancePoint>(StringComparer.Ordinal);
            foreach (var row in table.Rows)
                found[KeyOf(Table.Label(row))] = new PerformancePoint
                {
                    Date = KeyOf(Table.Label(row)),
                    Assigned = table.Count(row, "assignedInPeriod"),
                    Resolved = table.Count(row, "resolvedInPeriod"),
                    Raised = table.Count(row, "raised"),
                    WithinSlaPercent = table.Value(row, "withinSlaPercent")
                };
            var keys = Keys(bucket, table.From, table.To);
            if (keys.Count == 0) return found.Values.OrderBy(p => p.Date, StringComparer.Ordinal).ToList();
            return keys.Select(k => found.TryGetValue(k, out var p) ? p : new PerformancePoint { Date = k }).ToList();
        }

        private static readonly string[] StatusOrder = { "New", "Assigned", "In Progress", "Pending", "Reopened" };
        private static readonly string[] PriorityOrder = { "Critical", "High", "Medium", "Low" };

        private static List<PerformanceCount> Counts(Table table, string[]? order)
        {
            var list = table.Rows.Select(r => new PerformanceCount(Table.Label(r), table.Count(r, "openNow"))).Where(c => c.Count > 0).ToList();
            return order == null ? list : list.OrderBy(c => Rank(order, c.Label)).ToList();
        }

        private static int Rank(string[] order, string label)
        {
            var index = Array.IndexOf(order, label);
            return index < 0 ? int.MaxValue : index;
        }

        private async Task<List<PerformanceTarget>> TargetsAsync(Guid departmentId)
        {
            var targets = await SlaTargets.LoadAsync(_db);
            return new[] { TicketPriority.Critical, TicketPriority.High, TicketPriority.Medium, TicketPriority.Low }
                .Select(p => { var (response, resolution) = targets.For(Guid.Empty, departmentId, p); return new PerformanceTarget((int)p, p.ToString(), response, resolution); }).ToList();
        }

        private static string Name(string? full, string? user) => !string.IsNullOrWhiteSpace(full) ? full! : (user ?? string.Empty);

                // ---------------- tasks (for the appraisal) ----------------

        private (DateTime? FromUtc, DateTime? ToUtc) Window(string? from, string? to)
        {
            DateTime? f = null;
            DateTime? t = null;
            if (DateOnly.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var fd))
                f = DateTime.SpecifyKind(fd.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc).AddHours(-_offsetHours);
            if (DateOnly.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var td))
                t = DateTime.SpecifyKind(td.AddDays(1).ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc).AddHours(-_offsetHours);
            return (f, t);
        }

        private static void Finish(TaskFigures f)
        {
            var measured = f.Done + f.OverdueOpen + f.CancelledLate;
            f.OnTimePercent = measured > 0 ? Math.Round(f.DoneOnTime * 100.0 / measured, 1) : null;
        }

        private static TaskFigures SumTasks(IEnumerable<TaskFigures> all)
        {
            var sum = new TaskFigures();
            foreach (var f in all)
            {
                sum.Given += f.Given; sum.Done += f.Done; sum.DoneOnTime += f.DoneOnTime; sum.DoneLate += f.DoneLate;
                sum.OpenNow += f.OpenNow; sum.OverdueOpen += f.OverdueOpen; sum.Rejected += f.Rejected;
                sum.Cancelled += f.Cancelled; sum.CancelledLate += f.CancelledLate;
            }
            Finish(sum);
            return sum;
        }

        /// <summary>Tasks given to each person (by name of the owner, not "nobody in particular") in the period, by the date they were given.</summary>
        private async Task<Dictionary<Guid, TaskFigures>> TaskFiguresAsync(List<Guid> userIds, string? from, string? to)
        {
            var result = new Dictionary<Guid, TaskFigures>();
            if (userIds.Count == 0) return result;
            var (fromUtc, toUtc) = Window(from, to);
            var query = _db.TicketTasks.AsNoTracking().Where(t => t.AssigneeUserId != null && userIds.Contains(t.AssigneeUserId.Value));
            if (fromUtc.HasValue) query = query.Where(t => t.CreatedAt >= fromUtc.Value);
            if (toUtc.HasValue) query = query.Where(t => t.CreatedAt < toUtc.Value);
            var rows = await query.Select(t => new { Owner = t.AssigneeUserId!.Value, t.DueAt, t.IsDone, t.DoneAt, t.RejectedAt, t.CancelledAt }).ToListAsync();
            var today = DateTime.UtcNow.AddHours(_offsetHours).Date;
            foreach (var group in rows.GroupBy(r => r.Owner))
            {
                var f = new TaskFigures { Given = group.Count() };
                foreach (var r in group)
                {
                    var due = r.DueAt?.Date;
                    if (r.CancelledAt.HasValue)
                    {
                        f.Cancelled++;
                        if (due.HasValue && r.CancelledAt.Value.AddHours(_offsetHours).Date > due.Value) f.CancelledLate++;
                    }
                    else if (r.IsDone)
                    {
                        f.Done++;
                        var finished = (r.DoneAt ?? DateTime.UtcNow).AddHours(_offsetHours).Date;
                        if (!due.HasValue || finished <= due.Value) f.DoneOnTime++; else f.DoneLate++;
                    }
                    else if (r.RejectedAt.HasValue) f.Rejected++;
                    else
                    {
                        f.OpenNow++;
                        if (due.HasValue && due.Value < today) f.OverdueOpen++;
                    }
                }
                Finish(f);
                result[group.Key] = f;
            }
            return result;
        }

        /// <summary>The latest tasks the person sent back in the period, with their reasons.</summary>
        private async Task<List<TaskRejectionDto>> TaskRejectionsAsync(Guid userId, string? from, string? to)
        {
            var (fromUtc, toUtc) = Window(from, to);
            var query = _db.TicketTasks.AsNoTracking().Where(t => t.AssigneeUserId == userId && t.RejectedAt != null);
            if (fromUtc.HasValue) query = query.Where(t => t.CreatedAt >= fromUtc.Value);
            if (toUtc.HasValue) query = query.Where(t => t.CreatedAt < toUtc.Value);
            return await query.OrderByDescending(t => t.RejectedAt).Take(10)
                .Select(t => new TaskRejectionDto { TicketReference = t.Ticket!.Reference, Title = t.Title, Reason = t.RejectedReason ?? string.Empty, RejectedAt = t.RejectedAt!.Value })
                .ToListAsync();
        }// ---------------- a person ----------------

        public Task<(TicketProblem? Problem, PerformanceDto? Performance)> MineAsync(PerformanceQuery query, Guid actorUserId) => BuildPersonAsync(actorUserId, query ?? new PerformanceQuery());

        public async Task<(TicketProblem? Problem, PerformanceDto? Performance)> PersonAsync(Guid userId, PerformanceQuery query, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var allowed = actorIsSuperAdmin || userId == actorUserId
                || await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive
                    && (m.Unit!.HeadUserId == actorUserId || m.Unit.Department!.HodUserId == actorUserId || m.Unit.Department.AdminUserId == actorUserId));
            if (!allowed) return (new TicketProblem(404, "Person not found."), null);
            return await BuildPersonAsync(userId, query ?? new PerformanceQuery());
        }

        private async Task<(TicketProblem? Problem, PerformanceDto? Performance)> BuildPersonAsync(Guid userId, PerformanceQuery query)
        {
            var person = await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.FullName, u.UserName }).FirstOrDefaultAsync();
            if (person == null) return (new TicketProblem(404, "Person not found."), null);

            var (p1, resolvedCohort) = await RunAsync(query, "resolved", "none", new[] { "avgResolutionHours", "withinSlaPercent", "breached", "reopenedPercent", "withinSla", "reopened" }, assigneeId: userId);
            if (p1 != null) return (p1, null);
            var (p2, raisedCohort) = await RunAsync(query, "created", "none", new[] { "avgFirstResponseHours", "firstResponseMetPercent", "firstResponseMissed", "firstResponseMet" }, assigneeId: userId);
            if (p2 != null) return (p2, null);
            var bucket = BucketFor(resolvedCohort!.From, resolvedCohort.To);
            var (p3, series) = await RunAsync(query, "resolved", bucket, new[] { "assignedInPeriod", "resolvedInPeriod", "withinSlaPercent" }, assigneeId: userId);
            if (p3 != null) return (p3, null);
            var (p4, open) = await RunAsync(query, "created", "status", new[] { "openNow", "overdueNow" }, assigneeId: userId);
            if (p4 != null) return (p4, null);
            var taskMap = await TaskFiguresAsync(new List<Guid> { userId }, resolvedCohort!.From, resolvedCohort.To);

            var figures = new PerformanceFigures
            {
                Assigned = series!.Count(series.Totals, "assignedInPeriod"),
                Resolved = series.Count(series.Totals, "resolvedInPeriod"),
                OpenNow = open!.Count(open.Totals, "openNow"),
                OnHold = open.Count(open.Rows.FirstOrDefault(r => Table.Label(r) == "Pending"), "openNow"),
                ResolvedLate = resolvedCohort.Count(resolvedCohort.Only, "breached"),
                WithinSlaPercent = resolvedCohort.Value(resolvedCohort.Only, "withinSlaPercent"),
                AvgResolutionHours = resolvedCohort.Value(resolvedCohort.Only, "avgResolutionHours"),
                ReopenedPercent = resolvedCohort.Value(resolvedCohort.Only, "reopenedPercent"),
                AvgFirstResponseHours = raisedCohort!.Value(raisedCohort.Only, "avgFirstResponseHours"),
                RespondedInTimePercent = raisedCohort.Value(raisedCohort.Only, "firstResponseMetPercent"),
                NoResponseInTime = raisedCohort.Count(raisedCohort.Only, "firstResponseMissed"),
                ResolvedWithinSla = resolvedCohort.Count(resolvedCohort.Only, "withinSla"),
                Reopened = resolvedCohort.Count(resolvedCohort.Only, "reopened"),
                FirstResponseMet = raisedCohort.Count(raisedCohort.Only, "firstResponseMet"),
                OverdueOpen = open.Count(open.Totals, "overdueNow"),
                ResolutionRatePercent = series.Count(series.Totals, "assignedInPeriod") > 0 ? Math.Round(series.Count(series.Totals, "resolvedInPeriod") * 100.0 / series.Count(series.Totals, "assignedInPeriod"), 1) : (double?)null
            };

            // the unit (or units) they work in, for the comparison and for which targets to show
            var memberships = await _db.UnitMembers.AsNoTracking().Where(m => m.UserId == userId && m.IsActive).Select(m => new { m.UnitId, m.Unit!.DepartmentId }).ToListAsync();
            PerformanceFigures? team = null;
            if (memberships.Count > 0)
            {
                var unitIds = memberships.Select(m => m.UnitId).Distinct().ToList();
                var (t1, teamResolved) = await RunAsync(query, "resolved", "none", new[] { "avgResolutionHours", "withinSlaPercent", "reopenedPercent" }, unitIds: unitIds);
                if (t1 != null) return (t1, null);
                var (t2, teamRaised) = await RunAsync(query, "created", "none", new[] { "avgFirstResponseHours", "firstResponseMetPercent" }, unitIds: unitIds);
                if (t2 != null) return (t2, null);
                team = new PerformanceFigures
                {
                    WithinSlaPercent = teamResolved!.Value(teamResolved.Only, "withinSlaPercent"),
                    AvgResolutionHours = teamResolved.Value(teamResolved.Only, "avgResolutionHours"),
                    ReopenedPercent = teamResolved.Value(teamResolved.Only, "reopenedPercent"),
                    AvgFirstResponseHours = teamRaised!.Value(teamRaised.Only, "avgFirstResponseHours"),
                    RespondedInTimePercent = teamRaised.Value(teamRaised.Only, "firstResponseMetPercent")
                };
            }

            return (null, new PerformanceDto
            {
                Period = new PerformancePeriodDto { From = resolvedCohort.From, To = resolvedCohort.To, Bucket = bucket },
                UserId = userId, Name = Name(person.FullName, person.UserName), Figures = figures, Team = team,
                Series = Series(series, bucket), OpenByStatus = Counts(open, StatusOrder),
                Tasks = taskMap.TryGetValue(userId, out var taskFigures) ? taskFigures : new TaskFigures(),
                TaskRejections = await TaskRejectionsAsync(userId, resolvedCohort.From, resolvedCohort.To),
                Targets = await TargetsAsync(memberships.Select(m => m.DepartmentId).FirstOrDefault())
            });
        }

        // ---------------- a unit ----------------

        public async Task<(TicketProblem? Problem, UnitPerformanceDto? Performance)> UnitAsync(Guid unitId, PerformanceQuery query, Guid actorUserId, bool actorIsSuperAdmin)
        {
            query ??= new PerformanceQuery();
            var unit = await _db.Units.AsNoTracking().Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return (new TicketProblem(404, "Unit not found."), null);
            if (!actorIsSuperAdmin && unit.HeadUserId != actorUserId && unit.Department!.HodUserId != actorUserId && unit.Department.AdminUserId != actorUserId)
                return (new TicketProblem(403, "Only the head of " + unit.Name + ", the Head of Department, the Department Admin or a Super Admin can see this."), null);

            var ids = new List<Guid> { unitId };
            var (e1, resolved) = await RunAsync(query, "resolved", "assignee", new[] { "assignedInPeriod", "resolvedInPeriod", "avgResolutionHours", "withinSlaPercent", "breached", "reopenedPercent", "withinSla", "reopened" }, unitIds: ids);
            if (e1 != null) return (e1, null);
            var (e2, raised) = await RunAsync(query, "created", "assignee", new[] { "avgFirstResponseHours", "firstResponseMetPercent", "firstResponseMissed", "firstResponseMet" }, unitIds: ids);
            if (e2 != null) return (e2, null);
            var (e3, current) = await RunAsync(query, "created", "assignee", new[] { "openNow", "pending", "overdueNow" }, unitIds: ids);
            if (e3 != null) return (e3, null);
            var bucket = BucketFor(resolved!.From, resolved.To);
            var (e4, series) = await RunAsync(query, "resolved", bucket, new[] { "raised", "resolvedInPeriod", "withinSlaPercent" }, unitIds: ids);
            if (e4 != null) return (e4, null);
            var (e5, byStatus) = await RunAsync(query, "created", "status", new[] { "openNow" }, unitIds: ids);
            if (e5 != null) return (e5, null);
            var (e6, byPriority) = await RunAsync(query, "created", "priority", new[] { "openNow" }, unitIds: ids);
            if (e6 != null) return (e6, null);
            var (e7, byAge) = await RunAsync(query, "created", "age", new[] { "openNow" }, unitIds: ids);
            if (e7 != null) return (e7, null);
            var (e8, categories) = await RunAsync(query, "created", "category", new[] { "count", "avgResolutionHours", "withinSlaPercent" }, unitIds: ids);
            if (e8 != null) return (e8, null);

            PerformanceFigures FiguresOf(List<object?>? resolvedRow, List<object?>? raisedRow, List<object?>? currentRow) => new()
            {
                Assigned = resolved.Count(resolvedRow, "assignedInPeriod"),
                Resolved = resolved.Count(resolvedRow, "resolvedInPeriod"),
                OpenNow = current!.Count(currentRow, "openNow"),
                OnHold = current.Count(currentRow, "pending"),
                ResolvedLate = resolved.Count(resolvedRow, "breached"),
                WithinSlaPercent = resolved.Value(resolvedRow, "withinSlaPercent"),
                AvgResolutionHours = resolved.Value(resolvedRow, "avgResolutionHours"),
                ReopenedPercent = resolved.Value(resolvedRow, "reopenedPercent"),
                AvgFirstResponseHours = raised!.Value(raisedRow, "avgFirstResponseHours"),
                RespondedInTimePercent = raised.Value(raisedRow, "firstResponseMetPercent"),
                NoResponseInTime = raised.Count(raisedRow, "firstResponseMissed"),
                ResolvedWithinSla = resolved.Count(resolvedRow, "withinSla"),
                Reopened = resolved.Count(resolvedRow, "reopened"),
                FirstResponseMet = raised.Count(raisedRow, "firstResponseMet"),
                OverdueOpen = current.Count(currentRow, "overdueNow"),
                ResolutionRatePercent = resolved.Count(resolvedRow, "assignedInPeriod") > 0 ? Math.Round(resolved.Count(resolvedRow, "resolvedInPeriod") * 100.0 / resolved.Count(resolvedRow, "assignedInPeriod"), 1) : (double?)null
            };

            // every active member, idle ones too; then anyone else who appears in the figures (someone who left but still has tickets)
            var memberIds = await _db.UnitMembers.AsNoTracking().Where(m => m.UnitId == unitId && m.IsActive).Select(m => m.UserId).ToListAsync();
            var taskMap = await TaskFiguresAsync(memberIds, resolved!.From, resolved.To);
            var members = await _db.Users.AsNoTracking().Where(u => memberIds.Contains(u.Id)).Select(u => new { UserId = u.Id, u.FullName, u.UserName }).ToListAsync();
            var named = members.Select(m => new { m.UserId, Label = Name(m.FullName, m.UserName) }).ToList();
            var duplicates = named.GroupBy(n => n.Label, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1).Select(g => g.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
            List<object?>? Find(Table t, string label) => t.Rows.FirstOrDefault(r => string.Equals(Table.Label(r), label, StringComparison.OrdinalIgnoreCase));

            var result = new List<PerformanceMemberDto>();
            foreach (var n in named)
                result.Add(new PerformanceMemberDto
                {
                    UserId = duplicates.Contains(n.Label) ? null : n.UserId, Name = n.Label, IsHead = n.UserId == unit.HeadUserId,
                    Figures = FiguresOf(Find(resolved, n.Label), Find(raised!, n.Label), Find(current!, n.Label)),
                    Tasks = taskMap.TryGetValue(n.UserId, out var memberTasks) ? memberTasks : new TaskFigures()
                });
            var listed = named.Select(n => n.Label).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var others = resolved.Rows.Concat(raised!.Rows).Concat(current!.Rows).Select(Table.Label).Where(l => l != "Unassigned" && !listed.Contains(l)).Distinct(StringComparer.OrdinalIgnoreCase);
            foreach (var label in others)
                result.Add(new PerformanceMemberDto { UserId = null, Name = label, Figures = FiguresOf(Find(resolved, label), Find(raised, label), Find(current, label)) });

            return (null, new UnitPerformanceDto
            {
                Period = new PerformancePeriodDto { From = resolved.From, To = resolved.To, Bucket = bucket },
                UnitId = unitId, UnitName = unit.Name,
                Figures = FiguresOf(resolved.Totals, raised.Totals, current.Totals),
                Tasks = SumTasks(taskMap.Values),
                Members = result.OrderByDescending(m => m.Figures.Resolved).ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase).ToList(),
                Series = Series(series!, bucket),
                OpenByStatus = Counts(byStatus!, StatusOrder),
                OpenByPriority = Counts(byPriority!, PriorityOrder),
                OpenByAge = Counts(byAge!, null),
                Categories = categories!.Rows.Select(r => new CategoryPerformanceDto
                {
                    Name = Table.Label(r), Tickets = categories.Count(r, "count"),
                    AvgResolutionHours = categories.Value(r, "avgResolutionHours"), WithinSlaPercent = categories.Value(r, "withinSlaPercent")
                }).OrderByDescending(c => c.Tickets).Take(8).ToList(),
                Targets = await TargetsAsync(unit.DepartmentId)
            });
        }
    }
}