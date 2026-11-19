using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Dashboard
{
    /// <summary>
    /// Counts for the home screen. Levels come from the stored SLA fields, the same as the daily digest, so the numbers agree with the emails.
    /// Overview scope: Super Admin every active unit; Head of Department and Department Admin their department's units; a unit head the units they head.
    /// </summary>
    public sealed class DashboardService : IDashboardService
    {
        private static readonly TicketStatus[] Open = { TicketStatus.New, TicketStatus.Assigned, TicketStatus.InProgress, TicketStatus.Pending, TicketStatus.Reopened };

        private readonly AppDbContext _db;

        public DashboardService(AppDbContext db) => _db = db;

        public async Task<DashboardSummaryDto> SummaryAsync(Guid userId, bool isSuperAdmin)
        {
            var result = new DashboardSummaryDto { GeneratedAt = DateTime.UtcNow };

            var mine = await _db.Tickets.AsNoTracking().Where(t => t.AssigneeUserId == userId && Open.Contains(t.Status))
                .GroupBy(t => 1)
                .Select(g => new DashboardMineDto
                {
                    Open = g.Count(),
                    WaitingToStart = g.Count(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened),
                    Warning = g.Count(t => t.SlaWarnedAt != null && t.SlaBreachedAt == null),
                    Overdue = g.Count(t => t.SlaBreachedAt != null && t.SlaL2At == null),
                    FarPast = g.Count(t => t.SlaL2At != null)
                }).FirstOrDefaultAsync();
            if (mine != null) result.Mine = mine;
            result.Mine.RaisedOpen = await _db.Tickets.AsNoTracking().CountAsync(t => t.RequesterUserId == userId && Open.Contains(t.Status));
            result.Mine.ToConfirm = await _db.Tickets.AsNoTracking().CountAsync(t => t.RequesterUserId == userId && t.Status == TicketStatus.Resolved);

            var unitsQuery = _db.Units.AsNoTracking().Where(u => u.IsActive && u.Department!.IsActive);
            if (!isSuperAdmin)
            {
                var departmentIds = await _db.Departments.AsNoTracking().Where(d => d.HodUserId == userId || d.AdminUserId == userId).Select(d => d.Id).ToListAsync();
                unitsQuery = unitsQuery.Where(u => departmentIds.Contains(u.DepartmentId) || u.HeadUserId == userId);
            }
            var units = await unitsQuery.OrderBy(u => u.Department!.Name).ThenBy(u => u.Name)
                .Select(u => new { u.Id, u.Name, u.DepartmentId, DepartmentName = u.Department!.Name }).ToListAsync();
            if (units.Count == 0) return result;

            var unitIds = units.Select(u => u.Id).ToList();
            var counts = (await _db.Tickets.AsNoTracking().Where(t => Open.Contains(t.Status) && unitIds.Contains(t.UnitId))
                .GroupBy(t => t.UnitId)
                .Select(g => new
                {
                    UnitId = g.Key,
                    Open = g.Count(),
                    WaitingToStart = g.Count(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened),
                    Unassigned = g.Count(t => t.AssigneeUserId == null),
                    Warning = g.Count(t => t.SlaWarnedAt != null && t.SlaBreachedAt == null),
                    Overdue = g.Count(t => t.SlaBreachedAt != null && t.SlaL2At == null),
                    FarPast = g.Count(t => t.SlaL2At != null),
                    Escalated = g.Count(t => t.EscalatedToHeadAt != null)
                }).ToListAsync()).ToDictionary(c => c.UnitId);

            var overview = new DashboardOverviewDto();
            foreach (var u in units)
            {
                var row = new DashboardUnitDto { UnitId = u.Id, UnitName = u.Name, DepartmentId = u.DepartmentId, DepartmentName = u.DepartmentName };
                if (counts.TryGetValue(u.Id, out var c))
                {
                    row.Open = c.Open; row.WaitingToStart = c.WaitingToStart; row.Unassigned = c.Unassigned; row.Warning = c.Warning;
                    row.Overdue = c.Overdue; row.FarPast = c.FarPast; row.Escalated = c.Escalated;
                }
                overview.Units.Add(row);
                overview.Total.Open += row.Open; overview.Total.WaitingToStart += row.WaitingToStart; overview.Total.Unassigned += row.Unassigned;
                overview.Total.Warning += row.Warning; overview.Total.Overdue += row.Overdue; overview.Total.FarPast += row.FarPast; overview.Total.Escalated += row.Escalated;
            }
            result.Overview = overview;
            return result;
        }
    }
}
