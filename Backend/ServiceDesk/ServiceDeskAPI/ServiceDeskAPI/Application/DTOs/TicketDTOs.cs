using ServiceDeskAPI.Domain.Entities;
using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Application.DTOs
{
    // ---------------- locations ----------------

    public record LocationDto(Guid Id, string Name, int SortOrder, bool IsActive);

    /// <summary>Active locations for the ticket form, and the one to pre-select (the person's last ticket's location, or the only one).</summary>
    public class LocationChoicesDto
    {
        public List<LocationDto> Locations { get; set; } = new();
        public Guid? DefaultLocationId { get; set; }
    }

    public class SaveLocationRequest
    {
        public string? Name { get; set; }
        public int? SortOrder { get; set; }
        public bool? IsActive { get; set; }
    }

    // ---------------- raising ----------------

    /// <summary>
    /// Sent as multipart/form-data: the fields below plus 0 to 6 files named "files" (each at most 1 MB; PDF, DOCX, XLSX, CSV, JPG, PNG).
    /// descriptionHtml comes from the rich-text editor and is cleaned on the server.
    /// </summary>
    public class CreateTicketRequest
    {
        public Guid CategoryId { get; set; }
        public Guid LocationId { get; set; }
        /// <summary>1 Low, 2 Medium, 3 High, 4 Critical. Left out: the category's default.</summary>
        public TicketPriority? Priority { get; set; }
        public string Subject { get; set; } = string.Empty;
        public string DescriptionHtml { get; set; } = string.Empty;
        /// <summary>Colleagues to copy (FR-2.6).</summary>
        public List<Guid> CcUserIds { get; set; } = new();
        /// <summary>Super Admin only: raise it for this person (FR-2.8).</summary>
        public Guid? RequesterUserId { get; set; }
        public List<IFormFile> Files { get; set; } = new();
    }

    /// <summary>Possible duplicates (FR-2.7): same category, an RSA PIN found in the subject or description, raised in the last 7 days and still open.</summary>
    public class DuplicateCheckRequest
    {
        public Guid CategoryId { get; set; }
        public string? Subject { get; set; }
        public string? DescriptionHtml { get; set; }
    }

    public class DuplicateCheckDto
    {
        /// <summary>The RSA PINs found, masked except the last four digits.</summary>
        public List<string> PinsFound { get; set; } = new();
        public List<DuplicateTicketDto> Matches { get; set; } = new();
    }

    public record DuplicateTicketDto(string Reference, TicketStatus Status, DateTime CreatedAt, bool IsYours);

    // ---------------- reading ----------------

    public record PersonDto(Guid UserId, string UserName, string? FullName);

    public class TicketListItemDto
    {
        public Guid Id { get; set; }
        public string Reference { get; set; } = string.Empty;
        public string Subject { get; set; } = string.Empty;
        public string DepartmentCode { get; set; } = string.Empty;
        public string CategoryName { get; set; } = string.Empty;
        public string UnitName { get; set; } = string.Empty;
        public string LocationName { get; set; } = string.Empty;
        public TicketPriority Priority { get; set; }
        public TicketStatus Status { get; set; }
        public PersonDto Requester { get; set; } = new(Guid.Empty, string.Empty, null);
        public PersonDto? Assignee { get; set; }
        /// <summary>When the current assignee got it (Step 6).</summary>
        public DateTime? AssignedAt { get; set; }
        /// <summary>When someone first answered the requester (acknowledged or commented); null until then.</summary>
        public DateTime? FirstRespondedAt { get; set; }
        /// <summary>Staff only: when the assignee asked the unit's head for help. Null in the requester's lists.</summary>
        public DateTime? EscalatedToHeadAt { get; set; }
        /// <summary>Staff only, and only while the ticket is open: 0 OnTrack, 1 Warning, 2 Overdue, 3 FarPast. Everyone else always gets 0.</summary>
        public SlaLevel SlaLevel { get; set; }
        /// <summary>Staff only, and only while the ticket is running (New, Assigned, In progress, Reopened): when the time allowed runs out (UTC). Null otherwise.</summary>
        public DateTime? SlaDueAt { get; set; }

        /// <summary>For the signed-in person: someone else commented since they last opened the ticket, or it was assigned to them and never opened.</summary>
        public bool Unread { get; set; }
        /// <summary>Comments typed by people that this person can see (internal notes count for staff only).</summary>
        public int CommentCount { get; set; }
        /// <summary>Files on the ticket and its comments that this person can see.</summary>
        public int AttachmentCount { get; set; }
        public DateTime? LastCommentAt { get; set; }
        /// <summary>The last comment this person can see was written by the requester: the ticket is waiting for staff to answer.</summary>
        public bool LastCommentByRequester { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }

    public class TicketPageDto
    {
        public List<TicketListItemDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }

    public class TicketAttachmentDto
    {
        public Guid Id { get; set; }
        public Guid? CommentId { get; set; }
        public string FileName { get; set; } = string.Empty;
        public string ContentType { get; set; } = string.Empty;
        public long SizeBytes { get; set; }
        public PersonDto UploadedBy { get; set; } = new(Guid.Empty, string.Empty, null);
        public DateTime UploadedAt { get; set; }
    }

    public class TicketCommentDto
    {
        public Guid Id { get; set; }
        public PersonDto Author { get; set; } = new(Guid.Empty, string.Empty, null);
        public string BodyHtml { get; set; } = string.Empty;
        public bool IsInternal { get; set; }
        /// <summary>0 Comment (typed by a person), 1 Workflow (written by the system for an action on the ticket).</summary>
        public CommentKind Kind { get; set; }
        public DateTime CreatedAt { get; set; }
        public List<TicketAttachmentDto> Attachments { get; set; } = new();
    }

    public class TicketDetailDto : TicketListItemDto
    {
        public Guid DepartmentId { get; set; }
        public string DepartmentName { get; set; } = string.Empty;
        public Guid CategoryId { get; set; }
        public Guid UnitId { get; set; }
        public Guid LocationId { get; set; }
        public string? RequesterDepartment { get; set; }
        public PersonDto RaisedBy { get; set; } = new(Guid.Empty, string.Empty, null);
        public string DescriptionHtml { get; set; } = string.Empty;
        public List<PersonDto> Cc { get; set; } = new();
        /// <summary>Files sent with the ticket itself (comment files are under each comment).</summary>
        public List<TicketAttachmentDto> Attachments { get; set; } = new();
        /// <summary>Oldest first. Internal notes only for department staff and Super Admin.</summary>
        public List<TicketCommentDto> Comments { get; set; } = new();
        /// <summary>The signed-in person works in the ticket's department (or is Super Admin): sees internal notes.</summary>
        public bool IsStaffView { get; set; }
        public bool CanComment { get; set; }
        public bool CanAddInternalNote { get; set; }

        // ---- workflow (Step 6); what the signed-in person may do: GET /api/tickets/{id}/actions ----
        public DateTime? AcknowledgedAt { get; set; }
        /// <summary>1 waiting on the requester, 2 waiting on a third party.</summary>
        public PendingReason? PendingReason { get; set; }
        public DateTime? PendingSince { get; set; }
        public DateTime? ResolvedAt { get; set; }
        /// <summary>1 Completed, 2 Information provided, 3 Referred elsewhere, 4 Duplicate, 5 No action required.</summary>
        public ResolutionCode? ResolutionCode { get; set; }
        public string? ResolutionNote { get; set; }
        public DateTime? ClosedAt { get; set; }
        public DateTime? CancelledAt { get; set; }
        public int ReopenCount { get; set; }
        /// <summary>Staff only: when the assignee asked the unit's head for help, and why. Null for everyone else.</summary>

        public string? EscalatedToHeadReason { get; set; }
        /// <summary>Staff only: when the warning, the overdue alert and the Head of Department alert were sent. Null until then.</summary>
        public DateTime? SlaWarnedAt { get; set; }
        public DateTime? SlaBreachedAt { get; set; }
        public DateTime? SlaL2At { get; set; }
    }

    /// <summary>multipart/form-data: bodyHtml, isInternal, and 0 to 6 files named "files".</summary>
    public class AddCommentRequest
    {
        public string BodyHtml { get; set; } = string.Empty;
        public bool IsInternal { get; set; }
        public List<IFormFile> Files { get; set; } = new();
    }

    /// <summary>Counts of open tickets by SLA level, for the oversight screens (a ticket is counted once, at its highest level).</summary>
    public class SlaSummaryDto
    {
        public int Open { get; set; }
        public int Warning { get; set; }
        public int Overdue { get; set; }
        public int FarPast { get; set; }
        /// <summary>Open tickets nobody holds yet.</summary>
        public int Unassigned { get; set; }
    }
    public record CreatedTicketDto(Guid Id, string Reference, string Message);
}