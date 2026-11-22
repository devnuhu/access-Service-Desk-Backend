using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A service level: how many business hours until the first response and until resolution, for one priority. The row with no department and no category is the
    /// global one; a department row overrides it for that department; a category row overrides both. No row means the built-in default (see SlaTargets).
    /// </summary>
    public class SlaPolicy
    {
        public Guid Id { get; set; }
        public Guid? DepartmentId { get; set; }
        public Guid? CategoryId { get; set; }
        public TicketPriority Priority { get; set; }
        public int ResponseHours { get; set; }
        public int ResolutionHours { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public Guid? UpdatedByUserId { get; set; }
    }
}