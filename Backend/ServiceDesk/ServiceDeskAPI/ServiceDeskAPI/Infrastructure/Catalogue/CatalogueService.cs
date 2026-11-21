using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Catalogue
{
    /// <summary>
    /// Categories and the skills matrix. Rules:
    /// - a category belongs to one unit (and so one department); names are unique within the department;
    /// - it can move to another active unit of the same department; skills of people who are not in the new unit end;
    /// - only active members of the owning unit can be mapped; leaving the unit ends their skills there (OrganisationService);
    /// - an active category should have at least two eligible case workers: the Super Admin is warned, nothing is blocked.
    /// </summary>
    public class CatalogueService : ICatalogueService
    {
        private const int MinCover = 2;

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly ILogger<CatalogueService> _logger;
        private readonly IAssignmentSignal _assignment;

        public CatalogueService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, ILogger<CatalogueService> logger,
            IAssignmentSignal assignment)
        {
            _assignment = assignment;
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _logger = logger;
        }

        // ---------------- reading ----------------

        public async Task<List<CatalogueDepartmentDto>> ListForRequestersAsync()
        {
            var rows = await _db.Categories.AsNoTracking()
                .Where(c => c.IsActive && c.Unit!.IsActive && c.Department!.IsActive)
                .OrderBy(c => c.Department!.Name).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new
                {
                    c.DepartmentId, DepartmentCode = c.Department!.Code, DepartmentName = c.Department.Name,
                    Category = new CatalogueCategoryDto { Id = c.Id, Name = c.Name, Description = c.Description, DefaultPriority = c.DefaultPriority }
                })
                .ToListAsync();
            return rows.GroupBy(r => new { r.DepartmentId, r.DepartmentCode, r.DepartmentName })
                .Select(g => new CatalogueDepartmentDto
                {
                    DepartmentId = g.Key.DepartmentId, Code = g.Key.DepartmentCode, Name = g.Key.DepartmentName,
                    Categories = g.Select(r => r.Category).ToList()
                })
                .ToList();
        }

        public async Task<List<CategoryAdminDto>> ListAsync(Guid? departmentId)
        {
            var query = _db.Categories.AsNoTracking();
            if (departmentId.HasValue) query = query.Where(c => c.DepartmentId == departmentId.Value);
            var list = await query
                .OrderBy(c => c.Department!.Name).ThenByDescending(c => c.IsActive).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new CategoryAdminDto
                {
                    Id = c.Id, DepartmentId = c.DepartmentId, DepartmentName = c.Department!.Name, UnitId = c.UnitId, UnitName = c.Unit!.Name,
                    Name = c.Name, Description = c.Description, TimelineHours = c.TimelineHours, DefaultPriority = c.DefaultPriority,
                    SortOrder = c.SortOrder, IsActive = c.IsActive
                })
                .ToListAsync();
            var counts = await EligibleCountsAsync(list.Select(c => c.Id).ToList());
            foreach (var c in list)
            {
                c.EligibleCount = counts.GetValueOrDefault(c.Id);
                c.NeedsCover = c.IsActive && c.EligibleCount < MinCover;
            }
            return list;
        }

        public async Task<UnitSkillsDto?> GetUnitSkillsAsync(Guid unitId)
        {
            var unit = await _db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return null;

            var categories = await _db.Categories.AsNoTracking()
                .Where(c => c.UnitId == unitId)
                .OrderByDescending(c => c.IsActive).ThenBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new SkillCategoryDto { Id = c.Id, Name = c.Name, IsActive = c.IsActive })
                .ToListAsync();
            var categoryIds = categories.Select(c => c.Id).ToList();
            var counts = await EligibleCountsAsync(categoryIds);
            foreach (var c in categories) c.EligibleCount = counts.GetValueOrDefault(c.Id);

            var members = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive)
                .OrderByDescending(m => m.StaffCategory).ThenBy(m => m.User!.FullName ?? m.User.UserName)
                .Select(m => new SkillMemberDto
                {
                    UserId = m.UserId, UserName = m.User!.UserName ?? string.Empty, FullName = m.User.FullName,
                    StaffCategory = m.StaffCategory, AccountActive = m.User.IsActive, IsHead = unit.HeadUserId == m.UserId
                })
                .ToListAsync();
            var memberIds = members.Select(m => m.UserId).ToList();
            var skills = await _db.CategorySkills.AsNoTracking()
                .Where(s => s.IsActive && memberIds.Contains(s.UserId) && categoryIds.Contains(s.CategoryId))
                .Select(s => new { s.UserId, s.CategoryId })
                .ToListAsync();
            foreach (var m in members)
                m.CategoryIds = skills.Where(s => s.UserId == m.UserId).Select(s => s.CategoryId).ToList();

            return new UnitSkillsDto
            {
                UnitId = unit.Id,
                UnitName = unit.Name,
                Categories = categories,
                Members = members,
                Warnings = unit.IsActive
                    ? categories.Where(c => c.IsActive && c.EligibleCount < MinCover)
                        .Select(c => new CategoryCoverDto { CategoryId = c.Id, CategoryName = c.Name, UnitId = unit.Id, UnitName = unit.Name, EligibleCount = c.EligibleCount })
                        .ToList()
                    : new List<CategoryCoverDto>()
            };
        }

        public async Task<List<CategoryCoverDto>> CoverWarningsAsync()
        {
            var categories = await _db.Categories.AsNoTracking()
                .Where(c => c.IsActive && c.Unit!.IsActive && c.Department!.IsActive)
                .OrderBy(c => c.Unit!.Name).ThenBy(c => c.SortOrder)
                .Select(c => new CategoryCoverDto { CategoryId = c.Id, CategoryName = c.Name, UnitId = c.UnitId, UnitName = c.Unit!.Name })
                .ToListAsync();
            var counts = await EligibleCountsAsync(categories.Select(c => c.CategoryId).ToList());
            foreach (var c in categories) c.EligibleCount = counts.GetValueOrDefault(c.CategoryId);
            return categories.Where(c => c.EligibleCount < MinCover).ToList();
        }

        public async Task<List<Guid>> EligibleCaseWorkerIdsAsync(Guid categoryId) =>
            await EligibleSkills()
                .Where(s => s.CategoryId == categoryId && s.Category!.IsActive)
                .Select(s => s.UserId)
                .Distinct()
                .ToListAsync();

        public async Task<List<MyCategoriesDto>> MineAsync(Guid userId)
        {
            var units = await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UserId == userId && m.IsActive && m.Unit!.IsActive)
                .OrderBy(m => m.Unit!.Department!.Name).ThenBy(m => m.Unit!.Name)
                .Select(m => new MyCategoriesDto { UnitId = m.UnitId, UnitName = m.Unit!.Name, DepartmentName = m.Unit.Department!.Name })
                .ToListAsync();
            if (units.Count == 0) return units;
            var unitIds = units.Select(u => u.UnitId).ToList();
            var skills = await _db.CategorySkills.AsNoTracking()
                .Where(s => s.UserId == userId && s.IsActive && unitIds.Contains(s.Category!.UnitId))
                .OrderBy(s => s.Category!.SortOrder).ThenBy(s => s.Category!.Name)
                .Select(s => new { s.Category!.UnitId, s.CategoryId, s.Category.Name, s.Category.IsActive })
                .ToListAsync();
            foreach (var unit in units)
                unit.Categories = skills.Where(s => s.UnitId == unit.UnitId).Select(s => new MyCategoryDto(s.CategoryId, s.Name, s.IsActive)).ToList();
            return units;
        }

        // ---------------- categories ----------------

        public async Task<(AdminResult Result, CategoryAdminDto? Category)> CreateAsync(CreateCategoryRequest request, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == request.UnitId);
            if (unit == null) return (AdminResult.NotFound("Unit not found."), null);
            if (!unit.IsActive || !unit.Department!.IsActive) return (AdminResult.Invalid("Switch the unit (and its department) on first."), null);

            var name = (request.Name ?? string.Empty).Trim();
            var problem = CheckName(name) ?? CheckDescription(request.Description) ?? CheckTimeline(request.TimelineHours) ?? CheckPriority(request.DefaultPriority);
            if (problem != null) return (AdminResult.Invalid(problem), null);
            if (await _db.Categories.AnyAsync(c => c.DepartmentId == unit.DepartmentId && c.Name == name))
                return (AdminResult.Conflict(unit.Department.Name + " already has a category named " + name + "."), null);

            var nextOrder = (await _db.Categories.Where(c => c.DepartmentId == unit.DepartmentId).MaxAsync(c => (int?)c.SortOrder) ?? 0) + 1;
            var category = new Category
            {
                Id = Guid.NewGuid(), DepartmentId = unit.DepartmentId, UnitId = unit.Id, Name = name, Description = Clean(request.Description),
                TimelineHours = request.TimelineHours, DefaultPriority = request.DefaultPriority, SortOrder = nextOrder, IsActive = true,
                CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId
            };
            _db.Categories.Add(category);
            Stage(AuditAction.Created, "Category", category.Id, name, null,
                new { unit = unit.Code, name, category.TimelineHours, defaultPriority = category.DefaultPriority.ToString() });

            var result = await SaveAsync("Category " + name + " created. Map at least two case workers to it.", "A category with that name already exists.");
            return (result, result.Success ? (await ListAsync(unit.DepartmentId)).First(c => c.Id == category.Id) : null);
        }

        public async Task<AdminResult> UpdateAsync(Guid categoryId, UpdateCategoryRequest request, Guid? actorUserId)
        {
            var category = await _db.Categories.Include(c => c.Unit).Include(c => c.Department).FirstOrDefaultAsync(c => c.Id == categoryId);
            if (category == null) return AdminResult.NotFound("Category not found.");
            var before = new { category.Name, category.Description, unitId = category.UnitId, category.TimelineHours, defaultPriority = category.DefaultPriority.ToString(), category.SortOrder, category.IsActive };
            var notes = new List<string>();

            if (request.Name != null)
            {
                var name = request.Name.Trim();
                var problem = CheckName(name);
                if (problem != null) return AdminResult.Invalid(problem);
                if (await _db.Categories.AnyAsync(c => c.Id != categoryId && c.DepartmentId == category.DepartmentId && c.Name == name))
                    return AdminResult.Conflict(category.Department!.Name + " already has a category named " + name + ".");
                category.Name = name;
            }
            if (request.Description != null)
            {
                var problem = CheckDescription(request.Description);
                if (problem != null) return AdminResult.Invalid(problem);
                category.Description = Clean(request.Description);
            }
            if (request.TimelineHours.HasValue)
            {
                var problem = CheckTimeline(request.TimelineHours.Value);
                if (problem != null) return AdminResult.Invalid(problem);
                category.TimelineHours = request.TimelineHours.Value;
            }
            if (request.DefaultPriority.HasValue)
            {
                var problem = CheckPriority(request.DefaultPriority.Value);
                if (problem != null) return AdminResult.Invalid(problem);
                category.DefaultPriority = request.DefaultPriority.Value;
            }
            if (request.SortOrder.HasValue)
            {
                if (request.SortOrder.Value < 0 || request.SortOrder.Value > 9999) return AdminResult.Invalid("The order must be between 0 and 9999.");
                category.SortOrder = request.SortOrder.Value;
            }
            if (request.UnitId.HasValue && request.UnitId.Value != category.UnitId)
            {
                var target = await _db.Units.FirstOrDefaultAsync(u => u.Id == request.UnitId.Value);
                if (target == null) return AdminResult.NotFound("Unit not found.");
                if (target.DepartmentId != category.DepartmentId) return AdminResult.Invalid("A category stays in its department. Choose a unit of " + category.Department!.Name + ".");
                if (!target.IsActive) return AdminResult.Invalid("Switch " + target.Name + " on first.");

                // Skills belong to the owning unit: anyone who is not in the new unit stops handling it
                var newMembers = await _db.UnitMembers.Where(m => m.UnitId == target.Id && m.IsActive).Select(m => m.UserId).ToListAsync();
                var ending = await _db.CategorySkills.Where(s => s.CategoryId == categoryId && s.IsActive && !newMembers.Contains(s.UserId)).ToListAsync();
                foreach (var skill in ending)
                {
                    skill.IsActive = false;
                    skill.RemovedAt = DateTime.UtcNow;
                    skill.RemovedByUserId = actorUserId;
                }
                category.UnitId = target.Id;
                notes.Add("Moved to " + target.Name + "." + (ending.Count > 0 ? " " + ending.Count + " case worker mapping" + (ending.Count == 1 ? " was" : "s were") + " removed." : string.Empty)
                    + " Map case workers of " + target.Name + " to it.");
            }
            if (request.IsActive.HasValue && request.IsActive.Value != category.IsActive)
            {
                if (request.IsActive.Value)
                {
                    var owner = await _db.Units.Include(u => u.Department).FirstAsync(u => u.Id == category.UnitId);
                    if (!owner.IsActive || !owner.Department!.IsActive) return AdminResult.Invalid("Switch " + owner.Name + " (and its department) on first.");
                }
                category.IsActive = request.IsActive.Value;
                notes.Add(category.IsActive ? "Requesters can choose it again." : "Requesters can no longer choose it.");
            }

            category.UpdatedAt = DateTime.UtcNow;
            category.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Category", category.Id, category.Name, before,
                new { category.Name, category.Description, unitId = category.UnitId, category.TimelineHours, defaultPriority = category.DefaultPriority.ToString(), category.SortOrder, category.IsActive });
            return await SaveAsync(string.Join(" ", new[] { "Category " + category.Name + " updated." }.Concat(notes)), "A category with that name already exists.");
        }

        // ---------------- skills matrix ----------------

        public async Task<AdminResult> SetSkillsAsync(Guid unitId, Guid userId, IReadOnlyCollection<Guid> categoryIds, Guid? actorUserId)
        {
            var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            var member = await _db.UnitMembers.Include(m => m.User).FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive);
            if (member?.User == null) return AdminResult.Invalid("Only members of " + unit.Name + " can handle its categories. Add them to the unit first.");

            var unitCategories = await _db.Categories.Where(c => c.UnitId == unitId).ToListAsync();
            var wanted = categoryIds.Distinct().ToList();
            var foreign = wanted.Where(id => unitCategories.All(c => c.Id != id)).ToList();
            if (foreign.Count > 0) return AdminResult.Invalid("Only categories owned by " + unit.Name + " can be mapped here.");

            var unitCategoryIds = unitCategories.Select(c => c.Id).ToList();
            var current = await _db.CategorySkills.Where(s => s.UserId == userId && s.IsActive && unitCategoryIds.Contains(s.CategoryId)).ToListAsync();
            var adding = wanted.Where(id => current.All(s => s.CategoryId != id)).ToList();
            var ending = current.Where(s => !wanted.Contains(s.CategoryId)).ToList();

            if (adding.Count > 0 && !member.User.IsActive) return AdminResult.Invalid(Name(member.User) + " is blocked.");
            var switchedOff = unitCategories.Where(c => adding.Contains(c.Id) && !c.IsActive).Select(c => c.Name).ToList();
            if (switchedOff.Count > 0) return AdminResult.Invalid("Switched off: " + string.Join(", ", switchedOff) + ". Switch it on first.");
            if (adding.Count == 0 && ending.Count == 0) return AdminResult.Ok("No change.");

            foreach (var id in adding)
                _db.CategorySkills.Add(new CategorySkill { Id = Guid.NewGuid(), CategoryId = id, UserId = userId, IsActive = true, AddedAt = DateTime.UtcNow, AddedByUserId = actorUserId });
            foreach (var skill in ending)
            {
                skill.IsActive = false;
                skill.RemovedAt = DateTime.UtcNow;
                skill.RemovedByUserId = actorUserId;
            }

            string NamesOf(IEnumerable<Guid> ids) => string.Join(", ", unitCategories.Where(c => ids.Contains(c.Id)).OrderBy(c => c.SortOrder).Select(c => c.Name));
            Stage(AuditAction.Updated, "CategorySkills", userId, member.User.UserName,
                new { unit = unit.Code, categories = NamesOf(current.Select(s => s.CategoryId)) },
                new { unit = unit.Code, categories = NamesOf(wanted) });
            _notifications.Stage(userId, "Your categories in " + unit.Name + " changed",
                wanted.Count == 0
                    ? "You are no longer mapped to any category in " + unit.Name + "."
                    : "You now handle " + wanted.Count + " categor" + (wanted.Count == 1 ? "y" : "ies") + ": " + NamesOf(wanted) + ".",
                NotificationType.Info, NotificationCategory.System, "CategorySkills", userId, null);

            var saved = await SaveAsync(Name(member.User) + " now handles " + wanted.Count + " categor" + (wanted.Count == 1 ? "y" : "ies") + " in " + unit.Name + ".",
                "The change could not be saved; try again.");
            if (!saved.Success) return saved;
            // New skills may make waiting tickets assignable (Step 5)
            _assignment.Poke();

            var counts = await EligibleCountsAsync(unitCategoryIds);
            var short_ = unitCategories.Where(c => c.IsActive && counts.GetValueOrDefault(c.Id) < MinCover).OrderBy(c => c.SortOrder).Select(c => c.Name).ToList();
            return short_.Count == 0 || !unit.IsActive
                ? saved
                : AdminResult.Ok(saved.Message + " Fewer than two case workers handle: " + string.Join(", ", short_) + ".");
        }

        // ---------------- helpers ----------------

        /// <summary>Mapped, still a member of the owning unit, account active, unit active.</summary>
        private IQueryable<CategorySkill> EligibleSkills() =>
            _db.CategorySkills.AsNoTracking().Where(s => s.IsActive && s.User!.IsActive && s.Category!.Unit!.IsActive
                && s.Category.Unit!.HeadUserId != s.UserId && _db.UnitMembers.Any(m => m.UserId == s.UserId && m.UnitId == s.Category.UnitId && m.IsActive));

        private async Task<Dictionary<Guid, int>> EligibleCountsAsync(List<Guid> categoryIds)
        {
            if (categoryIds.Count == 0) return new Dictionary<Guid, int>();
            return await EligibleSkills()
                .Where(s => categoryIds.Contains(s.CategoryId))
                .GroupBy(s => s.CategoryId)
                .Select(g => new { g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.Key, x => x.Count);
        }

        private async Task<AdminResult> SaveAsync(string okMessage, string conflictMessage)
        {
            try
            {
                await _db.SaveChangesAsync();
                return AdminResult.Ok(okMessage);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Catalogue change refused by the database");
                _db.ChangeTracker.Clear();
                return AdminResult.Conflict(conflictMessage);
            }
        }

        private static string? CheckName(string name) =>
            name.Length < 2 || name.Length > 100 ? "The name must be 2 to 100 characters." : null;

        private static string? CheckDescription(string? description) =>
            description != null && description.Trim().Length > 300 ? "The description must be at most 300 characters." : null;

        private static string? CheckTimeline(int hours) =>
            hours < 1 || hours > 720 ? "The timeline must be between 1 and 720 business hours." : null;

        private static string? CheckPriority(TicketPriority priority) =>
            Enum.IsDefined(priority) ? null : "Choose Low, Medium, High or Critical.";

        private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

        private void Stage(AuditAction action, string entityType, Guid entityId, string? display, object? before, object? after)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, entityType, entityId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Catalogue);
        }

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
    }
}