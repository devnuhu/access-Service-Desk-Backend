using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Super Admin management of people and roles (BRD Section 4), ported from People Hub's AdminUserRoleService with several
    /// roles per person. Every change is audited and the person is notified, in the same save.
    /// </summary>
    public interface IAdminUserService
    {
        Task<PagedResult<AdminUserDto>> ListUsersAsync(int page, int pageSize, string? search, string? role);
        Task<AdminUserDto?> GetUserAsync(Guid userId);
        Task<List<RoleItemDto>> ListRolesAsync();

        /// <summary>Gives a role. 409 when the person already holds it.</summary>
        Task<AdminResult> AssignRoleAsync(Guid userId, Guid roleId, Guid actorUserId);

        /// <summary>Takes a role away (the history is kept). Refuses Requester (every staff member has it) and the last Super Admin.</summary>
        Task<AdminResult> RemoveRoleAsync(Guid userId, Guid roleId, Guid actorUserId);

        /// <summary>Lets a person sign in or blocks them. Blocking ends their sessions. Refuses blocking yourself or the last Super Admin.</summary>
        Task<AdminResult> SetStatusAsync(Guid userId, bool isActive, Guid actorUserId);

        /// <summary>Makes a local account for someone from the directory (Requester role), so roles can be given before their first sign-in.</summary>
        Task<(AdminResult Result, ProvisionedUserDto? User)> EnsureFromDirectoryAsync(string samAccountName, Guid actorUserId);
    }

    /// <summary>Live search of on-premises Active Directory for the staff pickers (copied from People Hub).</summary>
    public interface IDirectoryService
    {
        /// <summary>Up to 20 enabled people matching name, login name or email. Throws when the directory cannot be reached.</summary>
        Task<List<DirectoryUserDto>> SearchUsersAsync(string query);
    }
}