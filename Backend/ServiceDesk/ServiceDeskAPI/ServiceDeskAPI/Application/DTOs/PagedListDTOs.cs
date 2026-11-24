namespace ServiceDeskAPI.Application.DTOs
{
    /// <summary>A ticket waiting in the unit pool, with its subject (so the list can be searched and read).</summary>
    public class PoolRowDto : PoolTicketDto
    {
        public string Subject { get; set; } = string.Empty;
    }

    /// <summary>How many pool tickets match, per unit (ignores the unit filter), to build a filter and the per-unit counts on the home page.</summary>
    public class PoolUnitCountDto
    {
        public Guid Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public int Count { get; set; }
    }

    /// <summary>One page of the unit pool, oldest first. Total counts every match, whatever the page.</summary>
    public class PoolPageDto
    {
        public List<PoolRowDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public List<PoolUnitCountDto> Units { get; set; } = new();
    }

    /// <summary>One page of saved reports (yours and those shared with you), newest first.</summary>
    public class SavedReportPageDto
    {
        public List<SavedReportDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
    }
}