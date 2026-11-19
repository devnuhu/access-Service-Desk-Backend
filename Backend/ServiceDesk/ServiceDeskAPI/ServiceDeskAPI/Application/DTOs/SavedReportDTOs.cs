namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>share: private, unit, department or roles.</summary>
    public class SaveReportRequest
    {
        public string? Name { get; set; }
        public string? Description { get; set; }
        public ReportSpec? Definition { get; set; }
        public string Share { get; set; } = "private";
        public Guid? ShareUnitId { get; set; }
        public Guid? ShareDepartmentId { get; set; }
        /// <summary>HeadOfUnit, HOD, DepartmentAdmin.</summary>
        public List<string> ShareRoles { get; set; } = new();
    }

    public class SavedReportDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string OwnerName { get; set; } = string.Empty;
        public bool IsMine { get; set; }
        public string Share { get; set; } = "private";
        public Guid? ShareUnitId { get; set; }
        public Guid? ShareDepartmentId { get; set; }
        public List<string> ShareRoles { get; set; } = new();
        public ReportSpec Definition { get; set; } = new();
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }
}
