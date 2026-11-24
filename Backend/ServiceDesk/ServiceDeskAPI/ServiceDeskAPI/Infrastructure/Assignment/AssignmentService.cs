using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Email;
using ServiceDeskAPI.Infrastructure.Persistence;
using ServiceDeskAPI.Infrastructure.Tickets;

namespace ServiceDeskAPI.Infrastructure.Assignment
{
    /// <summary>
    /// The assignment engine and reassignment (BRD M3, FR-3.1 to FR-3.11). One assignment at a time per API instance (a gate), so
    /// two tickets raised together are not both counted against the same empty workload.
    /// Who may reassign (FR-3.7, FR-3.8):
    /// - the person holding the ticket, and the unit's head: to an available member of the same unit who handles the category;
    /// - the HOD of the department and a Super Admin: to any available member of any unit of the department (the ticket moves unit).
    /// A reason is always required. Every assignment is recorded with how, why, by whom and the workloads considered (FR-3.10).
    /// </summary>
    public class AssignmentService : IAssignmentService
    {
        private static readonly SemaphoreSlim Gate = new(1, 1);
        private static readonly TicketStatus[] OpenStatuses = { TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Reopened };
        private static readonly TicketStatus[] MovableStatuses = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Reopened };

        private readonly AppDbContext _db;
        private readonly ICatalogueService _catalogue;
        private readonly IAvailabilityService _availability;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly AssignmentOptions _options;
        private readonly ILogger<AssignmentService> _logger;

        public AssignmentService(AppDbContext db, ICatalogueService catalogue, IAvailabilityService availability, IAuditService audit,
            IInAppNotificationService notifications, IHttpContextAccessor http, IOptions<AssignmentOptions> options, ILogger<AssignmentService> logger)
        {
            _db = db;
            _catalogue = catalogue;
            _availability = availability;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _options = options.Value;
            _logger = logger;
        }

        // ---------------- the engine ----------------

        public async Task<bool> AssignAsync(Guid ticketId, string trigger, CancellationToken cancellationToken = default)
        {
            await Gate.WaitAsync(cancellationToken);
            try { return await AssignCoreAsync(ticketId, trigger); }
            finally { Gate.Release(); }
        }

        public async Task<int> ProcessQueueAsync(CancellationToken cancellationToken = default)
        {
            await Gate.WaitAsync(cancellationToken);
            try
            {
                var assigned = 0;
                var today = _availability.Today();

                // 1. Waiting tickets, oldest first
                var waiting = await _db.Tickets.AsNoTracking()
                    .Where(t => t.Status == TicketStatus.New && t.Unit!.IsActive)
                    .OrderBy(t => t.CreatedAt).Select(t => t.Id).Take(200).ToListAsync(cancellationToken);
                foreach (var id in waiting)
                    if (await AssignCoreAsync(id, "retry")) assigned++;

                // 2. Not started (Assigned, or Reopened and not yet acknowledged), but the assignee is away, blocked or left the unit (FR-3.11)
                var notStarted = await AwayAssignee(_db.Tickets.AsNoTracking().Where(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened), today)
                    .OrderBy(t => t.AssignedAt).Select(t => t.Id).Take(200).ToListAsync(cancellationToken);
                foreach (var id in notStarted)
                    if (await AssignCoreAsync(id, "assignee unavailable")) assigned++;

                // 3. Already started (In progress or Pending) and the assignee is away: they keep it, the unit's head is told once (FR-3.11)
                var started = await AwayAssignee(_db.Tickets.Include(t => t.Unit).Include(t => t.AssigneeUser)
                        .Where(t => (t.Status == TicketStatus.InProgress || t.Status == TicketStatus.Pending) && t.AssigneeAwayFlaggedAt == null), today)
                    .Take(200).ToListAsync(cancellationToken);
                foreach (var ticket in started)
                {
                    TellHeads(ticket.Unit!, null, "Ticket " + ticket.Reference + ": assignee unavailable",
                        Name(ticket.AssigneeUser) + " is unavailable and has this ticket in progress. Reassign it if it cannot wait.",
                        NotificationType.Warning, ticket);
                    ticket.AssigneeAwayFlaggedAt = DateTime.UtcNow;
                }
                if (started.Count > 0) await _db.SaveChangesAsync(cancellationToken);
                _db.ChangeTracker.Clear();
                return assigned;
            }
            finally { Gate.Release(); }
        }

