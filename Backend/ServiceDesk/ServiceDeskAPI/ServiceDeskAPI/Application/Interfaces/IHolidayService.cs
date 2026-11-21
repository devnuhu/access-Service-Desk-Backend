using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>Company holidays (Super Admin). Every change reaches the SLA clock at once.</summary>
    public interface IHolidayService
    {
        /// <summary>Holidays (and those from the server settings), oldest first; one year when given.</summary>
        Task<List<HolidayDto>> ListAsync(int? year);
        Task<(AdminResult Result, HolidayDto? Holiday)> CreateAsync(SaveHolidayRequest request, Guid? actorUserId);
        Task<AdminResult> DeleteAsync(Guid holidayId, Guid? actorUserId);
    }
}