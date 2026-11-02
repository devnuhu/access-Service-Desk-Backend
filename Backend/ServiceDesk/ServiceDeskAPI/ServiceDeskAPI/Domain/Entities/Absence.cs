using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Domain.Organisation
{
    /// <summary>Why a person is away. Both make them unavailable for automatic assignment (BRD 5.3).</summary>
    public enum AbsenceKind
    {
        Leave = 1,
        OutOfOffice = 2
    }
}

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A period a person is away (leave or out of office), whole office days in Lagos time, start and end included.
    /// Cancelling keeps the row (IsCancelled) as history; ending early moves EndDate back to yesterday.
    /// </summary>
    public class Absence
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public AbsenceKind Kind { get; set; } = AbsenceKind.Leave;
        public DateOnly StartDate { get; set; }
        public DateOnly EndDate { get; set; }
        /// <summary>Optional short note (for example "Annual leave"). Never customer data.</summary>
        public string? Note { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
        public bool IsCancelled { get; set; }
        public DateTime? CancelledAt { get; set; }
        public Guid? CancelledByUserId { get; set; }
    }
}