using System.Text.Json;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Domain;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Infrastructure.Audit;
using ServiceDeskAPI.Infrastructure.Identity;
using ServiceDeskAPI.Infrastructure.Organisation;
using ServiceDeskAPI.Infrastructure.Persistence;

namespace ServiceDeskAPI.Infrastructure.Services
{
    /// <summary>
    /// Super Admin management of people and roles. Ported from People Hub's AdminUserRoleService; the one-active-role rule was replaced
    /// by "each role once while active". Each change, its audit entry and the person's notification are saved together.
    /// A role change reaches the person's session at the next token refresh (within 15 minutes) or sign-in.
    /// </summary>
    public class AdminUserService : IAdminUserService
    {
        private readonly AppDbContext _db;
        private readonly IAuditService _audit;
        private readonly IInAppNotificationService _notifications;
        private readonly ILdapAuthService _ldap;
        private readonly IHttpContextAccessor _http;
        private readonly ILogger<AdminUserService> _logger;

        public AdminUserService(AppDbContext db, IAuditService audit, IInAppNotificationService notifications, ILdapAuthService ldap,
            IHttpContextAccessor http, ILogger<AdminUserService> logger)
        {
            _db = db;
            _audit = audit;
            _notifications = notifications;
            _ldap = ldap;
            _http = http;
            _logger = logger;
        }

        public async Task<PagedResult<AdminUserDto>> ListUsersAsync(int page, int pageSize, string? search, string? role)
        {
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 100);
            var query = _db.Users.AsNoTracking().AsQueryable();

            var text = (search ?? string.Empty).Trim();
            if (text.Length > 0)
                query = query.Where(u => u.UserName!.Contains(text)
                    || (u.FullName != null && u.FullName.Contains(text))
                    || (u.Email != null && u.Email.Contains(text))
                    || (u.Department != null && u.Department.Contains(text)));

            var roleName = (role ?? string.Empty).Trim().ToUpperInvariant();
            if (roleName.Length > 0)
                query = query.Where(u => u.RoleAssignments.Any(a => a.IsActive && a.Role!.NormalizedName == roleName));

            var total = await query.CountAsync();
            var items = await Project(query.OrderBy(u => u.FullName ?? u.UserName).Skip((page - 1) * pageSize).Take(pageSize)).ToListAsync();
            return new PagedResult<AdminUserDto> { Items = items, Total = total, Page = page, PageSize = pageSize };
        }

        public Task<AdminUserDto?> GetUserAsync(Guid userId) =>
            Project(_db.Users.AsNoTracking().Where(u => u.Id == userId)).FirstOrDefaultAsync();

        private static IQueryable<AdminUserDto> Project(IQueryable<User> users) => users.Select(u => new AdminUserDto
        {
            Id = u.Id,
            UserName = u.UserName ?? string.Empty,
            FullName = u.FullName,
            Email = u.CorporateEmail ?? u.Email,
            Department = u.Department,
            JobTitle = u.JobTitle,
            Roles = u.RoleAssignments.Where(a => a.IsActive).Select(a => a.Role!.Name!).OrderBy(n => n).ToList(),
            IsActive = u.IsActive,
            HasSignedIn = u.LastLoginAt != null,
            LastLoginAt = u.LastLoginAt,
            CreatedAt = u.CreatedAt
        });

        public async Task<List<RoleItemDto>> ListRolesAsync() =>
            await _db.Roles.AsNoTracking().OrderBy(r => r.Name).Select(r => new RoleItemDto(r.Id, r.Name!, r.Description)).ToListAsync();

        public async Task<AdminResult> AssignRoleAsync(Guid userId, Guid roleId, Guid actorUserId)
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return AdminResult.NotFound("Person not found.");
            var role = await _db.Roles.FirstOrDefaultAsync(r => r.Id == roleId);
            if (role == null) return AdminResult.NotFound("Role not found.");
            if (OrgRoleSync.IsStructureRole(roleId)) return AdminResult.Invalid(StructureRoleMessage(role.Name));
            if (await _db.UserRoleAssignments.AnyAsync(a => a.UserId == userId && a.RoleId == roleId && a.IsActive))
                return AdminResult.Conflict(Name(user) + " already has the " + role.Name + " role.");

