using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A department that receives tickets on Access Desk (a module), with its Head of Department (oversight only).
    /// Requesters' own departments come from AD (User.Department) and are used for reporting only.
    /// </summary>
    public class Department
    {
        public Guid Id { get; set; }
        /// <summary>Short code, also the ticket reference prefix later (for example CP).</summary>
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public Guid? HodUserId { get; set; }
        public User? HodUser { get; set; }
        /// <summary>The Department Admin: the head of a unit in this department, named by the Super Admin. Sees and administers the whole department.</summary>
        public Guid? AdminUserId { get; set; }
        public User? AdminUser { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }

        public ICollection<Unit> Units { get; set; } = new List<Unit>();
    }

    /// <summary>A unit of a department (for example Contribution Matching), with its Head of Unit.</summary>
    public class Unit
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public Guid? HeadUserId { get; set; }
        public User? HeadUser { get; set; }
        /// <summary>Receives escalations when the Head of Unit is on leave (BRD Section 5). Must be a member of the unit.</summary>
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }

        public ICollection<UnitMember> Members { get; set; } = new List<UnitMember>();
    }

    /// <summary>
    /// A person working tickets in a unit (case worker; the Head of Unit is a member too, with staff category HeadOfUnit).
    /// One active membership per person per department. Leaving keeps the row (IsActive false) as history.
    /// </summary>
    public class UnitMember
    {
        public Guid Id { get; set; }
        public Guid UnitId { get; set; }
        public Unit? Unit { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public StaffCategory StaffCategory { get; set; } = StaffCategory.Employee;
        public string? StaffNo { get; set; }
        public bool IsActive { get; set; } = true;
        /// <summary>Tie-breaker for automatic assignment (Step 5): least recently assigned first.</summary>
        public DateTime? LastAssignedAt { get; set; }
        public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
        public Guid? AddedByUserId { get; set; }
        public DateTime? LeftAt { get; set; }
        public Guid? RemovedByUserId { get; set; }
    }
}