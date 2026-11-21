using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>
    /// A kind of request a department handles (BRD Section 7, FR-7.1), owned by one of its units. The requester picks a category and
    /// describes the request in the ticket body; categories have no extra form fields (decided 3 Nov 2026).
    /// </summary>
    public class Category
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        /// <summary>The unit whose case workers handle it. Can move to another unit of the same department.</summary>
        public Guid UnitId { get; set; }
        public Unit? Unit { get; set; }
        public string Name { get; set; } = string.Empty;
        /// <summary>Optional one-line help shown to requesters when choosing.</summary>
        public string? Description { get; set; }
        /// <summary>Resolution timeline in business hours (24 at launch).</summary>
        public int TimelineHours { get; set; } = 24;
        public TicketPriority DefaultPriority { get; set; } = TicketPriority.Medium;
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }

        /// <summary>Optional template: the subject the raise form suggests. May hold placeholders such as {{requester.name}}.</summary>
        public string? TemplateSubject { get; set; }
        /// <summary>Optional template: the description (rich text) the raise form suggests.</summary>
        public string? TemplateDescriptionHtml { get; set; }

        public ICollection<CategorySkill> Skills { get; set; } = new List<CategorySkill>();
    }

    /// <summary>
    /// The skills matrix (BRD 5.2, FR-7.3): this case worker handles this category. Only members of the category's unit.
    /// Ending keeps the row (IsActive false) as history; leaving the unit or moving the category to another unit ends it.
    /// </summary>
    public class CategorySkill
    {
        public Guid Id { get; set; }
        public Guid CategoryId { get; set; }
        public Category? Category { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime AddedAt { get; set; } = DateTime.UtcNow;
        public Guid? AddedByUserId { get; set; }
        public DateTime? RemovedAt { get; set; }
        public Guid? RemovedByUserId { get; set; }
    }
}