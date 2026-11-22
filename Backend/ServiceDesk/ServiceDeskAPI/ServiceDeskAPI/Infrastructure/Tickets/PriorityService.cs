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
    public class PriorityService : IPriorityService
    {
        private static readonly TicketStatus[] Changeable =
            { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;

        public PriorityService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
        }

        // ---------------- the matrix ----------------

        public async Task<PriorityMatrixDto> GetMatrixAsync()
        {
            var saved = await _db.PriorityMatrix.AsNoTracking().ToListAsync();
            var matrix = new PriorityMatrixDto
            {
                Impacts = PriorityRules.Impacts.Select(i => new PriorityChoiceDto((int)i.Value, i.Label, i.Description)).ToList(),
                Urgencies = PriorityRules.Urgencies.Select(u => new PriorityChoiceDto((int)u.Value, u.Label, u.Description)).ToList()
            };
            foreach (var impact in Enum.GetValues<TicketImpact>())
                foreach (var urgency in Enum.GetValues<TicketUrgency>())
                {
                    var row = saved.FirstOrDefault(c => c.Impact == impact && c.Urgency == urgency);
                    matrix.Cells.Add(new PriorityCellDto(impact, urgency, row?.Priority ?? PriorityRules.Default(impact, urgency), row == null));
                }
            return matrix;
        }

        public async Task<(TicketProblem? Problem, PriorityMatrixDto? Matrix)> SaveMatrixAsync(SavePriorityMatrixRequest request, Guid actorUserId)
        {
            var requested = request.Cells ?? new List<PriorityCellRequest>();
            if (requested.Count == 0) return (new TicketProblem(400, "Send at least one cell to change.", "cells"), null);
            var seen = new HashSet<(TicketImpact, TicketUrgency)>();
            foreach (var cell in requested)
            {
                if (!Enum.IsDefined(cell.Impact) || !Enum.IsDefined(cell.Urgency))
                    return (new TicketProblem(400, "Impact and urgency must each be 1 to 4.", "cells"), null);
                if (!Enum.IsDefined(cell.Priority))
                    return (new TicketProblem(400, "Choose Low, Medium, High or Critical.", "cells"), null);
                if (!seen.Add((cell.Impact, cell.Urgency)))
                    return (new TicketProblem(400, "Each impact and urgency pair can be sent once.", "cells"), null);
            }

            var rows = await _db.PriorityMatrix.ToListAsync();
            var now = DateTime.UtcNow;
            var changes = new List<object>();
            foreach (var cell in requested)
            {
                var row = rows.FirstOrDefault(r => r.Impact == cell.Impact && r.Urgency == cell.Urgency);
                var standard = PriorityRules.Default(cell.Impact, cell.Urgency);
                var before = row?.Priority ?? standard;
                if (cell.Priority == standard)
                {
                    if (row != null) _db.PriorityMatrix.Remove(row);
                }
                else if (row == null)
                {
                    _db.PriorityMatrix.Add(new PriorityMatrixCell
                    {
                        Id = Guid.NewGuid(), Impact = cell.Impact, Urgency = cell.Urgency, Priority = cell.Priority, UpdatedAt = now, UpdatedByUserId = actorUserId
                    });
                }
                else
                {
                    row.Priority = cell.Priority;
                    row.UpdatedAt = now;
                    row.UpdatedByUserId = actorUserId;
                }
                if (before != cell.Priority)
                    changes.Add(new { impact = cell.Impact.ToString(), urgency = cell.Urgency.ToString(), from = before.ToString(), to = cell.Priority.ToString() });
            }

            if (changes.Count > 0)
            {
                var actor = AuditActor.From(_http.HttpContext);
                _audit.Stage(actor.UserId, actor.DisplayName, AuditAction.ConfigurationChanged, "PriorityMatrix", Guid.Empty, "Priority matrix", null,
                    JsonSerializer.Serialize(new { changes }), actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
            }
            await _db.SaveChangesAsync();
            return (null, await GetMatrixAsync());
        }

        // ---------------- one ticket ----------------

        private sealed record Access(bool CanSee, bool CanChange);

        private async Task<Access> AccessAsync(Ticket ticket, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var isHead = ticket.Unit!.HeadUserId == actorUserId;
            var isOversight = await _db.Departments.AnyAsync(d => d.Id == ticket.DepartmentId && (d.HodUserId == actorUserId || d.AdminUserId == actorUserId));
            var isMember = await _db.UnitMembers.AnyAsync(m => m.UserId == actorUserId && m.IsActive && m.UnitId == ticket.UnitId);
            var isRequester = ticket.RequesterUserId == actorUserId || ticket.RaisedByUserId == actorUserId;
            var canChange = actorIsSuperAdmin || isHead || isOversight;
            return new Access(canChange || isMember || isRequester, canChange);
        }

        private const string WhoMayChange = "Only the head of the unit, the Head of Department, the Department Admin or a Super Admin can change the priority.";

        public async Task<(TicketProblem? Problem, PriorityOptionsDto? Options)> GetOptionsAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.AsNoTracking().Include(t => t.Unit).FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null);
            var access = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!access.CanSee) return (new TicketProblem(404, "Ticket not found."), null);

            var options = new PriorityOptionsDto { Priority = ticket.Priority, CanChange = access.CanChange && Changeable.Contains(ticket.Status) };
            if (!access.CanChange) options.Reason = WhoMayChange;
            else if (!Changeable.Contains(ticket.Status)) options.Reason = "The priority of a finished ticket cannot be changed.";
            var isStaff = access.CanChange || await _db.UnitMembers.AnyAsync(m => m.UserId == actorUserId && m.IsActive && m.UnitId == ticket.UnitId);
            if (isStaff) { options.Impact = ticket.Impact; options.Urgency = ticket.Urgency; }
            return (null, options);
        }

        public async Task<(TicketProblem? Problem, string? Message)> ChangeAsync(Guid ticketId, ChangePriorityRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var errors = new Dictionary<string, string>();
            if (!Enum.IsDefined(request.Priority)) errors["priority"] = "Choose Low, Medium, High or Critical.";
            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 5 || reason.Length > 500) errors["reason"] = "Say why the priority changes (5 to 500 characters).";
            if (errors.Count > 0)
            {
                var first = errors.First();
                return (new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors), null);
            }

            var ticket = await _db.Tickets.Include(t => t.Unit).Include(t => t.Category).FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null);
            var access = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!access.CanSee) return (new TicketProblem(404, "Ticket not found."), null);
            if (!access.CanChange) return (new TicketProblem(403, WhoMayChange), null);
            if (!Changeable.Contains(ticket.Status)) return (new TicketProblem(400, "The priority of a finished ticket cannot be changed."), null);
            if (ticket.Priority == request.Priority) return (new TicketProblem(400, "It already has that priority.", "priority"), null);

            var now = DateTime.UtcNow;
            var from = ticket.Priority;
            ticket.Priority = request.Priority;
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;

            var body = string.Join("<br>", reason.Replace("\r", string.Empty).Split('\n').Select(WebUtility.HtmlEncode));
            var label = "Priority changed from " + from + " to " + request.Priority;
            _db.TicketComments.Add(new TicketComment
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, AuthorUserId = actorUserId, IsInternal = true, Kind = CommentKind.Workflow, CreatedAt = now,
                BodyHtml = "<p><strong>" + WebUtility.HtmlEncode(label) + "</strong></p><p>" + body + "</p>",
                BodyText = label + "\n" + reason
            });

            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, AuditAction.Updated, "Ticket", ticket.Id, ticket.Reference, null,
                JsonSerializer.Serialize(new { status = ticket.Status.ToString(), detail = new { priority = new { from = from.ToString(), to = request.Priority.ToString() }, reason } }),
                actor.IpAddress, actor.UserAgent, AuditModule.Tickets);

            var link = "/tickets/" + ticket.Reference;
            var text = "The priority was changed from " + from + " to " + request.Priority + ".";
            if (ticket.AssigneeUserId.HasValue && ticket.AssigneeUserId.Value != actorUserId)
                _notifications.Stage(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + " priority changed", text,
                    NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);
            if (ticket.RequesterUserId != actorUserId)
                _notifications.Stage(ticket.RequesterUserId, "Ticket " + ticket.Reference + " priority changed", text,
                    NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);

            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket changed at the same moment. Reload it and try again."), null);
            }
            return (null, ticket.Reference + " is now " + request.Priority + " priority.");
        }
    }
}