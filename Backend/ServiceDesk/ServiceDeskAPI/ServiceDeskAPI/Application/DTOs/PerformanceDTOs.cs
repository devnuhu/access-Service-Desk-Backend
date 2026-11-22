namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>
    /// preset: today, last7, last30, thismonth (default), lastmonth, thisquarter, thisyear, all. Or from and to (yyyy-MM-dd) for a custom range, which wins over the preset.
    /// </summary>
    public class PerformanceQuery
    {
        public string? Preset { get; set; }
        public string? From { get; set; }
        public string? To { get; set; }
    }

    /// <summary>
    /// The figures for a person, or for a whole unit. All times are business hours. Percentages are null when there is nothing to measure.
    /// Resolution figures cover tickets resolved in the period; first-response figures cover tickets raised in the period and held by the person;
    /// Assigned and Resolved are counted by their own dates; OpenNow and OnHold are right now, whatever the period.
    /// </summary>
    public class PerformanceFigures
    {
        public int Assigned { get; set; }
        public int Resolved { get; set; }
        public int OpenNow { get; set; }
        /// <summary>Pending: waiting on the requester or a third party.</summary>
        public int OnHold { get; set; }
        /// <summary>Of the tickets resolved in the period, how many went past their deadline.</summary>
        public int ResolvedLate { get; set; }
        public double? WithinSlaPercent { get; set; }
        public double? AvgResolutionHours { get; set; }
        public double? AvgFirstResponseHours { get; set; }
        public double? RespondedInTimePercent { get; set; }
        public int NoResponseInTime { get; set; }
        public double? ReopenedPercent { get; set; }
    }

    /// <summary>One bar or point of a chart. Date is yyyy-MM-dd for a day, the Monday of the week for a week, yyyy-MM for a month. Gaps are filled with zeros.</summary>
    public class PerformancePoint
    {
        public string Date { get; set; } = string.Empty;
        public int Assigned { get; set; }
        public int Resolved { get; set; }
        public int Raised { get; set; }
        public double? WithinSlaPercent { get; set; }
    }

    public record PerformanceCount(string Label, int Count);

    /// <summary>The first-response and resolution targets (business hours) for a priority. Priority 1 Low, 2 Medium, 3 High, 4 Critical.</summary>
    public record PerformanceTarget(int Priority, string PriorityName, int ResponseHours, int ResolutionHours);

    /// <summary>The period the figures cover (the dates after presets are worked out; null for all time) and how the series is cut: day, week or month.</summary>
    public class PerformancePeriodDto
    {
        public string? From { get; set; }
        public string? To { get; set; }
        public string Bucket { get; set; } = "day";
    }

    /// <summary>One person. Team: the averages of the unit or units they belong to, to compare with (efficiency figures only); null when they are in no unit.</summary>
    public class PerformanceDto
    {
        public PerformancePeriodDto Period { get; set; } = new();
        public Guid UserId { get; set; }
        public string Name { get; set; } = string.Empty;
        public PerformanceFigures Figures { get; set; } = new();
        public PerformanceFigures? Team { get; set; }
        public List<PerformancePoint> Series { get; set; } = new();
        /// <summary>Open tickets right now by status, only the statuses that have some.</summary>
        public List<PerformanceCount> OpenByStatus { get; set; } = new();
        public List<PerformanceTarget> Targets { get; set; } = new();
    }

    /// <summary>A member of a unit. UserId is null for someone no longer in the unit who still has tickets in the figures (or when two people share a name).</summary>
    public class PerformanceMemberDto
    {
        public Guid? UserId { get; set; }
        public string Name { get; set; } = string.Empty;
        public bool IsHead { get; set; }
        public PerformanceFigures Figures { get; set; } = new();
    }

    public class CategoryPerformanceDto
    {
        public string Name { get; set; } = string.Empty;
        public int Tickets { get; set; }
        public double? AvgResolutionHours { get; set; }
        public double? WithinSlaPercent { get; set; }
    }

    /// <summary>A unit: its totals, every member (idle ones too), the trend, the open tickets split three ways, and its busiest categories.</summary>
    public class UnitPerformanceDto
    {
        public PerformancePeriodDto Period { get; set; } = new();
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public PerformanceFigures Figures { get; set; } = new();
        public List<PerformanceMemberDto> Members { get; set; } = new();
        public List<PerformancePoint> Series { get; set; } = new();
        public List<PerformanceCount> OpenByStatus { get; set; } = new();
        /// <summary>Critical, High, Medium, Low.</summary>
        public List<PerformanceCount> OpenByPriority { get; set; } = new();
        /// <summary>Under 1 day, 1 to 2 days, 3 to 5 days, 6 to 10 days, Over 10 days.</summary>
        public List<PerformanceCount> OpenByAge { get; set; } = new();
        /// <summary>The 8 categories with the most tickets raised in the period.</summary>
        public List<CategoryPerformanceDto> Categories { get; set; } = new();
        public List<PerformanceTarget> Targets { get; set; } = new();
    }
}