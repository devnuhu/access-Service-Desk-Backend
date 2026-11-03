using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Domain.Entities
{
    /// <summary>Where the requester works (HQ at launch). Kept by the Super Admin; chosen on every ticket.</summary>
    public class Location
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public int SortOrder { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public Guid? CreatedByUserId { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
    }

    /// <summary>
    /// A request to a department (BRD Section 10). Reference is DEPT-YYYY-000001 per department and year (FR-2.5).
    /// The description is cleaned HTML from the rich-text editor; DescriptionText is its plain-text copy for search and the duplicate check.
    /// Assignment, SLA and workflow fields are added by later steps.
    /// </summary>
    public class Ticket
    {
        public Guid Id { get; set; }
        public string Reference { get; set; } = string.Empty;
        public Guid DepartmentId { get; set; }
        public Department? Department { get; set; }
        /// <summary>The unit that owned the category when the ticket was raised (routing target).</summary>
        public Guid UnitId { get; set; }
        public Unit? Unit { get; set; }
        public Guid CategoryId { get; set; }
        public Category? Category { get; set; }
        public Guid LocationId { get; set; }
        public Location? Location { get; set; }
        public Guid RequesterUserId { get; set; }
        public User? RequesterUser { get; set; }
        /// <summary>Who submitted it: the requester, or a Super Admin raising it on their behalf (FR-2.8).</summary>
        public Guid RaisedByUserId { get; set; }
        /// <summary>The requester's own department from AD at the time (reporting only).</summary>
        public string? RequesterDepartment { get; set; }
        public string Subject { get; set; } = string.Empty;
        public string DescriptionHtml { get; set; } = string.Empty;
        public string DescriptionText { get; set; } = string.Empty;
        public TicketPriority Priority { get; set; } = TicketPriority.Medium;
        public TicketStatus Status { get; set; } = TicketStatus.New;
        public Guid? AssigneeUserId { get; set; }
        public User? AssigneeUser { get; set; }
        public DateTime? AssignedAt { get; set; }
        /// <summary>When the unit's head was told that nobody could take it (once per wait; cleared on assignment).</summary>
        public DateTime? QueueAlertedAt { get; set; }
        /// <summary>When the unit's head was told the assignee is away while the ticket is in progress (cleared on reassignment).</summary>
        public DateTime? AssigneeAwayFlaggedAt { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? UpdatedAt { get; set; }
        public Guid? UpdatedByUserId { get; set; }
        /// <summary>Optimistic concurrency (two people changing the same ticket).</summary>
        public byte[] RowVersion { get; set; } = Array.Empty<byte>();

        public ICollection<TicketWatcher> Watchers { get; set; } = new List<TicketWatcher>();
        public ICollection<TicketComment> Comments { get; set; } = new List<TicketComment>();
        public ICollection<TicketAttachment> Attachments { get; set; } = new List<TicketAttachment>();
    }

    /// <summary>A colleague copied on the ticket (FR-2.6): notified and able to view it.</summary>
    public class TicketWatcher
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid UserId { get; set; }
        public User? User { get; set; }
        public DateTime AddedAt { get; set; } = DateTime.UtcNow;
        public Guid? AddedByUserId { get; set; }
    }

    /// <summary>A public comment (seen by the requester and those copied) or an internal note (department staff only) (FR-4.1).</summary>
    public class TicketComment
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        public Guid AuthorUserId { get; set; }
        public User? AuthorUser { get; set; }
        public string BodyHtml { get; set; } = string.Empty;
        public string BodyText { get; set; } = string.Empty;
        public bool IsInternal { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>File details. The bytes live in TicketAttachmentContents so lists never load them.</summary>
    public class TicketAttachment
    {
        public Guid Id { get; set; }
        public Guid TicketId { get; set; }
        public Ticket? Ticket { get; set; }
        /// <summary>Set when the file came with a comment (an internal note's files are internal too).</summary>
        public Guid? CommentId { get; set; }
        public TicketComment? Comment { get; set; }
        public string FileName { get; set; } = string.Empty;
        public string ContentType { get; set; } = string.Empty;
        public long SizeBytes { get; set; }
        public string Sha256 { get; set; } = string.Empty;
        public Guid UploadedByUserId { get; set; }
        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    }

    public class TicketAttachmentContent
    {
        public Guid AttachmentId { get; set; }
        public byte[] Data { get; set; } = Array.Empty<byte>();
    }

    /// <summary>The last reference number used per department and year.</summary>
    public class TicketSequence
    {
        public Guid DepartmentId { get; set; }
        public int Year { get; set; }
        public int LastNumber { get; set; }
    }
}