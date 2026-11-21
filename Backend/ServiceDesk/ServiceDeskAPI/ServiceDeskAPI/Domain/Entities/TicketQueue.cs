namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>A person's own saved list view: a name and the filter the web app applies (kept as JSON; the server only checks that it is a JSON object).</summary>
    public class SavedView
    {
        public Guid Id { get; set; }
        public Guid UserId { get; set; }
        public string Name { get; set; } = string.Empty;
        public string FilterJson { get; set; } = "{}";
        public bool IsFavourite { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
    }

    /// <summary>When this person last opened this ticket. A ticket is unread when someone else commented after that.</summary>
    public class TicketRead
    {
        public Guid TicketId { get; set; }
        public Guid UserId { get; set; }
        public DateTime LastReadAt { get; set; } = DateTime.UtcNow;
    }
}