        /// <summary>Tickets whose assignee is blocked, no longer in the ticket's unit, or away today.</summary>
        private IQueryable<Ticket> AwayAssignee(IQueryable<Ticket> query, DateOnly today) =>
            query.Where(t => t.AssigneeUserId != null && (
                !t.AssigneeUser!.IsActive
                || !_db.UnitMembers.Any(m => m.UserId == t.AssigneeUserId && m.UnitId == t.UnitId && m.IsActive)
                || _db.Absences.Any(a => a.UserId == t.AssigneeUserId && !a.IsCancelled && a.StartDate <= today && a.EndDate >= today)));

        private async Task<bool> AssignCoreAsync(Guid ticketId, string trigger)
        {
            try
            {
                var ticket = await _db.Tickets.Include(t => t.Unit).Include(t => t.Category).FirstOrDefaultAsync(t => t.Id == ticketId);
                if (ticket == null) return false;
                var assigneeAway = (ticket.Status == TicketStatus.Assigned || ticket.Status == TicketStatus.Reopened) && ticket.AssigneeUserId.HasValue
                    && !await IsWorkingInUnitAsync(ticket.AssigneeUserId.Value, ticket.UnitId);
                if (ticket.Status != TicketStatus.New && !assigneeAway) return ticket.AssigneeUserId.HasValue;

                var scores = await ScoreAsync(ticket.CategoryId, ticket.UnitId, assigneeAway ? ticket.AssigneeUserId : null);
                var link = "/tickets/" + ticket.Reference;
                if (scores.Count == 0)
                {
                    if (ticket.QueueAlertedAt == null)
                    {
                        TellHeads(ticket.Unit!, null, "Ticket " + ticket.Reference + " is waiting",
                            (assigneeAway ? "Its assignee is unavailable and " : string.Empty) + "no case worker in " + ticket.Unit!.Name
                            + " is available for " + ticket.Category!.Name + ". It will be assigned as soon as someone is; you can also assign it yourself.",
                            NotificationType.ActionRequired, ticket);
                        ticket.QueueAlertedAt = DateTime.UtcNow;
                        await _db.SaveChangesAsync();
                    }
                    return false;
                }

                var chosen = scores.OrderBy(s => s.Workload).ThenBy(s => s.LastAssignedAt ?? DateTime.MinValue).ThenBy(s => s.UserName).First();
                chosen.Chosen = true;
                var previous = ticket.AssigneeUserId;
                var now = DateTime.UtcNow;
                await ApplyAsync(ticket, chosen.UserId, ticket.UnitId, now, null, "Automatic assignment (" + trigger + ")");
                _db.TicketAssignments.Add(new TicketAssignment
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromUserId = previous, ToUserId = chosen.UserId, Method = AssignmentMethod.Auto,
                    Reason = trigger, FromUnitId = ticket.UnitId, ToUnitId = ticket.UnitId, ScoresJson = JsonSerializer.Serialize(scores), At = now
                });
                Stage(AuditAction.Assigned, ticket, previous, chosen.UserId, trigger, scores.Count);

                var chosenName = chosen.FullName ?? chosen.UserName;
                _notifications.Stage(chosen.UserId, "Ticket " + ticket.Reference + " assigned to you",
                    ticket.Category!.Name + ", priority " + ticket.Priority + ". Please acknowledge it and start work.",
                    NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", ticket.Id, link);
                if (previous == null)
                    _notifications.Stage(ticket.RequesterUserId, "Ticket " + ticket.Reference + " picked up",
                        chosenName + " in " + ticket.Unit!.Name + " is handling your " + ticket.Category.Name + " request.",
                        NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);
                else
                    _notifications.Stage(previous.Value, "Ticket " + ticket.Reference + " moved while you are unavailable",
                        "It went to " + chosenName + ".", NotificationType.Info, NotificationCategory.Assignment, "Ticket", ticket.Id, link);

                await _db.SaveChangesAsync();
                return true;
            }
            catch (DbUpdateConcurrencyException)
            {
                // Someone changed the ticket at the same moment; the next queue pass looks again
                return false;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Assigning ticket {TicketId} failed", ticketId);
                return false;
            }
            finally
            {
                _db.ChangeTracker.Clear();
            }
        }

