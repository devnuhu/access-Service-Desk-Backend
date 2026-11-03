using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Organisation
{
    /// <summary>
    /// Departments, units, heads and members (BRD Section 5). Rules:
    /// - one active unit per person per department; the Head of Unit is a member of their unit (staff category HeadOfUnit);
    /// - the deputy must be a member of the unit and is not its head;
    /// - the HOD oversees and does not work tickets, so is never a member of a unit in their own department;
    /// - a unit is switched off only when it has no members; a department only when its units are switched off.
    /// Each change is saved with its audit entries; then the structure roles are brought in step (OrgRoleSync) in the same transaction.
    /// </summary>
    public class OrganisationService : IOrganisationService
    {
        private static readonly Regex CodeRule = new("^[A-Z0-9-]{2,10}$", RegexOptions.Compiled);

        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly IHttpContextAccessor _http;
        private readonly ILogger<OrganisationService> _logger;

        public OrganisationService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, IHttpContextAccessor http, ILogger<OrganisationService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _http = http;
            _logger = logger;
        }

        // ---------------- read ----------------

        public async Task<List<DepartmentDto>> ListDepartmentsAsync() =>
            await _db.Departments.AsNoTracking()
                .OrderBy(d => d.Name)
                .Select(d => new DepartmentDto
                {
                    Id = d.Id,
                    Code = d.Code,
                    Name = d.Name,
                    IsActive = d.IsActive,
                    Hod = d.HodUser == null ? null : new PersonRefDto(d.HodUser.Id, d.HodUser.UserName!, d.HodUser.FullName, d.HodUser.CorporateEmail ?? d.HodUser.Email),
                    Units = d.Units.OrderBy(u => u.Name).Select(u => new UnitDto
                    {
                        Id = u.Id,
                        DepartmentId = u.DepartmentId,
                        Code = u.Code,
                        Name = u.Name,
                        IsActive = u.IsActive,
                        Head = u.HeadUser == null ? null : new PersonRefDto(u.HeadUser.Id, u.HeadUser.UserName!, u.HeadUser.FullName, u.HeadUser.CorporateEmail ?? u.HeadUser.Email),
                        Deputy = u.DeputyHeadUser == null ? null : new PersonRefDto(u.DeputyHeadUser.Id, u.DeputyHeadUser.UserName!, u.DeputyHeadUser.FullName, u.DeputyHeadUser.CorporateEmail ?? u.DeputyHeadUser.Email),
                        MemberCount = u.Members.Count(m => m.IsActive)
                    }).ToList()
                })
                .ToListAsync();

        public async Task<List<UnitMemberDto>?> ListMembersAsync(Guid unitId)
        {
            var unit = await _db.Units.AsNoTracking().FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return null;
            return await _db.UnitMembers.AsNoTracking()
                .Where(m => m.UnitId == unitId && m.IsActive)
                .OrderBy(m => m.User!.FullName ?? m.User.UserName)
                .Select(m => new UnitMemberDto
                {
                    UserId = m.UserId,
                    UserName = m.User!.UserName ?? string.Empty,
                    FullName = m.User.FullName,
                    Email = m.User.CorporateEmail ?? m.User.Email,
                    StaffNo = m.StaffNo,
                    StaffCategory = m.StaffCategory,
                    IsHead = unit.HeadUserId == m.UserId,
                    IsDeputy = unit.DeputyHeadUserId == m.UserId,
                    AccountActive = m.User.IsActive,
                    JoinedAt = m.JoinedAt,
                    LastAssignedAt = m.LastAssignedAt
                })
                .ToListAsync();
        }

        public async Task<MyOrganisationDto> GetMyOrganisationAsync(Guid userId)
        {
            var units = await _db.Units.AsNoTracking()
                .Where(u => u.IsActive && u.Department!.IsActive
                    && (u.HeadUserId == userId || u.DeputyHeadUserId == userId || u.Members.Any(m => m.UserId == userId && m.IsActive)))
                .Select(u => new
                {
                    u.DepartmentId,
                    Unit = new MyUnitDto
                    {
                        Id = u.Id,
                        Code = u.Code,
                        Name = u.Name,
                        IsHead = u.HeadUserId == userId,
                        IsDeputy = u.DeputyHeadUserId == userId,
                        IsMember = u.Members.Any(m => m.UserId == userId && m.IsActive)
                    }
                })
                .ToListAsync();
            var departmentIds = units.Select(u => u.DepartmentId).Distinct().ToList();
            var departments = await _db.Departments.AsNoTracking()
                .Where(d => d.IsActive && (d.HodUserId == userId || departmentIds.Contains(d.Id)))
                .OrderBy(d => d.Name)
                .Select(d => new MyDepartmentDto { Id = d.Id, Code = d.Code, Name = d.Name, IsHod = d.HodUserId == userId })
                .ToListAsync();
            foreach (var d in departments)
                d.Units = units.Where(u => u.DepartmentId == d.Id).Select(u => u.Unit).OrderBy(u => u.Name).ToList();
            return new MyOrganisationDto { Departments = departments };
        }

        public async Task<List<OrgDepartmentDto>> ListActiveDepartmentsAsync() =>
            await _db.Departments.AsNoTracking()
                .Where(d => d.IsActive)
                .OrderBy(d => d.Name)
                .Select(d => new OrgDepartmentDto(d.Id, d.Code, d.Name,
                    d.Units.Where(u => u.IsActive).OrderBy(u => u.Name).Select(u => new OrgUnitDto(u.Id, u.Code, u.Name)).ToList()))
                .ToListAsync();

        // ---------------- departments ----------------

        public async Task<(AdminResult Result, DepartmentDto? Department)> CreateDepartmentAsync(CreateDepartmentRequest request, Guid? actorUserId)
        {
            var code = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
            var name = (request.Name ?? string.Empty).Trim();
            if (!CodeRule.IsMatch(code)) return (AdminResult.Invalid("The code must be 2 to 10 capital letters, digits or dashes, for example CP."), null);
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (await _db.Departments.AnyAsync(d => d.Code == code)) return (AdminResult.Conflict("A department with the code " + code + " already exists."), null);
            if (await _db.Departments.AnyAsync(d => d.Name == name)) return (AdminResult.Conflict("A department named " + name + " already exists."), null);

            var department = new Department { Id = Guid.NewGuid(), Code = code, Name = name, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Departments.Add(department);
            Stage(AuditAction.Created, "Department", department.Id, name, null, new { code, name });
            var result = await SaveAsync(Array.Empty<Guid?>(), actorUserId, "Department " + name + " created.", "A department with that code or name already exists.");
            return (result, result.Success ? (await ListDepartmentsAsync()).First(d => d.Id == department.Id) : null);
        }

        public async Task<AdminResult> UpdateDepartmentAsync(Guid departmentId, UpdateOrgItemRequest request, Guid? actorUserId)
        {
            var department = await _db.Departments.Include(d => d.Units).FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return AdminResult.NotFound("Department not found.");
            var before = new { department.Name, department.IsActive };

            if (request.Name != null)
            {
                var name = request.Name.Trim();
                if (name.Length < 2 || name.Length > 100) return AdminResult.Invalid("The name must be 2 to 100 characters.");
                if (await _db.Departments.AnyAsync(d => d.Id != departmentId && d.Name == name)) return AdminResult.Conflict("A department named " + name + " already exists.");
                department.Name = name;
            }
            if (request.IsActive == false && department.IsActive && department.Units.Any(u => u.IsActive))
                return AdminResult.Invalid("Switch off its units first.");
            if (request.IsActive.HasValue) department.IsActive = request.IsActive.Value;

            department.UpdatedAt = DateTime.UtcNow;
            department.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Department", department.Id, department.Name, before, new { department.Name, department.IsActive });
            return await SaveAsync(new[] { department.HodUserId }, actorUserId, "Department " + department.Name + " updated.", "A department with that name already exists.");
        }

        public async Task<AdminResult> SetHodAsync(Guid departmentId, Guid? userId, Guid? actorUserId)
        {
            var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return AdminResult.NotFound("Department not found.");
            if (department.HodUserId == userId) return AdminResult.Ok("No change.");

            string? newName = null;
            if (userId.HasValue)
            {
                var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
                if (user == null) return AdminResult.NotFound("Person not found.");
                if (!user.IsActive) return AdminResult.Invalid(Name(user) + " is blocked and cannot be the Head of Department.");
                var memberOf = await _db.UnitMembers.Where(m => m.UserId == user.Id && m.IsActive && m.Unit!.DepartmentId == departmentId)
                    .Select(m => m.Unit!.Name).FirstOrDefaultAsync();
                if (memberOf != null)
                    return AdminResult.Invalid("The Head of Department oversees and does not work tickets. Remove " + Name(user) + " from " + memberOf + " first.");
                newName = user.UserName;
            }

            var previous = department.HodUserId;
            department.HodUserId = userId;
            department.UpdatedAt = DateTime.UtcNow;
            department.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Department", department.Id, department.Name, new { hodUserId = previous }, new { hodUserId = userId, hod = newName });
            return await SaveAsync(new[] { previous, userId }, actorUserId,
                userId.HasValue ? "Head of Department set." : "Head of Department cleared.", "The change could not be saved; try again.");
        }

        // ---------------- units ----------------

        public async Task<(AdminResult Result, UnitDto? Unit)> CreateUnitAsync(Guid departmentId, CreateUnitRequest request, Guid? actorUserId)
        {
            var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == departmentId);
            if (department == null) return (AdminResult.NotFound("Department not found."), null);
            if (!department.IsActive) return (AdminResult.Invalid("Switch the department on first."), null);
            var code = (request.Code ?? string.Empty).Trim().ToUpperInvariant();
            var name = (request.Name ?? string.Empty).Trim();
            if (!CodeRule.IsMatch(code)) return (AdminResult.Invalid("The code must be 2 to 10 capital letters, digits or dashes, for example CM."), null);
            if (name.Length < 2 || name.Length > 100) return (AdminResult.Invalid("The name must be 2 to 100 characters."), null);
            if (await _db.Units.AnyAsync(u => u.DepartmentId == departmentId && u.Code == code)) return (AdminResult.Conflict(department.Name + " already has a unit with the code " + code + "."), null);
            if (await _db.Units.AnyAsync(u => u.DepartmentId == departmentId && u.Name == name)) return (AdminResult.Conflict(department.Name + " already has a unit named " + name + "."), null);

            var unit = new Unit { Id = Guid.NewGuid(), DepartmentId = departmentId, Code = code, Name = name, IsActive = true, CreatedAt = DateTime.UtcNow, CreatedByUserId = actorUserId };
            _db.Units.Add(unit);
            Stage(AuditAction.Created, "Unit", unit.Id, name, null, new { department = department.Code, code, name });
            var result = await SaveAsync(Array.Empty<Guid?>(), actorUserId, "Unit " + name + " created.", "A unit with that code or name already exists.");
            return (result, result.Success ? new UnitDto { Id = unit.Id, DepartmentId = departmentId, Code = code, Name = name, IsActive = true } : null);
        }

        public async Task<AdminResult> UpdateUnitAsync(Guid unitId, UpdateOrgItemRequest request, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            var before = new { unit.Name, unit.IsActive };

            if (request.Name != null)
            {
                var name = request.Name.Trim();
                if (name.Length < 2 || name.Length > 100) return AdminResult.Invalid("The name must be 2 to 100 characters.");
                if (await _db.Units.AnyAsync(u => u.Id != unitId && u.DepartmentId == unit.DepartmentId && u.Name == name))
                    return AdminResult.Conflict(unit.Department!.Name + " already has a unit named " + name + ".");
                unit.Name = name;
            }
            if (request.IsActive == false && unit.IsActive && await _db.UnitMembers.AnyAsync(m => m.UnitId == unitId && m.IsActive))
                return AdminResult.Invalid("Remove its members (and its head) first.");
            if (request.IsActive == true && !unit.Department!.IsActive)
                return AdminResult.Invalid("Switch the department on first.");
            if (request.IsActive.HasValue) unit.IsActive = request.IsActive.Value;

            unit.UpdatedAt = DateTime.UtcNow;
            unit.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Unit", unit.Id, unit.Name, before, new { unit.Name, unit.IsActive });
            return await SaveAsync(new[] { unit.HeadUserId, unit.DeputyHeadUserId }, actorUserId, "Unit " + unit.Name + " updated.", "A unit with that name already exists.");
        }

        public async Task<AdminResult> SetUnitHeadAsync(Guid unitId, Guid? userId, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            if (unit.HeadUserId == userId) return AdminResult.Ok("No change.");
            var previousHead = unit.HeadUserId;
            var previousDeputy = unit.DeputyHeadUserId;

            if (userId.HasValue)
            {
                if (!unit.IsActive) return AdminResult.Invalid("Switch the unit on first.");
                var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
                if (user == null) return AdminResult.NotFound("Person not found.");
                if (!user.IsActive) return AdminResult.Invalid(Name(user) + " is blocked and cannot head a unit.");
                if (unit.Department!.HodUserId == user.Id)
                    return AdminResult.Invalid(Name(user) + " is the Head of Department, who oversees and does not work tickets.");
                var otherUnit = await _db.UnitMembers
                    .Where(m => m.UserId == user.Id && m.IsActive && m.UnitId != unitId && m.Unit!.DepartmentId == unit.DepartmentId)
                    .Select(m => m.Unit!.Name).FirstOrDefaultAsync();
                if (otherUnit != null) return AdminResult.Conflict(Name(user) + " is a member of " + otherUnit + ". Remove them there first.");

                // The new head works tickets in the unit, with staff category Head of Unit
                var membership = await _db.UnitMembers.FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == user.Id && m.IsActive);
                if (membership == null)
                {
                    _db.UnitMembers.Add(new UnitMember
                    {
                        Id = Guid.NewGuid(), UnitId = unitId, UserId = user.Id, StaffCategory = StaffCategory.HeadOfUnit,
                        IsActive = true, JoinedAt = DateTime.UtcNow, AddedByUserId = actorUserId
                    });
                }
                else membership.StaffCategory = StaffCategory.HeadOfUnit;

                if (unit.DeputyHeadUserId == user.Id) unit.DeputyHeadUserId = null;
            }

            // The previous head stays in the unit as an ordinary member
            if (previousHead.HasValue)
            {
                var old = await _db.UnitMembers.FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == previousHead.Value && m.IsActive);
                if (old != null) old.StaffCategory = StaffCategory.Employee;
            }

            unit.HeadUserId = userId;
            unit.UpdatedAt = DateTime.UtcNow;
            unit.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Unit", unit.Id, unit.Name, new { headUserId = previousHead, deputyHeadUserId = previousDeputy },
                new { headUserId = userId, unit.DeputyHeadUserId });
            return await SaveAsync(new[] { previousHead, userId, previousDeputy }, actorUserId,
                userId.HasValue ? "Head of " + unit.Name + " set." : "Head of " + unit.Name + " cleared.", "The change could not be saved; try again.");
        }

        public async Task<AdminResult> SetUnitDeputyAsync(Guid unitId, Guid? userId, Guid? actorUserId)
        {
            var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            if (unit.DeputyHeadUserId == userId) return AdminResult.Ok("No change.");
            if (userId.HasValue)
            {
                if (userId == unit.HeadUserId) return AdminResult.Invalid("The Head of Unit cannot also be the deputy.");
                var isMember = await _db.UnitMembers.AnyAsync(m => m.UnitId == unitId && m.UserId == userId.Value && m.IsActive && m.User!.IsActive);
                if (!isMember) return AdminResult.Invalid("The deputy must be an active member of " + unit.Name + ". Add them to the unit first.");
            }

            var previous = unit.DeputyHeadUserId;
            unit.DeputyHeadUserId = userId;
            unit.UpdatedAt = DateTime.UtcNow;
            unit.UpdatedByUserId = actorUserId;
            Stage(AuditAction.Updated, "Unit", unit.Id, unit.Name, new { deputyHeadUserId = previous }, new { deputyHeadUserId = userId });
            return await SaveAsync(new[] { previous, userId }, actorUserId,
                userId.HasValue ? "Deputy of " + unit.Name + " set." : "Deputy of " + unit.Name + " cleared.", "The change could not be saved; try again.");
        }

        // ---------------- members ----------------

        public async Task<AdminResult> AddMemberAsync(Guid unitId, Guid userId, string? staffNo, Guid? actorUserId)
        {
            var unit = await _db.Units.Include(u => u.Department).FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            if (!unit.IsActive) return AdminResult.Invalid("Switch the unit on first.");
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return AdminResult.NotFound("Person not found.");
            if (!user.IsActive) return AdminResult.Invalid(Name(user) + " is blocked and cannot join a unit.");
            if (unit.Department!.HodUserId == userId)
                return AdminResult.Invalid(Name(user) + " is the Head of Department, who oversees and does not work tickets.");
            if (await _db.UnitMembers.AnyAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive))
                return AdminResult.Conflict(Name(user) + " is already a member of " + unit.Name + ".");
            var otherUnit = await _db.UnitMembers
                .Where(m => m.UserId == userId && m.IsActive && m.Unit!.DepartmentId == unit.DepartmentId)
                .Select(m => m.Unit!.Name).FirstOrDefaultAsync();
            if (otherUnit != null) return AdminResult.Conflict(Name(user) + " is a member of " + otherUnit + ". Remove them there first.");

            var number = string.IsNullOrWhiteSpace(staffNo) ? null : staffNo.Trim();
            if (number != null && number.Length > 30) return AdminResult.Invalid("The staff number must be at most 30 characters.");

            var member = new UnitMember
            {
                Id = Guid.NewGuid(), UnitId = unitId, UserId = userId, StaffCategory = StaffCategory.Employee, StaffNo = number,
                IsActive = true, JoinedAt = DateTime.UtcNow, AddedByUserId = actorUserId
            };
            _db.UnitMembers.Add(member);
            Stage(AuditAction.Created, "UnitMember", member.Id, user.UserName, null, new { unit = unit.Code, user = user.UserName, staffNo = number });
            return await SaveAsync(new Guid?[] { userId }, actorUserId, Name(user) + " added to " + unit.Name + ".", Name(user) + " is already a member of " + unit.Name + ".");
        }

        public async Task<AdminResult> RemoveMemberAsync(Guid unitId, Guid userId, Guid? actorUserId)
        {
            var unit = await _db.Units.FirstOrDefaultAsync(u => u.Id == unitId);
            if (unit == null) return AdminResult.NotFound("Unit not found.");
            var member = await _db.UnitMembers.Include(m => m.User).FirstOrDefaultAsync(m => m.UnitId == unitId && m.UserId == userId && m.IsActive);
            if (member?.User == null) return AdminResult.NotFound("This person is not a member of " + unit.Name + ".");
            if (unit.HeadUserId == userId) return AdminResult.Invalid(Name(member.User) + " heads " + unit.Name + ". Choose another head (or clear the head) first.");
            if (unit.DeputyHeadUserId == userId) return AdminResult.Invalid(Name(member.User) + " is the deputy of " + unit.Name + ". Clear the deputy first.");

            member.IsActive = false;
            member.LeftAt = DateTime.UtcNow;
            member.RemovedByUserId = actorUserId;
            // Their categories in this unit end with the membership (Step 3 skills matrix); history kept
            var skills = await _db.CategorySkills.Where(s => s.UserId == userId && s.IsActive && s.Category!.UnitId == unitId).ToListAsync();
            foreach (var skill in skills)
            {
                skill.IsActive = false;
                skill.RemovedAt = DateTime.UtcNow;
                skill.RemovedByUserId = actorUserId;
            }
            Stage(AuditAction.Deleted, "UnitMember", member.Id, member.User.UserName, new { unit = unit.Code, user = member.User.UserName }, null);
            return await SaveAsync(new Guid?[] { userId }, actorUserId, Name(member.User) + " removed from " + unit.Name + ".", "The change could not be saved; try again.");
        }

        // ---------------- helpers ----------------

        /// <summary>Saves the staged structure change, then brings the affected people's roles in step, in one transaction.</summary>
        private async Task<AdminResult> SaveAsync(IEnumerable<Guid?> affected, Guid? actorUserId, string okMessage, string conflictMessage)
        {
            var people = affected.Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
            await using var transaction = await _db.Database.BeginTransactionAsync();
            try
            {
                await _db.SaveChangesAsync();
                if (people.Count > 0 && await OrgRoleSync.StageAsync(_db, people, actorUserId, Actor(), _audit, _notifications) > 0)
                    await _db.SaveChangesAsync();
                await transaction.CommitAsync();
                return AdminResult.Ok(okMessage);
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Organisation change refused by the database");
                await transaction.RollbackAsync();
                _db.ChangeTracker.Clear();
                return AdminResult.Conflict(conflictMessage);
            }
        }

        private AuditActor Actor() => AuditActor.From(_http.HttpContext);

        private void Stage(AuditAction action, string entityType, Guid entityId, string? display, object? before, object? after)
        {
            var actor = Actor();
            _audit.Stage(actor.UserId, actor.DisplayName, action, entityType, entityId, display,
                before == null ? null : JsonSerializer.Serialize(before), after == null ? null : JsonSerializer.Serialize(after),
                actor.IpAddress, actor.UserAgent, AuditModule.Units);
        }

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;
    }
}