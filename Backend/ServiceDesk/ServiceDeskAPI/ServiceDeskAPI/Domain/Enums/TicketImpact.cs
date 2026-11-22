namespace ServiceDeskAPI.Domain.Enums
{
    /// <summary>Who a request affects, as the requester answers it. The priority matrix turns impact and urgency into a priority.</summary>
    public enum TicketImpact
    {
        JustMe = 1,
        MyTeam = 2,
        MyDepartment = 3,
        WholeCompany = 4
    }

    /// <summary>How soon the requester needs it.</summary>
    public enum TicketUrgency
    {
        CanWait = 1,
        Soon = 2,
        Urgent = 3,
        CannotWork = 4
    }
}