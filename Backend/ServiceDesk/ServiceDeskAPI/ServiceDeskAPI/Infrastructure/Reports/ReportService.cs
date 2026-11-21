using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>
    /// Runs report definitions (Step 9). Rows are read once, inside the person's scope, then grouped in memory with the same business-hours clock
    /// the SLA uses. Scope: Super Admin everything; HOD and Department Admin their department; a unit head their own unit(s).
    /// </summary>
    public sealed class ReportService : IReportService
    {
        private const int MaxTicketRows = 200000;
        private const int MaxOutputRows = 50000;
        private static readonly TicketStatus[] OpenStatuses = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };
        private static readonly HashSet<string> MeasureKeys = new(ReportCatalogue.Measures.Select(m => m.Key), StringComparer.OrdinalIgnoreCase);
        private static readonly HashSet<string> GroupKeys = new(ReportCatalogue.GroupBys.Select(g => g.Key), StringComparer.OrdinalIgnoreCase);
        private static readonly HashSet<string> TimeGroups = new(StringComparer.OrdinalIgnoreCase) { "day", "week", "month" };

        private readonly AppDbContext _db;
        private readonly SlaOptions _sla;

        public ReportService(AppDbContext db, IOptions<SlaOptions> sla)
        {
            _db = db;
            _sla = sla.Value;
        }

        private int Offset => _sla.UtcOffsetHours;

        // ---------------- scope ----------------

        private sealed record Scope(bool All, List<Guid> Departments, List<Guid> Units);

        private async Task<Scope?> ScopeAsync(Guid userId, bool superAdmin)
        {
            if (superAdmin) return new Scope(true, new List<Guid>(), new List<Guid>());
            var departments = await _db.Departments.AsNoTracking().Where(d => d.HodUserId == userId || d.AdminUserId == userId).Select(d => d.Id).ToListAsync();
            var units = await _db.Units.AsNoTracking().Where(u => u.HeadUserId == userId).Select(u => u.Id).ToListAsync();
            if (departments.Count == 0 && units.Count == 0) return null;
            return new Scope(false, departments, units);
        }

        private static readonly ReportProblem NotAllowed = new(403, "Reports are for unit heads, the Head of Department, Department Admins and Super Admin.");

        public async Task<(ReportProblem? Problem, ReportCatalogueDto? Catalogue)> CatalogueAsync(Guid userId, bool isSuperAdmin)
        {
            if (await ScopeAsync(userId, isSuperAdmin) == null) return (NotAllowed, null);
            return (null, new ReportCatalogueDto
            {
                Measures = ReportCatalogue.Measures.ToList(),
                GroupBys = ReportCatalogue.GroupBys.ToList(),
                Columns = ReportCatalogue.Columns.ToList(),
                LeaveColumns = ReportCatalogue.LeaveColumns.ToList(),
                Presets = ReportCatalogue.Presets.ToList(),
                DateFields = ReportCatalogue.DateFields.ToList(),
                Charts = ReportCatalogue.Charts.ToList(),
                BuiltIn = ReportCatalogue.BuiltIns()
            });
        }

        // ---------------- range ----------------

        private sealed record Range(DateOnly? From, DateOnly? To, DateTime? FromUtc, DateTime? ToUtc);

        private (Range? Range, string? Error) ResolveRange(ReportSpec spec)
        {
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(Offset));
            DateOnly? from = null, to = null;
            if (!string.IsNullOrWhiteSpace(spec.From))
            {
                if (!DateOnly.TryParseExact(spec.From.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedFrom)) return (null, "From must be a date like 2026-11-17.");
                from = parsedFrom;
            }
            if (!string.IsNullOrWhiteSpace(spec.To))
            {
                if (!DateOnly.TryParseExact(spec.To.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedTo)) return (null, "To must be a date like 2026-11-17.");
                to = parsedTo;
            }
            var preset = (spec.Preset ?? string.Empty).Trim().ToLowerInvariant();
            switch (preset)
            {
                case "": break;
                case "all": from = null; to = null; break;
                case "today": from = today; to = today; break;
                case "last7": from = today.AddDays(-6); to = today; break;
                case "last30": from = today.AddDays(-29); to = today; break;
                case "thismonth": from = new DateOnly(today.Year, today.Month, 1); to = today; break;
                case "lastmonth":
                    var first = new DateOnly(today.Year, today.Month, 1);
                    from = first.AddMonths(-1); to = first.AddDays(-1); break;
                case "thisquarter": from = new DateOnly(today.Year, (today.Month - 1) / 3 * 3 + 1, 1); to = today; break;
                case "thisyear": from = new DateOnly(today.Year, 1, 1); to = today; break;
                default: return (null, "Unknown date preset '" + spec.Preset + "'.");
            }
            if (preset == "" && !from.HasValue && !to.HasValue) { from = today.AddDays(-29); to = today; }
            if (preset == "" && from.HasValue && !to.HasValue) to = today;
            if (preset == "" && to.HasValue && !from.HasValue) from = to.Value.AddDays(-29);
            if (from.HasValue && to.HasValue)
            {
                if (from > to) return (null, "The start date is after the end date.");
                if (to.Value.DayNumber - from.Value.DayNumber > 3660) return (null, "Choose a range of at most ten years.");
                var fromUtc = DateTime.SpecifyKind(from.Value.ToDateTime(TimeOnly.MinValue).AddHours(-Offset), DateTimeKind.Utc);
                var toUtc = DateTime.SpecifyKind(to.Value.AddDays(1).ToDateTime(TimeOnly.MinValue).AddHours(-Offset), DateTimeKind.Utc);
                return (new Range(from, to, fromUtc, toUtc), null);
            }
            return (new Range(null, null, null, null), null);
        }

        // ---------------- the run ----------------

        public async Task<(ReportProblem? Problem, ReportResultDto? Result)> RunAsync(ReportSpec spec, Guid userId, bool isSuperAdmin, CancellationToken cancellationToken = default)
        {
            spec ??= new ReportSpec();
            var scope = await ScopeAsync(userId, isSuperAdmin);
            if (scope == null) return (NotAllowed, null);

            var source = (spec.Source ?? "tickets").Trim().ToLowerInvariant();
            var mode = (spec.Mode ?? "summary").Trim().ToLowerInvariant();
            if (source != "tickets" && source != "leave") return (Bad("Source must be tickets or leave."), null);
            if (mode != "summary" && mode != "list") return (Bad("Mode must be summary or list."), null);
            var (range, rangeError) = ResolveRange(spec);
            if (range == null) return (Bad(rangeError!), null);

            if (source == "leave") return (null, await RunLeaveAsync(spec, scope, range, cancellationToken));

            var groupBy = (spec.GroupBy ?? "none").Trim();
            if (!GroupKeys.Contains(groupBy)) return (Bad("Unknown grouping '" + spec.GroupBy + "'."), null);
            groupBy = ReportCatalogue.GroupBys.First(g => g.Key.Equals(groupBy, StringComparison.OrdinalIgnoreCase)).Key;
            var dateField = (spec.DateField ?? "created").Trim().ToLowerInvariant();
            if (dateField != "created" && dateField != "resolved" && dateField != "closed") return (Bad("DateField must be created, resolved or closed."), null);

            var measures = new List<string>();
            foreach (var m in spec.Measures ?? new List<string>())
            {
                if (!MeasureKeys.Contains(m)) return (Bad("Unknown measure '" + m + "'."), null);
                var key = ReportCatalogue.Measures.First(x => x.Key.Equals(m, StringComparison.OrdinalIgnoreCase)).Key;
                if (!measures.Contains(key)) measures.Add(key);
            }
            if (mode == "summary" && measures.Count == 0) measures.Add("count");

            var columns = new List<string>();
            foreach (var c in spec.Columns ?? new List<string>())
            {
                var info = ReportCatalogue.Columns.FirstOrDefault(x => x.Key.Equals(c, StringComparison.OrdinalIgnoreCase));
                if (info == null) return (Bad("Unknown column '" + c + "'."), null);
                if (!columns.Contains(info.Key)) columns.Add(info.Key);
            }
            if (mode == "list" && columns.Count == 0) columns.AddRange(new[] { "reference", "subject", "unit", "category", "priority", "status", "assignee", "createdAt" });

            var statuses = new List<TicketStatus>();
            foreach (var s in spec.Statuses ?? new List<string>())
            {
                if (!Enum.TryParse<TicketStatus>((s ?? string.Empty).Replace(" ", string.Empty), true, out var st) || !Enum.IsDefined(st)) return (Bad("Unknown status '" + s + "'."), null);
                statuses.Add(st);
            }
            var priorities = new List<TicketPriority>();
            foreach (var p in spec.Priorities ?? new List<string>())
            {
                if (!Enum.TryParse<TicketPriority>((p ?? string.Empty).Replace(" ", string.Empty), true, out var pr) || !Enum.IsDefined(pr)) return (Bad("Unknown priority '" + p + "'."), null);
                priorities.Add(pr);
            }

            // ---- rows, inside the person's scope ----
            IQueryable<Ticket> q = _db.Tickets.AsNoTracking();
            if (!scope.All)
            {
                var deptIds = scope.Departments;
                var unitIds = scope.Units;
                q = q.Where(t => deptIds.Contains(t.DepartmentId) || unitIds.Contains(t.UnitId));
            }
            if (spec.DepartmentId.HasValue) { var d = spec.DepartmentId.Value; q = q.Where(t => t.DepartmentId == d); }
            if (spec.UnitIds is { Count: > 0 }) { var u = spec.UnitIds; q = q.Where(t => u.Contains(t.UnitId)); }
            if (spec.CategoryIds is { Count: > 0 }) { var c = spec.CategoryIds; q = q.Where(t => c.Contains(t.CategoryId)); }
            if (spec.AssigneeIds is { Count: > 0 }) { var a = spec.AssigneeIds; q = q.Where(t => t.AssigneeUserId != null && a.Contains(t.AssigneeUserId.Value)); }
            if (statuses.Count > 0) q = q.Where(t => statuses.Contains(t.Status));
            if (priorities.Count > 0) q = q.Where(t => priorities.Contains(t.Priority));
            if (spec.Escalated == true) q = q.Where(t => t.EscalatedToHeadAt != null);
            if (spec.Escalated == false) q = q.Where(t => t.EscalatedToHeadAt == null);
            if (range.FromUtc.HasValue)
            {
                var f = range.FromUtc.Value; var e = range.ToUtc!.Value;
                q = q.Where(t => (t.CreatedAt >= f && t.CreatedAt < e) || (t.ResolvedAt >= f && t.ResolvedAt < e) || (t.ClosedAt >= f && t.ClosedAt < e));
            }

            var loaded = await q.OrderByDescending(t => t.CreatedAt).Take(MaxTicketRows + 1).Select(t => new Row
            {
                Id = t.Id, Reference = t.Reference, Subject = t.Subject,
                DepartmentId = t.DepartmentId, DepartmentName = t.Department!.Name,
                UnitId = t.UnitId, UnitName = t.Unit!.Name,
                CategoryId = t.CategoryId, CategoryName = t.Category!.Name, Hours = t.Category.TimelineHours,
                Priority = t.Priority, Status = t.Status,
                RequesterName = t.RequesterUser!.FullName, RequesterUserName = t.RequesterUser.UserName,
                AssigneeId = t.AssigneeUserId,
                AssigneeName = t.AssigneeUserId == null ? null : t.AssigneeUser!.FullName,
                AssigneeUserName = t.AssigneeUserId == null ? null : t.AssigneeUser!.UserName,
                CreatedAt = t.CreatedAt, FirstRespondedAt = t.FirstRespondedAt, ResolvedAt = t.ResolvedAt, ClosedAt = t.ClosedAt, CancelledAt = t.CancelledAt,
                EscalatedAt = t.EscalatedToHeadAt, ReopenCount = t.ReopenCount, Resolution = (int?)t.ResolutionCode,
                AssignedAt = t.AssignedAt, MissedAt = t.FirstResponseMissedAt, MissedBy = t.FirstResponseMissedByUserId
            }).ToListAsync(cancellationToken);
            var truncated = loaded.Count > MaxTicketRows;
            if (truncated) loaded.RemoveAt(loaded.Count - 1);

            var now = DateTime.UtcNow;
            var clock = BusinessClock.From(_sla);
            var needSla = measures.Any(m => m is "breached" or "breachedPercent" or "withinSlaPercent" or "avgResolutionHours")
                          || columns.Contains("usedPercent") || columns.Contains("breached") || spec.SlaBreached.HasValue;
            if (needSla)
            {
                var ids = q.Select(t => t.Id);
                var changes = (await _db.TicketStatusChanges.AsNoTracking().Where(c => ids.Contains(c.TicketId)).OrderBy(c => c.At)
                    .Select(c => new { c.TicketId, c.ToStatus, c.At }).ToListAsync(cancellationToken))
                    .ToLookup(c => c.TicketId, c => (To: c.ToStatus, At: c.At));
                foreach (var r in loaded) Calculate(r, clock, changes[r.Id], now);
            }
            if (measures.Contains("avgFirstResponseHours"))
                foreach (var r in loaded)
                    if (r.FirstRespondedAt.HasValue) r.FirstResponseHours = clock.BusinessMinutes(r.CreatedAt, r.FirstRespondedAt.Value) / 60.0;

            IEnumerable<Row> rows = loaded;
            if (spec.SlaBreached == true) rows = rows.Where(r => r.Breached);
            else if (spec.SlaBreached == false) rows = rows.Where(r => !r.Breached);
            var all = rows.ToList();

            var result = new ReportResultDto
            {
                Title = string.IsNullOrWhiteSpace(spec.Title) ? "Report" : spec.Title!.Trim(),
                Source = "tickets", Mode = mode, Chart = string.IsNullOrWhiteSpace(spec.Chart) ? "table" : spec.Chart,
                From = range.From?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), To = range.To?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Truncated = truncated, GeneratedAt = now
            };

            bool InRange(DateTime utc) => !range.FromUtc.HasValue || (utc >= range.FromUtc.Value && utc < range.ToUtc!.Value);
            DateTime? DateOf(Row r) => dateField == "resolved" ? r.ResolvedAt : dateField == "closed" ? r.ClosedAt : r.CreatedAt;

            if (mode == "list")
            {
                var cohort = all.Where(r => DateOf(r) is DateTime d && InRange(d)).ToList();
                var sortKey = ReportCatalogue.Columns.Any(c => c.Key.Equals(spec.SortBy ?? string.Empty, StringComparison.OrdinalIgnoreCase))
                    ? ReportCatalogue.Columns.First(c => c.Key.Equals(spec.SortBy, StringComparison.OrdinalIgnoreCase)).Key : "createdAt";
                var desc = spec.SortBy == null || spec.SortDescending;
                var ordered = cohort.OrderBy(r => Value(r, sortKey, now), Comparer<object?>.Create((a, b) => a == null || b == null ? Cmp(a, b) : desc ? Cmp(b, a) : Cmp(a, b))).ToList();
                var limit = Math.Clamp(spec.Limit ?? 1000, 1, MaxOutputRows);
                if (ordered.Count > limit) { ordered = ordered.Take(limit).ToList(); result.Truncated = true; }
                result.Columns = columns.Select(c => ReportCatalogue.Columns.First(x => x.Key == c)).ToList();
                result.Rows = ordered.Select(r => columns.Select(c => Value(r, c, now)).ToList()).ToList();
                return (null, result);
            }

            // ---- summary ----
            var time = TimeGroups.Contains(groupBy);
            var groups = new Dictionary<string, Group>();
            Group Get(string key, string label)
            {
                if (!groups.TryGetValue(key, out var g)) groups[key] = g = new Group { Key = key, Label = label, ByPerson = groupBy == "assignee" };
                return g;
            }
            var needRaised = measures.Contains("raised");
            var needResolvedP = measures.Contains("resolvedInPeriod");
            var needClosedP = measures.Contains("closedInPeriod");
            var total = new Group { Key = "total", Label = "Total", ByPerson = groupBy == "assignee" };
            foreach (var r in all)
            {
                var cd = DateOf(r);
                if (cd.HasValue && InRange(cd.Value))
                {
                    var d = Dim(groupBy, r, time ? cd : null, now);
                    if (d != null) Get(d.Value.Key, d.Value.Label).Rows.Add(r);
                    total.Rows.Add(r);
                }
                if (needRaised && InRange(r.CreatedAt)) { var d = Dim(groupBy, r, r.CreatedAt, now); if (d != null) Get(d.Value.Key, d.Value.Label).Raised++; total.Raised++; }
                if (needResolvedP && r.ResolvedAt.HasValue && InRange(r.ResolvedAt.Value)) { var d = Dim(groupBy, r, r.ResolvedAt, now); if (d != null) Get(d.Value.Key, d.Value.Label).ResolvedP++; total.ResolvedP++; }
                if (needClosedP && r.ClosedAt.HasValue && InRange(r.ClosedAt.Value)) { var d = Dim(groupBy, r, r.ClosedAt, now); if (d != null) Get(d.Value.Key, d.Value.Label).ClosedP++; total.ClosedP++; }
            }

            var measureColumns = measures.Select(m => ReportCatalogue.Measures.First(x => x.Key == m)).ToList();
            var cols = new List<ReportColumnDto>();
            var grouped = groupBy != "none";
            if (grouped) cols.Add(new ReportColumnDto("group", ReportCatalogue.GroupBys.First(g => g.Key == groupBy).Label, "text"));
            cols.AddRange(measureColumns.Select(m => new ReportColumnDto(m.Key, m.Label, m.Type)));
            result.Columns = cols;

            var list = groups.Values.ToList();
            if (!grouped && list.Count == 0) list.Add(new Group { Key = "all", Label = "All tickets" });
            var lines = list.Select(g => (Group: g, Values: (grouped ? new List<object?> { g.Label } : new List<object?>()).Concat(measures.Select(m => Measure(m, g))).ToList())).ToList();

            var sortIndex = spec.SortBy == null ? -1 : cols.FindIndex(c => c.Key.Equals(spec.SortBy, StringComparison.OrdinalIgnoreCase));
            if (sortIndex >= 0)
            {
                var desc = spec.SortDescending;
                lines = lines.OrderBy(l => l.Values[sortIndex], Comparer<object?>.Create((a, b) => a == null || b == null ? Cmp(a, b) : desc ? Cmp(b, a) : Cmp(a, b))).ToList();
            }
            else if (time || groupBy == "age") lines = lines.OrderBy(l => l.Group.Key, StringComparer.Ordinal).ToList();
            else if (grouped && measures.Count > 0) lines = lines.OrderBy(l => l.Values[1], Comparer<object?>.Create((a, b) => a == null || b == null ? Cmp(a, b) : Cmp(b, a))).ToList();

            if (lines.Count > MaxOutputRows) { lines = lines.Take(MaxOutputRows).ToList(); result.Truncated = true; }
            result.Rows = lines.Select(l => l.Values).ToList();
            if (grouped) result.Totals = new List<object?> { "Total" }.Concat(measures.Select(m => Measure(m, total))).ToList();
            return (null, result);
        }

        private static ReportProblem Bad(string message) => new(400, message);

        // ---------------- rows ----------------

        public sealed class Row
        {
            public Guid Id { get; set; }
            public string Reference { get; set; } = string.Empty;
            public string Subject { get; set; } = string.Empty;
            public Guid DepartmentId { get; set; }
            public string DepartmentName { get; set; } = string.Empty;
            public Guid UnitId { get; set; }
            public string UnitName { get; set; } = string.Empty;
            public Guid CategoryId { get; set; }
            public string CategoryName { get; set; } = string.Empty;
            public int Hours { get; set; }
            public TicketPriority Priority { get; set; }
            public TicketStatus Status { get; set; }
            public string? RequesterName { get; set; }
            public string? RequesterUserName { get; set; }
            public Guid? AssigneeId { get; set; }
            public string? AssigneeName { get; set; }
            public string? AssigneeUserName { get; set; }
            public DateTime CreatedAt { get; set; }
            public DateTime? FirstRespondedAt { get; set; }
            public DateTime? ResolvedAt { get; set; }
            public DateTime? ClosedAt { get; set; }
            public DateTime? CancelledAt { get; set; }
            public DateTime? EscalatedAt { get; set; }
            public int ReopenCount { get; set; }
            public int? Resolution { get; set; }
            public double UsedMinutes { get; set; }
            public double UsedPercent { get; set; }
            public bool Breached { get; set; }
            public bool Within { get; set; }
            public double? FirstResponseHours { get; set; }
            public DateTime? AssignedAt { get; set; }
            public DateTime? MissedAt { get; set; }
            public Guid? MissedBy { get; set; }

            public bool IsOpen => OpenStatuses.Contains(Status);
            public bool IsDone => Status is TicketStatus.Resolved or TicketStatus.Closed;
            public bool IsCounted => Status != TicketStatus.Cancelled && Hours > 0;
        }

        private sealed class Group
        {
            public string Key = string.Empty;
            public string Label = string.Empty;
            public List<Row> Rows = new();
            public int Raised;
            public int ResolvedP;
            public int ClosedP;
            /// <summary>Grouped by person: a missed first response counts against the person who missed it.</summary>
            public bool ByPerson;
        }

        /// <summary>Time used so far (or at the end), like the SLA clock: business minutes since raised, minus time spent Pending or Resolved.</summary>
        private static void Calculate(Row r, BusinessClock clock, IEnumerable<(TicketStatus To, DateTime At)> changes, DateTime now)
        {
            var end = r.IsOpen ? now : (r.ResolvedAt ?? r.ClosedAt ?? r.CancelledAt ?? now);
            double paused = 0;
            DateTime? from = null;
            foreach (var ch in changes)
            {
                if (ch.At > end) break;
                if (ch.To is TicketStatus.Pending or TicketStatus.Resolved) from ??= ch.At < r.CreatedAt ? r.CreatedAt : ch.At;
                else if (from.HasValue) { paused += clock.BusinessMinutes(from.Value, ch.At); from = null; }
            }
            if (from.HasValue) paused += clock.BusinessMinutes(from.Value, end);
            r.UsedMinutes = Math.Max(0, clock.BusinessMinutes(r.CreatedAt, end) - paused);
            r.UsedPercent = r.Hours > 0 ? Math.Round(r.UsedMinutes / (r.Hours * 60.0) * 100.0, 1) : 0;
            r.Breached = r.IsCounted && r.UsedMinutes > r.Hours * 60.0;
            r.Within = r.IsCounted && r.IsDone && !r.Breached;
        }

        private static string Words(string text) => Regex.Replace(text, "(?<=[a-z])(?=[A-Z])", " ");

        private static string PersonName(string? full, string? user) => !string.IsNullOrWhiteSpace(full) ? full! : (user ?? string.Empty);

        private static object? Iso(DateTime? value) => value.HasValue ? DateTime.SpecifyKind(value.Value, DateTimeKind.Utc) : null;

        private object? Value(Row r, string column, DateTime now) => column switch
        {
            "reference" => r.Reference,
            "subject" => r.Subject,
            "department" => r.DepartmentName,
            "unit" => r.UnitName,
            "category" => r.CategoryName,
            "priority" => Words(r.Priority.ToString()),
            "status" => Words(r.Status.ToString()),
            "requester" => PersonName(r.RequesterName, r.RequesterUserName),
            "assignee" => r.AssigneeId.HasValue ? PersonName(r.AssigneeName, r.AssigneeUserName) : "Unassigned",
            "createdAt" => Iso(r.CreatedAt),
            "firstRespondedAt" => Iso(r.FirstRespondedAt),
            "resolvedAt" => Iso(r.ResolvedAt),
            "closedAt" => Iso(r.ClosedAt),
            "resolutionCode" => r.Resolution.HasValue ? Words(((ResolutionCode)r.Resolution.Value).ToString()) : null,
            "reopenCount" => r.ReopenCount,
            "escalated" => r.EscalatedAt.HasValue,
            "usedPercent" => r.IsCounted ? r.UsedPercent : null,
            "breached" => r.Breached,
            _ => null
        };

        private static int Cmp(object? a, object? b)
        {
            if (a == null && b == null) return 0;
            if (a == null) return 1;
            if (b == null) return -1;
            if (a is string sa && b is string sb) return string.Compare(sa, sb, StringComparison.OrdinalIgnoreCase);
            if (a is IComparable ca && a.GetType() == b.GetType()) return ca.CompareTo(b);
            return string.Compare(a.ToString(), b.ToString(), StringComparison.OrdinalIgnoreCase);
        }

        // ---------------- grouping ----------------

        private (string Key, string Label)? Dim(string groupBy, Row r, DateTime? when, DateTime now)
        {
            switch (groupBy)
            {
                case "none": return ("all", "All tickets");
                case "day": case "week": case "month":
                    if (!when.HasValue) return null;
                    var local = when.Value.AddHours(Offset);
                    var key = groupBy == "day" ? local.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                        : groupBy == "week" ? local.Date.AddDays(-(((int)local.DayOfWeek + 6) % 7)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                        : local.ToString("yyyy-MM", CultureInfo.InvariantCulture);
                    return (key, groupBy == "week" ? "Week of " + key : key);
                case "unit": return (r.UnitId.ToString(), r.UnitName);
                case "category": return (r.CategoryId.ToString(), r.CategoryName);
                case "department": return (r.DepartmentId.ToString(), r.DepartmentName);
                case "assignee": return r.AssigneeId.HasValue ? (r.AssigneeId.Value.ToString(), PersonName(r.AssigneeName, r.AssigneeUserName)) : ("none", "Unassigned");
                case "status": return (r.Status.ToString(), Words(r.Status.ToString()));
                case "priority": return (((int)r.Priority).ToString(CultureInfo.InvariantCulture), Words(r.Priority.ToString()));
                case "resolutionCode": return r.Resolution.HasValue ? (r.Resolution.Value.ToString(CultureInfo.InvariantCulture), Words(((ResolutionCode)r.Resolution.Value).ToString())) : ("0", "Not resolved");
                case "age":
                    var days = (now - r.CreatedAt).TotalDays;
                    return days < 1 ? ("1", "Under 1 day") : days < 3 ? ("2", "1 to 2 days") : days < 6 ? ("3", "3 to 5 days") : days < 11 ? ("4", "6 to 10 days") : ("5", "Over 10 days");
                default: return null;
            }
        }

        private static double? Pct(int part, int whole) => whole == 0 ? null : Math.Round(part * 100.0 / whole, 1);

        private static double? Avg(IEnumerable<double> values)
        {
            var list = values.ToList();
            return list.Count == 0 ? null : Math.Round(list.Average(), 1);
        }

        /// <summary>The first-response time ran out. Grouped by person only the person who missed it is charged; otherwise it counts once per ticket.</summary>
        private static bool IsResponseMiss(Row r, Group g) => r.MissedAt.HasValue && (!g.ByPerson || r.MissedBy == r.AssigneeId);

        /// <summary>The current holder answered it, after it reached them and in time. An answer given by the previous holder is not theirs.</summary>
        private static bool IsResponseMet(Row r) =>
            r.AssigneeId.HasValue && r.FirstRespondedAt.HasValue && r.AssignedAt.HasValue && r.FirstRespondedAt.Value >= r.AssignedAt.Value && !r.MissedAt.HasValue;
        private static object? Measure(string key, Group g)
        {
            var rows = g.Rows;
            var counted = rows.Where(r => r.IsCounted).ToList();
            var done = counted.Where(r => r.IsDone).ToList();
            switch (key)
            {
                case "count": return rows.Count;
                case "open": return rows.Count(r => r.IsOpen);
                case "resolved": return rows.Count(r => r.IsDone);
                case "closed": return rows.Count(r => r.Status == TicketStatus.Closed);
                case "cancelled": return rows.Count(r => r.Status == TicketStatus.Cancelled);
                case "unassigned": return rows.Count(r => r.IsOpen && !r.AssigneeId.HasValue);
                case "breached": return rows.Count(r => r.Breached);
                case "breachedPercent": return Pct(counted.Count(r => r.Breached), counted.Count);
                case "withinSlaPercent": return Pct(done.Count(r => r.Within), done.Count);
                case "avgResolutionHours": return Avg(done.Select(r => r.UsedMinutes / 60.0));
                case "avgFirstResponseHours": return Avg(rows.Where(r => r.FirstResponseHours.HasValue).Select(r => r.FirstResponseHours!.Value));
                case "respondedPercent": var live = rows.Where(r => r.Status != TicketStatus.Cancelled).ToList(); return Pct(live.Count(r => r.FirstRespondedAt.HasValue), live.Count);
                case "firstResponseMissed": return rows.Count(r => IsResponseMiss(r, g));
                case "firstResponseMetPercent":
                    {
                        var missed = rows.Count(r => IsResponseMiss(r, g));
                        var met = rows.Count(IsResponseMet);
                        return Pct(met, met + missed);
                    }
                case "reopenedPercent": return Pct(rows.Count(r => r.ReopenCount > 0), rows.Count(r => r.Status != TicketStatus.Cancelled));
                case "reopened": return rows.Count(r => r.ReopenCount > 0);
                case "escalated": return rows.Count(r => r.EscalatedAt.HasValue);
                case "raised": return g.Raised;
                case "resolvedInPeriod": return g.ResolvedP;
                case "closedInPeriod": return g.ClosedP;
                default: return null;
            }
        }

        // ---------------- leave and cover (R9) ----------------

        private async Task<ReportResultDto> RunLeaveAsync(ReportSpec spec, Scope scope, Range range, CancellationToken ct)
        {
            var all = scope.All;
            var deptIds = scope.Departments;
            var unitIds = scope.Units;
            var memberships = _db.UnitMembers.AsNoTracking().Where(m => m.IsActive && (all || deptIds.Contains(m.Unit!.DepartmentId) || unitIds.Contains(m.UnitId)));
            if (spec.DepartmentId.HasValue) { var d = spec.DepartmentId.Value; memberships = memberships.Where(m => m.Unit!.DepartmentId == d); }
            if (spec.UnitIds is { Count: > 0 }) { var u = spec.UnitIds; memberships = memberships.Where(m => u.Contains(m.UnitId)); }

            var absences = _db.Absences.AsNoTracking().Where(a => !a.IsCancelled);
            if (range.From.HasValue) { var f = range.From.Value; var t = range.To!.Value; absences = absences.Where(a => a.StartDate <= t && a.EndDate >= f); }

            var found = await (from a in absences
                               join m in memberships on a.UserId equals m.UserId
                               select new { a.UserId, a.Kind, a.StartDate, a.EndDate, m.UnitId, UnitName = m.Unit!.Name })
                .Take(MaxOutputRows + 1).ToListAsync(ct);
            var truncated = found.Count > MaxOutputRows;
            if (truncated) found.RemoveAt(found.Count - 1);

            var userIds = found.Select(x => x.UserId).Distinct().ToList();
            var names = await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).Select(u => new { u.Id, u.FullName, u.UserName }).ToListAsync(ct);
            var nameOf = names.ToDictionary(n => n.Id, n => PersonName(n.FullName, n.UserName));
            var held = await _db.Tickets.AsNoTracking().Where(t => t.AssigneeUserId != null && userIds.Contains(t.AssigneeUserId.Value) && OpenStatuses.Contains(t.Status))
                .GroupBy(t => t.AssigneeUserId!.Value).Select(g => new { Id = g.Key, N = g.Count() }).ToListAsync(ct);
            var heldBy = held.ToDictionary(h => h.Id, h => h.N);

            var clock = BusinessClock.From(_sla);
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(Offset));
            int WorkingDays(DateOnly from, DateOnly to)
            {
                var n = 0;
                for (var d = from; d <= to && n < 400; d = d.AddDays(1)) if (clock.IsWorkingDay(d.ToDateTime(TimeOnly.MinValue))) n++;
                return n;
            }

            var lines = found.OrderByDescending(x => x.StartDate).Select(x => new List<object?>
            {
                nameOf.TryGetValue(x.UserId, out var n) ? n : string.Empty,
                x.UnitName,
                Words(x.Kind.ToString()),
                x.StartDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                x.EndDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                WorkingDays(x.StartDate, x.EndDate),
                heldBy.TryGetValue(x.UserId, out var h) ? h : 0,
                x.StartDate <= today && x.EndDate >= today ? "Away now" : x.StartDate > today ? "Upcoming" : "Past"
            }).ToList();

            var sortIndex = spec.SortBy == null ? -1 : ReportCatalogue.LeaveColumns.ToList().FindIndex(c => c.Key.Equals(spec.SortBy, StringComparison.OrdinalIgnoreCase));
            if (sortIndex >= 0)
            {
                var desc = spec.SortDescending;
                lines = lines.OrderBy(l => l[sortIndex], Comparer<object?>.Create((a, b) => a == null || b == null ? Cmp(a, b) : desc ? Cmp(b, a) : Cmp(a, b))).ToList();
            }
            var limit = Math.Clamp(spec.Limit ?? 1000, 1, MaxOutputRows);
            if (lines.Count > limit) { lines = lines.Take(limit).ToList(); truncated = true; }

            return new ReportResultDto
            {
                Title = string.IsNullOrWhiteSpace(spec.Title) ? "Leave and cover" : spec.Title!.Trim(),
                Source = "leave", Mode = "list", Chart = "table",
                From = range.From?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), To = range.To?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                Columns = ReportCatalogue.LeaveColumns.ToList(), Rows = lines, Truncated = truncated, GeneratedAt = DateTime.UtcNow
            };
        }
    }
}