            _db.UserRoleAssignments.Add(new UserRoleAssignment
            {
                Id = Guid.NewGuid(),
                UserId = userId,
                RoleId = roleId,
                IsActive = true,
                AssignedAt = DateTime.UtcNow,
                AssignedByUserId = actorUserId
            });
            if (!await _db.UserRoles.AnyAsync(r => r.UserId == userId && r.RoleId == roleId))
                _db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = userId, RoleId = roleId });

            Stage(AuditAction.RoleChanged, user, null, Json(new { granted = role.Name }));
            _notifications.Stage(userId, "Your Access Desk access changed",
                "You now have the " + Friendly(role.Name) + " role. Sign out and back in if you do not see the new pages yet.",
                NotificationType.Info, NotificationCategory.System, "User", userId, null);

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Granted by someone else at the same moment (unique index on active user + role)
                return AdminResult.Conflict(Name(user) + " already has the " + role.Name + " role.");
            }
            _logger.LogInformation("Role {Role} given to {User} by {Actor}", role.Name, user.UserName, actorUserId);
            return AdminResult.Ok(role.Name + " role given to " + Name(user) + ".");
        }

        public async Task<AdminResult> RemoveRoleAsync(Guid userId, Guid roleId, Guid actorUserId)
        {
            var assignment = await _db.UserRoleAssignments
                .Include(a => a.Role)
                .Include(a => a.User)
                .FirstOrDefaultAsync(a => a.UserId == userId && a.RoleId == roleId && a.IsActive);
            if (assignment?.User == null || assignment.Role == null)
                return AdminResult.NotFound("This person does not hold that role.");

            if (OrgRoleSync.IsStructureRole(roleId))
                return AdminResult.Invalid(StructureRoleMessage(assignment.Role.Name));
            if (roleId == AppRoles.RequesterId)
                return AdminResult.Invalid("Every staff member is a Requester. To stop someone using Access Desk, block their account instead.");
            if (roleId == AppRoles.SuperAdminId && await SuperAdminRules.IsLastAsync(_db, userId))
                return AdminResult.Invalid("This is the last Super Admin. Give the role to someone else first.");

            assignment.IsActive = false;
            assignment.DisabledAt = DateTime.UtcNow;
            assignment.DisabledByUserId = actorUserId;
            var link = await _db.UserRoles.FirstOrDefaultAsync(r => r.UserId == userId && r.RoleId == roleId);
            if (link != null) _db.UserRoles.Remove(link);

            Stage(AuditAction.RoleChanged, assignment.User, Json(new { removed = assignment.Role.Name }), null);
            _notifications.Stage(userId, "Your Access Desk access changed",
                "The " + Friendly(assignment.Role.Name) + " role was removed from your account.",
                NotificationType.Info, NotificationCategory.System, "User", userId, null);

            await _db.SaveChangesAsync();
            _logger.LogInformation("Role {Role} removed from {User} by {Actor}", assignment.Role.Name, assignment.User.UserName, actorUserId);
            return AdminResult.Ok(assignment.Role.Name + " role removed from " + Name(assignment.User) + ".");
        }

        public async Task<AdminResult> SetStatusAsync(Guid userId, bool isActive, Guid actorUserId)
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user == null) return AdminResult.NotFound("Person not found.");
            if (user.IsActive == isActive)
                return AdminResult.Ok(Name(user) + (isActive ? " is already active." : " is already deactivated."));
            if (!isActive && userId == actorUserId)
                return AdminResult.Invalid("You cannot deactivate your own account.");
            if (!isActive && await SuperAdminRules.IsLastAsync(_db, userId))
                return AdminResult.Invalid("This is the last Super Admin. Give the role to someone else first.");

            user.IsActive = isActive;
            user.UpdatedAt = DateTime.UtcNow;
            if (!isActive)
            {
                // End every session: no refresh token of theirs works any more
                var now = DateTime.UtcNow;
                foreach (var token in await _db.RefreshTokenStores.Where(t => t.UserId == userId && !t.IsRevoked).ToListAsync())
                {
                    token.IsRevoked = true;
                    token.RevokedAt = now;
                }
            }

            Stage(AuditAction.StatusChanged, user, Json(new { isActive = !isActive }), Json(new { isActive }));
            await _db.SaveChangesAsync();
            _logger.LogInformation("{User} {State} by {Actor}", user.UserName, isActive ? "activated" : "deactivated", actorUserId);
            return AdminResult.Ok(Name(user) + (isActive ? " can sign in again." : " is deactivated and signed out."));
        }

        public async Task<(AdminResult Result, ProvisionedUserDto? User)> EnsureFromDirectoryAsync(string samAccountName, Guid actorUserId)
        {
            var sam = (samAccountName ?? string.Empty).Trim();
            if (sam.Length == 0 || sam.Length > 256)
                return (AdminResult.Invalid("Choose a person from the directory search."), null);

            var existing = await FindByUserNameAsync(sam);
            if (existing != null)
                return (AdminResult.Ok("Already has an account."), await ToProvisionedAsync(existing, false));

            var ad = await _ldap.GetUserDetailsAsync(sam);
            if (ad == null)
                return (AdminResult.NotFound("That person was not found in the directory."), null);

            var userName = string.IsNullOrWhiteSpace(ad.Username) ? sam : ad.Username.Trim();
            existing = await FindByUserNameAsync(userName);
            if (existing != null)
                return (AdminResult.Ok("Already has an account."), await ToProvisionedAsync(existing, false));

            var email = string.IsNullOrWhiteSpace(ad.Email) ? null : ad.Email.Trim();
            var user = new User
            {
                Id = Guid.NewGuid(),
                UserName = userName,
                NormalizedUserName = userName.ToUpperInvariant(),
                Email = email,
                NormalizedEmail = email?.ToUpperInvariant(),
                CorporateEmail = email,
                EmailConfirmed = email != null,
                FullName = string.IsNullOrWhiteSpace(ad.DisplayName) ? userName : ad.DisplayName,
                Department = string.IsNullOrWhiteSpace(ad.Department) ? null : ad.Department.Trim(),
                JobTitle = string.IsNullOrWhiteSpace(ad.Title) ? null : ad.Title.Trim(),
                AdDistinguishedName = string.IsNullOrWhiteSpace(ad.DistinguishedName) ? null : ad.DistinguishedName,
                IsActive = true,
                SecurityStamp = Guid.NewGuid().ToString(),
                ConcurrencyStamp = Guid.NewGuid().ToString(),
                CreatedAt = DateTime.UtcNow
            };
            _db.Users.Add(user);
            _db.UserRoleAssignments.Add(new UserRoleAssignment
            {
                Id = Guid.NewGuid(), UserId = user.Id, RoleId = AppRoles.RequesterId, IsActive = true,
                AssignedAt = DateTime.UtcNow, AssignedByUserId = actorUserId
            });
            _db.UserRoles.Add(new IdentityUserRole<Guid> { UserId = user.Id, RoleId = AppRoles.RequesterId });
            Stage(AuditAction.Created, user, null, Json(new { source = "directory", user.Department }));

            try
            {
                await _db.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogWarning(ex, "Could not add {User} from the directory", userName);
                return (AdminResult.Conflict("An account with the same login name or email already exists."), null);
            }
            return (AdminResult.Ok("Account created."), await ToProvisionedAsync(user, true));
        }

        // ---------------- helpers ----------------

        private Task<User?> FindByUserNameAsync(string userName)
        {
            var normalized = userName.ToUpperInvariant();
            return _db.Users.FirstOrDefaultAsync(u => u.NormalizedUserName == normalized);
        }

        private async Task<ProvisionedUserDto> ToProvisionedAsync(User user, bool created) => new()
        {
            UserId = user.Id,
            UserName = user.UserName ?? string.Empty,
            FullName = user.FullName,
            Email = user.CorporateEmail ?? user.Email,
            Department = user.Department,
            Created = created,
            Roles = await RoleAssignments.GetActiveRoleNamesAsync(_db, user.Id)
        };

        private void Stage(AuditAction action, User user, string? oldValues, string? newValues)
        {
            var actor = AuditActor.From(_http.HttpContext);
            _audit.Stage(actor.UserId, actor.DisplayName, action, "User", user.Id, user.UserName, oldValues, newValues,
                actor.IpAddress, actor.UserAgent, AuditModule.Administration);
        }

        /// <summary>Case Worker, Head of Unit and HOD follow the organisation set-up (Step 2a); they are not given by hand.</summary>
        private static string StructureRoleMessage(string? role) => role switch
        {
            AppRoles.CaseWorker => "Case Worker follows unit membership: add or remove the person under Administration > Units.",
            AppRoles.HeadOfUnit => "Head of Unit follows the unit set-up: set the head or deputy under Administration > Units.",
            AppRoles.HOD => "Head of Department follows the department set-up: set the HOD under Administration > Units.",
            _ => "This role follows the organisation set-up."
        };

        private static string Json(object value) => JsonSerializer.Serialize(value);

        private static string Name(User user) => string.IsNullOrWhiteSpace(user.FullName) ? user.UserName ?? "This person" : user.FullName;

        private static string Friendly(string? role) => role switch
        {
            AppRoles.CaseWorker => "Case Worker",
            AppRoles.HeadOfUnit => "Head of Unit",
            AppRoles.HOD => "Head of Department",
            AppRoles.SuperAdmin => "Super Admin",
            _ => role ?? string.Empty
        };
    }
}