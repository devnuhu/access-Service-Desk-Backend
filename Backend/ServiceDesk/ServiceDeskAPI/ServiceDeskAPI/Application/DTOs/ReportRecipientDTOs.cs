namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A person copied on a scheduled report, picked from the staff directory.</summary>
    public class ReportRecipientDto
    {
        public string Name { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
    }
}