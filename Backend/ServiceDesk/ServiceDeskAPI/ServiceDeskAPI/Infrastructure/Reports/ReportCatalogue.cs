using ServiceDeskAPI.Application.DTOs;

namespace ServiceDeskAPI.Infrastructure.Reports
{
    /// <summary>What reports can show, and the built-in reports R1 to R9 (these are ordinary definitions: open one, change it, save it as your own).</summary>
    public static class ReportCatalogue
    {
        public static readonly string[] OpenStatusNames = { "New", "Assigned", "InProgress", "Pending", "Reopened" };

        public static readonly ReportMeasureInfo[] Measures =
        {
            new("count", "Tickets", "number", "Tickets in the period (by the chosen date)."),
            new("open", "Open", "number", "Still open: New, Assigned, In progress, Pending or Reopened."),
            new("resolved", "Resolved", "number", "Resolved or closed."),
            new("closed", "Closed", "number", "Closed."),
            new("cancelled", "Cancelled", "number", "Cancelled by the requester."),
            new("unassigned", "Unassigned", "number", "Open and nobody holds it."),
            new("breached", "Past deadline", "number", "Tickets that used more than their time allowed (business hours; Pending and Resolved time not counted)."),
            new("breachedPercent", "Past deadline %", "percent", "Past deadline as a share of tickets."),
            new("withinSlaPercent", "Within time %", "percent", "Of resolved or closed tickets, the share finished within the time allowed."),
            new("avgResolutionHours", "Average time to resolve (business hours)", "hours", "Business hours used by resolved or closed tickets, not counting Pending time."),
            new("avgFirstResponseHours", "Average first response (business hours)", "hours", "Business hours from raising to the first answer."),
            new("respondedPercent", "Answered %", "percent", "Share of tickets someone has answered."),
            new("reopened", "Reopened", "number", "Tickets reopened at least once."),
            new("escalated", "Escalated to head", "number", "Tickets the assignee escalated to the unit head."),
            new("raised", "Raised", "number", "Tickets raised in the period (by raising date, always)."),
            new("resolvedInPeriod", "Resolved in period", "number", "Tickets resolved in the period (by resolving date, always)."),
            new("closedInPeriod", "Closed in period", "number", "Tickets closed in the period (by closing date, always)."),
            new("firstResponseMetPercent", "Responded in time %", "percent", "Of the tickets that reached a case worker, the share they acknowledged or answered within the first-response time (4 business hours from when it was assigned to them)."),
            new("firstResponseMissed", "No response in time", "number", "Tickets where the case worker did not acknowledge or answer within the first-response time. Grouped by person it counts against the person who missed it."),
            new("reopenedPercent", "Reopened %", "percent", "Share of tickets reopened at least once.")
        };

        public static readonly ReportOption[] GroupBys =
        {
            new("none", "No grouping"), new("day", "Day"), new("week", "Week"), new("month", "Month"), new("unit", "Unit"),
            new("category", "Category"), new("department", "Department"), new("assignee", "Person"), new("status", "Status"),
            new("priority", "Priority"), new("resolutionCode", "How it was resolved"), new("age", "Age of the ticket")
        };

        public static readonly ReportColumnDto[] Columns =
        {
            new("reference", "Reference", "text"), new("subject", "Subject", "text"), new("department", "Department", "text"),
            new("unit", "Unit", "text"), new("category", "Category", "text"), new("priority", "Priority", "text"),
            new("status", "Status", "text"), new("requester", "Requester", "text"), new("assignee", "Assigned to", "text"),
            new("createdAt", "Raised", "datetime"), new("firstRespondedAt", "First answered", "datetime"),
            new("resolvedAt", "Resolved", "datetime"), new("closedAt", "Closed", "datetime"),
            new("resolutionCode", "How it was resolved", "text"), new("reopenCount", "Times reopened", "number"),
            new("escalated", "Escalated to head", "boolean"), new("usedPercent", "Time used %", "percent"),
            new("breached", "Past deadline", "boolean")
        };

        public static readonly ReportColumnDto[] LeaveColumns =
        {
            new("person", "Person", "text"), new("unit", "Unit", "text"), new("kind", "Kind", "text"),
            new("startDate", "From", "date"), new("endDate", "To", "date"), new("workingDays", "Working days", "number"),
            new("openTicketsHeld", "Open tickets they hold", "number"), new("status", "Status", "text")
        };

