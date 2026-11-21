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
        private readonly ICatalogueService _catalogue;
        private readonly IAvailabilityService _availability;

        public DashboardService(AppDbContext db, ICatalogueService catalogue, IAvailabilityService availability)
        {
            _db = db;
            _catalogue = catalogue;
            _availability = availability;
        }

        public async Task<(TicketProblem? Problem, UnitDashboardDto? Dashboard)> UnitAsync(Guid unitId, Guid userId, bool isSuperAdmin)
        {
            var unit = await _db.Units.AsNoTracking().Where(u => u.Id == unitId)
                .Select(u => new { u.Id, u.Name, u.HeadUserId, u.DepartmentId, DepartmentName = u.Department!.Name, HodUserId = u.Department.HodUserId, AdminUserId = u.Department.AdminUserId })
                .FirstOrDefaultAsync();
            if (unit == null) return (new TicketProblem(404, "Unit not found."), null);
            if (!isSuperAdmin && unit.HeadUserId != userId && unit.HodUserId != userId && unit.AdminUserId != userId)
                return (new TicketProblem(403, "Only the head of this unit, the Head of Department or a Super Admin can see its dashboard."), null);

            var today = _availability.Today();
            var tickets = await _db.Tickets.AsNoTracking().Where(t => t.UnitId == unitId && Open.Contains(t.Status))
                .Select(t => new
                {
                    t.Id, t.Reference, t.CategoryId, CategoryName = t.Category!.Name, t.AssigneeUserId,
                    AssigneeName = t.AssigneeUser == null ? null : (t.AssigneeUser.FullName ?? t.AssigneeUser.UserName),
                    t.Status, t.CreatedAt, t.SlaWarnedAt, t.SlaBreachedAt, t.SlaL2At, t.EscalatedToHeadAt, t.EscalatedToHeadReason, t.FirstRespondedAt, t.FirstResponseMissedAt
                }).ToListAsync();

            var result = new UnitDashboardDto
            {
                GeneratedAt = DateTime.UtcNow, UnitId = unit.Id, UnitName = unit.Name, DepartmentId = unit.DepartmentId, DepartmentName = unit.DepartmentName,
                Counts = new DashboardCountsDto
                {
                    Open = tickets.Count,
                    WaitingToStart = tickets.Count(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened),
                    Unassigned = tickets.Count(t => t.AssigneeUserId == null),
                    Warning = tickets.Count(t => t.SlaWarnedAt != null && t.SlaBreachedAt == null),
                    Overdue = tickets.Count(t => t.SlaBreachedAt != null && t.SlaL2At == null),
                    FarPast = tickets.Count(t => t.SlaL2At != null),
                    Escalated = tickets.Count(t => t.EscalatedToHeadAt != null),
                    ResponseOverdue = tickets.Count(t => t.FirstResponseMissedAt != null && t.FirstRespondedAt == null)
                }
            };

            result.Pool = tickets.Where(t => t.Status == TicketStatus.New && t.AssigneeUserId == null)
                .GroupBy(t => t.CategoryId)
                .Select(g => new DashboardPoolDto { CategoryId = g.Key, CategoryName = g.First().CategoryName, Waiting = g.Count(), OldestWaitingAt = g.Min(t => t.CreatedAt) })
                .OrderBy(p => p.OldestWaitingAt).ToList();

            var members = await _db.UnitMembers.AsNoTracking().Where(m => m.UnitId == unitId && m.IsActive)
                .Select(m => new { m.UserId, UserName = m.User!.UserName, m.User.FullName }).ToListAsync();
            var away = await _db.Absences.AsNoTracking()
                .Where(a => !a.IsCancelled && a.StartDate <= today && a.EndDate >= today
                    && _db.UnitMembers.Any(m => m.UnitId == unitId && m.IsActive && m.UserId == a.UserId))
                .Select(a => new { a.UserId, a.EndDate }).ToListAsync();
                        var since = DateTime.UtcNow.AddDays(-30);
            var recent = await _db.Tickets.AsNoTracking()
                .Where(t => t.UnitId == unitId && t.AssignedAt >= since && t.Status != TicketStatus.Cancelled)
                .Select(t => new { t.AssigneeUserId, t.AssignedAt, t.FirstRespondedAt, t.FirstResponseMissedAt, t.FirstResponseMissedByUserId }).ToListAsync();result.Team = members.Select(m =>
            {
                var mine = tickets.Where(t => t.AssigneeUserId == m.UserId).ToList();
                var leave = away.FirstOrDefault(x => x.UserId == m.UserId);
                var rMissed = recent.Count(t => t.FirstResponseMissedAt != null && t.FirstResponseMissedByUserId == m.UserId);
                var rMet = recent.Count(t => t.AssigneeUserId == m.UserId && t.FirstRespondedAt != null && t.AssignedAt != null && t.FirstRespondedAt >= t.AssignedAt && t.FirstResponseMissedAt == null);
                return new DashboardMemberDto
                {
                    UserId = m.UserId, UserName = m.UserName ?? string.Empty, FullName = m.FullName, IsHead = unit.HeadUserId == m.UserId,
                    OpenTickets = mine.Count,
                    WaitingToStart = mine.Count(t => t.Status == TicketStatus.Assigned || t.Status == TicketStatus.Reopened),
                    Warning = mine.Count(t => t.SlaWarnedAt != null && t.SlaBreachedAt == null),
                    Overdue = mine.Count(t => t.SlaBreachedAt != null && t.SlaL2At == null),
                    FarPast = mine.Count(t => t.SlaL2At != null),
                    ResponseOverdue = mine.Count(t => t.FirstResponseMissedAt != null && t.FirstRespondedAt == null),
                    ResponseMissed = rMissed,
                    ResponseMetPercent = rMissed + rMet == 0 ? (double?)null : Math.Round(rMet * 100.0 / (rMissed + rMet), 1),
                    OnLeave = leave != null,
                    LeaveUntil = leave == null ? (DateOnly?)null : leave.EndDate
                };
            }).OrderByDescending(m => m.IsHead).ThenBy(m => m.FullName ?? m.UserName).ToList();

            var skills = await _catalogue.GetUnitSkillsAsync(unitId);
            if (skills != null)
                result.Categories = skills.Categories.Select(c => new DashboardCategoryDto
                {
                    CategoryId = c.Id, CategoryName = c.Name, IsActive = c.IsActive, EligibleCount = c.EligibleCount,
                    OpenTickets = tickets.Count(t => t.CategoryId == c.Id), NeedsCover = c.IsActive && c.EligibleCount < 2
                }).ToList();

            result.Escalated = tickets.Where(t => t.EscalatedToHeadAt != null).OrderByDescending(t => t.EscalatedToHeadAt).Take(20)
                .Select(t => new DashboardTicketDto
                {
                    TicketId = t.Id, Reference = t.Reference, CategoryName = t.CategoryName, AssigneeName = t.AssigneeName,
                    Level = "escalated", Since = t.EscalatedToHeadAt!.Value, Note = t.EscalatedToHeadReason
                }).ToList();

            result.Attention = tickets.Where(t => t.SlaBreachedAt != null || t.SlaL2At != null)
                .OrderByDescending(t => t.SlaL2At != null).ThenBy(t => t.CreatedAt).Take(20)
                .Select(t => new DashboardTicketDto
                {
                    TicketId = t.Id, Reference = t.Reference, CategoryName = t.CategoryName, AssigneeName = t.AssigneeName,
                    Level = t.SlaL2At != null ? "farPast" : "overdue", Since = t.CreatedAt
                }).ToList();

            return (null, result);
        }
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
            result.Mine.ResponseOverdue = await _db.Tickets.AsNoTracking().CountAsync(t => t.AssigneeUserId == userId && Open.Contains(t.Status) && t.FirstResponseMissedAt != null && t.FirstRespondedAt == null);
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
                    Escalated = g.Count(t => t.EscalatedToHeadAt != null),
                    ResponseOverdue = g.Count(t => t.FirstResponseMissedAt != null && t.FirstRespondedAt == null)
                }).ToListAsync()).ToDictionary(c => c.UnitId);

            var overview = new DashboardOverviewDto();
            foreach (var u in units)
            {
                var row = new DashboardUnitDto { UnitId = u.Id, UnitName = u.Name, DepartmentId = u.DepartmentId, DepartmentName = u.DepartmentName };
                if (counts.TryGetValue(u.Id, out var c))
                {
                    row.Open = c.Open; row.WaitingToStart = c.WaitingToStart; row.Unassigned = c.Unassigned; row.Warning = c.Warning;
                    row.Overdue = c.Overdue; row.FarPast = c.FarPast; row.Escalated = c.Escalated; row.ResponseOverdue = c.ResponseOverdue;
                }
                overview.Units.Add(row);
                overview.Total.Open += row.Open; overview.Total.WaitingToStart += row.WaitingToStart; overview.Total.Unassigned += row.Unassigned;
                overview.Total.Warning += row.Warning; overview.Total.Overdue += row.Overdue; overview.Total.FarPast += row.FarPast; overview.Total.Escalated += row.Escalated; overview.Total.ResponseOverdue += row.ResponseOverdue;
            }
            result.Overview = overview;
            return result;
        }
    }
}
