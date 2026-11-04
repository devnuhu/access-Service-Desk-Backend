using ServiceDeskAPI.Domain.Entities;

namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>What the signed-in person may do with the ticket now (BRD Section 8). The server checks again on every action.</summary>
    public class TicketActionsDto
    {
        public bool CanAcknowledge { get; set; }
        public bool CanSetPending { get; set; }
        public bool CanResume { get; set; }
        public bool CanResolve { get; set; }
        public bool CanConfirm { get; set; }
        public bool CanReopen { get; set; }
        public bool CanCancel { get; set; }
        public List<ResolutionCodeDto> ResolutionCodes { get; set; } = new();
    }

    public record ResolutionCodeDto(ResolutionCode Code, string Label);

    /// <summary>reason: 1 waiting on the requester (their reply resumes it), 2 waiting on a third party. note: 5 to 2000 characters, posted as a public comment.</summary>
    public class SetPendingRequest
    {
        public PendingReason Reason { get; set; }
        public string Note { get; set; } = string.Empty;
    }

    /// <summary>code: see ResolutionCodes. note: 10 to 4000 characters, posted as a public comment.</summary>
    public class ResolveRequest
    {
        public ResolutionCode Code { get; set; }
        public string Note { get; set; } = string.Empty;
    }

    /// <summary>For reopen (5 to 2000 characters, posted as a public comment) and cancel (3 to 500).</summary>
    public class WorkflowReasonRequest
    {
        public string Reason { get; set; } = string.Empty;
    }

    /// <summary>The categories the signed-in person handles, per unit (the skills matrix, read-only).</summary>
    public class MyCategoriesDto
    {
        public Guid UnitId { get; set; }
        public string UnitName { get; set; } = string.Empty;
        public string DepartmentName { get; set; } = string.Empty;
        public List<MyCategoryDto> Categories { get; set; } = new();
    }

    public record MyCategoryDto(Guid Id, string Name, bool IsActive);
}