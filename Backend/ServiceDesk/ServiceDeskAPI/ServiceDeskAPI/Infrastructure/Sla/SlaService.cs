using System.Globalization;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>
    /// The SLA clock. Time used = business minutes since the ticket was raised, minus the time it spent Pending or Resolved (read from TicketStatusChanges).
    /// Level 1 = warning, 2 = overdue (the unit's head), 3 = far past (the Head of Department and the Department Admin, who only watch).
    /// </summary>
    public sealed class SlaService : ISlaService
    {
        private static readonly TicketStatus[] Running = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Reopened };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly SlaOptions _options;
        private readonly ILogger<SlaService> _logger;

        public SlaService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IOptions<SlaOptions> options, ILogger<SlaService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _options = options.Value;
            _logger = logger;
        }

        public async Task<int> CheckAsync(DateTime nowUtc, CancellationToken cancellationToken = default)
        {
            var clock = BusinessClock.From(_options);
            await CheckFirstResponseAsync(clock, nowUtc, cancellationToken);
            await CheckPendingAsync(clock, nowUtc, cancellationToken);
            await CheckTasksAsync(nowUtc, cancellationToken);
            try { await SlaDueStore.RefreshAsync(_db, _options, nowUtc, null, cancellationToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogError(ex, "Saving the SLA due times failed; the checks go on"); }
            finally { _db.ChangeTracker.Clear(); } // the refresh changes the row version behind the context; drop copies an earlier check left in memory so the alerts below read fresh rows
            var query = _db.Tickets.AsNoTracking().Where(t => Running.Contains(t.Status) && t.SlaL2At == null);
            if (DateTime.TryParse(_options.TrackFrom, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var trackFrom))
                query = query.Where(t => t.CreatedAt >= trackFrom);
            var candidates = await query
                .Select(t => new { t.Id, t.CreatedAt, t.SlaWarnedAt, t.SlaBreachedAt, t.CategoryId, t.DepartmentId, t.Priority })
                .ToListAsync(cancellationToken);
            if (candidates.Count == 0) return 0;
            var targets = await SlaTargets.LoadAsync(_db);

            var ids = candidates.Select(c => c.Id).ToList();
            var changes = (await _db.TicketStatusChanges.AsNoTracking().Where(c => ids.Contains(c.TicketId)).OrderBy(c => c.At)
                .Select(c => new { c.TicketId, c.ToStatus, c.At }).ToListAsync(cancellationToken))
                .ToLookup(c => c.TicketId);

            var moved = 0;
            foreach (var c in candidates)
            {
                var hours = targets.ResolutionHours(c.CategoryId, c.DepartmentId, c.Priority);
                if (hours <= 0) continue;
                double paused = 0;
                DateTime? pausedFrom = null;
                foreach (var ch in changes[c.Id])
                {
                    if (ch.ToStatus is TicketStatus.Pending or TicketStatus.Resolved) pausedFrom ??= ch.At < c.CreatedAt ? c.CreatedAt : ch.At;
                    else if (pausedFrom.HasValue) { paused += clock.BusinessMinutes(pausedFrom.Value, ch.At); pausedFrom = null; }
                }
                if (pausedFrom.HasValue) paused += clock.BusinessMinutes(pausedFrom.Value, nowUtc);
                var used = Math.Max(0, clock.BusinessMinutes(c.CreatedAt, nowUtc) - paused);
                var percent = used / (hours * 60.0) * 100.0;

                var level = percent >= _options.L2Percent ? 3 : percent >= _options.L1Percent ? 2 : percent >= _options.WarnPercent ? 1 : 0;
                var stored = c.SlaBreachedAt.HasValue ? 2 : c.SlaWarnedAt.HasValue ? 1 : 0; // level 3 tickets are not selected
                if (level > stored && await ApplyAsync(c.Id, stored, level, percent, nowUtc, cancellationToken)) moved++;
            }
            return moved;
        }

                /// <summary>
        /// A ticket nobody has acknowledged or answered within its response target (business hours, by priority, from when it was raised; see SlaTargets).
        /// With an assignee the miss is recorded once against them (they always get at least an hour after it reached them) and they are reminded; with nobody holding it the
        /// unit is answerable. The unit's head is told either way. The old setting FirstResponseHours now only switches the check off (0).
        /// </summary>
        private async Task CheckFirstResponseAsync(BusinessClock clock, DateTime nowUtc, CancellationToken ct)
        {
            if (_options.FirstResponseHours <= 0) return;
            var targets = await SlaTargets.LoadAsync(_db);
            var query = _db.Tickets.Where(t => t.FirstRespondedAt == null && t.FirstResponseMissedAt == null
                && (t.Status == TicketStatus.New || t.Status == TicketStatus.Assigned || t.Status == TicketStatus.InProgress || t.Status == TicketStatus.Reopened));
            if (DateTime.TryParse(_options.TrackFrom, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var trackFrom))
                query = query.Where(t => t.CreatedAt >= trackFrom);
            var candidates = await query.OrderBy(t => t.CreatedAt).Take(200).ToListAsync(ct);

            var changed = false;
            foreach (var ticket in candidates)
            {
                var hours = targets.ResponseHours(ticket.CategoryId, ticket.DepartmentId, ticket.Priority);
                if (hours <= 0) continue;
                var due = clock.AddBusinessMinutes(ticket.CreatedAt, hours * 60.0);
                if (ticket.AssignedAt.HasValue && ticket.AssigneeUserId.HasValue)
                {
                    var grace = clock.AddBusinessMinutes(ticket.AssignedAt.Value, Math.Min(hours, 1) * 60.0);
                    if (grace > due) due = grace;
                }
                if (nowUtc <= due) continue;

                ticket.FirstResponseMissedAt = nowUtc;
                ticket.FirstResponseMissedByUserId = ticket.AssigneeUserId;
                var heads = await ServiceDeskAPI.Infrastructure.Organisation.HeadContacts.ForAsync(_db, ticket.UnitId, DateOnly.FromDateTime(nowUtc.AddHours(_options.UtcOffsetHours)), ct);
                if (ticket.AssigneeUserId.HasValue)
                {
                    Tell(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + " needs a first response",
                        "The first-response time (" + hours + " working hours) has run out and it has not been acknowledged or answered. Please do it now.",
                        NotificationType.ActionRequired, NotificationCategory.Escalation, ticket);
                    foreach (var head in heads.Where(h => h != ticket.AssigneeUserId).Distinct())
                        Tell(head, "Ticket " + ticket.Reference + ": no first response",
                            "The case worker has not responded within " + hours + " working hours.", NotificationType.Warning, NotificationCategory.Escalation, ticket);
                }
                else
                {
                    foreach (var head in heads.Distinct())
                        Tell(head, "Ticket " + ticket.Reference + ": still waiting, no response",
                            "Nobody has picked it up and the first-response time (" + hours + " working hours) has run out. Assign it or pick it from the pool.",
                            NotificationType.ActionRequired, NotificationCategory.Escalation, ticket);
                }
                changed = true;
            }
            if (!changed) return;
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { _logger.LogInformation("First-response check: a ticket changed at the same moment; it will be looked at again in the next pass"); }
            finally { _db.ChangeTracker.Clear(); }
        }

        /// <summary>
        /// Tickets that sit in Pending. Working days are counted from PendingSince with the same business clock as the SLA. Once per wait: a reminder counts as sent when it is stamped on or after PendingSince,
        /// so a ticket that is resumed and goes Pending again is reminded afresh. Requester waits: reminder, second reminder (the case worker is told too). Third-party waits: the case worker is nudged.
        /// Either way the unit head is told once the wait is long. Nothing is closed or changed by this check. A setting of 0 switches that step off.
        /// </summary>
        private async Task CheckPendingAsync(BusinessClock clock, DateTime nowUtc, CancellationToken ct)
        {
            var first = _options.PendingRequesterRemindDays;
            var again = _options.PendingRequesterRemindAgainDays;
            var nudge = _options.PendingThirdPartyNudgeDays;
            var flag = _options.PendingFlagHeadDays;
            if (first <= 0 && again <= 0 && nudge <= 0 && flag <= 0) return;

            var query = _db.Tickets.Include(t => t.Category).Where(t => t.Status == TicketStatus.Pending && t.PendingSince != null);
            if (DateTime.TryParse(_options.TrackFrom, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var trackFrom))
                query = query.Where(t => t.CreatedAt >= trackFrom);
            var candidates = await query.OrderBy(t => t.PendingSince).Take(1000).ToListAsync(ct);
            if (candidates.Count == 0) return;

            var hoursPerDay = _options.WorkdayEndHour - _options.WorkdayStartHour;
            var dayMinutes = (hoursPerDay > 0 ? hoursPerDay : 9) * 60.0;
            var changed = false;
            foreach (var ticket in candidates)
            {
                var since = ticket.PendingSince!.Value;
                var days = clock.BusinessMinutes(since, nowUtc) / dayMinutes;
                var d = (int)Math.Floor(days);
                var category = ticket.Category?.Name ?? "service";

                if (ticket.PendingReason == PendingReason.Requester)
                {
                    if (again > 0 && days >= again && !Stamped(ticket.PendingReminder2At, since))
                    {
                        Tell(ticket.RequesterUserId, "Ticket " + ticket.Reference + ": second reminder, your reply is needed",
                            "Your " + category + " request has been waiting for your reply for " + d + " working days. Please reply on the ticket so work can continue.",
                            NotificationType.ActionRequired, NotificationCategory.Ticket, ticket);
                        if (ticket.AssigneeUserId.HasValue)
                            Tell(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + ": requester has not replied",
                                "The requester has not replied after " + d + " working days. You may want to follow up with them.",
                                NotificationType.Info, NotificationCategory.Ticket, ticket);
                        ticket.PendingReminder2At = nowUtc;
                        if (!Stamped(ticket.PendingReminder1At, since)) ticket.PendingReminder1At = nowUtc;
                        changed = true;
                    }
                    else if (first > 0 && days >= first && !Stamped(ticket.PendingReminder1At, since) && !Stamped(ticket.PendingReminder2At, since))
                    {
                        Tell(ticket.RequesterUserId, "Ticket " + ticket.Reference + ": reminder, your reply is needed",
                            "Your " + category + " request is waiting for your reply. Please reply on the ticket so work can continue.",
                            NotificationType.ActionRequired, NotificationCategory.Ticket, ticket);
                        ticket.PendingReminder1At = nowUtc;
                        changed = true;
                    }
                }
                else if (ticket.PendingReason == PendingReason.ThirdParty
                    && nudge > 0 && days >= nudge && !Stamped(ticket.PendingNudgeAt, since) && ticket.AssigneeUserId.HasValue)
                {
                    Tell(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + ": chase the third party",
                        "It has been waiting on a third party for " + d + " working days. Please follow up with them.",
                        NotificationType.ActionRequired, NotificationCategory.Ticket, ticket);
                    ticket.PendingNudgeAt = nowUtc;
                    changed = true;
                }

                if (flag > 0 && days >= flag && !Stamped(ticket.PendingFlaggedAt, since))
                {
                    var heads = await ServiceDeskAPI.Infrastructure.Organisation.HeadContacts.ForAsync(_db, ticket.UnitId, DateOnly.FromDateTime(nowUtc.AddHours(_options.UtcOffsetHours)), ct);
                    var on = ticket.PendingReason == PendingReason.Requester ? "the requester" : "a third party";
                    foreach (var head in heads.Where(h => h != ticket.AssigneeUserId).Distinct())
                        Tell(head, "Ticket " + ticket.Reference + ": Pending for " + d + " working days",
                            "This " + category + " request has been waiting on " + on + " for " + d + " working days. Please check that it is not stuck.",
                            NotificationType.Warning, NotificationCategory.Escalation, ticket);
                    ticket.PendingFlaggedAt = nowUtc;
                    changed = true;
                }
            }
            if (!changed) return;
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { _logger.LogInformation("Pending check: a ticket changed at the same moment; it will be looked at again in the next pass"); }
            finally { _db.ChangeTracker.Clear(); }
        }

        
        /// <summary>
        /// Open tasks on open tickets whose due date has passed (Lagos date): the person who owns the task (or the ticket's assignee when it has no owner) is told once.
        /// A new due date or a new owner starts it again.
        /// </summary>
        private async Task CheckTasksAsync(DateTime nowUtc, CancellationToken ct)
        {
            var today = nowUtc.AddHours(_options.UtcOffsetHours).Date;
            var due = await _db.TicketTasks.Include(x => x.Ticket)
                .Where(x => !x.IsDone && x.CancelledAt == null && x.RejectedAt == null && x.DueAt != null && x.OverdueNotifiedAt == null && x.DueAt < today
                    && x.Ticket!.Status != TicketStatus.Closed && x.Ticket.Status != TicketStatus.Cancelled && x.Ticket.Status != TicketStatus.Resolved)
                .OrderBy(x => x.DueAt).Take(500).ToListAsync(ct);
            if (due.Count == 0) return;
            foreach (var task in due)
            {
                var ticket = task.Ticket!;
                var owner = task.AssigneeUserId ?? ticket.AssigneeUserId;
                if (owner.HasValue)
                    Tell(owner.Value, "Ticket " + ticket.Reference + ": a task is overdue",
                        task.Title + " was due on " + task.DueAt!.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) + ".",
                        NotificationType.ActionRequired, NotificationCategory.Ticket, ticket);
                if (task.AssigneeUserId.HasValue && ticket.AssigneeUserId.HasValue && task.AssigneeUserId != ticket.AssigneeUserId)
                    Tell(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + ": a task is overdue",
                        task.Title + " (owned by someone else) was due on " + task.DueAt!.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) + ".",
                        NotificationType.Info, NotificationCategory.Ticket, ticket);
                task.OverdueNotifiedAt = nowUtc;
            }
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateConcurrencyException) { _logger.LogInformation("Task check: a ticket changed at the same moment; it will be looked at again in the next pass"); }
            finally { _db.ChangeTracker.Clear(); }
        }

        private static bool Stamped(DateTime? at, DateTime since) => at.HasValue && at.Value >= since;

        private async Task<bool> ApplyAsync(Guid ticketId, int stored, int level, double percent, DateTime now, CancellationToken ct)
        {
            var ticket = await _db.Tickets.Include(t => t.Category).FirstOrDefaultAsync(t => t.Id == ticketId, ct);
            if (ticket == null || !Running.Contains(ticket.Status)) return false;
            var unit = await _db.Units.AsNoTracking().FirstAsync(u => u.Id == ticket.UnitId, ct);
            var department = await _db.Departments.AsNoTracking().FirstAsync(d => d.Id == ticket.DepartmentId, ct);
            var category = ticket.Category!.Name;
            var rounded = (int)Math.Round(percent);
            var heads = await ServiceDeskAPI.Infrastructure.Organisation.HeadContacts.ForAsync(_db, unit.Id, DateOnly.FromDateTime(now.AddHours(_options.UtcOffsetHours)), ct);

            if (level >= 1) ticket.SlaWarnedAt ??= now;
            if (level >= 2) ticket.SlaBreachedAt ??= now;
            if (level >= 3) ticket.SlaL2At ??= now;

            // The warning is only sent when the ticket has not already gone past it
            if (level == 1)
            {
                var title = "Ticket " + ticket.Reference + " is nearing its deadline";
                var message = rounded + "% of the time allowed for this " + category + " request is used.";
                var people = ticket.AssigneeUserId.HasValue ? new List<Guid> { ticket.AssigneeUserId.Value } : heads;
                foreach (var p in people) Tell(p, title, message, NotificationType.ActionRequired, NotificationCategory.Ticket, ticket);
            }
            if (level >= 2 && stored < 2)
            {
                var title = "Ticket " + ticket.Reference + " is overdue";
                var message = "The time allowed for this " + category + " request has run out.";
                var people = new List<Guid>(heads);
                if (ticket.AssigneeUserId.HasValue) people.Add(ticket.AssigneeUserId.Value);
                foreach (var p in people.Distinct()) Tell(p, title, message, NotificationType.ActionRequired, NotificationCategory.Escalation, ticket);
                StageAudit(ticket, 1, rounded);
            }
            if (level >= 3)
            {
                // The Head of Department and the Department Admin only watch. The unit's own head already knows from level 2.
                var title = "Ticket " + ticket.Reference + " is far past its deadline";
                var message = "This " + category + " request in " + unit.Name + " is well past the time allowed.";
                var watchers = new[] { department.HodUserId, department.AdminUserId }.Where(w => w.HasValue).Select(w => w!.Value).Distinct().Where(w => !heads.Contains(w));
                foreach (var w in watchers) Tell(w, title, message, NotificationType.Info, NotificationCategory.Escalation, ticket);
                StageAudit(ticket, 2, rounded);
            }

            try
            {
                await _db.SaveChangesAsync(ct);
                return true;
            }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                _logger.LogInformation("SLA: ticket {Id} changed at the same moment; it will be looked at again in the next pass", ticketId);
                return false;
            }
        }

        private void Tell(Guid recipient, string title, string message, NotificationType type, NotificationCategory category, Ticket ticket) =>
            _notifications.Stage(recipient, title, message, type, category, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);

        private void StageAudit(Ticket ticket, int escalationLevel, int percent) =>
            _audit.Stage(null, "System", AuditAction.SlaBreached, "Ticket", ticket.Id, ticket.Reference, null,
                JsonSerializer.Serialize(new { level = escalationLevel, percentUsed = percent, status = ticket.Status.ToString() }), null, null, AuditModule.Tickets);
    }
}