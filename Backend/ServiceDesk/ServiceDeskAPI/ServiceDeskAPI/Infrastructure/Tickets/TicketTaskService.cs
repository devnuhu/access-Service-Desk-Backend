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
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    /// <summary>
    /// The checklist on a ticket. Every change is audited. A person given a task is told in the app (and by email, like every notification).
    /// Tasks are for staff: a requester or anyone else who is not staff on the ticket gets 404, except the person a task is given to (they may
    /// be in another unit of the department): they see only their own tasks and can finish or reject them.
    /// A task is Open, Done, Rejected (sent back by its owner, still blocks resolving) or Cancelled (does not block).
    /// </summary>
    public class TicketTaskService : ITicketTaskService
    {
        private const int MaxTasks = 30;

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly SlaOptions _sla;

        public TicketTaskService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, IOptions<SlaOptions> sla)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _sla = sla.Value;
        }

        private sealed record Viewer(Guid UserId, bool IsStaff, bool IsHead, bool IsSuperAdmin);

        private static bool Locked(Ticket t) => t.Status is TicketStatus.Resolved or TicketStatus.Closed or TicketStatus.Cancelled;

        private static string StateOf(TicketTask t) => t.CancelledAt != null ? "Cancelled" : t.IsDone ? "Done" : t.RejectedAt != null ? "Rejected" : "Open";

        private async Task<(TicketProblem? Problem, Ticket? Ticket, Viewer? Viewer)> LoadAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin, bool forChange, bool allowOwner = false)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null, null);
            var staff = actorIsSuperAdmin || await TicketAccess.IsStaffForTicketAsync(_db, actorUserId, ticket.DepartmentId, ticket.UnitId);
            if (!staff && !(allowOwner && await _db.TicketTasks.AnyAsync(t => t.TicketId == ticketId && t.AssigneeUserId == actorUserId && t.CancelledAt == null)))
                return (new TicketProblem(404, "Ticket not found."), null, null);
            if (forChange && Locked(ticket))
                return (new TicketProblem(400, "Tasks cannot be changed while the ticket is " + ticket.Status.ToString().ToLowerInvariant() + "."), null, null);
            var head = staff && await _db.Units.AnyAsync(u => u.Id == ticket.UnitId && u.HeadUserId == actorUserId);
            return (null, ticket, new Viewer(actorUserId, staff, head, actorIsSuperAdmin));
        }

        private DateTime LagosToday() => DateTime.UtcNow.AddHours(_sla.UtcOffsetHours).Date;

        private async Task<Dictionary<Guid, PersonDto>> PeopleAsync(IEnumerable<Guid?> ids)
        {
            var list = ids.Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
            if (list.Count == 0) return new Dictionary<Guid, PersonDto>();
            return (await _db.Users.AsNoTracking().Where(u => list.Contains(u.Id)).Select(u => new { u.Id, u.UserName, u.FullName }).ToListAsync())
                .ToDictionary(u => u.Id, u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName));
        }

        private static PersonDto? Who(Dictionary<Guid, PersonDto> people, Guid? id) => id.HasValue && people.TryGetValue(id.Value, out var p) ? p : null;

        private async Task<List<TicketTaskDto>> ToDtosAsync(List<TicketTask> tasks, Ticket ticket, Viewer viewer)
        {
            var people = await PeopleAsync(tasks.SelectMany(t => new Guid?[] { t.AssigneeUserId, t.DoneByUserId, t.RejectedByUserId, t.CancelledByUserId, t.CreatedByUserId }));
            var today = LagosToday();
            var locked = Locked(ticket);
            return tasks.Select(t =>
            {
                var state = StateOf(t);
                var mine = t.AssigneeUserId == viewer.UserId;
                return new TicketTaskDto
                {
                    Id = t.Id, Title = t.Title, Status = state,
                    Assignee = Who(people, t.AssigneeUserId), CreatedBy = Who(people, t.CreatedByUserId),
                    DueDate = t.DueAt?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    IsDone = t.IsDone, DoneAt = t.DoneAt, DoneBy = Who(people, t.DoneByUserId), CreatedAt = t.CreatedAt,
                    IsOverdue = state == "Open" && t.DueAt.HasValue && t.DueAt.Value.Date < today,
                    RejectedBy = Who(people, t.RejectedByUserId), RejectedAt = t.RejectedAt, RejectedReason = t.RejectedReason, HandedOver = t.HandedOverAt != null,
                    CancelledBy = Who(people, t.CancelledByUserId), CancelledAt = t.CancelledAt, CancelledReason = t.CancelledReason,
                    CanComplete = !locked && state == "Open" && (viewer.IsStaff || mine),
                    CanReject = !locked && state == "Open" && mine,
                    CanCancel = !locked && (state == "Open" || state == "Rejected") && t.HandedOverAt == null && viewer.IsStaff && MayCancel(t, ticket, viewer),
                    CanRemove = !locked && viewer.IsStaff && (!t.AssigneeUserId.HasValue || t.AssigneeUserId == viewer.UserId)
                };
            }).ToList();
        }

        private static bool MayCancel(TicketTask task, Ticket ticket, Viewer viewer) =>
            viewer.IsSuperAdmin || viewer.IsHead || ticket.AssigneeUserId == viewer.UserId || task.CreatedByUserId == viewer.UserId;

        public async Task<(TicketProblem? Problem, TicketTasksDto? Tasks)> ListAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, viewer) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, false, allowOwner: true);
            if (problem != null) return (problem, null);
            var query = _db.TicketTasks.AsNoTracking().Where(t => t.TicketId == ticketId);
            if (!viewer!.IsStaff) query = query.Where(t => t.AssigneeUserId == actorUserId);
            var tasks = await query.OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt).ToListAsync();
            var items = await ToDtosAsync(tasks, ticket!, viewer);
            return (null, new TicketTasksDto
            {
                Items = items,
                Open = items.Count(i => i.Status == "Open"), Done = items.Count(i => i.Status == "Done"),
                Rejected = items.Count(i => i.Status == "Rejected" && !i.HandedOver), Cancelled = items.Count(i => i.Status == "Cancelled"),
                CanEdit = viewer.IsStaff && !Locked(ticket!)
            });
        }

        /// <summary>Checks the title, due date and owner. Returns the cleaned values.</summary>
        private async Task<(TicketProblem? Problem, string Title, DateTime? DueAt)> CheckAsync(TicketTaskRequest request, Ticket ticket)
        {
            var errors = new Dictionary<string, string>();
            var title = (request.Title ?? string.Empty).Trim();
            if (title.Length < 3 || title.Length > 200) errors["title"] = "Describe the task in 3 to 200 characters.";
            DateTime? dueAt = null;
            if (!string.IsNullOrWhiteSpace(request.DueDate))
            {
                if (DateTime.TryParseExact(request.DueDate.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var due))
                    dueAt = DateTime.SpecifyKind(due.Date, DateTimeKind.Utc);
                else errors["dueDate"] = "Use the date format yyyy-MM-dd.";
            }
            if (request.AssigneeUserId.HasValue)
            {
                var id = request.AssigneeUserId.Value;
                var inDepartment = await _db.UnitMembers.AnyAsync(m => m.UserId == id && m.IsActive && m.Unit!.DepartmentId == ticket.DepartmentId);
                if (!inDepartment) errors["assigneeUserId"] = "Choose someone who works in this department.";
            }
            if (errors.Count > 0)
            {
                var first = errors.First();
                return (new TicketProblem(400, errors.Count == 1 ? first.Value : "Check the " + errors.Count + " highlighted fields.", first.Key, errors), title, null);
            }
            return (null, title, dueAt);
        }

        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> AddAsync(Guid ticketId, TicketTaskRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, viewer) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var (bad, title, dueAt) = await CheckAsync(request, ticket!);
            if (bad != null) return (bad, null);
            var existing = await _db.TicketTasks.Where(t => t.TicketId == ticketId).Select(t => t.SortOrder).ToListAsync();
            if (existing.Count >= MaxTasks) return (new TicketProblem(400, "A ticket can have at most " + MaxTasks + " tasks."), null);

            var now = DateTime.UtcNow;
            var task = new TicketTask
            {
                Id = Guid.NewGuid(), TicketId = ticketId, Title = title, AssigneeUserId = request.AssigneeUserId, DueAt = dueAt,
                SortOrder = existing.Count == 0 ? 1 : existing.Max() + 1, CreatedAt = now, CreatedByUserId = actorUserId
            };
            _db.TicketTasks.Add(task);
            Stage(AuditAction.Created, task, ticket!, new { title, assignee = request.AssigneeUserId, dueDate = request.DueDate });
            TellOwner(task, ticket!, actorUserId);
            await _db.SaveChangesAsync();
            return (null, (await ToDtosAsync(new List<TicketTask> { task }, ticket!, viewer!)).Single());
        }

        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> UpdateAsync(Guid ticketId, Guid taskId, TicketTaskRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, viewer) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null) return (new TicketProblem(404, "Task not found."), null);
            if (task.CancelledAt != null) return (new TicketProblem(400, "This task was cancelled, so it cannot be changed."), null);
            if (task.HandedOverAt != null) return (new TicketProblem(400, "This task was handed over to someone else. Change the new task instead."), null);
            var (bad, title, dueAt) = await CheckAsync(request, ticket!);
            if (bad != null) return (bad, null);

            var ownerChanged = task.AssigneeUserId != request.AssigneeUserId;
            var now = DateTime.UtcNow;

            if (ownerChanged && task.RejectedAt != null)
            {
                // The rejection stays on the first person's record; the work goes on as a new task for the new owner
                var existing = await _db.TicketTasks.Where(t => t.TicketId == ticketId).Select(t => t.SortOrder).ToListAsync();
                if (existing.Count >= MaxTasks) return (new TicketProblem(400, "A ticket can have at most " + MaxTasks + " tasks."), null);
                task.HandedOverAt = now;
                task.UpdatedAt = now;
                var next = new TicketTask
                {
                    Id = Guid.NewGuid(), TicketId = ticketId, Title = title, AssigneeUserId = request.AssigneeUserId, DueAt = dueAt,
                    SortOrder = existing.Max() + 1, CreatedAt = now, CreatedByUserId = actorUserId
                };
                _db.TicketTasks.Add(next);
                Stage(AuditAction.Updated, task, ticket!, new { title = task.Title, handedOver = true, to = request.AssigneeUserId });
                Stage(AuditAction.Created, next, ticket!, new { title, assignee = request.AssigneeUserId, dueDate = request.DueDate, handedOverFrom = task.Id });
                TellOwner(next, ticket!, actorUserId);
                await _db.SaveChangesAsync();
                return (null, (await ToDtosAsync(new List<TicketTask> { next }, ticket!, viewer!)).Single());
            }

            var dueChanged = task.DueAt != dueAt;
            task.Title = title;
            task.AssigneeUserId = request.AssigneeUserId;
            task.DueAt = dueAt;
            task.UpdatedAt = now;
            if (ownerChanged || dueChanged) task.OverdueNotifiedAt = null;
            Stage(AuditAction.Updated, task, ticket!, new { title, assignee = request.AssigneeUserId, dueDate = request.DueDate });
            if (ownerChanged) TellOwner(task, ticket!, actorUserId);
            await _db.SaveChangesAsync();
            return (null, (await ToDtosAsync(new List<TicketTask> { task }, ticket!, viewer!)).Single());
        }        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> SetDoneAsync(Guid ticketId, Guid taskId, bool done, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, viewer) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true, allowOwner: true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null || (!viewer!.IsStaff && task.AssigneeUserId != actorUserId)) return (new TicketProblem(404, "Task not found."), null);
            var state = StateOf(task);
            if (state == "Cancelled") return (new TicketProblem(400, "This task was cancelled."), null);
            if (state == "Rejected" && done) return (new TicketProblem(400, "This task was rejected. Give it to someone else or cancel it."), null);
            if (task.IsDone != done)
            {
                var now = DateTime.UtcNow;
                task.IsDone = done;
                task.DoneAt = done ? now : null;
                task.DoneByUserId = done ? actorUserId : null;
                task.UpdatedAt = now;
                Stage(AuditAction.Updated, task, ticket!, new { title = task.Title, done });
                if (done) await TellDoneAsync(task, ticket!, actorUserId);
                await _db.SaveChangesAsync();
            }
            return (null, (await ToDtosAsync(new List<TicketTask> { task }, ticket!, viewer!)).Single());
        }

        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> RejectAsync(Guid ticketId, Guid taskId, string? reason, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var text = (reason ?? string.Empty).Trim();
            if (text.Length < 5 || text.Length > 500)
                return (new TicketProblem(400, "Say why you are sending it back (5 to 500 characters).", "reason"), null);
            var (problem, ticket, viewer) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true, allowOwner: true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null || (!viewer!.IsStaff && task.AssigneeUserId != actorUserId)) return (new TicketProblem(404, "Task not found."), null);
            if (task.AssigneeUserId != actorUserId) return (new TicketProblem(403, "Only the person the task is given to can reject it."), null);
            if (StateOf(task) != "Open") return (new TicketProblem(400, "Only an open task can be rejected."), null);

            var now = DateTime.UtcNow;
            task.RejectedAt = now;
            task.RejectedByUserId = actorUserId;
            task.RejectedReason = text;
            task.UpdatedAt = now;
            Stage(AuditAction.Updated, task, ticket!, new { title = task.Title, rejected = true, reason = text });
            var name = await NameOfAsync(actorUserId);
            var told = new HashSet<Guid>();
            foreach (var who in new Guid?[] { ticket!.AssigneeUserId, task.CreatedByUserId })
                if (who.HasValue && who.Value != actorUserId && told.Add(who.Value))
                    _notifications.Stage(who.Value, "Ticket " + ticket.Reference + ": a task was rejected",
                        name + " sent back \"" + task.Title + "\": " + text,
                        NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
            await _db.SaveChangesAsync();
            return (null, (await ToDtosAsync(new List<TicketTask> { task }, ticket, viewer!)).Single());
        }

        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> CancelAsync(Guid ticketId, Guid taskId, string? reason, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var text = (reason ?? string.Empty).Trim();
            if (text.Length < 3 || text.Length > 500)
                return (new TicketProblem(400, "Say why it is cancelled (3 to 500 characters).", "reason"), null);
            var (problem, ticket, viewer) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null) return (new TicketProblem(404, "Task not found."), null);
            var state = StateOf(task);
            if (state != "Open" && state != "Rejected") return (new TicketProblem(400, "Only an open or rejected task can be cancelled."), null);
            if (task.HandedOverAt != null) return (new TicketProblem(400, "This task was handed over to someone else."), null);
            if (!MayCancel(task, ticket!, viewer!))
                return (new TicketProblem(403, "Only the ticket's case worker, the person who added the task, the head of the unit or a Super Admin can cancel it."), null);

            var now = DateTime.UtcNow;
            task.CancelledAt = now;
            task.CancelledByUserId = actorUserId;
            task.CancelledReason = text;
            task.UpdatedAt = now;
            Stage(AuditAction.Updated, task, ticket!, new { title = task.Title, cancelled = true, reason = text });
            if (task.AssigneeUserId.HasValue && task.AssigneeUserId.Value != actorUserId)
                _notifications.Stage(task.AssigneeUserId.Value, "Ticket " + ticket!.Reference + ": a task was cancelled",
                    await NameOfAsync(actorUserId) + " cancelled \"" + task.Title + "\": " + text + " No further work is needed on it.",
                    NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
            await _db.SaveChangesAsync();
            return (null, (await ToDtosAsync(new List<TicketTask> { task }, ticket!, viewer!)).Single());
        }

        public async Task<(TicketProblem? Problem, string? Message)> RemoveAsync(Guid ticketId, Guid taskId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, _) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null) return (new TicketProblem(404, "Task not found."), null);
            if (task.AssigneeUserId.HasValue && task.AssigneeUserId.Value != actorUserId)
                return (new TicketProblem(400, "This task is given to someone else, so cancel it with a reason instead of removing it."), null);
            Stage(AuditAction.Deleted, task, ticket!, new { title = task.Title });
            _db.TicketTasks.Remove(task);
            await _db.SaveChangesAsync();
            return (null, "Task removed.");
        }

        /// <summary>Everyone who can own a task on this ticket: active people who work in any unit of the ticket's department. For the owner picker.</summary>
        public async Task<(TicketProblem? Problem, List<PersonDto>? Owners)> OwnersAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket, _) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var ids = await _db.UnitMembers.AsNoTracking().Where(m => m.IsActive && m.Unit!.DepartmentId == ticket!.DepartmentId).Select(m => m.UserId).Distinct().ToListAsync();
            var people = await _db.Users.AsNoTracking().Where(u => ids.Contains(u.Id) && u.IsActive).Select(u => new { u.Id, u.UserName, u.FullName }).ToListAsync();
            return (null, people.Select(u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName)).OrderBy(p => p.FullName ?? p.UserName).ToList());
        }

        /// <summary>The tasks given to the signed-in person, for good: open, done, rejected and cancelled. Older call: open ones, or everything with includeFinished.</summary>
        public async Task<MyTasksDto> MineAsync(Guid actorUserId, bool includeFinished, int page, int pageSize)
        {
            var (_, result) = await MineAsync(actorUserId, new MyTasksQuery { Status = includeFinished ? "all" : "open", Page = page, PageSize = pageSize });
            return result!;
        }

        private static IQueryable<TicketTask> OnlyOpen(IQueryable<TicketTask> tasks) =>
            tasks.Where(t => !t.IsDone && t.RejectedAt == null && t.CancelledAt == null
                && t.Ticket!.Status != TicketStatus.Resolved && t.Ticket.Status != TicketStatus.Closed && t.Ticket.Status != TicketStatus.Cancelled);

        /// <summary>
        /// Status: open (default; on running tickets, soonest due first), done, rejected, cancelled or all (newest first). DateField: given (default), due or finished,
        /// with From and To (yyyy-MM-dd, Lagos dates, both included). The date window applies to the list and to the counts; the counts show every status.
        /// </summary>
        public async Task<(TicketProblem? Problem, MyTasksDto? Result)> MineAsync(Guid actorUserId, MyTasksQuery query)
        {
            query ??= new MyTasksQuery();
            var status = (query.Status ?? "open").Trim().ToLowerInvariant();
            if (status is not ("open" or "done" or "rejected" or "cancelled" or "all"))
                return (new TicketProblem(400, "Status must be open, done, rejected, cancelled or all.", "status"), null);
            var field = (query.DateField ?? "given").Trim().ToLowerInvariant();
            if (field is not ("given" or "due" or "finished"))
                return (new TicketProblem(400, "The date to filter on must be given, due or finished.", "dateField"), null);
            DateTime? fromDay = null;
            DateTime? toDay = null;
            if (!string.IsNullOrWhiteSpace(query.From))
            {
                if (!DateTime.TryParseExact(query.From.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var f))
                    return (new TicketProblem(400, "Use the date format yyyy-MM-dd.", "from"), null);
                fromDay = f.Date;
            }
            if (!string.IsNullOrWhiteSpace(query.To))
            {
                if (!DateTime.TryParseExact(query.To.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t))
                    return (new TicketProblem(400, "Use the date format yyyy-MM-dd.", "to"), null);
                toDay = t.Date;
            }
            if (fromDay.HasValue && toDay.HasValue && fromDay > toDay)
                return (new TicketProblem(400, "The start date is after the end date.", "from"), null);

            var page = Math.Max(1, query.Page);
            var pageSize = query.PageSize <= 0 ? 20 : Math.Min(query.PageSize, 100);

            var mine = _db.TicketTasks.AsNoTracking().Where(t => t.AssigneeUserId == actorUserId);
            var openCount = await OnlyOpen(mine).CountAsync();

            var windowed = mine;
            if (fromDay.HasValue || toDay.HasValue)
            {
                var offset = _sla.UtcOffsetHours;
                DateTime? fromUtc = fromDay?.AddHours(-offset);
                DateTime? toUtc = toDay?.AddDays(1).AddHours(-offset);
                DateTime? dueFrom = fromDay;
                DateTime? dueTo = toDay?.AddDays(1);
                if (field == "due")
                {
                    windowed = windowed.Where(t => t.DueAt != null);
                    if (dueFrom.HasValue) windowed = windowed.Where(t => t.DueAt >= dueFrom.Value);
                    if (dueTo.HasValue) windowed = windowed.Where(t => t.DueAt < dueTo.Value);
                }
                else if (field == "finished")
                {
                    windowed = windowed.Where(t => (t.DoneAt ?? t.CancelledAt ?? t.RejectedAt) != null);
                    if (fromUtc.HasValue) windowed = windowed.Where(t => (t.DoneAt ?? t.CancelledAt ?? t.RejectedAt) >= fromUtc.Value);
                    if (toUtc.HasValue) windowed = windowed.Where(t => (t.DoneAt ?? t.CancelledAt ?? t.RejectedAt) < toUtc.Value);
                }
                else
                {
                    if (fromUtc.HasValue) windowed = windowed.Where(t => t.CreatedAt >= fromUtc.Value);
                    if (toUtc.HasValue) windowed = windowed.Where(t => t.CreatedAt < toUtc.Value);
                }
            }

            var counts = new MyTaskCounts
            {
                Open = await OnlyOpen(windowed).CountAsync(),
                Done = await windowed.CountAsync(t => t.IsDone),
                Rejected = await windowed.CountAsync(t => t.RejectedAt != null && !t.IsDone && t.CancelledAt == null),
                Cancelled = await windowed.CountAsync(t => t.CancelledAt != null),
                All = await windowed.CountAsync()
            };

            var list = status switch
            {
                "open" => OnlyOpen(windowed),
                "done" => windowed.Where(t => t.IsDone),
                "rejected" => windowed.Where(t => t.RejectedAt != null && !t.IsDone && t.CancelledAt == null),
                "cancelled" => windowed.Where(t => t.CancelledAt != null),
                _ => windowed
            };
            var total = await list.CountAsync();
            var ordered = status == "open"
                ? list.OrderBy(t => t.DueAt == null).ThenBy(t => t.DueAt).ThenBy(t => t.CreatedAt)
                : list.OrderByDescending(t => t.DoneAt ?? t.CancelledAt ?? t.RejectedAt ?? t.CreatedAt).ThenByDescending(t => t.CreatedAt);
            var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize)
                .Select(t => new
                {
                    t.Id, t.TicketId, Reference = t.Ticket!.Reference, Subject = t.Ticket.Subject, TicketStatus = t.Ticket.Status,
                    t.Title, t.DueAt, t.IsDone, t.DoneAt, t.RejectedAt, t.RejectedReason, t.CancelledAt, t.CancelledReason, t.CreatedByUserId, t.CreatedAt
                }).ToListAsync();
            var people = await PeopleAsync(rows.Select(r => (Guid?)r.CreatedByUserId));
            var today = LagosToday();
            var items = rows.Select(r =>
            {
                var state = r.CancelledAt != null ? "Cancelled" : r.IsDone ? "Done" : r.RejectedAt != null ? "Rejected" : "Open";
                return new MyTaskDto
                {
                    TaskId = r.Id, TicketId = r.TicketId, TicketReference = r.Reference, TicketSubject = r.Subject, TicketStatus = r.TicketStatus,
                    Title = r.Title, Status = state, DueDate = r.DueAt?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    IsOverdue = state == "Open" && r.DueAt.HasValue && r.DueAt.Value.Date < today,
                    GivenBy = Who(people, r.CreatedByUserId), CreatedAt = r.CreatedAt,
                    FinishedAt = r.DoneAt ?? r.CancelledAt ?? r.RejectedAt,
                    Reason = state == "Cancelled" ? r.CancelledReason : state == "Rejected" ? r.RejectedReason : null
                };
            }).ToList();
            return (null, new MyTasksDto { Items = items, Total = total, OpenCount = openCount, Counts = counts, Page = page, PageSize = pageSize });
        }        private async Task<string> NameOfAsync(Guid userId) =>
            await _db.Users.Where(u => u.Id == userId).Select(u => u.FullName ?? u.UserName).FirstOrDefaultAsync() ?? "Someone";

        private void TellOwner(TicketTask task, Ticket ticket, Guid actorUserId)
        {
            if (!task.AssigneeUserId.HasValue || task.AssigneeUserId.Value == actorUserId) return;
            _notifications.Stage(task.AssigneeUserId.Value, "Ticket " + ticket.Reference + ": a task is assigned to you",
                task.Title + (task.DueAt.HasValue ? " (due " + task.DueAt.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) + ")" : string.Empty),
                NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        /// <summary>The ticket's case worker and the person who added the task hear that it is done (not the person who did it).</summary>
        private async Task TellDoneAsync(TicketTask task, Ticket ticket, Guid actorUserId)
        {
            var name = await NameOfAsync(actorUserId);
            var told = new HashSet<Guid>();
            foreach (var who in new Guid?[] { ticket.AssigneeUserId, task.CreatedByUserId })
                if (who.HasValue && who.Value != actorUserId && told.Add(who.Value))
                    _notifications.Stage(who.Value, "Ticket " + ticket.Reference + ": a task is done",
                        name + " finished \"" + task.Title + "\".",
                        NotificationType.Info, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private void Stage(AuditAction action, TicketTask task, Ticket ticket, object detail)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "TicketTask", task.Id, ticket.Reference, null,
                JsonSerializer.Serialize(detail), actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }
    }
}