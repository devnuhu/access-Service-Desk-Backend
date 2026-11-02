using Microsoft.AspNetCore.Identity;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A staff member who has signed in with Active Directory (or a Development test account).
    /// Copied from People Hub, without the Employee link; department and job title come from AD.
    /// </summary>
    public class User : IdentityUser<Guid>
    {
        /// <summary>The AD distinguished name, set on first sign-in (just-in-time linking).</summary>
        public string? AdDistinguishedName { get; set; }
        public string? CorporateEmail { get; set; }
        public string? FullName { get; set; }
        /// <summary>The AD department attribute, refreshed at every sign-in.</summary>
        public string? Department { get; set; }
        /// <summary>The AD title attribute, refreshed at every sign-in.</summary>
        public string? JobTitle { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime? LastLoginAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }

        public ICollection<UserRoleAssignment> RoleAssignments { get; set; } = new List<UserRoleAssignment>();
    }
}