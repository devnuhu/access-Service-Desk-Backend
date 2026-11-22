namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>frequency: daily, weekly or monthly. weekDay is a day name (Monday) for weekly; dayOfMonth is 1 to 28 for monthly. sendHour is the Lagos hour 0 to 23. format: xlsx or csv.</summary>
    public class SaveReportScheduleRequest
    {
        public Guid SavedReportId { get; set; }
        public string Frequency { get; set; } = "daily";
        public string? WeekDay { get; set; }
        /// <summary>For frequency custom: day names from Monday to Friday.</summary>
        public List<string>? WeekDays { get; set; }
        public int? DayOfMonth { get; set; }
        public int SendHour { get; set; } = 8;
        public string Format { get; set; } = "xlsx";
        public bool Enabled { get; set; } = true;
        /// <summary>People to copy (up to 10), chosen from the staff directory. They receive the same email.</summary>
        public List<ReportRecipientDto>? Cc { get; set; }
    }

    public class ReportScheduleDto
    {
        public Guid Id { get; set; }
        public Guid SavedReportId { get; set; }
        public string ReportName { get; set; } = string.Empty;
        public string Frequency { get; set; } = "daily";
        public string? WeekDay { get; set; }
        /// <summary>For frequency custom: day names from Monday to Friday.</summary>
        public List<string>? WeekDays { get; set; }
        public int? DayOfMonth { get; set; }
        public int SendHour { get; set; }
        public string Format { get; set; } = "xlsx";
        public bool Enabled { get; set; }
        /// <summary>The next time it will send (UTC). Empty when the schedule is switched off.</summary>
        public DateTime? NextRunAt { get; set; }
        public List<ReportRecipientDto> Cc { get; set; } = new();
        public DateTime? LastSentAt { get; set; }
        /// <summary>Sent, Skipped, Retrying or Failed.</summary>
        public string? LastStatus { get; set; }
        public string? LastError { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }
}