        /// <summary>Eligible case workers with their weighted workload (FR-3.2 to FR-3.4).</summary>
        private async Task<List<CandidateScoreDto>> ScoreAsync(Guid categoryId, Guid unitId, Guid? exclude)
        {
            var mapped = await _catalogue.EligibleCaseWorkerIdsAsync(categoryId);
            var available = await _availability.AvailableMemberIdsAsync(unitId);
            var ids = mapped.Intersect(available).Where(id => id != exclude).ToList();
            if (ids.Count == 0) return new List<CandidateScoreDto>();

            var people = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive && ids.Contains(m.UserId))
                .Select(m => new CandidateScoreDto { UserId = m.UserId, UserName = m.User!.UserName ?? string.Empty, FullName = m.User.FullName, LastAssignedAt = m.LastAssignedAt })
                .ToListAsync();
            var loads = await WorkloadsAsync(ids);
            foreach (var p in people)
            {
                var (workload, count) = loads.GetValueOrDefault(p.UserId);
                p.Workload = workload;
                p.OpenTickets = count;
            }
            return people;
        }

        /// <summary>Open tickets (Assigned, In progress, Reopened) weighted by priority; Pending is not counted (FR-3.3).</summary>
        private async Task<Dictionary<Guid, (int Workload, int Count)>> WorkloadsAsync(List<Guid> userIds)
        {
            var rows = await _db.Tickets.AsNoTracking()
                .Where(t => t.AssigneeUserId != null && userIds.Contains(t.AssigneeUserId.Value) && OpenStatuses.Contains(t.Status))
                .GroupBy(t => new { t.AssigneeUserId, t.Priority })
                .Select(g => new { g.Key.AssigneeUserId, g.Key.Priority, Count = g.Count() })
                .ToListAsync();
            return rows.GroupBy(r => r.AssigneeUserId!.Value)
                .ToDictionary(g => g.Key, g => (g.Sum(r => r.Count * Weight(r.Priority)), g.Sum(r => r.Count)));
        }

        private int Weight(TicketPriority priority) => priority switch
        {
            TicketPriority.Critical => _options.WeightCritical,
            TicketPriority.High => _options.WeightHigh,
            TicketPriority.Medium => _options.WeightMedium,
            _ => _options.WeightLow
        };

        private async Task<bool> IsWorkingInUnitAsync(Guid userId, Guid unitId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.UnitId == unitId && m.IsActive)
            && await _availability.IsAvailableAsync(userId);

        /// <summary>
        /// Puts the ticket with this person in this unit: status Assigned (a reopened ticket stays Reopened), a new acknowledgement
        /// window (FR-5.11), flags cleared. The status change is recorded for the SLA clock.
        /// </summary>
        private async Task ApplyAsync(Ticket ticket, Guid userId, Guid unitId, DateTime now, Guid? byUserId = null, string? why = null)
        {
            var newStatus = ticket.Status == TicketStatus.Reopened ? TicketStatus.Reopened : TicketStatus.Assigned;
            if (newStatus != ticket.Status)
                _db.TicketStatusChanges.Add(new TicketStatusChange
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = ticket.Status, ToStatus = newStatus, ByUserId = byUserId,
                    Reason = why == null ? null : (why.Length > 500 ? why.Substring(0, 500) : why), At = now
                });
            ticket.AssigneeUserId = userId;
            ticket.UnitId = unitId;
            ticket.Status = newStatus;
            ticket.AssignedAt = now;
            ticket.AcknowledgedAt = null;
            ticket.EscalatedToHeadAt = null;
            ticket.EscalatedToHeadByUserId = null;
            ticket.EscalatedToHeadReason = null;
            ticket.QueueAlertedAt = null;
            ticket.AssigneeAwayFlaggedAt = null;
            ticket.UpdatedAt = now;
            var member = await _db.UnitMembers.FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive);
            if (member != null) member.LastAssignedAt = now;
        }

        // ---------------- reassignment ----------------

        private enum Scope { None, Unit, Department }

        private static Scope ScopeOf(Ticket ticket, Guid actorUserId, bool actorIsSuperAdmin)
        {
            if (actorIsSuperAdmin || ticket.Department!.HodUserId == actorUserId || ticket.Department!.AdminUserId == actorUserId) return Scope.Department;
            if (ticket.Unit!.HeadUserId == actorUserId && ticket.Unit.IsActive) return Scope.Unit;
            if (ticket.AssigneeUserId == actorUserId) return Scope.Unit;
            return Scope.None;
        }

        private async Task<(TicketProblem? Problem, Ticket? Ticket, Scope Scope)> LoadForStaffAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.Include(t => t.Unit).Include(t => t.Department).Include(t => t.Category).Include(t => t.AssigneeUser)
                .FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null, Scope.None);
            var isStaff = actorIsSuperAdmin || await TicketAccess.IsStaffForTicketAsync(_db, actorUserId, ticket.DepartmentId, ticket.UnitId);
            if (!isStaff)
            {
                var canView = ticket.RequesterUserId == actorUserId || ticket.RaisedByUserId == actorUserId
                    || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticketId && w.UserId == actorUserId);
                return (canView ? new TicketProblem(403, "Only staff of " + ticket.Department!.Name + " can see or change who handles a ticket.")
                                : new TicketProblem(404, "Ticket not found."), null, Scope.None);
            }
            return (null, ticket, ScopeOf(ticket, actorUserId, actorIsSuperAdmin));
        }

        private async Task<List<ReassignCandidateDto>> CandidatesAsync(Ticket ticket, Scope scope)
        {
            var units = scope == Scope.Department
                ? await _db.Units.AsNoTracking().Where(u => u.DepartmentId == ticket.DepartmentId && u.IsActive).Select(u => new { u.Id, u.Name, u.HeadUserId }).ToListAsync()
                : new[] { new { Id = ticket.UnitId, Name = ticket.Unit!.Name, HeadUserId = ticket.Unit.HeadUserId } }.ToList();
            var mapped = (await _catalogue.EligibleCaseWorkerIdsAsync(ticket.CategoryId)).ToHashSet();
            var result = new List<ReassignCandidateDto>();
            foreach (var unit in units)
            {
                var available = await _availability.AvailableMemberIdsAsync(unit.Id);
                if (scope == Scope.Unit) available = available.Where(id => mapped.Contains(id) || id == unit.HeadUserId).ToList();
                if (available.Count == 0) continue;
                var people = await _db.Users.AsNoTracking().Where(u => available.Contains(u.Id))
                    .Select(u => new { u.Id, u.UserName, u.FullName }).ToListAsync();
                result.AddRange(people.Select(p => new ReassignCandidateDto
                {
                    UserId = p.Id, UserName = p.UserName ?? string.Empty, FullName = p.FullName, UnitId = unit.Id, UnitName = unit.Name,
                    HandlesCategory = mapped.Contains(p.Id) && unit.Id == ticket.Category!.UnitId, IsCurrentAssignee = p.Id == ticket.AssigneeUserId
                }));
            }
            var loads = await WorkloadsAsync(result.Select(r => r.UserId).ToList());
            foreach (var r in result) r.Workload = loads.GetValueOrDefault(r.UserId).Workload;
            return result.OrderByDescending(r => r.UnitId == ticket.UnitId).ThenByDescending(r => r.HandlesCategory).ThenBy(r => r.Workload)
                .ThenBy(r => r.FullName ?? r.UserName).ToList();
        }

        public async Task<(TicketProblem? Problem, ReassignOptionsDto? Options)> GetReassignOptionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, scope) = await LoadForStaffAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!MovableStatuses.Contains(ticket!.Status))
                return (null, new ReassignOptionsDto { CanReassign = false, Reason = "A " + StatusText(ticket.Status) + " ticket cannot be reassigned." });
            if (scope == Scope.None)
                return (null, new ReassignOptionsDto { CanReassign = false, Reason = "Only the person handling it, the head of " + ticket.Unit!.Name + ", the Head of Department or a Super Admin can reassign it." });
            return (null, new ReassignOptionsDto { CanReassign = true, Candidates = await CandidatesAsync(ticket, scope) });
        }

        public async Task<(TicketProblem? Problem, string? Message)> ReassignAsync(Guid ticketId, ReassignRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 5 || reason.Length > 500) return (new TicketProblem(400, "Give a reason (5 to 500 characters).", "reason"), null);
            if (request.ToUserId == Guid.Empty) return (new TicketProblem(400, "Choose who should handle it.", "toUserId"), null);

            await Gate.WaitAsync();
            try
            {
                var (problem, ticket, scope) = await LoadForStaffAsync(ticketId, actorUserId, actorIsSuperAdmin);
                if (problem != null) return (problem, null);
                if (scope == Scope.None)
                    return (new TicketProblem(403, "Only the person handling it, the head of " + ticket!.Unit!.Name + ", the Head of Department or a Super Admin can reassign it."), null);
                if (!MovableStatuses.Contains(ticket!.Status))
                    return (new TicketProblem(400, "A " + StatusText(ticket.Status) + " ticket cannot be reassigned."), null);
                if (ticket.AssigneeUserId == request.ToUserId)
                    return (new TicketProblem(400, "They already have this ticket.", "toUserId"), null);

                var target = (await CandidatesAsync(ticket, scope)).FirstOrDefault(c => c.UserId == request.ToUserId);
                if (target == null)
                    return (new TicketProblem(400, scope == Scope.Unit
                        ? "Choose an available member of " + ticket.Unit!.Name + " who handles " + ticket.Category!.Name + "."
                        : "Choose an available member of a unit of " + ticket.Department!.Name + ".", "toUserId"), null);

                var previous = ticket.AssigneeUserId;
                var fromUnitId = ticket.UnitId;
                var now = DateTime.UtcNow;
                await ApplyAsync(ticket, target.UserId, target.UnitId, now, actorUserId, reason);
                _db.TicketAssignments.Add(new TicketAssignment
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromUserId = previous, ToUserId = target.UserId, Method = AssignmentMethod.Reassigned,
                    Reason = reason, ByUserId = actorUserId, FromUnitId = fromUnitId, ToUnitId = target.UnitId, At = now
                });
                Stage(AuditAction.Reassigned, ticket, previous, target.UserId, reason, null);

                var actorName = await NameOfAsync(actorUserId);
                var targetName = target.FullName ?? target.UserName;
                var link = "/tickets/" + ticket.Reference;
                var shortReason = EmailSafety.Redact(reason.Length > 200 ? reason.Substring(0, 200) + "..." : reason);
                if (target.UserId != actorUserId)
                    _notifications.Stage(target.UserId, "Ticket " + ticket.Reference + " assigned to you",
                        actorName + " passed it to you: " + shortReason, NotificationType.ActionRequired, NotificationCategory.Assignment, "Ticket", ticket.Id, link);
                if (previous.HasValue && previous != actorUserId)
                    _notifications.Stage(previous.Value, "Ticket " + ticket.Reference + " reassigned",
                        actorName + " moved it to " + targetName + ".", NotificationType.Info, NotificationCategory.Assignment, "Ticket", ticket.Id, link);
                if (target.UnitId != fromUnitId)
                {
                    var newUnit = await _db.Units.AsNoTracking().FirstAsync(u => u.Id == target.UnitId);
                    TellHeads(newUnit, actorUserId, "Ticket " + ticket.Reference + " moved to " + newUnit.Name,
                        actorName + " moved it from " + ticket.Unit!.Name + " to " + targetName + ".", NotificationType.Info, ticket);
                }

                try { await _db.SaveChangesAsync(); }
                catch (DbUpdateConcurrencyException)
                {
                    return (new TicketProblem(409, "The ticket changed at the same moment. Reload it and try again."), null);
                }
                return (null, "Ticket " + ticket.Reference + " is now with " + targetName + ".");
            }
            finally
            {
                _db.ChangeTracker.Clear();
                Gate.Release();
            }
        }

        public async Task<(TicketProblem? Problem, List<TicketAssignmentDto>? History)> GetHistoryAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, _, _) = await LoadForStaffAsync(ticketId, actorUserId, actorIsSuperAdmin);
            _db.ChangeTracker.Clear();
            if (problem != null) return (problem, null);

            var rows = await _db.TicketAssignments.AsNoTracking().Where(a => a.TicketId == ticketId).OrderBy(a => a.At).ToListAsync();
            var people = await PeopleAsync(rows.SelectMany(r => new[] { r.FromUserId, r.ByUserId, (Guid?)r.ToUserId }).Where(x => x.HasValue).Select(x => x!.Value));
            var unitIds = rows.SelectMany(r => new[] { r.FromUnitId, r.ToUnitId }).Distinct().ToList();
            var units = await _db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Name);
            return (null, rows.Select(r => new TicketAssignmentDto
            {
                Id = r.Id, At = r.At, Method = r.Method, Reason = r.Reason,
                From = r.FromUserId.HasValue ? people[r.FromUserId.Value] : null,
                To = people[r.ToUserId],
                By = r.ByUserId.HasValue ? people[r.ByUserId.Value] : null,
                FromUnitName = units.GetValueOrDefault(r.FromUnitId) ?? string.Empty,
                ToUnitName = units.GetValueOrDefault(r.ToUnitId) ?? string.Empty,
                Scores = string.IsNullOrEmpty(r.ScoresJson) ? new List<CandidateScoreDto>() : JsonSerializer.Deserialize<List<CandidateScoreDto>>(r.ScoresJson) ?? new List<CandidateScoreDto>()
            }).ToList());
        }

        // ---------------- picking from the unit pool ----------------

        public async Task<List<PoolTicketDto>> ListPoolAsync(Guid actorUserId)
        {
            var memberUnits = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UserId == actorUserId && m.IsActive && m.Unit!.IsActive)
                .Select(m => m.UnitId).ToListAsync();
            if (memberUnits.Count == 0) return new List<PoolTicketDto>();
            var headOf = await _db.Units.AsNoTracking().Where(u => u.HeadUserId == actorUserId).Select(u => u.Id).ToListAsync();
            var mySkills = await _db.CategorySkills.AsNoTracking().Where(s => s.UserId == actorUserId && s.IsActive).Select(s => s.CategoryId).ToListAsync();

            var rows = await _db.Tickets.AsNoTracking()
                .Where(t => t.Status == TicketStatus.New && t.AssigneeUserId == null && memberUnits.Contains(t.UnitId))
                .Where(t => headOf.Contains(t.UnitId) || mySkills.Contains(t.CategoryId))
                .OrderBy(t => t.CreatedAt).Take(200)
                .Select(t => new PoolTicketDto
                {
                    Id = t.Id, Reference = t.Reference, UnitId = t.UnitId, UnitName = t.Unit!.Name, CategoryId = t.CategoryId,
                    CategoryName = t.Category!.Name, Priority = t.Priority, CreatedAt = t.CreatedAt
                }).ToListAsync();
            return rows;
        }

        /// <summary>
        /// The unit pool, one page at a time (oldest first). Members see their mapped categories, a head sees every category of the unit.
        /// search matches the reference, subject, category and unit name across the whole pool; unitId narrows to one unit; Units counts the matches per unit.
        /// </summary>
        public async Task<PoolPageDto> ListPoolPageAsync(Guid actorUserId, string? search, Guid? unitId, int page, int pageSize)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize <= 0 ? 10 : pageSize, 1, 100);
            var memberUnits = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UserId == actorUserId && m.IsActive && m.Unit!.IsActive)
                .Select(m => m.UnitId).ToListAsync();
            if (memberUnits.Count == 0) return new PoolPageDto { Page = page, PageSize = pageSize };
            var headOf = await _db.Units.AsNoTracking().Where(u => u.HeadUserId == actorUserId).Select(u => u.Id).ToListAsync();
            var mySkills = await _db.CategorySkills.AsNoTracking().Where(s => s.UserId == actorUserId && s.IsActive).Select(s => s.CategoryId).ToListAsync();

            IQueryable<Ticket> pool = _db.Tickets.AsNoTracking()
                .Where(t => t.Status == TicketStatus.New && t.AssigneeUserId == null && memberUnits.Contains(t.UnitId))
                .Where(t => headOf.Contains(t.UnitId) || mySkills.Contains(t.CategoryId));
            var term = (search ?? string.Empty).Trim();
            if (term.Length > 0)
                pool = pool.Where(t => t.Reference.Contains(term) || t.Subject.Contains(term) || t.Category!.Name.Contains(term) || t.Unit!.Name.Contains(term));

            var unitCounts = await pool.GroupBy(t => t.UnitId).Select(g => new { Id = g.Key, Count = g.Count() }).ToListAsync();
            var unitIds = unitCounts.Select(c => c.Id).ToList();
            var unitNames = await _db.Units.AsNoTracking().Where(u => unitIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Name);
            if (unitId.HasValue)
            {
                var one = unitId.Value;
                pool = pool.Where(t => t.UnitId == one);
            }
            var total = await pool.CountAsync();
            var rows = await pool.OrderBy(t => t.CreatedAt).ThenBy(t => t.Id).Skip((page - 1) * pageSize).Take(pageSize)
                .Select(t => new PoolRowDto
                {
                    Id = t.Id, Reference = t.Reference, Subject = t.Subject, UnitId = t.UnitId, UnitName = t.Unit!.Name, CategoryId = t.CategoryId,
                    CategoryName = t.Category!.Name, Priority = t.Priority, CreatedAt = t.CreatedAt
                }).ToListAsync();
            return new PoolPageDto
            {
                Items = rows, Total = total, Page = page, PageSize = pageSize,
                Units = unitCounts.Select(c => new PoolUnitCountDto { Id = c.Id, Name = unitNames.TryGetValue(c.Id, out var n) ? n : string.Empty, Count = c.Count })
                    .OrderBy(u => u.Name).ToList()
            };
        }

        public async Task<(TicketProblem? Problem, string? Message)> PickAsync(Guid ticketId, Guid actorUserId)
        {
            await Gate.WaitAsync();
            try
            {
                var (problem, ticket, _) = await LoadForStaffAsync(ticketId, actorUserId, false);
                if (problem != null) return (problem, null);
                if (ticket!.Status != TicketStatus.New || ticket.AssigneeUserId.HasValue)
                    return (new TicketProblem(409, "This ticket is no longer waiting in the pool."), null);
                if (!await _db.UnitMembers.AnyAsync(m => m.UserId == actorUserId && m.UnitId == ticket.UnitId && m.IsActive))
                    return (new TicketProblem(403, "Only members of " + ticket.Unit!.Name + " can pick from its pool."), null);
                var isHead = ticket.Unit!.HeadUserId == actorUserId;
                if (!isHead && !(await _catalogue.EligibleCaseWorkerIdsAsync(ticket.CategoryId)).Contains(actorUserId))
                    return (new TicketProblem(403, "You are not mapped to " + ticket.Category!.Name + ". Ask the head of " + ticket.Unit.Name + " to assign it."), null);
                if (!await _availability.IsAvailableAsync(actorUserId))
                    return (new TicketProblem(400, "You are marked unavailable today."), null);

                var now = DateTime.UtcNow;
                const string why = "Picked from the unit pool";
                await ApplyAsync(ticket, actorUserId, ticket.UnitId, now, actorUserId, why);
                _db.TicketAssignments.Add(new TicketAssignment
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromUserId = null, ToUserId = actorUserId, Method = AssignmentMethod.Picked,
                    Reason = why, ByUserId = actorUserId, FromUnitId = ticket.UnitId, ToUnitId = ticket.UnitId, At = now
                });
                Stage(AuditAction.Assigned, ticket, null, actorUserId, why, null);

                var name = await NameOfAsync(actorUserId);
                var link = "/tickets/" + ticket.Reference;
                _notifications.Stage(ticket.RequesterUserId, "Ticket " + ticket.Reference + " picked up",
                    name + " in " + ticket.Unit.Name + " is handling your " + ticket.Category!.Name + " request.",
                    NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);
                TellHeads(ticket.Unit, actorUserId, "Ticket " + ticket.Reference + " picked",
                    name + " picked it from the pool.", NotificationType.Info, ticket);

                try { await _db.SaveChangesAsync(); }
                catch (DbUpdateConcurrencyException)
                {
                    return (new TicketProblem(409, "Someone else took this ticket at the same moment."), null);
                }
                return (null, "Ticket " + ticket.Reference + " is now yours. Acknowledge it to start work.");
            }
            finally
            {
                _db.ChangeTracker.Clear();
                Gate.Release();
            }
        }
        // ---------------- people search (for copying colleagues) ----------------

        public async Task<(TicketProblem? Problem, List<PersonSearchResultDto>? People)> SearchPeopleAsync(string? query, Guid actorUserId)
        {
            var term = (query ?? string.Empty).Trim();
            if (term.Length < 2) return (new TicketProblem(400, "Type at least 2 letters.", "query"), null);
            if (term.Length > 100) term = term.Substring(0, 100);
            var people = await _db.Users.AsNoTracking()
                .Where(u => u.IsActive && u.Id != actorUserId && ((u.UserName != null && u.UserName.Contains(term)) || (u.FullName != null && u.FullName.Contains(term))))
                .OrderBy(u => u.FullName ?? u.UserName)
                .Take(20)
                .Select(u => new PersonSearchResultDto(u.Id, u.UserName ?? string.Empty, u.FullName, u.Department))
                .ToListAsync();
            return (null, people);
        }

        // ---------------- helpers ----------------

        private void TellHeads(Unit unit, Guid? except, string title, string message, NotificationType type, Ticket ticket)
        {
            foreach (var head in ServiceDeskAPI.Infrastructure.Organisation.HeadContacts.For(_db, unit.Id, _availability.Today()).Select(h => (Guid?)h).Where(h => h.HasValue && h != except).Distinct())
                _notifications.Stage(head!.Value, title, message, type, NotificationCategory.Assignment, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private async Task<bool> IsDepartmentStaffAsync(Guid userId, Guid departmentId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == departmentId)
            || await _db.Departments.AnyAsync(d => d.Id == departmentId && d.HodUserId == userId);

        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private async Task<Dictionary<Guid, PersonDto>> PeopleAsync(IEnumerable<Guid> ids)
        {
            var list = ids.Distinct().ToList();
            var found = await _db.Users.AsNoTracking().Where(u => list.Contains(u.Id))
                .Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).ToListAsync();
            var map = found.ToDictionary(p => p.UserId);
            foreach (var id in list.Where(id => !map.ContainsKey(id))) map[id] = new PersonDto(id, string.Empty, null);
            return map;
        }

        private void Stage(AuditAction action, Ticket ticket, Guid? from, Guid to, string reason, int? candidates)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName ?? "System", action, "Ticket", ticket.Id, ticket.Reference,
                from.HasValue ? JsonSerializer.Serialize(new { assignee = from }) : null,
                JsonSerializer.Serialize(new { assignee = to, unitId = ticket.UnitId, reason = EmailSafety.Redact(reason), candidates }),
                actor.IpAddress, actor.UserAgent, AuditModule.Assignment);
        }

        private static string StatusText(TicketStatus status) => status switch
        {
            TicketStatus.InProgress => "in-progress",
            _ => status.ToString().ToLowerInvariant()
        };

        private static string Name(User? user) => user == null ? "The assignee" : string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "The assignee" : user.FullName;
    }
}