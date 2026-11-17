using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Leave and out of office (BRD 5.3). A person is available when their account is active and they are not away today (Lagos office date).
    /// Who may record or cancel: the person themselves (when they are in the structure); the Head of Unit for members of their unit;
    /// the HOD for anyone in their department's units; a Super Admin for anyone. Moving tickets off someone going on leave comes with
    /// the assignment engine (Step 4), which uses AvailableMemberIdsAsync.
    /// </summary>
    public interface IAvailabilityService
    {
        /// <summary>Today's office date (Africa/Lagos, UTC+1, no daylight saving).</summary>
        DateOnly Today();

        Task<MyAvailabilityDto> GetMineAsync(Guid userId);
        Task<(AdminResult Result, AbsenceDto? Absence)> CreateAsync(CreateAbsenceRequest request, Guid actorUserId, bool actorIsSuperAdmin);
        /// <summary>Cancels a future period, or ends a current one early (it then ends yesterday).</summary>
        Task<AdminResult> CancelAsync(Guid absenceId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<(AdminResult Result, UnitAvailabilityDto? Unit)> GetUnitAsync(Guid unitId, Guid actorUserId, bool actorIsSuperAdmin);
        Task<(AdminResult Result, List<UnitAvailabilityDto>? Units)> GetDepartmentAsync(Guid departmentId, Guid actorUserId, bool actorIsSuperAdmin);

        Task<bool> IsAvailableAsync(Guid userId);
        /// <summary>Active members of the unit with an active account and no absence today (for automatic assignment).</summary>
        Task<List<Guid>> AvailableMemberIdsAsync(Guid unitId);
    }
}