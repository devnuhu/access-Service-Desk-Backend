using Microsoft.EntityFrameworkCore;
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ServiceDeskAPI.Domain.Entities
{
    public enum ReportFrequency
    {
        /// <summary>Every working day.</summary>
        Daily = 0,
        /// <summary>One chosen weekday.</summary>
        Weekly = 1,
        /// <summary>One chosen day of the month (1 to 28).</summary>
        Monthly = 2,
        /// <summary>The chosen weekdays, Monday to Friday (for example Monday, Wednesday and Friday).</summary>
        Custom = 3
    }

    /// <summary>
    /// A saved report that is emailed to its owner on a schedule (Step 9d). The report runs with the owner's own scope, so a schedule can never
    /// send data the owner could not already see. Times are Lagos hours. One schedule per person and saved report. Deleting the saved report deletes its schedules.
    /// </summary>
    [Index(nameof(OwnerUserId), nameof(SavedReportId), IsUnique = true)]
    public class ReportSchedule
    {
        public Guid Id { get; set; }
        public Guid OwnerUserId { get; set; }
        public Guid SavedReportId { get; set; }
        [ForeignKey(nameof(SavedReportId))]
        public SavedReport? SavedReport { get; set; }
        public ReportFrequency Frequency { get; set; } = ReportFrequency.Daily;
        public DayOfWeek WeekDay { get; set; } = DayOfWeek.Monday;
        /// <summary>Custom frequency: the chosen weekdays, one bit per DayOfWeek (Sunday is bit 0).</summary>
        public int DaysMask { get; set; }
        /// <summary>The people copied, a JSON list of name and email, chosen from the staff directory.</summary>
        [MaxLength(4000)]
        public string CcJson { get; set; } = "[]";
        public int DayOfMonth { get; set; } = 1;
        /// <summary>Lagos hour, 0 to 23.</summary>
        public int SendHour { get; set; } = 8;
        /// <summary>xlsx or csv.</summary>
        [MaxLength(10)]
        public string Format { get; set; } = "xlsx";
        public bool Enabled { get; set; } = true;
        /// <summary>Only scheduled moments after this time can send. Set on every save, so the first send is the next scheduled time after saving.</summary>
        public DateTime StartsAfterUtc { get; set; } = DateTime.UtcNow;
        /// <summary>The period (day, week or month) that is finished: sent, skipped, or given up. Used to send once per period.</summary>
        [MaxLength(20)]
        public string? LastPeriodKey { get; set; }
        public DateTime? LastSentAt { get; set; }
        /// <summary>Sent, Skipped, Retrying or Failed.</summary>
        [MaxLength(20)]
        public string? LastStatus { get; set; }
        [MaxLength(500)]
        public string? LastError { get; set; }
        [MaxLength(20)]
        public string? PendingPeriodKey { get; set; }
        public int PendingAttempts { get; set; }
        public DateTime? LastAttemptAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
    }
}
