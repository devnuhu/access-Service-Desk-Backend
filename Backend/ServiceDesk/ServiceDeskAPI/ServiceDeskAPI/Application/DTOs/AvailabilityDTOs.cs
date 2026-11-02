using ServiceDeskAPI.Domain.Organisation;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One leave or out-of-office period. Dates are office days in Lagos time, start and end included.</summary>
    public class AbsenceDto
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public AbsenceKind Kind { get; set; }
        public DateOnly StartDate { get; set; }
        public DateOnly EndDate { get; set; }
        public string? Note { get; set; }
        public string? RecordedBy { get; set; }
        public DateTime RecordedAt { get; set; }
    }

    /// <summary>Leave or out of office for yourself (userId left out) or, for a Head of Unit, HOD or Super Admin, for someone else.</summary>
    public class CreateAbsenceRequest
    {
        public Guid? UserId { get; set; }
        /// <summary>1 = Leave, 2 = Out of office.</summary>
        public AbsenceKind Kind { get; set; } = AbsenceKind.Leave;
        public DateOnly? StartDate { get; set; }
        public DateOnly? EndDate { get; set; }
        public string? Note { get; set; }
    }

    /// <summary>The signed-in person's availability.</summary>
    public class MyAvailabilityDto
    {
        /// <summary>Today's office date (Lagos).</summary>
        public DateOnly Today { get; set; }
        /// <summary>True when the person works tickets in a unit, heads one or is an HOD (the people availability matters for).</summary>
        public bool InStructure { get; set; }
        public bool AvailableNow { get; set; }
        public AbsenceDto? Current { get; set; }
        /// <summary>Current and future periods, earliest first.</summary>
        public List<AbsenceDto> Absences { get; set; } = new();
    }

    public class MemberAvailabilityDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public StaffCategory StaffCategory { get; set; }
        public bool IsHead { get; set; }
        public bool IsDeputy { get; set; }
        public bool AccountActive { get; set; }
        /// <summary>Active account and not away today: can be given new tickets.</summary>
        public bool AvailableNow { get; set; }
        public AbsenceDto? Current { get; set; }
        /// <summary>Periods starting after today (next 90 days), earliest first.</summary>
        public List<AbsenceDto> Upcoming { get; set; } = new();
    }

    /// <summary>A unit's people and who is available today (Head of Unit, deputy, HOD of the department, Super Admin).</summary>
    public class UnitAvailabilityDto
    {
        public Guid UnitId { get; set; }
        public Guid DepartmentId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public DateOnly Today { get; set; }
        public int MemberCount { get; set; }
        public int AvailableCount { get; set; }
        public List<MemberAvailabilityDto> Members { get; set; } = new();
    }
}