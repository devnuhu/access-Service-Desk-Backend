using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>Who a saved report is shared with. Running it always uses the viewer's own scope, so sharing never shows anyone data they could not already see.</summary>
    public enum ReportShare
    {
        Private = 0,
        /// <summary>People who work in, or head, the unit in ShareUnitId (and the HOD and Admin of its department).</summary>
        Unit = 1,
        /// <summary>People who work in, head, or run the department in ShareDepartmentId.</summary>
        Department = 2,
        /// <summary>Anyone who holds one of the roles in ShareRoles (and can run reports).</summary>
        Roles = 3
    }

    /// <summary>A report someone built and saved (Step 9b). The definition is stored as JSON so new options never need a migration.</summary>
    [Index(nameof(OwnerUserId), nameof(Name), IsUnique = true)]
    public class SavedReport
    {
        public Guid Id { get; set; }
        public Guid OwnerUserId { get; set; }
        [MaxLength(150)]
        public string Name { get; set; } = string.Empty;
        [MaxLength(500)]
        public string? Description { get; set; }
        public string DefinitionJson { get; set; } = "{}";
        public ReportShare Share { get; set; } = ReportShare.Private;
        public Guid? ShareUnitId { get; set; }
        public Guid? ShareDepartmentId { get; set; }
        /// <summary>Comma separated role names (HeadOfUnit, HOD, DepartmentAdmin).</summary>
        [MaxLength(200)]
        public string? ShareRoles { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
    }
}
