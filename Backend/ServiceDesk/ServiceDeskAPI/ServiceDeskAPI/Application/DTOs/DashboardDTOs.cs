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

    /// <summary>New tickets nobody holds yet, in one category of the unit (the unit pool).</summary>
    public class DashboardPoolDto
    {
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public int Waiting { get; set; }
        public DateTime OldestWaitingAt { get; set; }
    }

    /// <summary>One member of the unit and the open tickets they hold.</summary>
    public class DashboardMemberDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public bool IsHead { get; set; }
        public int OpenTickets { get; set; }
        public int WaitingToStart { get; set; }
        public int Warning { get; set; }
        public int Overdue { get; set; }
        public int FarPast { get; set; }
        public bool OnLeave { get; set; }
        public DateOnly? LeaveUntil { get; set; }
    }

    /// <summary>One category of the unit: how many people can take it and how many open tickets it has.</summary>
    public class DashboardCategoryDto
    {
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public bool IsActive { get; set; }
        public int EligibleCount { get; set; }
        public int OpenTickets { get; set; }
        /// <summary>An active category with fewer than two eligible case workers.</summary>
        public bool NeedsCover { get; set; }
    }

    /// <summary>A ticket the head should look at. level: escalated, overdue or farPast.</summary>
    public class DashboardTicketDto
    {
        public Guid TicketId { get; set; }
        public string Reference { get; set; } = string.Empty;
        public string CategoryName { get; set; } = string.Empty;
        public string? AssigneeName { get; set; }
        public string Level { get; set; } = string.Empty;
        public DateTime Since { get; set; }
        /// <summary>For an escalation: why the case worker passed it up.</summary>
        public string? Note { get; set; }
    }

    /// <summary>What the head of a unit (or the HOD, Department Admin or Super Admin looking at that unit) needs: pool, team, categories, escalations, attention.</summary>
    public class UnitDashboardDto
    {
        public DateTime GeneratedAt { get; set; }
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
        public DashboardCountsDto Counts { get; set; } = new();
        public List<DashboardPoolDto> Pool { get; set; } = new();
        public List<DashboardMemberDto> Team { get; set; } = new();
        public List<DashboardCategoryDto> Categories { get; set; } = new();
        public List<DashboardTicketDto> Escalated { get; set; } = new();
        public List<DashboardTicketDto> Attention { get; set; } = new();
    }
    public class DashboardSummaryDto
    {
        public DateTime GeneratedAt { get; set; }
        public DashboardMineDto Mine { get; set; } = new();
        /// <summary>Null when the person does not oversee any unit (a case worker or a requester).</summary>
        public DashboardOverviewDto? Overview { get; set; }
    }
}
