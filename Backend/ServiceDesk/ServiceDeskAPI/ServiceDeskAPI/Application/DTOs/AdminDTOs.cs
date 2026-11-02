namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A page of results.</summary>
    public class PagedResult<T>
    {
        public List<T> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }

    /// <summary>One person in the Super Admin user list, with every active role.</summary>
    public class AdminUserDto
    {
        public Guid Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? Department { get; set; }
        public string? JobTitle { get; set; }
        public List<string> Roles { get; set; } = new();
        public bool IsActive { get; set; }
        /// <summary>False for someone added from the directory who has not signed in yet.</summary>
        public bool HasSignedIn { get; set; }
        public DateTime? LastLoginAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    /// <summary>A role that can be given (GET api/admin/roles).</summary>
    public record RoleItemDto(Guid Id, string Name, string? Description);

    public class AssignRoleRequest
    {
        public Guid RoleId { get; set; }
    }

    public class UpdateUserStatusRequest
    {
        /// <summary>True to let the person sign in, false to block them (their sessions end).</summary>
        public bool IsActive { get; set; }
    }

    /// <summary>Outcome of an admin action: Status is the HTTP status the controller returns (200, 400, 404 or 409).</summary>
    public sealed record AdminResult(int Status, string Message)
    {
        public bool Success => Status == 200;
        public static AdminResult Ok(string message) => new(200, message);
        public static AdminResult Invalid(string message) => new(400, message);
        public static AdminResult NotFound(string message) => new(404, message);
        public static AdminResult Conflict(string message) => new(409, message);
    }

    /// <summary>One person found in Active Directory. Only safe attributes; the manager link is never sent to the browser.</summary>
    public class DirectoryUserDto
    {
        public string DistinguishedName { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string? JobTitle { get; set; }
        public string? Department { get; set; }
        public string SamAccountName { get; set; } = string.Empty;
        [System.Text.Json.Serialization.JsonIgnore]
        public string? ManagerDn { get; set; }
    }

    public class EnsureUserRequest
    {
        /// <summary>The login name (sAMAccountName) from the directory search.</summary>
        public string SamAccountName { get; set; } = string.Empty;
    }

    /// <summary>A local account made (or found) for a person from the directory, so roles can be given before their first sign-in.</summary>
    public class ProvisionedUserDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public string? Email { get; set; }
        public string? Department { get; set; }
        /// <summary>True when this call created the local account.</summary>
        public bool Created { get; set; }
        public List<string> Roles { get; set; } = new();
    }
}