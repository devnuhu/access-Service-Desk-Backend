namespace ServiceDeskAPI.Application.Interfaces
{
    /// <summary>The daily and weekly ticket summaries for unit heads, Department Admins and Heads of Department (step 8b).</summary>
    public interface IDigestService
    {
        /// <summary>One pass at the given time (UTC). Sends the digests that are due and not yet sent. Returns how many were sent.</summary>
        Task<int> RunAsync(DateTime nowUtc, CancellationToken cancellationToken = default);
    }
}
