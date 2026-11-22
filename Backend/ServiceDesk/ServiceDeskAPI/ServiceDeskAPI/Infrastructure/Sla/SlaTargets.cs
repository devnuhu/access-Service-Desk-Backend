using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>
    /// The service levels in force: the target hours (business hours) for a ticket, from its category, department and priority.
    /// Order: a category row, then a department row, then the global row, then the built-in default. Loaded once per pass or request (a handful of rows).
    /// </summary>
    public sealed class SlaTargets
    {
        /// <summary>Built-in defaults until the Super Admin sets others: (first response, resolution) in business hours.</summary>
        public static readonly IReadOnlyDictionary<TicketPriority, (int Response, int Resolution)> Defaults = new Dictionary<TicketPriority, (int, int)>
        {
            [TicketPriority.Critical] = (1, 4),
            [TicketPriority.High] = (2, 8),
            [TicketPriority.Medium] = (4, 24),
            [TicketPriority.Low] = (8, 72)
        };

        private readonly List<SlaPolicy> _rows;

        public SlaTargets(IEnumerable<SlaPolicy> rows) => _rows = rows.ToList();

        public static async Task<SlaTargets> LoadAsync(AppDbContext db) => new(await db.SlaPolicies.AsNoTracking().ToListAsync());

        public (int Response, int Resolution) For(Guid categoryId, Guid departmentId, TicketPriority priority)
        {
            var row = _rows.FirstOrDefault(r => r.CategoryId == categoryId && r.Priority == priority)
                ?? _rows.FirstOrDefault(r => r.CategoryId == null && r.DepartmentId == departmentId && r.Priority == priority)
                ?? _rows.FirstOrDefault(r => r.CategoryId == null && r.DepartmentId == null && r.Priority == priority);
            if (row != null) return (row.ResponseHours, row.ResolutionHours);
            return Defaults.TryGetValue(priority, out var d) ? d : Defaults[TicketPriority.Medium];
        }

        public int ResponseHours(Guid categoryId, Guid departmentId, TicketPriority priority) => For(categoryId, departmentId, priority).Response;

        public int ResolutionHours(Guid categoryId, Guid departmentId, TicketPriority priority) => For(categoryId, departmentId, priority).Resolution;
    }
}