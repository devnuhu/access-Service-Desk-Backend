using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// Departments, units, heads and members (BRD Section 5, M7 FR-7.2). The Case Worker, Head of Unit and HOD roles follow the
    /// structure automatically (OrgRoleSync); every change, its audit entries and the people's notifications are saved together.
    /// actorUserId is null for the system (Development seeding).
    /// </summary>
    public interface IOrganisationService
    {
        Task<List<DepartmentDto>> ListDepartmentsAsync();
        Task<(AdminResult Result, DepartmentDto? Department)> CreateDepartmentAsync(CreateDepartmentRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateDepartmentAsync(Guid departmentId, UpdateOrgItemRequest request, Guid? actorUserId);
        Task<AdminResult> SetHodAsync(Guid departmentId, Guid? userId, Guid? actorUserId);
        Task<AdminResult> SetAdminAsync(Guid departmentId, Guid? userId, Guid? actorUserId);

        Task<(AdminResult Result, UnitDto? Unit)> CreateUnitAsync(Guid departmentId, CreateUnitRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateUnitAsync(Guid unitId, UpdateOrgItemRequest request, Guid? actorUserId);
        Task<AdminResult> SetUnitHeadAsync(Guid unitId, Guid? userId, Guid? actorUserId);
        Task<AdminResult> SetUnitDeputyAsync(Guid unitId, Guid? userId, Guid? actorUserId);

        Task<List<UnitMemberDto>?> ListMembersAsync(Guid unitId);
        Task<AdminResult> AddMemberAsync(Guid unitId, Guid userId, string? staffNo, Guid? actorUserId);
        Task<AdminResult> RemoveMemberAsync(Guid unitId, Guid userId, Guid? actorUserId);

        Task<MyOrganisationDto> GetMyOrganisationAsync(Guid userId);
        Task<List<OrgDepartmentDto>> ListActiveDepartmentsAsync();
    }
}