        public static readonly ReportOption[] Presets =
        {
            new("today", "Today"), new("last7", "Last 7 days"), new("last30", "Last 30 days"), new("thisMonth", "This month"),
            new("lastMonth", "Last month"), new("thisQuarter", "This quarter"), new("thisYear", "This year"), new("all", "All time")
        };

        public static readonly ReportOption[] DateFields = { new("created", "Date raised"), new("resolved", "Date resolved"), new("closed", "Date closed") };

        public static readonly ReportOption[] Charts = { new("table", "Table"), new("bar", "Bar"), new("line", "Line"), new("pie", "Pie") };

        public static List<BuiltInReportDto> BuiltIns() => new()
        {
            Make("R1", "Raised and resolved", "Tickets raised, resolved and closed each day.",
                new ReportSpec { Title = "Raised and resolved", Preset = "last30", GroupBy = "day", Measures = new() { "raised", "resolvedInPeriod", "closedInPeriod" }, Chart = "line", SortDescending = false }),
            Make("R2", "Open tickets by age", "Every open ticket, grouped by how long ago it was raised.",
                new ReportSpec { Title = "Open tickets by age", Preset = "all", GroupBy = "age", Statuses = OpenStatusNames.ToList(), Measures = new() { "count", "unassigned" }, Chart = "bar" }),
            Make("R3", "SLA compliance", "Share of tickets finished within the time allowed, by unit.",
                new ReportSpec { Title = "SLA compliance", Preset = "last30", GroupBy = "unit", Measures = new() { "count", "resolved", "withinSlaPercent", "breachedPercent", "avgResolutionHours" }, Chart = "bar" }),
            Make("R4", "SLA breaches", "Every ticket past its deadline, and who holds it.",
                new ReportSpec { Title = "SLA breaches", Preset = "last30", Mode = "list", SlaBreached = true,
                    Columns = new() { "reference", "subject", "unit", "category", "assignee", "status", "createdAt", "usedPercent" }, SortBy = "usedPercent" }),
            Make("R5", "Workload per person", "Tickets held, resolved and past deadline for each person.",
                new ReportSpec { Title = "Workload per person", Preset = "last30", GroupBy = "assignee", Measures = new() { "count", "open", "resolved", "avgResolutionHours", "breached" }, Chart = "bar" }),
            Make("R6", "Tickets by category", "Volume and speed for each category.",
                new ReportSpec { Title = "Tickets by category", Preset = "last30", GroupBy = "category", Measures = new() { "count", "resolved", "avgResolutionHours", "withinSlaPercent" }, Chart = "bar" }),
            Make("R7", "First response time", "How quickly tickets are first answered, by unit.",
                new ReportSpec { Title = "First response time", Preset = "last30", GroupBy = "unit", Measures = new() { "count", "respondedPercent", "avgFirstResponseHours" }, Chart = "bar" }),
            Make("R8", "Escalations and reopened tickets", "Tickets escalated to the head or reopened, by unit.",
                new ReportSpec { Title = "Escalations and reopened tickets", Preset = "last30", GroupBy = "unit", Measures = new() { "count", "escalated", "reopened" }, Chart = "bar" }),
            Make("R9", "Leave and cover", "Who is or was away, and how many open tickets they hold.",
                new ReportSpec { Title = "Leave and cover", Source = "leave", Mode = "list", Preset = "thisYear", SortBy = "startDate" }),
            Make("R10", "Team performance", "Each case worker: tickets, resolved, average time to resolve, finished within time, answered in time and reopened.",
                new ReportSpec { Title = "Team performance", Preset = "last30", GroupBy = "assignee", Measures = new() { "count", "resolved", "avgResolutionHours", "withinSlaPercent", "firstResponseMetPercent", "firstResponseMissed", "reopenedPercent" }, Chart = "table" }),
            Make("R11", "Unit performance", "Each unit: tickets, resolved, average time to resolve, finished within time, answered in time and reopened.",
                new ReportSpec { Title = "Unit performance", Preset = "last30", GroupBy = "unit", Measures = new() { "count", "resolved", "avgResolutionHours", "withinSlaPercent", "firstResponseMetPercent", "firstResponseMissed", "reopenedPercent" }, Chart = "table" })
        };

        private static BuiltInReportDto Make(string code, string name, string description, ReportSpec definition) =>
            new() { Code = code, Name = name, Description = description, Definition = definition };
    }
}
