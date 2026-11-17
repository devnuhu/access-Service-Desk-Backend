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
    /// Level 1 = warning, 2 = overdue (the unit's head and deputy), 3 = far past (the Head of Department and the Department Admin, who only watch).
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
            var query = _db.Tickets.AsNoTracking().Where(t => Running.Contains(t.Status) && t.SlaL2At == null);
            if (DateTime.TryParse(_options.TrackFrom, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var trackFrom))
                query = query.Where(t => t.CreatedAt >= trackFrom);
            var candidates = await query
                .Select(t => new { t.Id, t.CreatedAt, t.SlaWarnedAt, t.SlaBreachedAt, Hours = t.Category!.TimelineHours })
                .ToListAsync(cancellationToken);
            if (candidates.Count == 0) return 0;

            var ids = candidates.Select(c => c.Id).ToList();
            var changes = (await _db.TicketStatusChanges.AsNoTracking().Where(c => ids.Contains(c.TicketId)).OrderBy(c => c.At)
                .Select(c => new { c.TicketId, c.ToStatus, c.At }).ToListAsync(cancellationToken))
                .ToLookup(c => c.TicketId);

            var moved = 0;
            foreach (var c in candidates)
            {
                if (c.Hours <= 0) continue;
                double paused = 0;
                DateTime? pausedFrom = null;
                foreach (var ch in changes[c.Id])
                {
                    if (ch.ToStatus is TicketStatus.Pending or TicketStatus.Resolved) pausedFrom ??= ch.At < c.CreatedAt ? c.CreatedAt : ch.At;
                    else if (pausedFrom.HasValue) { paused += clock.BusinessMinutes(pausedFrom.Value, ch.At); pausedFrom = null; }
                }
                if (pausedFrom.HasValue) paused += clock.BusinessMinutes(pausedFrom.Value, nowUtc);
                var used = Math.Max(0, clock.BusinessMinutes(c.CreatedAt, nowUtc) - paused);
                var percent = used / (c.Hours * 60.0) * 100.0;

                var level = percent >= _options.L2Percent ? 3 : percent >= _options.L1Percent ? 2 : percent >= _options.WarnPercent ? 1 : 0;
                var stored = c.SlaBreachedAt.HasValue ? 2 : c.SlaWarnedAt.HasValue ? 1 : 0; // level 3 tickets are not selected
                if (level > stored && await ApplyAsync(c.Id, stored, level, percent, nowUtc, cancellationToken)) moved++;
            }
            return moved;
        }

        private async Task<bool> ApplyAsync(Guid ticketId, int stored, int level, double percent, DateTime now, CancellationToken ct)
        {
            var ticket = await _db.Tickets.Include(t => t.Category).FirstOrDefaultAsync(t => t.Id == ticketId, ct);
            if (ticket == null || !Running.Contains(ticket.Status)) return false;
            var unit = await _db.Units.AsNoTracking().FirstAsync(u => u.Id == ticket.UnitId, ct);
            var department = await _db.Departments.AsNoTracking().FirstAsync(d => d.Id == ticket.DepartmentId, ct);
            var category = ticket.Category!.Name;
            var rounded = (int)Math.Round(percent);
            var heads = new[] { unit.HeadUserId, unit.DeputyHeadUserId }.Where(h => h.HasValue).Select(h => h!.Value).Distinct().ToList();

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
                // The Head of Department and the Department Admin only watch. The unit's own head and deputy already know from level 2.
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