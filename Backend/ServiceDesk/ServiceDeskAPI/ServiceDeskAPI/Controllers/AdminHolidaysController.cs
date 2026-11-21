using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ServiceDeskAPI.Application.DTOs;
using ServiceDeskAPI.Application.Interfaces;
using ServiceDeskAPI.Infrastructure.Identity;

namespace ServiceDeskAPI.Controllers
{
    /// <summary>Super Admin: company holidays. The SLA clock does not run on these days.</summary>
    [ApiController]
    [Route("api/admin/holidays")]
    [Authorize(Policy = Policies.SuperAdminOnly)]
    [Produces("application/json")]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    public class AdminHolidaysController : ControllerBase
    {
        private readonly IHolidayService _holidays;

        public AdminHolidaysController(IHolidayService holidays) => _holidays = holidays;

        private Guid? Actor() => Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id) ? id : null;

        /// <summary>Holidays, oldest first (one year with ?year=2027). Those set in the server settings are flagged fromConfig and cannot be removed here.</summary>
        [HttpGet]
        [ProducesResponseType(typeof(List<HolidayDto>), StatusCodes.Status200OK)]
        public async Task<ActionResult<List<HolidayDto>>> List([FromQuery] int? year) => Ok(await _holidays.ListAsync(year));

        [HttpPost]
        [ProducesResponseType(typeof(HolidayDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status400BadRequest)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status409Conflict)]
        public async Task<ActionResult<HolidayDto>> Create([FromBody] SaveHolidayRequest request)
        {
            var (result, holiday) = await _holidays.CreateAsync(request, Actor());
            return result.Success && holiday != null ? Ok(holiday) : StatusCode(result.Status, new ApiError(result.Message));
        }

        [HttpDelete("{holidayId:guid}")]
        [ProducesResponseType(typeof(MessageDto), StatusCodes.Status200OK)]
        [ProducesResponseType(typeof(ApiError), StatusCodes.Status404NotFound)]
        public async Task<ActionResult<MessageDto>> Delete(Guid holidayId)
        {
            var result = await _holidays.DeleteAsync(holidayId, Actor());
            return result.Success ? Ok(new MessageDto(result.Message)) : StatusCode(result.Status, new ApiError(result.Message));
        }
    }
}