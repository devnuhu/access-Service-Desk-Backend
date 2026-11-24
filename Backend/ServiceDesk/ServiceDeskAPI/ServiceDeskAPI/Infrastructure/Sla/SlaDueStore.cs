using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;
using System.Globalization;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>
    /// Keeps Ticket.SlaDueAt (when a running ticket's time allowed runs out) up to date so the ticket list can sort by it in the database.
    /// The same business-clock sum as SlaDue.Compute. The SLA check runs it for every running ticket; a new ticket is stamped when it is raised.
    /// A ticket that is not running (Pending, Resolved, finished), has no target or is older than Sla:TrackFrom has no due time.
    /// </summary>
    public static class SlaDueStore
    {
        private static readonly TicketStatus[] Running = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Reopened };

        /// <summary>Works out and saves the due time. onlyTicketId limits it to one ticket. Returns how many tickets were changed.</summary>
        public static async Task<int> RefreshAsync(AppDbContext db, SlaOptions options, DateTime nowUtc, Guid? onlyTicketId = null, CancellationToken ct = default)
        {
            var clock = BusinessClock.From(options);
            var query = db.Tickets.AsNoTracking().Where(t => Running.Contains(t.Status));
            if (onlyTicketId.HasValue)
            {
                var one = onlyTicketId.Value;
                query = query.Where(t => t.Id == one);
            }
            if (DateTime.TryParse(options.TrackFrom, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var trackFrom))
                query = query.Where(t => t.CreatedAt >= trackFrom);
            var rows = await query.Select(t => new { t.Id, t.CreatedAt, t.CategoryId, t.DepartmentId, t.Priority, t.SlaDueAt }).ToListAsync(ct);

            var changed = 0;
            if (rows.Count > 0)
            {
                var targets = await SlaTargets.LoadAsync(db);
                foreach (var chunk in rows.Chunk(400))
                {
                    var ids = chunk.Select(r => r.Id).ToList();
                    var changes = (await db.TicketStatusChanges.AsNoTracking().Where(c => ids.Contains(c.TicketId)).OrderBy(c => c.At)
                        .Select(c => new { c.TicketId, c.ToStatus, c.At }).ToListAsync(ct)).ToLookup(c => c.TicketId);
                    foreach (var row in chunk)
                    {
                        var hours = targets.ResolutionHours(row.CategoryId, row.DepartmentId, row.Priority);
                        DateTime? due = hours > 0
                            ? SlaDue.Compute(clock, row.CreatedAt, hours, changes[row.Id].Select(c => (c.ToStatus, c.At)))
                            : null;
                        var same = due.HasValue == row.SlaDueAt.HasValue && (!due.HasValue || Math.Abs((due.Value - row.SlaDueAt!.Value).TotalSeconds) < 1);
                        if (same) continue;
                        var id = row.Id;
                        var value = due;
                        await db.Tickets.Where(t => t.Id == id).ExecuteUpdateAsync(s => s.SetProperty(t => t.SlaDueAt, value), ct);
                        changed++;
                    }
                }
            }

            if (!onlyTicketId.HasValue)
                changed += await db.Tickets.Where(t => !Running.Contains(t.Status) && t.SlaDueAt != null)
                    .ExecuteUpdateAsync(s => s.SetProperty(t => t.SlaDueAt, (DateTime?)null), ct);
            return changed;
        }
    }
}