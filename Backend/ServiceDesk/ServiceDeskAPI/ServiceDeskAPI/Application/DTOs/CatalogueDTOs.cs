using ServiceDeskAPI.Domain.Enums;
using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>What a requester chooses from: active categories of active departments (no owning unit or staffing shown).</summary>
    public class CatalogueDepartmentDto
    {
        public Guid DepartmentId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public List<CatalogueCategoryDto> Categories { get; set; } = new();
    }

    public class CatalogueCategoryDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        /// <summary>1 Low, 2 Medium, 3 High, 4 Critical.</summary>
        public TicketPriority DefaultPriority { get; set; }
    }

    /// <summary>A category as the Super Admin manages it, with how many case workers can take it.</summary>
    public class CategoryAdminDto
    {
        public Guid Id { get; set; }
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public int TimelineHours { get; set; }
        public TicketPriority DefaultPriority { get; set; }
        public int SortOrder { get; set; }
        public bool IsActive { get; set; }
        /// <summary>Case workers mapped to it who are active members of its unit with an active account.</summary>
        public int EligibleCount { get; set; }
        /// <summary>True for an active category with fewer than two eligible case workers (BRD 5.2).</summary>
        public bool NeedsCover { get; set; }
    }

    public class CreateCategoryRequest
    {
        public Guid UnitId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public int TimelineHours { get; set; } = 24;
        public TicketPriority DefaultPriority { get; set; } = TicketPriority.Medium;
    }

    /// <summary>Leave a field out (null) to keep it. unitId moves the category to another unit of the same department.</summary>
    public class UpdateCategoryRequest
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public Guid? UnitId { get; set; }
        public int? TimelineHours { get; set; }
        public TicketPriority? DefaultPriority { get; set; }
        public int? SortOrder { get; set; }
        public bool? IsActive { get; set; }
    }

    /// <summary>The skills matrix for one unit: its categories (columns) and members (rows).</summary>
    public class UnitSkillsDto
    {
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public List<SkillCategoryDto> Categories { get; set; } = new();
        public List<SkillMemberDto> Members { get; set; } = new();
        /// <summary>Active categories of the unit with fewer than two eligible case workers.</summary>
        public List<CategoryCoverDto> Warnings { get; set; } = new();
    }

    public class SkillCategoryDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public int EligibleCount { get; set; }
    }

    public class SkillMemberDto
    {
        /// <summary>True for the head of the unit: heads are not assigned automatically, so their ticks do not count.</summary>
        public bool IsHead { get; set; }

        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public StaffCategory StaffCategory { get; set; }
        public bool AccountActive { get; set; }
        public List<Guid> CategoryIds { get; set; } = new();
    }

    public class CategoryCoverDto
    {
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public int EligibleCount { get; set; }
    }

    /// <summary>The categories (of the unit) this person handles. Replaces their current set in that unit.</summary>
    public class SetSkillsRequest
    {
        public List<Guid> CategoryIds { get; set; } = new();
    }
}