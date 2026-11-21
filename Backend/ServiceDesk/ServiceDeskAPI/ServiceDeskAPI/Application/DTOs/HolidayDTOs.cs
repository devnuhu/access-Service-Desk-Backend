namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A day the SLA clock does not run. FromConfig: set in the server settings (Sla:Holidays), so it cannot be removed here.</summary>
    public record HolidayDto(Guid? Id, DateOnly Date, string Name, bool FromConfig);

    public class SaveHolidayRequest
    {
        /// <summary>yyyy-MM-dd.</summary>
        public DateOnly Date { get; set; }
        /// <summary>2 to 100 characters, for example "Independence Day".</summary>
        public string Name { get; set; } = string.Empty;
    }
}