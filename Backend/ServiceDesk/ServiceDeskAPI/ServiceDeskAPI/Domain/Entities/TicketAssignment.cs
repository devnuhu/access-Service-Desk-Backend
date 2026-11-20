namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>How a ticket reached its assignee (BRD FR-3.10).</summary>
    public enum AssignmentMethod
    {
        /// <summary>The engine chose (lowest weighted workload, then least recently assigned).</summary>
        Auto = 1,
        /// <summary>A person moved it (the holder, the Head of Unit, the HOD or a Super Admin), with a reason.</summary>
        Reassigned = 2,
        /// <summary>A member or the head took it from the unit pool.</summary>
        Picked = 3
    }

    /// <summary>
    /// One assignment of a ticket: who had it, who got it, how, why, and (for Auto) the workload of every eligible case worker
    /// at that moment, so any assignment can be explained later (FR-3.10).
    /// </summary>
    public class TicketAssignment
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid? FromUserId { get; set; }
        public Guid ToUserId { get; set; }
        public AssignmentMethod Method { get; set; }
        /// <summary>Auto: what started it (raised, retry, assignee away). Reassigned: the reason given.</summary>
        public string Reason { get; set; } = string.Empty;
        /// <summary>Who reassigned it; null for the engine.</summary>
        public Guid? ByUserId { get; set; }
        public Guid FromUnitId { get; set; }
        public Guid ToUnitId { get; set; }
        /// <summary>JSON list of { userId, userName, workload, openTickets, lastAssignedAt, chosen } for every eligible case worker.</summary>
        public string? ScoresJson { get; set; }
        public DateTime At { get; set; } = DateTime.UtcNow;
    }
}