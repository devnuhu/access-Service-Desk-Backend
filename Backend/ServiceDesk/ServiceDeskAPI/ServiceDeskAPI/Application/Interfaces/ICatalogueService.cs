using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>
    /// The service catalogue (BRD Section 7, FR-7.1) and the skills matrix (BRD 5.2, FR-7.3). actorUserId is null for the system
    /// (Development seeding).
    /// </summary>
    public interface ICatalogueService
    {
        /// <summary>Active categories of active departments and units, for anyone raising a ticket.</summary>
        Task<List<CatalogueDepartmentDto>> ListForRequestersAsync();

        Task<List<CategoryAdminDto>> ListAsync(Guid? departmentId);
        Task<(AdminResult Result, CategoryAdminDto? Category)> CreateAsync(CreateCategoryRequest request, Guid? actorUserId);
        Task<AdminResult> UpdateAsync(Guid categoryId, UpdateCategoryRequest request, Guid? actorUserId);

        Task<UnitSkillsDto?> GetUnitSkillsAsync(Guid unitId);
        /// <summary>Sets exactly which of the unit's categories this member handles. The message names categories left short of cover.</summary>
        Task<AdminResult> SetSkillsAsync(Guid unitId, Guid userId, IReadOnlyCollection<Guid> categoryIds, Guid? actorUserId);
        /// <summary>Every active category with fewer than two eligible case workers.</summary>
        Task<List<CategoryCoverDto>> CoverWarningsAsync();

        /// <summary>The categories this person handles, per unit they are an active member of (Step 6).</summary>
        Task<List<MyCategoriesDto>> MineAsync(Guid userId);

        /// <summary>For automatic assignment (Step 4): mapped, active members of the owning unit with active accounts. Availability is checked separately.</summary>
        Task<List<Guid>> EligibleCaseWorkerIdsAsync(Guid categoryId);
    }
}