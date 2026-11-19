namespace ServiceDeskAPI.Application.DTOs
{
    public record ReportProblem(int Status, string Message);

    /// <summary>
    /// A report definition (Step 9). The same shape runs the built-in reports R1 to R9 and the reports people build and save.
    /// Dates are Lagos dates. Preset (today, last7, last30, thisMonth, lastMonth, thisQuarter, thisYear, all) wins over From and To.
    /// </summary>
    public class ReportSpec
    {
        public string? Title { get; set; }
        /// <summary>tickets (default) or leave (who is away and what they hold).</summary>
        public string Source { get; set; } = "tickets";
        /// <summary>summary (grouped numbers) or list (one row per ticket).</summary>
        public string Mode { get; set; } = "summary";
        public string? Preset { get; set; }
        /// <summary>yyyy-MM-dd</summary>
        public string? From { get; set; }
        /// <summary>yyyy-MM-dd</summary>
        public string? To { get; set; }
        /// <summary>Which date the range applies to: created (default), resolved or closed.</summary>
        public string DateField { get; set; } = "created";
        public Guid? DepartmentId { get; set; }
        public List<Guid> UnitIds { get; set; } = new();
        public List<Guid> CategoryIds { get; set; } = new();
        public List<Guid> AssigneeIds { get; set; } = new();
        /// <summary>Status names, for example InProgress.</summary>
        public List<string> Statuses { get; set; } = new();
        public List<string> Priorities { get; set; } = new();
        public bool? Escalated { get; set; }
        public bool? SlaBreached { get; set; }
        /// <summary>none, day, week, month, unit, category, department, assignee, status, priority, resolutionCode, age.</summary>
        public string GroupBy { get; set; } = "none";
        public List<string> Measures { get; set; } = new();
        public List<string> Columns { get; set; } = new();
        /// <summary>A column key, or group.</summary>
        public string? SortBy { get; set; }
        public bool SortDescending { get; set; } = true;
        public int? Limit { get; set; }
        /// <summary>A hint for the screen: table, bar, line, pie.</summary>
        public string Chart { get; set; } = "table";
    }

    /// <summary>Type is text, number, percent, hours, date, datetime or boolean.</summary>
    public record ReportColumnDto(string Key, string Label, string Type);

    public class ReportResultDto
    {
        public string Title { get; set; } = string.Empty;
        public string Source { get; set; } = "tickets";
        public string Mode { get; set; } = "summary";
        public string Chart { get; set; } = "table";
        public string? From { get; set; }
        public string? To { get; set; }
        public List<ReportColumnDto> Columns { get; set; } = new();
        /// <summary>One list of values per row, in the order of Columns. Dates are ISO text.</summary>
        public List<List<object?>> Rows { get; set; } = new();
        /// <summary>Summary reports with a grouping: the figure for all rows together, in the order of Columns.</summary>
        public List<object?>? Totals { get; set; }
        public bool Truncated { get; set; }
        public DateTime GeneratedAt { get; set; }
    }

    public record ReportMeasureInfo(string Key, string Label, string Type, string Description);

    public record ReportOption(string Key, string Label);

    public class BuiltInReportDto
    {
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public ReportSpec Definition { get; set; } = new();
    }

    public class ReportCatalogueDto
    {
        public List<ReportMeasureInfo> Measures { get; set; } = new();
        public List<ReportOption> GroupBys { get; set; } = new();
        public List<ReportColumnDto> Columns { get; set; } = new();
        public List<ReportColumnDto> LeaveColumns { get; set; } = new();
        public List<ReportOption> Presets { get; set; } = new();
        public List<ReportOption> DateFields { get; set; } = new();
        public List<ReportOption> Charts { get; set; } = new();
        public List<BuiltInReportDto> BuiltIn { get; set; } = new();
    }
}
