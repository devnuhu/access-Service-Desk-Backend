using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Tickets
{
    // ---------------- saved views ----------------

    public class SavedViewService : ISavedViewService
    {
        private const int MaxViews = 30;
        private readonly AppDbContext _db;

        public SavedViewService(AppDbContext db) => _db = db;

        private static SavedViewDto ToDto(SavedView v) => new(v.Id, v.Name, v.FilterJson, v.IsFavourite, v.CreatedAt);

        public async Task<List<SavedViewDto>> ListAsync(Guid userId)
        {
            var rows = await _db.SavedViews.AsNoTracking().Where(v => v.UserId == userId).ToListAsync();
            return rows.OrderByDescending(v => v.IsFavourite).ThenBy(v => v.Name).Select(ToDto).ToList();
        }

        private static (TicketProblem? Problem, string? Name, string? Json) Check(SaveViewRequest request, bool isCreate)
        {
            string? name = null, json = null;
            if (request.Name != null || isCreate)
            {
                name = (request.Name ?? string.Empty).Trim();
                if (name.Length < 2 || name.Length > 60) return (new TicketProblem(400, "The name must be 2 to 60 characters.", "name"), null, null);
            }
            if (request.FilterJson != null || isCreate)
            {
                json = (request.FilterJson ?? string.Empty).Trim();
                if (json.Length == 0 || json.Length > 2000) return (new TicketProblem(400, "The filter must be a JSON object of at most 2000 characters.", "filterJson"), null, null);
                try
                {
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.ValueKind != JsonValueKind.Object) return (new TicketProblem(400, "The filter must be a JSON object.", "filterJson"), null, null);
                }
                catch (JsonException) { return (new TicketProblem(400, "The filter is not valid JSON.", "filterJson"), null, null); }
            }
            return (null, name, json);
        }

        public async Task<(TicketProblem? Problem, SavedViewDto? View)> CreateAsync(Guid userId, SaveViewRequest request)
        {
            var (problem, name, json) = Check(request, true);
            if (problem != null) return (problem, null);
            if (await _db.SavedViews.CountAsync(v => v.UserId == userId) >= MaxViews) return (new TicketProblem(400, "You can keep at most " + MaxViews + " saved views."), null);
            if (await _db.SavedViews.AnyAsync(v => v.UserId == userId && v.Name == name)) return (new TicketProblem(409, "You already have a view with that name.", "name"), null);
            var view = new SavedView { Id = Guid.NewGuid(), UserId = userId, Name = name!, FilterJson = json!, IsFavourite = request.IsFavourite ?? false, CreatedAt = DateTime.UtcNow };
            _db.SavedViews.Add(view);
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (new TicketProblem(409, "You already have a view with that name.", "name"), null); }
            return (null, ToDto(view));
        }

        public async Task<(TicketProblem? Problem, SavedViewDto? View)> UpdateAsync(Guid userId, Guid viewId, SaveViewRequest request)
        {
            var view = await _db.SavedViews.FirstOrDefaultAsync(v => v.Id == viewId && v.UserId == userId);
            if (view == null) return (new TicketProblem(404, "View not found."), null);
            var (problem, name, json) = Check(request, false);
            if (problem != null) return (problem, null);
            if (name == null && json == null && request.IsFavourite == null) return (new TicketProblem(400, "Send something to change."), null);
            if (name != null && name != view.Name && await _db.SavedViews.AnyAsync(v => v.UserId == userId && v.Name == name && v.Id != viewId))
                return (new TicketProblem(409, "You already have a view with that name.", "name"), null);
            if (name != null) view.Name = name;
            if (json != null) view.FilterJson = json;
            if (request.IsFavourite != null) view.IsFavourite = request.IsFavourite.Value;
            view.UpdatedAt = DateTime.UtcNow;
            try { await _db.SaveChangesAsync(); }
            catch (DbUpdateException) { return (new TicketProblem(409, "You already have a view with that name.", "name"), null); }
            return (null, ToDto(view));
        }

        public async Task<(TicketProblem? Problem, string? Message)> DeleteAsync(Guid userId, Guid viewId)
        {
            var view = await _db.SavedViews.FirstOrDefaultAsync(v => v.Id == viewId && v.UserId == userId);
            if (view == null) return (new TicketProblem(404, "View not found."), null);
            _db.SavedViews.Remove(view);
            await _db.SaveChangesAsync();
            return (null, "\"" + view.Name + "\" removed.");
        }
    }

    // ---------------- bulk actions ----------------

    public class BulkTicketService : IBulkTicketService
    {
        private const int MaxTickets = 50;
        private readonly AppDbContext _db;
        private readonly IAssignmentService _assignment;
        private readonly IWorkflowService _workflow;
        private readonly ILogger<BulkTicketService> _logger;

        public BulkTicketService(AppDbContext db, IAssignmentService assignment, IWorkflowService workflow, ILogger<BulkTicketService> logger)
        {
            _db = db;
            _assignment = assignment;
            _workflow = workflow;
            _logger = logger;
        }

        public Task<(TicketProblem? Problem, BulkResultDto? Result)> PickAsync(BulkRequest request, Guid actorUserId, bool actorIsSuperAdmin) =>
            RunAsync(request.TicketIds, id => _assignment.PickAsync(id, actorUserId));

        public Task<(TicketProblem? Problem, BulkResultDto? Result)> AcknowledgeAsync(BulkRequest request, Guid actorUserId, bool actorIsSuperAdmin) =>
            RunAsync(request.TicketIds, id => _workflow.AcknowledgeAsync(id, actorUserId, actorIsSuperAdmin));

        public Task<(TicketProblem? Problem, BulkResultDto? Result)> ReassignAsync(BulkReassignRequest request, Guid actorUserId, bool actorIsSuperAdmin) =>
            RunAsync(request.TicketIds, id => _assignment.ReassignAsync(id, new ReassignRequest { ToUserId = request.ToUserId, Reason = request.Reason }, actorUserId, actorIsSuperAdmin));

        public Task<(TicketProblem? Problem, BulkResultDto? Result)> ResolveAsync(BulkResolveRequest request, Guid actorUserId, bool actorIsSuperAdmin) =>
            RunAsync(request.TicketIds, id => _workflow.ResolveAsync(id, new ResolveRequest { Code = request.Code, Note = request.Note }, actorUserId, actorIsSuperAdmin));

        private async Task<(TicketProblem? Problem, BulkResultDto? Result)> RunAsync(List<Guid>? requested, Func<Guid, Task<(TicketProblem? Problem, string? Message)>> action)
        {
            var ids = (requested ?? new List<Guid>()).Where(i => i != Guid.Empty).Distinct().ToList();
            if (ids.Count == 0 || ids.Count > MaxTickets) return (new TicketProblem(400, "Choose 1 to " + MaxTickets + " tickets.", "ticketIds"), null);

            var references = await _db.Tickets.AsNoTracking().Where(t => ids.Contains(t.Id)).ToDictionaryAsync(t => t.Id, t => t.Reference);
            var result = new BulkResultDto { Total = ids.Count };
            foreach (var id in ids)
            {
                _db.ChangeTracker.Clear(); // every ticket starts from what is in the database, whatever the one before did
                BulkItemDto item;
                try
                {
                    var (problem, message) = await action(id);
                    if (problem == null)
                        item = new BulkItemDto(id, references.GetValueOrDefault(id), true, 200, message ?? "Done.");
                    else
                        // never show the reference of a ticket the person cannot see
                        item = new BulkItemDto(id, problem.Status == 404 ? null : references.GetValueOrDefault(id), false, problem.Status, problem.Message);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Bulk action failed for ticket {TicketId}", id);
                    item = new BulkItemDto(id, null, false, 500, "This ticket could not be processed. Try it on its own.");
                }
                result.Items.Add(item);
            }
            result.Succeeded = result.Items.Count(i => i.Ok);
            result.Failed = result.Items.Count - result.Succeeded;
            return (null, result);
        }
    }

    // ---------------- read markers ----------------

    public class TicketReadService : ITicketReadService
    {
        private readonly AppDbContext _db;

        public TicketReadService(AppDbContext db) => _db = db;

        public async Task<TicketProblem?> MarkReadAsync(Guid ticketId, Guid actorUserId, bool actorIsSuperAdmin)
        {
            var t = await _db.Tickets.AsNoTracking().Where(x => x.Id == ticketId)
                .Select(x => new { x.RequesterUserId, x.RaisedByUserId, x.DepartmentId, x.UnitId }).FirstOrDefaultAsync();
            if (t == null) return new TicketProblem(404, "Ticket not found.");
            var visible = actorIsSuperAdmin || t.RequesterUserId == actorUserId || t.RaisedByUserId == actorUserId
                || await _db.TicketWatchers.AnyAsync(w => w.TicketId == ticketId && w.UserId == actorUserId)
                || await TicketAccess.IsStaffForTicketAsync(_db, actorUserId, t.DepartmentId, t.UnitId);
            if (!visible) return new TicketProblem(404, "Ticket not found.");

            var now = DateTime.UtcNow;
            var rows = await _db.TicketReads.Where(r => r.TicketId == ticketId && r.UserId == actorUserId).ExecuteUpdateAsync(s => s.SetProperty(r => r.LastReadAt, now));
            if (rows == 0)
            {
                try
                {
                    _db.TicketReads.Add(new TicketRead { TicketId = ticketId, UserId = actorUserId, LastReadAt = now });
                    await _db.SaveChangesAsync();
                }
                catch (DbUpdateException)
                {
                    _db.ChangeTracker.Clear(); // two requests at once: the other one created it
                    await _db.TicketReads.Where(r => r.TicketId == ticketId && r.UserId == actorUserId).ExecuteUpdateAsync(s => s.SetProperty(r => r.LastReadAt, now));
                }
            }
            return null;
        }
    }

    /// <summary>The markers shown on each row of a ticket list, worked out for the signed-in person for the tickets on the page only.</summary>
    public static class TicketMarkers
    {
        public static async Task FillAsync(AppDbContext db, List<TicketListItemDto> items, Guid actorUserId, bool staff)
        {
            if (items.Count == 0) return;
            var ids = items.Select(i => i.Id).ToList();
            var comments = (await db.TicketComments.AsNoTracking().Where(c => ids.Contains(c.TicketId) && (staff || !c.IsInternal))
                .Select(c => new { c.TicketId, c.AuthorUserId, c.CreatedAt, c.Kind }).ToListAsync()).ToLookup(c => c.TicketId);
            var reads = await db.TicketReads.AsNoTracking().Where(r => r.UserId == actorUserId && ids.Contains(r.TicketId)).ToDictionaryAsync(r => r.TicketId, r => r.LastReadAt);
            var files = await db.TicketAttachments.AsNoTracking().Where(a => ids.Contains(a.TicketId) && (staff || a.CommentId == null || !a.Comment!.IsInternal))
                .GroupBy(a => a.TicketId).Select(g => new { Id = g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.N);

            foreach (var item in items)
            {
                var all = comments[item.Id].ToList();
                var typed = all.Where(c => c.Kind == CommentKind.Comment).OrderBy(c => c.CreatedAt).ToList();
                item.CommentCount = typed.Count;
                if (typed.Count > 0)
                {
                    var last = typed[typed.Count - 1];
                    item.LastCommentAt = last.CreatedAt;
                    item.LastCommentByRequester = last.AuthorUserId == item.Requester.UserId;
                }
                item.AttachmentCount = files.TryGetValue(item.Id, out var n) ? n : 0;
                var lastOther = all.Where(c => c.AuthorUserId != actorUserId).Select(c => (DateTime?)c.CreatedAt).Max();
                item.Unread = reads.TryGetValue(item.Id, out var readAt)
                    ? lastOther > readAt
                    : (lastOther != null || item.Assignee?.UserId == actorUserId);
            }
        }
    }
}