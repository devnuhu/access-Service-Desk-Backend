using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>
    /// Saved and shared reports (Step 9b). Sharing only decides who can SEE and run the saved definition; every run uses the viewer's own
    /// scope (ReportService), so a shared report can never show data the viewer could not already see.
    /// </summary>
    public sealed class SavedReportService : ISavedReportService
    {
        private const int MaxPerPerson = 100;
        private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
        private static readonly string[] ShareableRoles = { AppRoles.HeadOfUnit, AppRoles.HOD, AppRoles.DepartmentAdmin };

        private readonly AppDbContext _db;
        private readonly IReportService _reports;

        public SavedReportService(AppDbContext db, IReportService reports)
        {
            _db = db;
            _reports = reports;
        }

        private sealed record Viewer(HashSet<Guid> Units, HashSet<Guid> Departments);

        /// <summary>The units and departments the person works in, heads or runs.</summary>
        private async Task<Viewer> ViewerAsync(Guid userId)
        {
            var member = await _db.UnitMembers.AsNoTracking().Where(m => m.UserId == userId && m.IsActive)
                .Select(m => new { m.UnitId, m.Unit!.DepartmentId }).ToListAsync();
            var headed = await _db.Units.AsNoTracking().Where(u => u.HeadUserId == userId).Select(u => new { UnitId = u.Id, u.DepartmentId }).ToListAsync();
            var wide = await _db.Departments.AsNoTracking().Where(d => d.HodUserId == userId || d.AdminUserId == userId).Select(d => d.Id).ToListAsync();
            var wideUnits = wide.Count == 0 ? new List<Guid>() : await _db.Units.AsNoTracking().Where(u => wide.Contains(u.DepartmentId)).Select(u => u.Id).ToListAsync();
            var units = new HashSet<Guid>(member.Select(x => x.UnitId).Concat(headed.Select(x => x.UnitId)).Concat(wideUnits));
            var departments = new HashSet<Guid>(member.Select(x => x.DepartmentId).Concat(headed.Select(x => x.DepartmentId)).Concat(wide));
            return new Viewer(units, departments);
        }

        private static List<string> RolesOf(SavedReport r) =>
            (r.ShareRoles ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();

        private static bool CanSee(SavedReport r, Guid userId, bool superAdmin, Viewer viewer, IReadOnlyCollection<string> roles) =>
            superAdmin || r.OwnerUserId == userId || r.Share switch
            {
                ReportShare.Unit => r.ShareUnitId.HasValue && viewer.Units.Contains(r.ShareUnitId.Value),
                ReportShare.Department => r.ShareDepartmentId.HasValue && viewer.Departments.Contains(r.ShareDepartmentId.Value),
                ReportShare.Roles => RolesOf(r).Any(x => roles.Contains(x)),
                _ => false
            };

        private static string ShareName(ReportShare s) => s.ToString().ToLowerInvariant();

        private static ReportSpec ReadDefinition(SavedReport r)
        {
            try { return JsonSerializer.Deserialize<ReportSpec>(r.DefinitionJson, Json) ?? new ReportSpec(); }
            catch (JsonException) { return new ReportSpec(); }
        }

        private static SavedReportDto ToDto(SavedReport r, string ownerName, Guid userId) => new()
        {
            Id = r.Id, Name = r.Name, Description = r.Description, OwnerName = ownerName, IsMine = r.OwnerUserId == userId,
            Share = ShareName(r.Share), ShareUnitId = r.ShareUnitId, ShareDepartmentId = r.ShareDepartmentId, ShareRoles = RolesOf(r),
            Definition = ReadDefinition(r), CreatedAt = DateTime.SpecifyKind(r.CreatedAt, DateTimeKind.Utc),
            UpdatedAt = r.UpdatedAt.HasValue ? DateTime.SpecifyKind(r.UpdatedAt.Value, DateTimeKind.Utc) : null
        };

        private async Task<string> OwnerNameAsync(Guid ownerId)
        {
            var u = await _db.Users.AsNoTracking().Where(x => x.Id == ownerId).Select(x => new { x.FullName, x.UserName }).FirstOrDefaultAsync();
            return u == null ? string.Empty : (!string.IsNullOrWhiteSpace(u.FullName) ? u.FullName! : (u.UserName ?? string.Empty));
        }

        public async Task<(ReportProblem? Problem, List<SavedReportDto>? Reports)> ListAsync(Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles)
        {
            var (problem, _) = await _reports.CatalogueAsync(userId, isSuperAdmin);
            if (problem != null) return (problem, null);
            var viewer = await ViewerAsync(userId);
            var all = await _db.SavedReports.AsNoTracking().OrderByDescending(r => r.CreatedAt).Take(5000).ToListAsync();
            var visible = all.Where(r => CanSee(r, userId, isSuperAdmin, viewer, roles)).ToList();
            var ownerIds = visible.Select(r => r.OwnerUserId).Distinct().ToList();
            var names = (await _db.Users.AsNoTracking().Where(u => ownerIds.Contains(u.Id)).Select(u => new { u.Id, u.FullName, u.UserName }).ToListAsync())
                .ToDictionary(u => u.Id, u => !string.IsNullOrWhiteSpace(u.FullName) ? u.FullName! : (u.UserName ?? string.Empty));
            return (null, visible.Select(r => ToDto(r, names.TryGetValue(r.OwnerUserId, out var n) ? n : string.Empty, userId)).ToList());
        }

        /// <summary>
        /// One page of the reports the person can see, newest first. scope: mine or shared (anything else: both). search matches the name, description and owner across all of them.
        /// </summary>
        public async Task<(ReportProblem? Problem, SavedReportPageDto? Page)> ListPageAsync(Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles, string? search, string? scope, int page, int pageSize)
        {
            var (problem, all) = await ListAsync(userId, isSuperAdmin, roles);
            if (problem != null || all == null) return (problem, null);
            IEnumerable<SavedReportDto> rows = all;
            var kind = (scope ?? string.Empty).Trim().ToLowerInvariant();
            if (kind == "mine") rows = rows.Where(r => r.IsMine);
            else if (kind == "shared") rows = rows.Where(r => !r.IsMine);
            var term = (search ?? string.Empty).Trim();
            if (term.Length > 0)
                rows = rows.Where(r => r.Name.Contains(term, StringComparison.OrdinalIgnoreCase)
                    || (r.Description ?? string.Empty).Contains(term, StringComparison.OrdinalIgnoreCase)
                    || r.OwnerName.Contains(term, StringComparison.OrdinalIgnoreCase));
            var list = rows.ToList();
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize <= 0 ? 10 : pageSize, 1, 100);
            return (null, new SavedReportPageDto { Items = list.Skip((page - 1) * pageSize).Take(pageSize).ToList(), Total = list.Count, Page = page, PageSize = pageSize });
        }

        public async Task<(ReportProblem? Problem, SavedReportDto? Report)> SaveAsync(Guid? id, SaveReportRequest request, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles)
        {
            var (scopeProblem, _) = await _reports.CatalogueAsync(userId, isSuperAdmin);
            if (scopeProblem != null) return (scopeProblem, null);

            var name = (request?.Name ?? string.Empty).Trim();
            if (name.Length < 2 || name.Length > 150) return (new ReportProblem(400, "Give the report a name of 2 to 150 characters."), null);
            var description = string.IsNullOrWhiteSpace(request!.Description) ? null : request.Description.Trim();
            if (description != null && description.Length > 500) return (new ReportProblem(400, "The description can be at most 500 characters."), null);
            if (request.Definition == null) return (new ReportProblem(400, "The report definition is missing."), null);

            // The definition must run (checked with a tiny list) before it is saved.
            var clone = JsonSerializer.Deserialize<ReportSpec>(JsonSerializer.Serialize(request.Definition, Json), Json)!;
            clone.Limit = 1;
            var (runProblem, _) = await _reports.RunAsync(clone, userId, isSuperAdmin);
            if (runProblem != null) return (runProblem, null);

            if (!Enum.TryParse<ReportShare>((request.Share ?? "private").Trim(), true, out var share) || !Enum.IsDefined(share))
                return (new ReportProblem(400, "Share must be private, unit, department or roles."), null);
            var viewer = await ViewerAsync(userId);
            Guid? unitId = null, departmentId = null;
            string? roleText = null;
            if (share == ReportShare.Unit)
            {
                if (!request.ShareUnitId.HasValue) return (new ReportProblem(400, "Choose the unit to share with."), null);
                if (!isSuperAdmin && !viewer.Units.Contains(request.ShareUnitId.Value)) return (new ReportProblem(403, "You can only share with a unit you work in or head."), null);
                unitId = request.ShareUnitId;
            }
            else if (share == ReportShare.Department)
            {
                if (!request.ShareDepartmentId.HasValue) return (new ReportProblem(400, "Choose the department to share with."), null);
                if (!isSuperAdmin && !viewer.Departments.Contains(request.ShareDepartmentId.Value)) return (new ReportProblem(403, "You can only share with your own department."), null);
                departmentId = request.ShareDepartmentId;
            }
            else if (share == ReportShare.Roles)
            {
                var chosen = (request.ShareRoles ?? new List<string>()).Select(r => (r ?? string.Empty).Trim()).Where(r => r.Length > 0).Distinct().ToList();
                if (chosen.Count == 0) return (new ReportProblem(400, "Choose at least one role to share with."), null);
                var bad = chosen.FirstOrDefault(r => !ShareableRoles.Contains(r));
                if (bad != null) return (new ReportProblem(400, "'" + bad + "' cannot be shared with. Use HeadOfUnit, HOD or DepartmentAdmin."), null);
                roleText = string.Join(",", chosen);
            }

            SavedReport entity;
            if (id.HasValue)
            {
                var existing = await _db.SavedReports.FirstOrDefaultAsync(r => r.Id == id.Value);
                if (existing == null || !CanSee(existing, userId, isSuperAdmin, viewer, roles)) return (new ReportProblem(404, "Report not found."), null);
                if (existing.OwnerUserId != userId && !isSuperAdmin) return (new ReportProblem(403, "Only the owner can change a report."), null);
                entity = existing;
                entity.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                if (await _db.SavedReports.CountAsync(r => r.OwnerUserId == userId) >= MaxPerPerson)
                    return (new ReportProblem(409, "You have " + MaxPerPerson + " saved reports. Delete one first."), null);
                entity = new SavedReport { Id = Guid.NewGuid(), OwnerUserId = userId, CreatedAt = DateTime.UtcNow };
                _db.SavedReports.Add(entity);
            }
            var lower = name.ToLower();
            if (await _db.SavedReports.AnyAsync(r => r.OwnerUserId == entity.OwnerUserId && r.Id != entity.Id && r.Name.ToLower() == lower))
            {
                if (!id.HasValue) _db.Entry(entity).State = EntityState.Detached;
                return (new ReportProblem(409, "There is already a saved report named '" + name + "'."), null);
            }

            entity.Name = name;
            entity.Description = description;
            entity.DefinitionJson = JsonSerializer.Serialize(request.Definition, Json);
            entity.Share = share;
            entity.ShareUnitId = unitId;
            entity.ShareDepartmentId = departmentId;
            entity.ShareRoles = roleText;
            await _db.SaveChangesAsync();
            return (null, ToDto(entity, await OwnerNameAsync(entity.OwnerUserId), userId));
        }

        public async Task<ReportProblem?> DeleteAsync(Guid id, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles)
        {
            var entity = await _db.SavedReports.FirstOrDefaultAsync(r => r.Id == id);
            if (entity == null) return new ReportProblem(404, "Report not found.");
            var viewer = await ViewerAsync(userId);
            if (!CanSee(entity, userId, isSuperAdmin, viewer, roles)) return new ReportProblem(404, "Report not found.");
            if (entity.OwnerUserId != userId && !isSuperAdmin) return new ReportProblem(403, "Only the owner can delete a report.");
            _db.SavedReports.Remove(entity);
            await _db.SaveChangesAsync();
            return null;
        }

        public async Task<(ReportProblem? Problem, ReportResultDto? Result)> RunAsync(Guid id, Guid userId, bool isSuperAdmin, IReadOnlyCollection<string> roles, CancellationToken cancellationToken = default)
        {
            var entity = await _db.SavedReports.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
            if (entity == null) return (new ReportProblem(404, "Report not found."), null);
            var viewer = await ViewerAsync(userId);
            if (!CanSee(entity, userId, isSuperAdmin, viewer, roles)) return (new ReportProblem(404, "Report not found."), null);
            var spec = ReadDefinition(entity);
            if (string.IsNullOrWhiteSpace(spec.Title)) spec.Title = entity.Name;
            return await _reports.RunAsync(spec, userId, isSuperAdmin, cancellationToken);
        }
    }
}
