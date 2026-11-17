using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Moves tickets through the workflow (BRD Section 8). Every change is recorded in TicketStatusChanges (the SLA clock in Step 7
    /// reads it), audited, and announced. Notes and reasons are posted on the ticket as public comments so the requester sees them;
    /// notifications never carry them (rule 13).
    /// </summary>
    public class WorkflowService : IWorkflowService
    {
        private static readonly TicketStatus[] Unfinished =
            { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened, TicketStatus.Resolved };

        private static readonly Dictionary<ResolutionCode, string> CodeLabels = new()
        {
            [ResolutionCode.Completed] = "Completed",
            [ResolutionCode.InformationProvided] = "Information provided",
            [ResolutionCode.ReferredElsewhere] = "Referred elsewhere",
            [ResolutionCode.Duplicate] = "Duplicate",
            [ResolutionCode.NoActionRequired] = "No action required"
        };

        private readonly AppDbContext _db;
        private readonly IAssignmentService _assignment;
        private readonly IAvailabilityService _availability;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;

        public WorkflowService(AppDbContext db, IAssignmentService assignment, IAvailabilityService availability, IAuditService audit,
            IInAppNotificationService notifications, IHttpContextAccessor http)
        {
            _db = db;
            _assignment = assignment;
            _availability = availability;
            _audit = audit;
            _notifications = notifications;
            _http = http;
        }

        // ---------------- what may I do ----------------

        private sealed record Who(bool IsAssignee, bool IsRequester, bool IsSuperAdmin);

        private static bool CanEscalate(Ticket t, Who w) =>
            w.IsAssignee && t.EscalatedToHeadAt == null
            && t.Status is TicketStatus.Assigned or TicketStatus.InProgress or TicketStatus.Pending or TicketStatus.Reopened;

        private static bool CanAcknowledge(Ticket t, Who w) => w.IsAssignee && t.Status is TicketStatus.Assigned or TicketStatus.Reopened;
        private static bool CanSetPending(Ticket t, Who w) => w.IsAssignee && t.Status == TicketStatus.InProgress;
        private static bool CanResume(Ticket t, Who w) => w.IsAssignee && t.Status == TicketStatus.Pending;
        private static bool CanResolve(Ticket t, Who w) => w.IsAssignee && t.Status is TicketStatus.InProgress or TicketStatus.Pending;
        private static bool CanConfirm(Ticket t, Who w) => w.IsRequester && t.Status == TicketStatus.Resolved;
        private static bool CanReopen(Ticket t, Who w) => w.IsRequester && t.Status == TicketStatus.Resolved;
        private static bool CanCancel(Ticket t, Who w) =>
            (w.IsRequester && t.Status is TicketStatus.New or TicketStatus.Assigned) || (w.IsSuperAdmin && Unfinished.Contains(t.Status));

        public async Task<(TicketProblem? Problem, TicketActionsDto? Actions)> GetActionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, track: false);
            if (problem != null) return (problem, null);
            return (null, new TicketActionsDto
            {
                CanAcknowledge = CanAcknowledge(ticket!, who!),
                CanSetPending = CanSetPending(ticket!, who!),
                CanResume = CanResume(ticket!, who!),
                CanResolve = CanResolve(ticket!, who!),
                CanConfirm = CanConfirm(ticket!, who!),
                CanReopen = CanReopen(ticket!, who!),
                CanCancel = CanCancel(ticket!, who!),
                CanEscalate = CanEscalate(ticket!, who!) && !await IsUnitHeadAsync(ticket!, actorUserId),
                ResolutionCodes = CodeLabels.Select(c => new ResolutionCodeDto(c.Key, c.Value)).ToList()
            });
        }

        // ---------------- the assignee ----------------

        public async Task<(TicketProblem? Problem, string? Message)> AcknowledgeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanAcknowledge(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can acknowledge it, while it is Assigned or Reopened."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.InProgress, actorUserId, "Acknowledged", now);
            ticket!.AcknowledgedAt = now;
            ticket.FirstRespondedAt ??= now;
            Stage(AuditAction.Acknowledged, ticket, null);
            var assignee = await NameOfAsync(actorUserId);
            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " in progress",
                assignee + " has started on your " + ticket.Category!.Name + " request.", NotificationType.Info);
            return await SaveAsync("Acknowledged. " + ticket.Reference + " is in progress.");
        }

        public async Task<(TicketProblem? Problem, string? Message)> SetPendingAsync(Guid ticketId, SetPendingRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var errors = new Dictionary<string, string>();
            if (!Enum.IsDefined(request.Reason)) errors["reason"] = "Choose who it is waiting on: the requester or a third party.";
            var note = (request.Note ?? string.Empty).Trim();
            if (note.Length < 5 || note.Length > 2000) errors["note"] = "Say what you are waiting for (5 to 2000 characters).";
            if (errors.Count > 0) return (Invalid(errors), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanSetPending(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can set it to Pending, while it is in progress."), null);

            var now = DateTime.UtcNow;
            var onRequester = request.Reason == PendingReason.Requester;
            Change(ticket!, TicketStatus.Pending, actorUserId, onRequester ? "Waiting on the requester" : "Waiting on a third party", now);
            ticket!.PendingReason = request.Reason;
            ticket.PendingSince = now;
            Comment(ticket, actorUserId, onRequester ? "Waiting on you" : "Waiting on a third party", note, now);
            Stage(AuditAction.StatusChanged, ticket, new { to = "Pending", reason = request.Reason.ToString() });
            var assignee = await NameOfAsync(actorUserId);
            Tell(ticket.RequesterUserId, actorUserId, ticket,
                onRequester ? "Ticket " + ticket.Reference + " needs your reply" : "Ticket " + ticket.Reference + " is waiting on a third party",
                onRequester ? assignee + " needs more information from you. Reply on the ticket to continue." : assignee + " is waiting on a third party. You will be told when it moves on.",
                onRequester ? NotificationType.ActionRequired : NotificationType.Info);
            return await SaveAsync(ticket.Reference + " is Pending (" + (onRequester ? "waiting on the requester" : "waiting on a third party") + ").");
        }

        public async Task<(TicketProblem? Problem, string? Message)> ResumeAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanResume(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can resume it, while it is Pending."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.InProgress, actorUserId, "Resumed", now);
            ticket!.PendingReason = null;
            ticket.PendingSince = null;
            Stage(AuditAction.StatusChanged, ticket, new { to = "InProgress", resumed = true });
            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " back in progress",
                "Work on your " + ticket.Category!.Name + " request has resumed.", NotificationType.Info);
            return await SaveAsync(ticket.Reference + " is back in progress.");
        }

        public async Task<(TicketProblem? Problem, string? Message)> ResolveAsync(Guid ticketId, ResolveRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var errors = new Dictionary<string, string>();
            if (!Enum.IsDefined(request.Code)) errors["code"] = "Choose a resolution code.";
            var note = (request.Note ?? string.Empty).Trim();
            if (note.Length < 10 || note.Length > 4000) errors["note"] = "Describe the resolution (10 to 4000 characters).";
            if (errors.Count > 0) return (Invalid(errors), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanResolve(ticket!, who!)) return (Refuse(ticket!, who!.IsAssignee, "Only the assignee can resolve it, while it is in progress or Pending."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Resolved, actorUserId, "Resolved: " + CodeLabels[request.Code], now);
            ticket!.ResolvedAt = now;
            ticket.ResolvedByUserId = actorUserId;
            ticket.ResolutionCode = request.Code;
            ticket.ResolutionNote = note;
            ticket.PendingReason = null;
            ticket.PendingSince = null;
            Comment(ticket, actorUserId, "Resolved: " + CodeLabels[request.Code], note, now);
            Stage(AuditAction.Resolved, ticket, new { code = request.Code.ToString() });

            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " resolved",
                "Your " + ticket.Category!.Name + " request has been resolved. Check the answer, then confirm it or reopen the ticket.", NotificationType.ActionRequired);
            foreach (var watcher in await _db.TicketWatchers.Where(w => w.TicketId == ticket.Id).Select(w => w.UserId).ToListAsync())
                if (watcher != ticket.RequesterUserId)
                    Tell(watcher, actorUserId, ticket, "Ticket " + ticket.Reference + " resolved", "A ticket you are copied on has been resolved.", NotificationType.Info);
            return await SaveAsync(ticket.Reference + " resolved. The requester can now confirm or reopen it.");
        }

        // ---------------- the requester ----------------

        public async Task<(TicketProblem? Problem, string? Message)> ConfirmAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanConfirm(ticket!, who!)) return (Refuse(ticket!, who!.IsRequester, "Only the requester can confirm it, while it is Resolved."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Closed, actorUserId, "Confirmed by the requester", now);
            ticket!.ClosedAt = now;
            Stage(AuditAction.StatusChanged, ticket, new { to = "Closed", confirmed = true });
            if (ticket.AssigneeUserId.HasValue)
                Tell(ticket.AssigneeUserId.Value, actorUserId, ticket, "Ticket " + ticket.Reference + " closed",
                    await NameOfAsync(actorUserId) + " confirmed the resolution.", NotificationType.Success);
            return await SaveAsync("Thank you. " + ticket.Reference + " is closed.");
        }

        public async Task<(TicketProblem? Problem, string? Message)> ReopenAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 5 || reason.Length > 2000)
                return (Invalid(new Dictionary<string, string> { ["reason"] = "Say why it is not resolved (5 to 2000 characters)." }), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanReopen(ticket!, who!)) return (Refuse(ticket!, who!.IsRequester, "Only the requester can reopen it, while it is Resolved."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Reopened, actorUserId, "Reopened by the requester", now);
            ticket!.ReopenCount++;
            ticket.AcknowledgedAt = null;
            ticket.ResolvedAt = null;
            ticket.ResolvedByUserId = null;
            ticket.ResolutionCode = null;
            ticket.ResolutionNote = null;
            Comment(ticket, actorUserId, "Reopened", reason, now);
            Stage(AuditAction.Reopened, ticket, new { count = ticket.ReopenCount });
            if (ticket.AssigneeUserId.HasValue)
                Tell(ticket.AssigneeUserId.Value, actorUserId, ticket, "Ticket " + ticket.Reference + " reopened",
                    await NameOfAsync(actorUserId) + " says it is not resolved yet. Please acknowledge it and pick it up again.", NotificationType.ActionRequired);
            var (saveProblem, message) = await SaveAsync(ticket.Reference + " is reopened and back with " + (ticket.AssigneeUserId.HasValue ? await NameOfAsync(ticket.AssigneeUserId.Value) : "the team") + ".");
            if (saveProblem != null) return (saveProblem, null);

            // Back to the same case worker, unless they are unavailable: then through the engine (FR-4.6)
            var assigneeId = ticket.AssigneeUserId;
            var unitId = ticket.UnitId;
            _db.ChangeTracker.Clear();
            if (assigneeId.HasValue && !(await _availability.IsAvailableAsync(assigneeId.Value)
                && await _db.UnitMembers.AnyAsync(m => m.UserId == assigneeId.Value && m.UnitId == unitId && m.IsActive)))
            {
                var moved = await _assignment.AssignAsync(ticketId, "reopened while the assignee is unavailable");
                message = ticket.Reference + " is reopened. " + (moved ? "Its case worker is unavailable, so it went to someone else." : "Its case worker is unavailable; it will go to the next available one.");
            }
            return (null, message);
        }

        /// <summary>The assignee asks the unit's head for help. Separate from the SLA escalation levels. The reason is an internal note.</summary>
        public async Task<(TicketProblem? Problem, string? Message)> EscalateAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 5 || reason.Length > 1000)
                return (Invalid(new Dictionary<string, string> { ["reason"] = "Say why it needs the head of the unit (5 to 1000 characters)." }), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (who!.IsAssignee && await IsUnitHeadAsync(ticket!, actorUserId))
                return (new TicketProblem(400, "You head this unit, so there is nobody above you to escalate to here. Reassign it, or ask the Head of Department."), null);
            if (!CanEscalate(ticket!, who))
                return (Refuse(ticket!, who.IsAssignee, "Only the assignee can escalate it to the head of the unit, while it is open and not already escalated."), null);

            var unit = await _db.Units.AsNoTracking().FirstAsync(u => u.Id == ticket!.UnitId);
            var now = DateTime.UtcNow;
            ticket!.EscalatedToHeadAt = now;
            ticket.EscalatedToHeadByUserId = actorUserId;
            ticket.EscalatedToHeadReason = reason;
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;
            var body = string.Join("<br>", reason.Replace("\r", string.Empty).Split('\n').Select(WebUtility.HtmlEncode));
            _db.TicketComments.Add(new TicketComment
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, AuthorUserId = actorUserId, IsInternal = true, Kind = CommentKind.Workflow, CreatedAt = now,
                BodyHtml = "<p><strong>Escalated to the head of unit</strong></p><p>" + body + "</p>",
                BodyText = "Escalated to the head of unit\n" + reason
            });
            Stage(AuditAction.Escalated, ticket, new { to = "HeadOfUnit" });
            var assignee = await NameOfAsync(actorUserId);
            foreach (var head in (await ServiceDeskAPI.Infrastructure.Organisation.HeadContacts.ForAsync(_db, unit.Id)).Distinct())
                if (head != actorUserId)
                    _notifications.Stage(head, "Ticket " + ticket.Reference + " escalated to you", assignee + " needs your help with a " + ticket.Category!.Name + " request.",
                        NotificationType.ActionRequired, NotificationCategory.Escalation, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
            return await SaveAsync(ticket.Reference + " is escalated to the head of " + unit.Name + ".");
        }
        public async Task<(TicketProblem? Problem, string? Message)> CancelAsync(Guid ticketId, WorkflowReasonRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 3 || reason.Length > 500)
                return (Invalid(new Dictionary<string, string> { ["reason"] = "Say why it is cancelled (3 to 500 characters)." }), null);

            var (problem, ticket, who) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin);
            if (problem != null) return (problem, null);
            if (!CanCancel(ticket!, who!))
                return (Refuse(ticket!, who!.IsRequester || who.IsSuperAdmin,
                    "The requester can cancel it before work starts (New or Assigned); a Super Admin can cancel any open ticket."), null);

            var now = DateTime.UtcNow;
            Change(ticket!, TicketStatus.Cancelled, actorUserId, "Cancelled", now);
            ticket!.CancelledAt = now;
            Comment(ticket, actorUserId, "Cancelled", reason, now);
            Stage(AuditAction.Cancelled, ticket, null);
            var actorName = await NameOfAsync(actorUserId);
            if (ticket.AssigneeUserId.HasValue)
                Tell(ticket.AssigneeUserId.Value, actorUserId, ticket, "Ticket " + ticket.Reference + " cancelled", actorName + " cancelled it. No further work is needed.", NotificationType.Info);
            Tell(ticket.RequesterUserId, actorUserId, ticket, "Ticket " + ticket.Reference + " cancelled", actorName + " cancelled your " + ticket.Category!.Name + " request.", NotificationType.Info);
            return await SaveAsync(ticket.Reference + " is cancelled.");
        }

        // ---------------- helpers ----------------

        private async Task<bool> IsUnitHeadAsync(Ticket ticket, Guid userId) =>
            await _db.Units.AnyAsync(u => u.Id == ticket.UnitId && u.HeadUserId == userId);

        private async Task<(TicketProblem? Problem, Ticket? Ticket, Who? Who)> LoadAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin, bool track = true)
        {
            var query = _db.Tickets.Include(t => t.Category).AsQueryable();
            if (!track) query = query.AsNoTracking();
            var ticket = await query.FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null, null);
            var isRequester = ticket.RequesterUserId == actorUserId || ticket.RaisedByUserId == actorUserId;
            var canView = actorIsSuperAdmin || isRequester
                || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticketId && w.UserId == actorUserId)
                || await _db.UnitMembers.AnyAsync(m => m.UserId == actorUserId && m.IsActive && m.UnitId == ticket.UnitId)
                || await _db.Departments.AnyAsync(d => d.Id == ticket.DepartmentId && (d.HodUserId == actorUserId || d.AdminUserId == actorUserId));
            if (!canView) return (new TicketProblem(404, "Ticket not found."), null, null);
            return (null, ticket, new Who(ticket.AssigneeUserId == actorUserId, isRequester, actorIsSuperAdmin));
        }

        /// <summary>403 when the person is not the one who may do it; 400 when they are, but the ticket is in the wrong status.</summary>
        private static TicketProblem Refuse(Ticket ticket, bool rightPerson, string rule) =>
            rightPerson ? new TicketProblem(400, "Not possible while the ticket is " + StatusText(ticket.Status) + ". " + rule)
                        : new TicketProblem(403, rule);

        private void Change(Ticket ticket, TicketStatus to, Guid actorUserId, string reason, DateTime now)
        {
            _db.TicketStatusChanges.Add(new TicketStatusChange
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = ticket.Status, ToStatus = to, ByUserId = actorUserId, Reason = reason, At = now
            });
            ticket.Status = to;
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;
            if (to != TicketStatus.InProgress && to != TicketStatus.Pending) ticket.AssigneeAwayFlaggedAt = null;
        }

        /// <summary>Posts the note as a public comment: a bold label, then the text with its line breaks.</summary>
        private void Comment(Ticket ticket, Guid authorUserId, string label, string text, DateTime now)
        {
            var body = string.Join("<br>", text.Replace("\r", string.Empty).Split('\n').Select(WebUtility.HtmlEncode));
            _db.TicketComments.Add(new TicketComment
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, AuthorUserId = authorUserId, IsInternal = false, Kind = CommentKind.Workflow, CreatedAt = now,
                BodyHtml = "<p><strong>" + WebUtility.HtmlEncode(label) + "</strong></p><p>" + body + "</p>",
                BodyText = label + "\n" + text
            });
        }

        private void Tell(Guid recipient, Guid actorUserId, Ticket ticket, string title, string message, NotificationType type)
        {
            if (recipient == actorUserId) return;
            _notifications.Stage(recipient, title, message, type, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private async Task<(TicketProblem? Problem, string? Message)> SaveAsync(string message)
        {
            try
            {
                await _db.SaveChangesAsync();
                return (null, message);
            }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket changed at the same moment. Reload it and try again."), null);
            }
        }

        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private void Stage(AuditAction action, Ticket ticket, object? detail)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "Ticket", ticket.Id, ticket.Reference, null,
                JsonSerializer.Serialize(new { status = ticket.Status.ToString(), detail }), actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }

        private static TicketProblem Invalid(Dictionary<string, string> errors)
        {
            var first = errors.First();
            return new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors);
        }

        private static string StatusText(TicketStatus status) => status switch
        {
            TicketStatus.InProgress => "in progress",
            _ => status.ToString().ToLowerInvariant()
        };
    }
}