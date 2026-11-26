using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Tickets;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// Raising, reading and commenting (BRD M2, M4). Tickets are created as New in the unit that owns the category and handed to the
    /// assignment engine straight after they are saved (Step 5); if nobody can take it, the engine tells the unit's head.
    /// Notifications and emails name the reference and category only, never the subject or description (rule 13).
    /// </summary>
    public class TicketService : ITicketService
    {
        private const int MaxCc = 10;
        private const int DuplicateDays = 7;
        private static readonly Regex RsaPin = new(@"\bPEN\d{12}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly TicketStatus[] FinishedStatuses = { TicketStatus.Resolved, TicketStatus.Closed, TicketStatus.Cancelled };
        private static readonly TicketStatus[] OpenStatuses = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly TimeProvider _time;
        private readonly ILogger<TicketService> _logger;
        private readonly IAssignmentService _assignment;

        private readonly ServiceDeskAPI.Infrastructure.Sla.SlaOptions _slaOptions;

        public TicketService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http,
            TimeProvider time, ILogger<TicketService> logger, IAssignmentService assignment, Microsoft.Extensions.Options.IOptions<ServiceDeskAPI.Infrastructure.Sla.SlaOptions> slaOptions)
        {
            _slaOptions = slaOptions.Value;
            _assignment = assignment;
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _time = time;
            _logger = logger;
        }

        // ---------------- raising ----------------

        public async Task<(TicketProblem? Problem, CreatedTicketDto? Ticket)> CreateAsync(CreateTicketRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            // Who it is for
            var requesterId = request.RequesterUserId ?? actorUserId;
            if (requesterId != actorUserId && !actorIsSuperAdmin)
                return (new TicketProblem(403, "Only a Super Admin can raise a ticket for someone else.", "requesterUserId"), null);
            var requester = await _db.Users.FirstOrDefaultAsync(u => u.Id == requesterId);
            if (requester == null) return (new TicketProblem(404, "Person not found.", "requesterUserId"), null);
            if (!requester.IsActive) return (new TicketProblem(400, Name(requester) + " is blocked.", "requesterUserId"), null);

            // Every field is checked, and every problem reported at once (Step 6)
            var errors = new Dictionary<string, string>();
            var category = await _db.Categories.Include(c => c.Unit).Include(c => c.Department)
                .FirstOrDefaultAsync(c => c.Id == request.CategoryId);
            if (category == null || !category.IsActive || !category.Unit!.IsActive || !category.Department!.IsActive)
                errors["categoryId"] = "Choose one of the listed categories.";
            var location = await _db.Locations.FirstOrDefaultAsync(l => l.Id == request.LocationId && l.IsActive);
            if (location == null) errors["locationId"] = "Choose your location.";
            TicketImpact? impact = request.Impact;
            TicketUrgency? urgency = request.Urgency;
            TicketPriority priority;
            if (impact.HasValue != urgency.HasValue)
            {
                errors[impact.HasValue ? "urgency" : "impact"] = impact.HasValue ? "Say how urgent it is." : "Say who it affects.";
                priority = category?.DefaultPriority ?? TicketPriority.Medium;
            }
            else if (impact.HasValue)
            {
                if (!Enum.IsDefined(impact.Value)) errors["impact"] = "Choose who it affects.";
                if (!Enum.IsDefined(urgency!.Value)) errors["urgency"] = "Choose how urgent it is.";
                priority = errors.ContainsKey("impact") || errors.ContainsKey("urgency")
                    ? category?.DefaultPriority ?? TicketPriority.Medium
                    : await PriorityRules.ResolveAsync(_db, impact.Value, urgency.Value);
            }
            else priority = request.Priority ?? category?.DefaultPriority ?? TicketPriority.Medium;
            if (!Enum.IsDefined(priority)) errors["priority"] = "Choose Low, Medium, High or Critical.";

            var subject = (request.Subject ?? string.Empty).Trim();
            if (subject.Length < 3 || subject.Length > TicketSeed.MaxSubjectChars)
                errors["subject"] = "The subject must be 3 to " + TicketSeed.MaxSubjectChars + " characters.";
            var (html, text, descriptionProblem) = CleanBody(request.DescriptionHtml, "descriptionHtml", "Describe the request.");
            if (descriptionProblem != null) errors["descriptionHtml"] = descriptionProblem.Message;

            // Copied colleagues
            var cc = (request.CcUserIds ?? new List<Guid>()).Where(id => id != Guid.Empty && id != requesterId).Distinct().ToList();
            if (cc.Count > MaxCc) errors["ccUserIds"] = "Copy at most " + MaxCc + " people.";
            else if (cc.Count > 0)
            {
                var found = await _db.Users.Where(u => cc.Contains(u.Id) && u.IsActive).Select(u => u.Id).ToListAsync();
                if (found.Count != cc.Count) errors["ccUserIds"] = "Some of the people to copy were not found or are blocked.";
            }

            var (fileProblem, files) = await AttachmentRules.CheckAsync(request.Files);
            if (fileProblem != null) errors["files"] = fileProblem;

            if (errors.Count > 0 || category == null || location == null)
                return (Invalid(errors), null);

            var now = DateTime.UtcNow;
            var ticket = new Ticket
            {
                Id = Guid.NewGuid(), DepartmentId = category.DepartmentId, UnitId = category.UnitId, CategoryId = category.Id, LocationId = location.Id,
                RequesterUserId = requesterId, RaisedByUserId = actorUserId, RequesterDepartment = Trim(requester.Department, 200),
                Subject = subject, DescriptionHtml = html, DescriptionText = text, Priority = priority, Impact = impact, Urgency = urgency, Status = TicketStatus.New, CreatedAt = now
            };

            await using var transaction = await _db.Database.BeginTransactionAsync();
            try
            {
                ticket.Reference = await NextReferenceAsync(category.Department!.Code, category.DepartmentId);
                _db.Tickets.Add(ticket);
                foreach (var userId in cc)
                    _db.TicketWatchers.Add(new TicketWatcher { Id = Guid.NewGuid(), TicketId = ticket.Id, UserId = userId, AddedAt = now, AddedByUserId = actorUserId });
                AddFiles(ticket.Id, null, files, actorUserId, now);

                Stage(AuditAction.Created, "Ticket", ticket.Id, ticket.Reference, null, new
                {
                    category = category.Name, unit = category.Unit!.Code, priority = priority.ToString(), impact = impact?.ToString(), urgency = urgency?.ToString(), location = location.Name,
                    requester = requester.UserName, onBehalf = requesterId != actorUserId, cc = cc.Count, files = files.Count
                });

                var link = "/tickets/" + ticket.Reference;
                foreach (var userId in cc)
                    _notifications.Stage(userId, "You were copied on " + ticket.Reference,
                        Name(requester) + " copied you on a " + category.Name + " request. You can follow it in " + ServiceDeskAPI.Infrastructure.AppBrand.Name + ".",
                        NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, link);

                await _db.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex, "Ticket could not be saved");
                await transaction.RollbackAsync();
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket could not be saved. Try again."), null);
            }

            // Assign straight away (FR-3.1). If it fails or nobody is free, the ticket stays New and the queue tries again.
            var reference = ticket.Reference;
            _db.ChangeTracker.Clear();
            var assigned = await _assignment.AssignAsync(ticket.Id, "raised");
            // The requester hears once, and the email says what happened: assigned to whom, or waiting for a case worker
            try
            {
                string? assigneeName = null;
                string? unitName = null;
                if (assigned)
                {
                    var holder = await _db.Tickets.AsNoTracking().Where(t => t.Id == ticket.Id)
                        .Select(t => new { Name = t.AssigneeUser != null ? (t.AssigneeUser.FullName ?? t.AssigneeUser.UserName) : null, Unit = t.Unit!.Name })
                        .FirstOrDefaultAsync();
                    assigneeName = holder?.Name;
                    unitName = holder?.Unit;
                }
                _notifications.Stage(requesterId, "Ticket " + reference + " received",
                    "Your " + category.Name + " request was received by " + category.Department!.Name
                    + (assigneeName != null ? " and assigned to " + assigneeName + " in " + unitName + "." : ". It is waiting for a case worker, and you will be told who takes it."),
                    NotificationType.Success, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + reference);
                await _db.SaveChangesAsync();
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "The received notice for {Reference} could not be saved", reference);
                _db.ChangeTracker.Clear();
            }
            try { await ServiceDeskAPI.Infrastructure.Sla.SlaDueStore.RefreshAsync(_db, _slaOptions, DateTime.UtcNow, ticket.Id); }
            catch (Exception ex) { _logger.LogWarning(ex, "The due time of {Reference} could not be saved yet; the SLA check will do it", reference); }
            return (null, new CreatedTicketDto(ticket.Id, reference, "Ticket " + reference + " raised."
                + (assigned ? string.Empty : " It is waiting for an available case worker.")));
        }

        public async Task<(TicketProblem? Problem, DuplicateCheckDto? Result)> CheckDuplicatesAsync(DuplicateCheckRequest request, Guid actorUserId)
        {
            if (!await _db.Categories.AnyAsync(c => c.Id == request.CategoryId))
                return (new TicketProblem(400, "Choose one of the listed categories.", "categoryId"), null);

            var text = (request.Subject ?? string.Empty) + "\n" + RichText.ToText(RichText.Clean(request.DescriptionHtml));
            var pins = RsaPin.Matches(text).Select(m => m.Value.ToUpperInvariant()).Distinct().Take(5).ToList();
            var result = new DuplicateCheckDto { PinsFound = pins.Select(p => "PEN********" + p.Substring(p.Length - 4)).ToList() };
            if (pins.Count == 0) return (null, result);

            var since = DateTime.UtcNow.AddDays(-DuplicateDays);
            var seen = new HashSet<Guid>();
            foreach (var pin in pins)
            {
                var matches = await _db.Tickets.AsNoTracking()
                    .Where(t => t.CategoryId == request.CategoryId && t.CreatedAt >= since && !FinishedStatuses.Contains(t.Status)
                        && (t.Subject.Contains(pin) || t.DescriptionText.Contains(pin)))
                    .OrderByDescending(t => t.CreatedAt)
                    .Select(t => new { t.Id, t.Reference, t.Status, t.CreatedAt, t.RequesterUserId })
                    .Take(10)
                    .ToListAsync();
                foreach (var m in matches.Where(m => seen.Add(m.Id)))
                    result.Matches.Add(new DuplicateTicketDto(m.Reference, m.Status, m.CreatedAt, m.RequesterUserId == actorUserId));
            }
            return (null, result);
        }

        // ---------------- reading ----------------

        public async Task<(TicketProblem? Problem, TicketPageDto? Page)> ListAsync(string? view, Guid? departmentId, Guid? unitId, TicketStatus? status,
            bool? open, string? search, int page, int pageSize, Guid actorUserId, bool actorIsSuperAdmin, bool? waitingToStart = null, string? sort = null, bool? slaBreached = null, bool? escalated = null, TicketPriority? priority = null, int? ageBand = null, int? pendingReason = null)
        {
            page = Math.Max(1, page);
            pageSize = pageSize <= 0 ? 20 : Math.Min(pageSize, 100);
            var query = _db.Tickets.AsNoTracking();
            List<Guid>? unitScope = null;
            var staffView = false;

            switch ((view ?? "mine").Trim().ToLowerInvariant())
            {
                case "mine":
                    query = query.Where(t => t.RequesterUserId == actorUserId || t.RaisedByUserId == actorUserId);
                    break;
                case "copied":
                    query = query.Where(t => t.Watchers.Any(w => w.UserId == actorUserId));
                    break;
                case "assigned":
                    query = query.Where(t => t.AssigneeUserId == actorUserId);
                    break;
                case "department":
                    if (!departmentId.HasValue) return (new TicketProblem(400, "Choose a department.", "departmentId"), null);
                    if (!actorIsSuperAdmin && !await TicketAccess.IsDepartmentWideAsync(_db, actorUserId, departmentId.Value) && (unitScope = await TicketAccess.UnitIdsAsync(_db, actorUserId, departmentId.Value)).Count == 0)
                        return (new TicketProblem(403, "Only staff of this department can see its tickets."), null);
                    staffView = true;
                    break;
                default:
                    return (new TicketProblem(400, "view must be mine, copied, assigned or department.", "view"), null);
            }

            if (unitScope != null) query = query.Where(t => unitScope.Contains(t.UnitId)); // a case worker or head sees only their own unit(s)
            // These narrow every view (Step 6)
            if (departmentId.HasValue) query = query.Where(t => t.DepartmentId == departmentId.Value);
            if (unitId.HasValue) query = query.Where(t => t.UnitId == unitId.Value);
            if (status.HasValue) query = query.Where(t => t.Status == status.Value);
            if (open == true) query = query.Where(t => OpenStatuses.Contains(t.Status));
            else if (open == false) query = query.Where(t => !OpenStatuses.Contains(t.Status));
            if (waitingToStart == true) query = query.Where(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened);
            if (priority.HasValue) query = query.Where(t => t.Priority == priority.Value);
            if (pendingReason.HasValue && pendingReason.Value != 1 && pendingReason.Value != 2) return (new TicketProblem(400, "pendingReason must be 1 (the requester) or 2 (a third party).", "pendingReason"), null);
            if (pendingReason.HasValue) query = query.Where(t => t.Status == TicketStatus.Pending && (int?)t.PendingReason == pendingReason.Value);
            if (ageBand.HasValue)
            {
                if (ageBand.Value < 1 || ageBand.Value > 5) return (new TicketProblem(400, "ageBand must be 1 to 5.", "ageBand"), null);
                // the same bands as the unit performance chart (OpenByAge), counted from when the ticket was raised
                var ageNow = DateTime.UtcNow;
                var d1 = ageNow.AddDays(-1); var d3 = ageNow.AddDays(-3); var d6 = ageNow.AddDays(-6); var d11 = ageNow.AddDays(-11);
                query = ageBand.Value switch
                {
                    1 => query.Where(t => t.CreatedAt > d1),
                    2 => query.Where(t => t.CreatedAt <= d1 && t.CreatedAt > d3),
                    3 => query.Where(t => t.CreatedAt <= d3 && t.CreatedAt > d6),
                    4 => query.Where(t => t.CreatedAt <= d6 && t.CreatedAt > d11),
                    _ => query.Where(t => t.CreatedAt <= d11)
                };
            }
            if (slaBreached == true && (staffView || (view ?? "mine").Trim().ToLowerInvariant() == "assigned"))
                query = query.Where(t => t.SlaBreachedAt != null && OpenStatuses.Contains(t.Status));
                if (escalated == true && (staffView || (view ?? "mine").Trim().ToLowerInvariant() == "assigned"))
                    query = query.Where(t => t.EscalatedToHeadAt != null);
            var term = (search ?? string.Empty).Trim();
            if (term.Length > 0)
            {
                if (term.Length > 100) term = term.Substring(0, 100);
                query = staffView
                    ? query.Where(t => t.Reference.Contains(term) || t.Subject.Contains(term) || t.DescriptionText.Contains(term))
                    : query.Where(t => t.Reference.Contains(term) || t.Subject.Contains(term));
            }

            var sortKey = (sort ?? "created").Trim().ToLowerInvariant();
            IOrderedQueryable<Ticket> ordered = sortKey switch
            {
                "assignedat" => query.OrderBy(t => t.AssignedAt == null).ThenBy(t => t.AssignedAt).ThenByDescending(t => t.CreatedAt),
                "assignedat_desc" => query.OrderBy(t => t.AssignedAt == null).ThenByDescending(t => t.AssignedAt).ThenByDescending(t => t.CreatedAt),
                "pendingsince" => query.OrderBy(t => t.PendingSince == null).ThenBy(t => t.PendingSince).ThenByDescending(t => t.CreatedAt),
                "due" => query.OrderBy(t => t.SlaDueAt == null).ThenBy(t => t.SlaDueAt).ThenByDescending(t => t.CreatedAt),
                _ => query.OrderByDescending(t => t.CreatedAt)
            };
            var total = await query.CountAsync();
            var items = await Project(ordered.Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync();
            var viewKey = (view ?? "mine").Trim().ToLowerInvariant();
            if (!staffView && viewKey != "assigned")
                foreach (var item in items) { item.EscalatedToHeadAt = null; item.SlaLevel = SlaLevel.OnTrack; }
            foreach (var item in items) if (!OpenStatuses.Contains(item.Status)) item.SlaLevel = SlaLevel.OnTrack;
            await FillSlaDueAsync(items, staffView || viewKey == "assigned");
            await TicketMarkers.FillAsync(_db, items, actorUserId, staffView || viewKey == "assigned");
            return (null, new TicketPageDto { Items = items, Total = total, Page = page, PageSize = pageSize });
        }

        private async Task FillSlaDueAsync(IEnumerable<TicketListItemDto> items, bool show)
        {
            if (!show) return;
            var running = new[] { ServiceDeskAPI.Domain.Enums.TicketStatus.New, ServiceDeskAPI.Domain.Enums.TicketStatus.Assigned, ServiceDeskAPI.Domain.Enums.TicketStatus.InProgress, ServiceDeskAPI.Domain.Enums.TicketStatus.Reopened };
            var open = items.Where(i => running.Contains(i.Status)).ToList();
            if (open.Count == 0) return;
            var ids = open.Select(i => i.Id).ToList();
            var targets = await ServiceDeskAPI.Infrastructure.Sla.SlaTargets.LoadAsync(_db);
            var hours = (await _db.Tickets.AsNoTracking().Where(t => ids.Contains(t.Id)).Select(t => new { t.Id, t.CategoryId, t.DepartmentId, t.Priority }).ToListAsync()).ToDictionary(x => x.Id, x => targets.ResolutionHours(x.CategoryId, x.DepartmentId, x.Priority));
            var changes = (await _db.TicketStatusChanges.AsNoTracking().Where(c => ids.Contains(c.TicketId)).OrderBy(c => c.At)
                .Select(c => new { c.TicketId, c.ToStatus, c.At }).ToListAsync()).ToLookup(c => c.TicketId);
            var clock = ServiceDeskAPI.Infrastructure.Sla.BusinessClock.From(_slaOptions);
            var tracked = System.DateTime.TryParse(_slaOptions.TrackFrom, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var trackFrom);
            foreach (var item in open)
            {
                if (tracked && item.CreatedAt < trackFrom) continue;
                if (hours.TryGetValue(item.Id, out var h) && h > 0)
                    item.SlaDueAt = ServiceDeskAPI.Infrastructure.Sla.SlaDue.Compute(clock, item.CreatedAt, h, changes[item.Id].Select(c => (c.ToStatus, c.At)));
            }
        }

        public async Task<Guid?> FindIdByReferenceAsync(string reference)
        {
            var value = (reference ?? string.Empty).Trim().ToUpperInvariant();
            if (value.Length == 0 || value.Length > 30) return null;
            return await _db.Tickets.AsNoTracking().Where(t => t.Reference == value).Select(t => (Guid?)t.Id).FirstOrDefaultAsync();
        }

        public async Task<(TicketProblem? Problem, TicketDetailDto? Ticket)> GetAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (NotFound(), null);
            var (canView, isStaff) = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!canView) return (NotFound(), null);

            var x = await Project(_db.Tickets.AsNoTracking().Where(t => t.Id == ticketId)).SingleAsync();
            var detail = new TicketDetailDto
            {
                Id = x.Id, Reference = x.Reference, Subject = x.Subject, DepartmentCode = x.DepartmentCode, CategoryName = x.CategoryName,
                UnitName = x.UnitName, LocationName = x.LocationName, Priority = x.Priority, Status = x.Status, Requester = x.Requester,
                Assignee = x.Assignee, AssignedAt = x.AssignedAt, FirstRespondedAt = x.FirstRespondedAt, SlaLevel = x.SlaLevel, CreatedAt = x.CreatedAt, UpdatedAt = x.UpdatedAt,
                AcknowledgedAt = ticket.AcknowledgedAt, PendingReason = ticket.PendingReason, PendingSince = ticket.PendingSince,
                ResolvedAt = ticket.ResolvedAt, ResolutionCode = ticket.ResolutionCode, ResolutionNote = ticket.ResolutionNote,
                ClosedAt = ticket.ClosedAt, CancelledAt = ticket.CancelledAt, ReopenCount = ticket.ReopenCount
            };
            var extra = await _db.Tickets.AsNoTracking().Where(t => t.Id == ticketId)
                .Select(t => new { t.DepartmentId, DepartmentName = t.Department!.Name, t.CategoryId, t.UnitId, t.LocationId, t.RequesterDepartment, t.RaisedByUserId, t.DescriptionHtml })
                .SingleAsync();
            detail.DepartmentId = extra.DepartmentId;
            detail.DepartmentName = extra.DepartmentName;
            detail.CategoryId = extra.CategoryId;
            detail.UnitId = extra.UnitId;
            detail.LocationId = extra.LocationId;
            detail.RequesterDepartment = extra.RequesterDepartment;
            detail.DescriptionHtml = extra.DescriptionHtml;
            detail.RaisedBy = await PersonAsync(extra.RaisedByUserId);

            detail.Cc = await _db.TicketWatchers.AsNoTracking().Where(w => w.TicketId == ticketId)
                .OrderBy(w => w.AddedAt)
                .Select(w => new PersonDto(w.UserId, w.User!.UserName ?? string.Empty, w.User.FullName))
                .ToListAsync();

            var comments = await _db.TicketComments.AsNoTracking()
                .Where(c => c.TicketId == ticketId && (isStaff || !c.IsInternal))
                .OrderBy(c => c.CreatedAt)
                .Select(c => new TicketCommentDto
                {
                    Id = c.Id, BodyHtml = c.BodyHtml, IsInternal = c.IsInternal, Kind = c.Kind, CreatedAt = c.CreatedAt,
                    Author = new PersonDto(c.AuthorUserId, c.AuthorUser!.UserName ?? string.Empty, c.AuthorUser.FullName)
                })
                .ToListAsync();
            var visibleCommentIds = comments.Select(c => c.Id).ToList();
            var files = await _db.TicketAttachments.AsNoTracking()
                .Where(a => a.TicketId == ticketId && (a.CommentId == null || visibleCommentIds.Contains(a.CommentId.Value)))
                .OrderBy(a => a.UploadedAt)
                .Select(a => new { a.CommentId, Dto = new TicketAttachmentDto { Id = a.Id, CommentId = a.CommentId, FileName = a.FileName, ContentType = a.ContentType, SizeBytes = a.SizeBytes, UploadedAt = a.UploadedAt }, a.UploadedByUserId })
                .ToListAsync();
            var uploaders = await PeopleAsync(files.Select(f => f.UploadedByUserId));
            foreach (var f in files) f.Dto.UploadedBy = uploaders[f.UploadedByUserId];
            detail.Attachments = files.Where(f => f.CommentId == null).Select(f => f.Dto).ToList();
            foreach (var c in comments) c.Attachments = files.Where(f => f.CommentId == c.Id).Select(f => f.Dto).ToList();
            detail.Comments = comments;

            detail.IsStaffView = isStaff;
            if (isStaff)
            {
                detail.SlaWarnedAt = ticket.SlaWarnedAt;
                detail.SlaBreachedAt = ticket.SlaBreachedAt;
                detail.SlaL2At = ticket.SlaL2At;
            }
            else detail.SlaLevel = SlaLevel.OnTrack;
            if (!OpenStatuses.Contains(ticket.Status)) detail.SlaLevel = SlaLevel.OnTrack;
            if (isStaff) await FillSlaDueAsync(new List<TicketListItemDto> { detail }, true);
            if (isStaff && ticket.EscalatedToHeadAt.HasValue)
            {
                detail.EscalatedToHeadAt = ticket.EscalatedToHeadAt;
                detail.EscalatedToHeadReason = ticket.EscalatedToHeadReason;
            }
            detail.CanComment = ticket.Status is not (TicketStatus.Closed or TicketStatus.Cancelled);
            detail.CanAddInternalNote = isStaff && detail.CanComment;
            return (null, detail);
        }

        public async Task<(TicketProblem? Problem, string? FileName, string? ContentType, byte[]? Data)> GetAttachmentAsync(Guid ticketId, Guid attachmentId,
            Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (NotFound(), null, null, null);
            var (canView, isStaff) = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!canView) return (NotFound(), null, null, null);

            var file = await _db.TicketAttachments.AsNoTracking()
                .Where(a => a.Id == attachmentId && a.TicketId == ticketId)
                .Select(a => new { a.FileName, a.ContentType, Internal = a.Comment != null && a.Comment.IsInternal })
                .FirstOrDefaultAsync();
            if (file == null || (file.Internal && !isStaff)) return (new TicketProblem(404, "File not found."), null, null, null);
            var data = await _db.TicketAttachmentContents.AsNoTracking().Where(c => c.AttachmentId == attachmentId).Select(c => c.Data).FirstOrDefaultAsync();
            if (data == null) return (new TicketProblem(404, "File not found."), null, null, null);

            Stage(AuditAction.Downloaded, "TicketAttachment", attachmentId, ticket.Reference + " / " + file.FileName, null, null);
            await _db.SaveChangesAsync();
            return (null, file.FileName, file.ContentType, data);
        }

        // ---------------- comments ----------------

        public async Task<(TicketProblem? Problem, TicketCommentDto? Comment)> AddCommentAsync(Guid ticketId, AddCommentRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var ticket = await _db.Tickets.Include(t => t.Unit).FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (NotFound(), null);
            var (canView, isStaff) = await AccessAsync(ticket, actorUserId, actorIsSuperAdmin);
            if (!canView) return (NotFound(), null);
            if (ticket.Status is TicketStatus.Closed or TicketStatus.Cancelled)
                return (new TicketProblem(400, "This ticket is " + ticket.Status.ToString().ToLowerInvariant() + ", so it takes no more comments."), null);
            if (request.IsInternal && !isStaff)
                return (new TicketProblem(403, "Only staff of the department can add internal notes.", "isInternal"), null);

            var errors = new Dictionary<string, string>();
            var (html, text, bodyProblem) = CleanBody(request.BodyHtml, "bodyHtml", "Write a comment.");
            if (bodyProblem != null) errors["bodyHtml"] = bodyProblem.Message;
            var (fileProblem, files) = await AttachmentRules.CheckAsync(request.Files);
            if (fileProblem != null) errors["files"] = fileProblem;
            if (errors.Count > 0) return (Invalid(errors), null);

            var now = DateTime.UtcNow;
            var comment = new TicketComment { Id = Guid.NewGuid(), TicketId = ticketId, AuthorUserId = actorUserId, BodyHtml = html, BodyText = text, IsInternal = request.IsInternal, CreatedAt = now };
            _db.TicketComments.Add(comment);
            AddFiles(ticketId, comment.Id, files, actorUserId, now);
            ticket.UpdatedAt = now;
            ticket.UpdatedByUserId = actorUserId;
            if (!request.IsInternal && ticket.AssigneeUserId == actorUserId) ticket.FirstRespondedAt ??= now;
            Stage(AuditAction.Created, "TicketComment", comment.Id, ticket.Reference, null, new { ticket = ticket.Reference, internalNote = request.IsInternal, files = files.Count });

            // Waiting on the requester and the requester answered: back to In progress (BRD Section 8)
            var resumed = false;
            if (!request.IsInternal && ticket.Status == TicketStatus.Pending && ticket.PendingReason == PendingReason.Requester
                && (actorUserId == ticket.RequesterUserId || actorUserId == ticket.RaisedByUserId))
            {
                _db.TicketStatusChanges.Add(new TicketStatusChange
                {
                    Id = Guid.NewGuid(), TicketId = ticket.Id, FromStatus = TicketStatus.Pending, ToStatus = TicketStatus.InProgress,
                    ByUserId = actorUserId, Reason = "The requester replied", At = now
                });
                ticket.Status = TicketStatus.InProgress;
                ticket.PendingReason = null;
                ticket.PendingSince = null;
                resumed = true;
            }

            // Who hears about it: public comments go to everyone on the ticket; internal notes to the assignee and the unit's heads
            var author = await PersonAsync(actorUserId);
            var recipients = new HashSet<Guid>();
            if (!request.IsInternal)
            {
                recipients.Add(ticket.RequesterUserId);
                foreach (var w in await _db.TicketWatchers.Where(w => w.TicketId == ticketId).Select(w => w.UserId).ToListAsync()) recipients.Add(w);
            }
            if (ticket.AssigneeUserId.HasValue) recipients.Add(ticket.AssigneeUserId.Value);
            if (request.IsInternal || !ticket.AssigneeUserId.HasValue)
                foreach (var head in await ServiceDeskAPI.Infrastructure.Organisation.HeadContacts.ForAsync(_db, ticket.UnitId)) recipients.Add(head);
            recipients.Remove(actorUserId);
            var who = author.FullName ?? author.UserName;
            if (resumed && ticket.AssigneeUserId.HasValue && ticket.AssigneeUserId != actorUserId)
            {
                recipients.Remove(ticket.AssigneeUserId.Value);
                _notifications.Stage(ticket.AssigneeUserId.Value, "Ticket " + ticket.Reference + " resumed",
                    who + " replied, so the ticket is back in progress.", NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
            }
            foreach (var userId in recipients)
                _notifications.Stage(userId,
                    (request.IsInternal ? "Internal note on " : "New comment on ") + ticket.Reference,
                    who + (request.IsInternal ? " added an internal note" : " commented") + CommentExcerpt.For(comment.BodyText) + (files.Count > 0 ? " Files attached: " + files.Count + "." : string.Empty),
                    NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                _db.ChangeTracker.Clear();
                return (new TicketProblem(409, "The ticket changed while you were writing. Reload it and try again."), null);
            }

            var uploader = author;
            return (null, new TicketCommentDto
            {
                Id = comment.Id, Author = author, BodyHtml = html, IsInternal = comment.IsInternal, CreatedAt = now,
                Attachments = _db.ChangeTracker.Entries<TicketAttachment>().Select(e => e.Entity).Where(a => a.CommentId == comment.Id)
                    .Select(a => new TicketAttachmentDto { Id = a.Id, CommentId = a.CommentId, FileName = a.FileName, ContentType = a.ContentType, SizeBytes = a.SizeBytes, UploadedAt = a.UploadedAt, UploadedBy = uploader })
                    .ToList()
            });
        }

        // ---------------- SLA summary (Step 7b) ----------------

        public async Task<(TicketProblem? Problem, SlaSummaryDto? Summary)> SlaSummaryAsync(Guid departmentId, Guid? unitId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            List<Guid>? scope = null;
            if (!actorIsSuperAdmin && !await TicketAccess.IsDepartmentWideAsync(_db, actorUserId, departmentId) && (scope = await TicketAccess.UnitIdsAsync(_db, actorUserId, departmentId)).Count == 0)
                return (new TicketProblem(403, "Only staff of this department can see its SLA summary."), null);
            var query = _db.Tickets.AsNoTracking().Where(t => t.DepartmentId == departmentId && OpenStatuses.Contains(t.Status));
            if (scope != null) query = query.Where(t => scope.Contains(t.UnitId));
            if (unitId.HasValue) query = query.Where(t => t.UnitId == unitId.Value);
            var summary = await query.GroupBy(t => 1).Select(g => new SlaSummaryDto
            {
                Open = g.Count(),
                Warning = g.Count(t => t.SlaWarnedAt != null && t.SlaBreachedAt == null),
                Overdue = g.Count(t => t.SlaBreachedAt != null && t.SlaL2At == null),
                FarPast = g.Count(t => t.SlaL2At != null),
                Unassigned = g.Count(t => t.AssigneeUserId == null)
            }).FirstOrDefaultAsync();
            return (null, summary ?? new SlaSummaryDto());
        }
        // ---------------- helpers ----------------

        /// <summary>Requester, raiser, copied people, department staff (unit members and HOD) and Super Admins can view; staff also see internal notes.</summary>
        private async Task<(bool CanView, bool IsStaff)> AccessAsync(Ticket ticket, Guid userId, bool isSuperAdmin)
        {
            var isStaff = isSuperAdmin || await TicketAccess.IsStaffForTicketAsync(_db, userId, ticket.DepartmentId, ticket.UnitId);
            if (isStaff) return (true, true);
            var canView = ticket.RequesterUserId == userId || ticket.RaisedByUserId == userId
                || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticket.Id && w.UserId == userId)
                || await _db.TicketTasks.AnyAsync(k => k.TicketId == ticket.Id && k.AssigneeUserId == userId && k.CancelledAt == null);
            return (canView, false);
        }

        private async Task<bool> IsDepartmentStaffAsync(Guid userId, Guid departmentId) =>
            await _db.UnitMembers.AnyAsync(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == departmentId)
            || await _db.Departments.AnyAsync(d => d.Id == departmentId && d.HodUserId == userId);

        private static IQueryable<TicketListItemDto> Project(IQueryable<Ticket> query) =>
            query.Select(t => new TicketListItemDto
            {
                Id = t.Id, Reference = t.Reference, Subject = t.Subject, DepartmentCode = t.Department!.Code, CategoryName = t.Category!.Name,
                UnitName = t.Unit!.Name, LocationName = t.Location!.Name, Priority = t.Priority, Status = t.Status, PendingReason = t.PendingReason, PendingSince = t.PendingSince,
                Requester = new PersonDto(t.RequesterUserId, t.RequesterUser!.UserName ?? string.Empty, t.RequesterUser.FullName),
                Assignee = t.AssigneeUserId == null ? null : new PersonDto(t.AssigneeUserId.Value, t.AssigneeUser!.UserName ?? string.Empty, t.AssigneeUser.FullName),
                AssignedAt = t.AssigneeUserId == null ? null : t.AssignedAt,
                FirstRespondedAt = t.FirstRespondedAt, EscalatedToHeadAt = t.EscalatedToHeadAt, CreatedAt = t.CreatedAt, UpdatedAt = t.UpdatedAt, SlaLevel = t.SlaL2At != null ? SlaLevel.FarPast : t.SlaBreachedAt != null ? SlaLevel.Overdue : t.SlaWarnedAt != null ? SlaLevel.Warning : SlaLevel.OnTrack
            });

        /// <summary>DEPT-YYYY-000001: the next number for the department and (Lagos) year, taken inside the caller's transaction.</summary>
        private async Task<string> NextReferenceAsync(string departmentCode, Guid departmentId)
        {
            var year = (_time.GetUtcNow().UtcDateTime + TimeSpan.FromHours(1)).Year;
            var numbers = await _db.Database.SqlQuery<int>($@"MERGE dbo.TicketSequences WITH (HOLDLOCK) AS target
USING (SELECT {departmentId} AS DepartmentId, {year} AS [Year]) AS source
ON target.DepartmentId = source.DepartmentId AND target.[Year] = source.[Year]
WHEN MATCHED THEN UPDATE SET LastNumber = target.LastNumber + 1
WHEN NOT MATCHED THEN INSERT (DepartmentId, [Year], LastNumber) VALUES (source.DepartmentId, source.[Year], 1)
OUTPUT inserted.LastNumber AS [Value];").ToListAsync();
            return departmentCode + "-" + year + "-" + numbers.Single().ToString("D6");
        }

        private (string Html, string Text, TicketProblem? Problem) CleanBody(string? raw, string field, string emptyMessage)
        {
            if (raw != null && raw.Length > TicketSeed.MaxHtmlChars * 2)
                return (string.Empty, string.Empty, new TicketProblem(400, "The text is too long. Attach large tables as files.", field));
            var html = RichText.Clean(raw);
            var text = RichText.ToText(html);
            if (text.Length == 0) return (string.Empty, string.Empty, new TicketProblem(400, emptyMessage, field));
            if (html.Length > TicketSeed.MaxHtmlChars) return (string.Empty, string.Empty, new TicketProblem(400, "The text is too long. Attach large tables as files.", field));
            return (html, text, null);
        }

        private void AddFiles(Guid ticketId, Guid? commentId, List<AttachmentRules.CheckedFile> files, Guid uploadedBy, DateTime now)
        {
            foreach (var file in files)
            {
                var attachment = new TicketAttachment
                {
                    Id = Guid.NewGuid(), TicketId = ticketId, CommentId = commentId, FileName = file.FileName, ContentType = file.ContentType,
                    SizeBytes = file.Data.Length, Sha256 = file.Sha256, UploadedByUserId = uploadedBy, UploadedAt = now
                };
                _db.TicketAttachments.Add(attachment);
                _db.TicketAttachmentContents.Add(new TicketAttachmentContent { AttachmentId = attachment.Id, Data = file.Data });
            }
        }

        private async Task<PersonDto> PersonAsync(Guid userId) =>
            await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).FirstOrDefaultAsync()
            ?? new PersonDto(userId, string.Empty, null);

        private async Task<Dictionary<Guid, PersonDto>> PeopleAsync(IEnumerable<Guid> ids)
        {
            var list = ids.Distinct().ToList();
            var found = await _db.Users.AsNoTracking().Where(u => list.Contains(u.Id))
                .Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).ToListAsync();
            var map = found.ToDictionary(p => p.UserId);
            foreach (var id in list.Where(id => !map.ContainsKey(id))) map[id] = new PersonDto(id, string.Empty, null);
            return map;
        }

        private static TicketProblem NotFound() => new(404, "Ticket not found.");

        private static TicketProblem Invalid(Dictionary<string, string> errors)
        {
            if (errors.Count == 0) errors["form"] = "Check the form.";
            var first = errors.First();
            return new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors);
        }

        private void Stage(AuditAction action, string entityType, Guid entityId, string? display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, entityType, entityId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }

        private static string? Trim(string? value, int max) => string.IsNullOrWhiteSpace(value) ? null : value.Length > max ? value.Substring(0, max) : value;

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
    }
}