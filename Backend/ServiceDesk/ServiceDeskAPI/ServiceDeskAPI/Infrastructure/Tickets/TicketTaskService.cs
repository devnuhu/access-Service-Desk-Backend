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
    /// Tasks are for staff: a requester or anyone else who is not staff on the ticket gets 404.
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

        private static bool Locked(Ticket t) => t.Status is TicketStatus.Resolved or TicketStatus.Closed or TicketStatus.Cancelled;

        private async Task<(TicketProblem? Problem, Ticket? Ticket)> LoadAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin, bool forChange)
        {
            var ticket = await _db.Tickets.AsNoTracking().FirstOrDefaultAsync(t => t.Id == ticketId);
            if (ticket == null) return (new TicketProblem(404, "Ticket not found."), null);
            var staff = actorIsSuperAdmin || await TicketAccess.IsStaffForTicketAsync(_db, actorUserId, ticket.DepartmentId, ticket.UnitId);
            if (!staff) return (new TicketProblem(404, "Ticket not found."), null);
            if (forChange && Locked(ticket))
                return (new TicketProblem(400, "Tasks cannot be changed while the ticket is " + ticket.Status.ToString().ToLowerInvariant() + "."), null);
            return (null, ticket);
        }

        private DateTime LagosToday() => DateTime.UtcNow.AddHours(_sla.UtcOffsetHours).Date;

        private async Task<List<TicketTaskDto>> ToDtosAsync(List<TicketTask> tasks)
        {
            var ids = tasks.Where(t => t.AssigneeUserId.HasValue).Select(t => t.AssigneeUserId!.Value).Distinct().ToList();
            var people = ids.Count == 0 ? new Dictionary<Guid, PersonDto>()
                : (await _db.Users.AsNoTracking().Where(u => ids.Contains(u.Id)).Select(u => new { u.Id, u.UserName, u.FullName }).ToListAsync())
                    .ToDictionary(u => u.Id, u => new PersonDto(u.Id, u.UserName ?? string.Empty, u.FullName));
            var today = LagosToday();
            return tasks.Select(t => new TicketTaskDto
            {
                Id = t.Id, Title = t.Title,
                Assignee = t.AssigneeUserId.HasValue && people.TryGetValue(t.AssigneeUserId.Value, out var p) ? p : null,
                DueDate = t.DueAt?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                IsDone = t.IsDone, DoneAt = t.DoneAt, CreatedAt = t.CreatedAt,
                IsOverdue = !t.IsDone && t.DueAt.HasValue && t.DueAt.Value.Date < today
            }).ToList();
        }

        public async Task<(TicketProblem? Problem, TicketTasksDto? Tasks)> ListAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, false);
            if (problem != null) return (problem, null);
            var tasks = await _db.TicketTasks.AsNoTracking().Where(t => t.TicketId == ticketId).OrderBy(t => t.SortOrder).ThenBy(t => t.CreatedAt).ToListAsync();
            var items = await ToDtosAsync(tasks);
            return (null, new TicketTasksDto { Items = items, Open = items.Count(i => !i.IsDone), Done = items.Count(i => i.IsDone), CanEdit = !Locked(ticket!) });
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
            var (problem, ticket) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
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
            return (null, (await ToDtosAsync(new List<TicketTask> { task })).Single());
        }

        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> UpdateAsync(Guid ticketId, Guid taskId, TicketTaskRequest request, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null) return (new TicketProblem(404, "Task not found."), null);
            var (bad, title, dueAt) = await CheckAsync(request, ticket!);
            if (bad != null) return (bad, null);

            var ownerChanged = task.AssigneeUserId != request.AssigneeUserId;
            var dueChanged = task.DueAt != dueAt;
            task.Title = title;
            task.AssigneeUserId = request.AssigneeUserId;
            task.DueAt = dueAt;
            task.UpdatedAt = DateTime.UtcNow;
            if (ownerChanged || dueChanged) task.OverdueNotifiedAt = null;
            Stage(AuditAction.Updated, task, ticket!, new { title, assignee = request.AssigneeUserId, dueDate = request.DueDate });
            if (ownerChanged) TellOwner(task, ticket!, actorUserId);
            await _db.SaveChangesAsync();
            return (null, (await ToDtosAsync(new List<TicketTask> { task })).Single());
        }

        public async Task<(TicketProblem? Problem, TicketTaskDto? Item)> SetDoneAsync(Guid ticketId, Guid taskId, bool done, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null) return (new TicketProblem(404, "Task not found."), null);
            if (task.IsDone != done)
            {
                var now = DateTime.UtcNow;
                task.IsDone = done;
                task.DoneAt = done ? now : null;
                task.DoneByUserId = done ? actorUserId : null;
                task.UpdatedAt = now;
                Stage(AuditAction.Updated, task, ticket!, new { title = task.Title, done });
                await _db.SaveChangesAsync();
            }
            return (null, (await ToDtosAsync(new List<TicketTask> { task })).Single());
        }

        public async Task<(TicketProblem? Problem, string? Message)> RemoveAsync(Guid ticketId, Guid taskId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var (problem, ticket) = await LoadAsync(ticketId, actorUserId, actorIsSuperAdmin, true);
            if (problem != null) return (problem, null);
            var task = await _db.TicketTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.TicketId == ticketId);
            if (task == null) return (new TicketProblem(404, "Task not found."), null);
            Stage(AuditAction.Deleted, task, ticket!, new { title = task.Title });
            _db.TicketTasks.Remove(task);
            await _db.SaveChangesAsync();
            return (null, "Task removed.");
        }

        private void TellOwner(TicketTask task, Ticket ticket, Guid actorUserId)
        {
            if (!task.AssigneeUserId.HasValue || task.AssigneeUserId.Value == actorUserId) return;
            _notifications.Stage(task.AssigneeUserId.Value, "Ticket " + ticket.Reference + ": a task is assigned to you",
                task.Title + (task.DueAt.HasValue ? " (due " + task.DueAt.Value.ToString("dd MMM yyyy", CultureInfo.InvariantCulture) + ")" : string.Empty),
                NotificationType.ActionRequired, NotificationCategory.Ticket, "Ticket", ticket.Id, "/tickets/" + ticket.Reference);
        }

        private void Stage(AuditAction action, TicketTask task, Ticket ticket, object detail)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "TicketTask", task.Id, ticket.Reference, null,
                JsonSerializer.Serialize(detail), actor.IpAddress, actor.UserAgent, AuditModule.Tickets);
        }
    }
}