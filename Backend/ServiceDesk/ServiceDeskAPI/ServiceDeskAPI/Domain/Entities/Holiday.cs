namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>A company holiday: the SLA clock does not run on this date. Kept by the Super Admin; the Sla:Holidays setting still works too.</summary>
    public class Holiday
    {
        public Guid Id { get; set; }
        public DateOnly Date { get; set; }
        public string Name { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
    }
}