namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>Counts business minutes: working days only, inside the working hours, minus holidays. Lagos has no daylight saving, so a fixed offset is enough.</summary>
    public sealed class BusinessClock
    {
        private readonly int _offsetHours;
        private readonly int _startHour;
        private readonly int _endHour;
        private readonly HashSet<DayOfWeek> _workDays;
        private readonly HashSet<DateOnly> _holidays;

        public BusinessClock(int offsetHours, int startHour, int endHour, IEnumerable<DayOfWeek> workDays, IEnumerable<DateOnly> holidays)
        {
            _offsetHours = offsetHours;
            _startHour = Math.Clamp(startHour, 0, 23);
            _endHour = Math.Clamp(endHour, _startHour + 1, 24);
            _workDays = new HashSet<DayOfWeek>(workDays);
            _holidays = new HashSet<DateOnly>(holidays);
        }

        public static BusinessClock From(SlaOptions o)
        {
            var days = (o.WorkDays ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(ParseDay).Where(d => d.HasValue).Select(d => d!.Value).ToList();
            if (days.Count == 0) days = new List<DayOfWeek> { DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday, DayOfWeek.Friday };
            var holidays = new List<DateOnly>();
            foreach (var h in o.Holidays ?? new List<string>())
                if (DateOnly.TryParse(h, System.Globalization.CultureInfo.InvariantCulture, out var d)) holidays.Add(d);
            return new BusinessClock(o.UtcOffsetHours, o.WorkdayStartHour, o.WorkdayEndHour, days, holidays);
        }

        private static DayOfWeek? ParseDay(string s) => s.Length < 3 ? null : s.Substring(0, 3).ToLowerInvariant() switch
        {
            "mon" => DayOfWeek.Monday, "tue" => DayOfWeek.Tuesday, "wed" => DayOfWeek.Wednesday, "thu" => DayOfWeek.Thursday,
            "fri" => DayOfWeek.Friday, "sat" => DayOfWeek.Saturday, "sun" => DayOfWeek.Sunday, _ => null
        };

        public bool IsWorkingDay(DateTime localDate) => _workDays.Contains(localDate.DayOfWeek) && !_holidays.Contains(DateOnly.FromDateTime(localDate));

        /// <summary>Business minutes between two UTC moments (0 when the end is not after the start).</summary>
        public double BusinessMinutes(DateTime fromUtc, DateTime toUtc)
        {
            if (toUtc <= fromUtc) return 0;
            var from = fromUtc.AddHours(_offsetHours);
            var to = toUtc.AddHours(_offsetHours);
            if ((to.Date - from.Date).TotalDays > 3650) to = from.AddDays(3650);
            double total = 0;
            for (var day = from.Date; day <= to.Date; day = day.AddDays(1))
            {
                if (!IsWorkingDay(day)) continue;
                var open = day.AddHours(_startHour);
                var close = day.AddHours(_endHour);
                var a = open > from ? open : from;
                var b = close < to ? close : to;
                if (b > a) total += (b - a).TotalMinutes;
            }
            return total;
        }
    }
}