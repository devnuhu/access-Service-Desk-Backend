namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// One role held by one person, with who granted it and when. Unlike People Hub, a person may hold
    /// several active roles; the database allows each role only once while it is active.
    /// </summary>
    public class UserRoleAssignment
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public Guid RoleId { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
        public Guid? AssignedByUserId { get; set; }
        public DateTime? DisabledAt { get; set; }
        public Guid? DisabledByUserId { get; set; }

        public User? User { get; set; }
        public Role? Role { get; set; }
    }
}