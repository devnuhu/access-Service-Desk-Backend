using ServiceDeskAPI.Domain.Entities;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>One eligible case worker's position when the engine chose (FR-3.10).</summary>
    public class CandidateScoreDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        /// <summary>Open tickets weighted by priority: Critical 3, High 2, Medium 1, Low 1 (Assigned, In progress, Reopened).</summary>
        public int Workload { get; set; }
        public int OpenTickets { get; set; }
        public DateTime? LastAssignedAt { get; set; }
        public bool Chosen { get; set; }
    }

    public class TicketAssignmentDto
    {
        public Guid Id { get; set; }
        public DateTime At { get; set; }
        /// <summary>1 Auto, 2 Reassigned.</summary>
        public AssignmentMethod Method { get; set; }
        public string Reason { get; set; } = string.Empty;
        public PersonDto? From { get; set; }
        public PersonDto To { get; set; } = new(Guid.Empty, string.Empty, null);
        public PersonDto? By { get; set; }
        public string FromUnitName { get; set; } = string.Empty;
        public string ToUnitName { get; set; } = string.Empty;
        public List<CandidateScoreDto> Scores { get; set; } = new();
    }

    /// <summary>Who the signed-in person may move this ticket to, and their current workload.</summary>
    public class ReassignOptionsDto
    {
        public bool CanReassign { get; set; }
        /// <summary>Why not, when CanReassign is false.</summary>
        public string? Reason { get; set; }
        public List<ReassignCandidateDto> Candidates { get; set; } = new();
    }

    public class ReassignCandidateDto
    {
        public Guid UserId { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string? FullName { get; set; }
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        /// <summary>Handles this ticket's category (skills matrix).</summary>
        public bool HandlesCategory { get; set; }
        public int Workload { get; set; }
        public bool IsCurrentAssignee { get; set; }
    }

    public class ReassignRequest
    {
        public Guid ToUserId { get; set; }
        /// <summary>Required (FR-3.7, FR-3.8): 5 to 500 characters.</summary>
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>A New ticket waiting in a unit's pool that the signed-in person may pick.</summary>
    public class PoolTicketDto
    {
        public Guid Id { get; set; }
        public string Reference { get; set; } = string.Empty;
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public Guid CategoryId { get; set; }
        public string CategoryName { get; set; } = string.Empty;
        public ServiceDeskAPI.Domain.Enums.TicketPriority Priority { get; set; }
        public DateTime CreatedAt { get; set; }
    }
    /// <summary>Anyone signed in can look people up to copy them on a ticket: name, login name and department only.</summary>
    public record PersonSearchResultDto(Guid UserId, string UserName, string? FullName, string? Department);
}