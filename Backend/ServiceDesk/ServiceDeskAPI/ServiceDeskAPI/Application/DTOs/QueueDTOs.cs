using ServiceDeskAPI.Domain.Entities;

namespace ServiceDeskAPI.Application.DTOs
{
    public record SavedViewDto(Guid Id, string Name, string FilterJson, bool IsFavourite, DateTime CreatedAt);

    /// <summary>On create name and filterJson are required. On update leave a field out to keep it. name 2 to 60 characters; filterJson a JSON object of at most 2000 characters.</summary>
    public class SaveViewRequest
    {
        public string? Name { get; set; }
        public string? FilterJson { get; set; }
        public bool? IsFavourite { get; set; }
    }

    /// <summary>The tickets to act on: 1 to 50.</summary>
    public class BulkRequest
    {
        public List<Guid> TicketIds { get; set; } = new();
    }

    public class BulkReassignRequest : BulkRequest
    {
        public Guid ToUserId { get; set; }
        /// <summary>5 to 500 characters.</summary>
        public string Reason { get; set; } = string.Empty;
    }

    public class BulkResolveRequest : BulkRequest
    {
        public ResolutionCode Code { get; set; }
        /// <summary>10 to 4000 characters, posted as a public comment on each ticket.</summary>
        public string Note { get; set; } = string.Empty;
    }

    /// <summary>What happened to one ticket. Status is the HTTP status the single action would have returned (200 done, 404 not found, 403, 400, 409).</summary>
    public record BulkItemDto(Guid TicketId, string? Reference, bool Ok, int Status, string Message);

    public class BulkResultDto
    {
        public int Total { get; set; }
        public int Succeeded { get; set; }
        public int Failed { get; set; }
        public List<BulkItemDto> Items { get; set; } = new();
    }
}