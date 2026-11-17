namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The SLA clock (BRD Section 9): warns and escalates tickets that are running out of time.</summary>
    public interface ISlaService
    {
        /// <summary>One pass over the open tickets at the given time (UTC). Returns how many tickets had a new level sent.</summary>
        Task<int> CheckAsync(DateTime nowUtc, CancellationToken cancellationToken = default);
    }
}