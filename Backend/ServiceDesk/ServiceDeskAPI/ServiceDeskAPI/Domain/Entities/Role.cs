using Microsoft.AspNetCore.Identity;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>An application role (BRD Section 4). The five roles are seeded; see AppRoles.</summary>
    public class Role : IdentityRole<Guid>
    {
        public string? Description { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}