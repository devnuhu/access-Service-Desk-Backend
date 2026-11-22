using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One service level. Scope is global, department or category. IsDefault: no row is saved, so the built-in default applies.</summary>
    public class SlaPolicyRowDto
    {
        public Guid? Id { get; set; }
        public string Scope { get; set; } = "global";
        public Guid? DepartmentId { get; set; }
        public string? DepartmentName { get; set; }
        public Guid? CategoryId { get; set; }
        public string? CategoryName { get; set; }
        public TicketPriority Priority { get; set; }
        /// <summary>Business hours until the first response (counted from when the ticket was raised).</summary>
        public int ResponseHours { get; set; }
        /// <summary>Business hours until resolution (Pending and Resolved time not counted).</summary>
        public int ResolutionHours { get; set; }
        public bool IsDefault { get; set; }
    }

    /// <summary>Global: always four rows, Critical to Low. Overrides: the department and category rows that exist.</summary>
    public class SlaPoliciesDto
    {
        public List<SlaPolicyRowDto> Global { get; set; } = new();
        public List<SlaPolicyRowDto> Overrides { get; set; } = new();
    }

    /// <summary>Saves (adds or changes) one level. scope: global, department (needs departmentId) or category (needs categoryId).</summary>
    public class SaveSlaPolicyRequest
    {
        public string Scope { get; set; } = "global";
        public Guid? DepartmentId { get; set; }
        public Guid? CategoryId { get; set; }
        public TicketPriority Priority { get; set; }
        public int ResponseHours { get; set; }
        public int ResolutionHours { get; set; }
    }
}