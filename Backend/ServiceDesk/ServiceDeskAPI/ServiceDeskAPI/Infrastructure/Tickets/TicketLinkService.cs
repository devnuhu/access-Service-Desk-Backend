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
    public class TicketLinkService : ITicketLinkService
    {
        private const int MaxCc = 10;
        private static readonly TicketStatus[] Open =
            { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;

        public TicketLinkService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
        }

        private static TicketProblem NotFound() => new(404, "Ticket not found.");

        private async Task<bool> IsStaffAsync(Ticket t, Guid actorUserId, bool actorIsSuperAdmin) =>
            actorIsSuperAdmin || await TicketAccess.IsStaffForTicketAsync(_db, actorUserId, t.DepartmentId, t.UnitId);

        private async Task<(TicketProblem? Problem, Ticket? Ticket)> StaffTicketAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin, bool track)
        {
            var query = _db.Tickets.AsQueryable();
            if (!track) query = query.AsNoTracking();
            var ticket = await query.FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null || !await IsStaffAsync(ticket, actorUserId, actorIsSuperAdmin)) return (NotFound(), null);
            return (null, ticket);
        }

        private async Task<(TicketProblem? Problem, Ticket? Ticket)> OtherByReferenceAsync(string? reference, string field, Guid actorUserId, bool actorIsSuperAdmin, bool track)
        {
            var text = (reference ?? string.Empty).Trim();
            if (text.Length == 0) return (new TicketProblem(400, "Enter the reference of the other ticket.", field), null);
            var query = _db.Tickets.AsQueryable();
            if (!track) query = query.AsNoTracking();
            var ticket = await query.FirstOrDefaultAsync(t => t.Reference == text);
            if (ticket == null || !await IsStaffAsync(ticket, actorUserId, actorIsSuperAdmin))
                return (new TicketProblem(404, "No ticket you work on has the reference " + text + ".", field), null);
            return (null, ticket);
        }

        private static string Relation(TicketLink link, Guid perspective) => link.Kind switch
        {
            TicketLinkKind.Related => "related",
            TicketLinkKind.DuplicateOf => link.TicketId == perspective ? "duplicateOf" : "hasDuplicate",
            _ => link.TicketId == perspective ? "mergedInto" : "hasMerged"
        };

        private static TicketLinkDto ToDto(TicketLink link, Guid perspective, Ticket other, bool showSubject) =>
            new(link.Id, Relation(link, perspective), new TicketLinkTicketDto(other.Id, other.Reference, showSubject ? other.Subject : null, other.Status),
                link.CreatedAt, link.Kind != TicketLinkKind.MergedInto);

        // ---------------- reading ----------------

        public async Task<(TicketProblem? Problem, List<TicketLinkDto>? Links)> ListAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, _) = await StaffTicketAsync(ticketId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var links = await _db.TicketLinks.AsNoTracking().Where(l => l.TicketId == ticketId || l.RelatedTicketId == ticketId).OrderBy(l => l.CreatedAt).ToListAsync();
            var otherIds = links.Select(l => l.TicketId == ticketId ? l.RelatedTicketId : l.TicketId).Distinct().ToList();
            var others = await _db.Tickets.AsNoTracking().Where(t => otherIds.Contains(t.Id)).ToListAsync();
            var result = new List<TicketLinkDto>();
            foreach (var link in links)
            {
                var other = others.First(t => t.Id == (link.TicketId == ticketId ? link.RelatedTicketId : link.TicketId));
                result.Add(ToDto(link, ticketId, other, await IsStaffAsync(other, actorUserId, actorIsSuperAdmin)));
            }
            return (null, result);
        }

        // ---------------- linking ----------------

        public async Task<(TicketProblem? Problem, TicketLinkDto? Link)> AddAsync(Guid ticketId, AddTicketLinkRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket) = await StaffTicketAsync(ticketId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);

            var relation = (request.Relation ?? "related").Trim();
            TicketLinkKind kind;
            if (string.Equals(relation, "related", StringComparison.OrdinalIgnoreCase)) kind = TicketLinkKind.Related;
            else if (string.Equals(relation, "duplicateOf", StringComparison.OrdinalIgnoreCase)) kind = TicketLinkKind.DuplicateOf;
            else return (new TicketProblem(400, "Choose related or duplicateOf.", "relation"), null);

            var (otherProblem, other) = await OtherByReferenceAsync(request.Reference, "reference", actorUserId, actorIsSuperAdmin, false);
            if (otherProblem != null) return (otherProblem, null);
            if (other!.Id == ticket!.Id) return (new TicketProblem(400, "A ticket cannot be linked to itself.", "reference"), null);
            if (await _db.TicketLinks.AnyAsync(l => (l.TicketId == ticket.Id && l.RelatedTicketId == other.Id) || (l.TicketId == other.Id && l.RelatedTicketId == ticket.Id)))
                return (new TicketProblem(409, "These two tickets are already linked.", "reference"), null);

            // A plain relation has no direction: keep one order so the same pair is never stored twice
            var from = ticket;
            var to = other;
            if (kind == TicketLinkKind.Related && ticket.Id.CompareTo(other.Id) > 0) { from = other; to = ticket; }

            var link = new TicketLink { Id = Guid.NewGuid(), TicketId = from.Id, RelatedTicketId = to.Id, Kind = kind, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.TicketLinks.Add(link);
            Stage(AuditAction.Created, "TicketLink", link.Id, ticket.Reference + " / " + other.Reference, null, new { kind = kind.ToString(), from = from.Reference, to = to.Reference });
            await _db.SaveChangesAsync();
            return (null, ToDto(link, ticketId, other, true));
        }

        public async Task<(TicketProblem? Problem, string? Message)> RemoveAsync(Guid ticketId, Guid linkId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket) = await StaffTicketAsync(ticketId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var link = await _db.TicketLinks.FirstOrDefaultAsync(l => l.Id == linkId && (l.TicketId == ticketId || l.RelatedTicketId == ticketId));
            if (link == null) return (new TicketProblem(404, "Link not found."), null);
            if (link.Kind == TicketLinkKind.MergedInto) return (new TicketProblem(400, "A merge cannot be undone."), null);
            _db.TicketLinks.Remove(link);
            Stage(AuditAction.Deleted, "TicketLink", link.Id, ticket!.Reference, new { kind = link.Kind.ToString() }, null);
            await _db.SaveChangesAsync();
            return (null, "Link removed.");
        }

        // ---------------- merging ----------------

        public async Task<(TicketProblem? Problem, string? Message)> MergeAsync(Guid ticketId, MergeTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, source) = await StaffTicketAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var (targetProblem, target) = await OtherByReferenceAsync(request.TargetReference, "targetReference", actorUserId, actorIsSuperAdmin, true);
            if (targetProblem != null) return (targetProblem, null);

            var reason = (request.Reason ?? string.Empty).Trim();
            if (reason.Length < 3 || reason.Length > 500) return (new TicketProblem(400, "Say why they are merged (3 to 500 characters).", "reason"), null);
            if (target!.Id == source!.Id) return (new TicketProblem(400, "A ticket cannot be merged into itself.", "targetReference"), null);
            if (source.UnitId != target.UnitId) return (new TicketProblem(400, "Both tickets must belong to the same unit.", "targetReference"), null);
            if (!Open.Contains(source.Status))
                return (new TicketProblem(400, source.Reference + " is " + source.Status.ToString().ToLowerInvariant() + ", so it cannot be merged. Only open tickets can."), null);
            if (!Open.Contains(target.Status))
                return (new TicketProblem(400, target.Reference + " is " + target.Status.ToString().ToLowerInvariant() + ". Merge into an open ticket.", "targetReference"), null);

            var now = DateTime.UtcNow;
            var actorName = await _db.Users.Where(u => u.Id == actorUserId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";
            var previousStatus = source.Status;

            // The duplicate is closed; the SLA clock reads this status change
            _db.TicketStatusChanges.Add(new TicketStatusChange
            {
                Id = Guid.NewGuid(), TicketId = source.Id, FromStatus = previousStatus, ToStatus = TicketStatus.Closed, ByUserId = actorUserId,
                Reason = "Merged into " + target.Reference, At = now
            });
            source.Status = TicketStatus.Closed;
            source.ClosedAt = now;
            source.ResolvedAt ??= now;
            source.ResolvedByUserId = actorUserId;
            source.ResolutionCode = ResolutionCode.Duplicate;
            source.ResolutionNote = "Merged into " + target.Reference;
            source.PendingReason = null;
            source.PendingSince = null;
            source.AssigneeAwayFlaggedAt = null;
            source.UpdatedAt = now;
            source.UpdatedByUserId = actorUserId;
            target.UpdatedAt = now;
            target.UpdatedByUserId = actorUserId;

            // Seen by the duplicate's requester and everyone on it; internal note on the primary for staff
            AddNote(source, actorUserId, false, "Merged", "This request was merged into " + target.Reference + ", which will continue to be handled.\n" + reason, now);
            AddNote(target, actorUserId, true, "Merged ticket", source.Reference + " (" + source.Subject + ") was merged into this ticket by " + actorName + ".\n" + reason, now);

            // One link per pair: a merge replaces any earlier plain link
            var older = await _db.TicketLinks.Where(l => (l.TicketId == source.Id && l.RelatedTicketId == target.Id) || (l.TicketId == target.Id && l.RelatedTicketId == source.Id)).ToListAsync();
            _db.TicketLinks.RemoveRange(older);
            _db.TicketLinks.Add(new TicketLink { Id = Guid.NewGuid(), TicketId = source.Id, RelatedTicketId = target.Id, Kind = TicketLinkKind.MergedInto, CreatedAt = now, CreatedByUserId = actorUserId });

            // Copy the duplicate's requester on the primary, only when asked and only when they are a different person
            var copied = false;
            var cannotCopy = false;
            if (request.CopyRequester && source.RequesterUserId != target.RequesterUserId && source.RequesterUserId != target.RaisedByUserId)
            {
                var already = await _db.TicketWatchers.AnyAsync(w => w.TicketId == target.Id && w.UserId == source.RequesterUserId);
                if (!already)
                {
                    if (await _db.TicketWatchers.CountAsync(w => w.TicketId == target.Id) >= MaxCc) cannotCopy = true;
                    else
                    {
                        _db.TicketWatchers.Add(new TicketWatcher { Id = Guid.NewGuid(), TicketId = target.Id, UserId = source.RequesterUserId, AddedAt = now, AddedByUserId = actorUserId });
                        copied = true;
                    }
                }
            }

            // Told by reference only, never the subject (rule 13)
            Tell(source.RequesterUserId, actorUserId, source, "Ticket " + source.Reference + " merged",
                "Your " + await CategoryNameAsync(source.CategoryId) + " request was merged into " + target.Reference + ".");
            if (source.AssigneeUserId.HasValue)
                Tell(source.AssigneeUserId.Value, actorUserId, source, "Ticket " + source.Reference + " merged", actorName + " merged it into " + target.Reference + ". No further work is needed on it.");
            if (target.AssigneeUserId.HasValue && target.AssigneeUserId != source.AssigneeUserId)
                Tell(target.AssigneeUserId.Value, actorUserId, target, "Ticket " + target.Reference + " has a merged duplicate", source.Reference + " was merged into it.");

            Stage(AuditAction.Updated, "Ticket", source.Id, source.Reference, new { status = previousStatus.ToString() },
                new { status = "Closed", mergedInto = target.Reference, copiedRequester = copied });
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "One of the tickets changed at the same moment. Reload and try again."), null);
            }
            var message = source.Reference + " is merged into " + target.Reference + ".";
            if (copied) message += " Its requester is copied on " + target.Reference + ".";
            if (cannotCopy) message += " Its requester could not be copied: " + target.Reference + " already has " + MaxCc + " copied people.";
            return (null, message);
        }

        private async Task<string> CategoryNameAsync(Guid categoryId) =>
            await _db.Categories.Where(c => c.Id == categoryId).Select(c => c.Name).FirstOrDefaultAsync() ?? "service";

        private void AddNote(Ticket ticket, Guid authorUserId, bool isInternal, string label, string text, DateTime now)
        {
            var body = string.Join("<br>", text.Replace("\r", string.Empty).Split('\n').Select(WebUtility.HtmlEncode));
            _db.TicketComments.Add(new TicketComment
            {
                Id = Guid.NewGuid(), TicketId = ticket.Id, AuthorUserId = authorUserId, IsInternal = isInternal, Kind = CommentKind.Workflow, CreatedAt = now,
                BodyHtml = "<p><strong>" + WebUtility.HtmlEncode(label) + "</strong></p><p>" + body + "</p>",
                BodyText = label + "\n" + text
            });
        }

        private void Tell(Guid recipient, Guid actorUserId, Ticket ticket, string title, string message)
        {
            if (recipient == actorUserId) return;
            _notifications.Stage(recipient, title, message, NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private void Stage(AuditAction action, string entity, Guid id, string display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, entity, id, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }
    }
}