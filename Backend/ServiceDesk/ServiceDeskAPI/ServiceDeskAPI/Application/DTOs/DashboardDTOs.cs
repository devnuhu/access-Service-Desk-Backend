namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>Counts of OPEN tickets (New, Assigned, In progress, Pending, Reopened). A ticket is counted once at its highest SLA level.</summary>
    public class DashboardCountsDto
    {
        public int Open { get; set; }
        /// <summary>Assigned or Reopened, and not yet picked up.</summary>
        public int WaitingToStart { get; set; }
        /// <summary>Open and nobody holds it.</summary>
        public int Unassigned { get; set; }
        /// <summary>Half the time used, not yet past the deadline.</summary>
        public int Warning { get; set; }
        /// <summary>Past the deadline, not yet far past.</summary>
        public int Overdue { get; set; }
        /// <summary>Far past the deadline (the Head of Department has been told).</summary>
        public int FarPast { get; set; }
        /// <summary>Escalated to the unit head.</summary>
        public int Escalated { get; set; }
    }

    public class DashboardUnitDto : DashboardCountsDto
    {
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
    }

    public class DashboardOverviewDto
    {
        public DashboardCountsDto Total { get; set; } = new();
        public List<DashboardUnitDto> Units { get; set; } = new();
    }

    /// <summary>The person's own work.</summary>
    public class DashboardMineDto
    {
        /// <summary>Open tickets assigned to the person.</summary>
        public int Open { get; set; }
        public int WaitingToStart { get; set; }
        public int Warning { get; set; }
        public int Overdue { get; set; }
        public int FarPast { get; set; }
        /// <summary>Open tickets the person raised.</summary>
        public int RaisedOpen { get; set; }
        /// <summary>Tickets the person raised that are Resolved and wait for them to confirm or reopen.</summary>
        public int ToConfirm { get; set; }
    }

    public class DashboardSummaryDto
    {
        public DateTime GeneratedAt { get; set; }
        public DashboardMineDto Mine { get; set; } = new();
        /// <summary>Null when the person does not oversee any unit (a case worker or a requester).</summary>
        public DashboardOverviewDto? Overview { get; set; }
    }
}
