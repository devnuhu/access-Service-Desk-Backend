using System.Globalization;
using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Infrastructure.Sla;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>Settings under "ReportSchedules". Working days, holidays and the Lagos offset are the Sla settings.</summary>
    public class ReportScheduleOptions
    {
        public bool WorkerEnabled { get; set; } = true;
        public int CheckMinutes { get; set; } = 5;
        /// <summary>How many hours after the chosen hour a late start can still send (so a restart at 09:30 does not lose the 08:00 report).</summary>
        public int WindowHours { get; set; } = 4;
        /// <summary>Tries per period before the period is given up.</summary>
        public int MaxAttempts { get; set; } = 3;
        public int MaxPerPerson { get; set; } = 10;
        /// <summary>A bigger file is not attached; the email says so and the person opens the report in the app.</summary>
        public int MaxAttachmentMb { get; set; } = 8;
        public string LinkPath { get; set; } = "/reports";
    }

    /// <summary>When a schedule is due. Pure functions, so the rules can be tested without a clock.</summary>
    public static class ReportScheduleTimes
    {
        public static bool Qualifies(ReportSchedule s, DateTime localDate, BusinessClock clock) => s.Frequency switch
        {
            ReportFrequency.Daily => clock.IsWorkingDay(localDate),
            ReportFrequency.Weekly => localDate.DayOfWeek == s.WeekDay,
            ReportFrequency.Custom => clock.IsWorkingDay(localDate) && (s.DaysMask & (1 << (int)localDate.DayOfWeek)) != 0,
            _ => localDate.Day == s.DayOfMonth
        };

        public static string Key(ReportSchedule s, DateTime localDate) => s.Frequency switch
        {
            ReportFrequency.Daily or ReportFrequency.Custom => "D-" + localDate.ToString("yyyyMMdd", CultureInfo.InvariantCulture),
            ReportFrequency.Weekly => "W-" + ISOWeek.GetYear(localDate).ToString(CultureInfo.InvariantCulture) + ISOWeek.GetWeekOfYear(localDate).ToString("00", CultureInfo.InvariantCulture),
            _ => "M-" + localDate.ToString("yyyyMM", CultureInfo.InvariantCulture)
        };

        /// <summary>The period that is due at this moment, or null: today must qualify, the Lagos time must be inside the send window, and the scheduled moment must be after the save.</summary>
        public static (string Key, DateTime ScheduledUtc)? Due(ReportSchedule s, DateTime nowUtc, int offsetHours, int windowHours, BusinessClock clock)
        {
            var local = nowUtc.AddHours(offsetHours);
            var date = local.Date;
            if (!Qualifies(s, date, clock)) return null;
            var scheduledLocal = date.AddHours(Math.Clamp(s.SendHour, 0, 23));
            if (local < scheduledLocal || local >= scheduledLocal.AddHours(Math.Clamp(windowHours, 1, 12))) return null;
            var scheduledUtc = scheduledLocal.AddHours(-offsetHours);
            if (scheduledUtc <= s.StartsAfterUtc) return null;
            return (Key(s, date), scheduledUtc);
        }

        /// <summary>The next scheduled moment (UTC) after now and after the save, looking ahead up to two months. Null when none.</summary>
        public static DateTime? NextUtc(ReportSchedule s, DateTime nowUtc, int offsetHours, BusinessClock clock)
        {
            var from = nowUtc > s.StartsAfterUtc ? nowUtc : s.StartsAfterUtc;
            var local = from.AddHours(offsetHours);
            for (var d = 0; d <= 62; d++)
            {
                var date = local.Date.AddDays(d);
                if (!Qualifies(s, date, clock)) continue;
                var scheduledUtc = date.AddHours(Math.Clamp(s.SendHour, 0, 23)).AddHours(-offsetHours);
                if (scheduledUtc > from) return DateTime.SpecifyKind(scheduledUtc, DateTimeKind.Utc);
            }
            return null;
        }
    }
}
