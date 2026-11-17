using ServiceDeskAPI.Domain.Enums;

namespace ServiceDeskAPI.Infrastructure.Sla
{
    /// <summary>The moment a running ticket's time allowed runs out: business minutes from the day it was raised, plus every business minute it spent Pending or Resolved.</summary>
    public static class SlaDue
    {
        public static DateTime Compute(BusinessClock clock, DateTime createdUtc, int hours, IEnumerable<(TicketStatus To, DateTime At)> changes)
        {
            double paused = 0;
            DateTime? from = null;
            foreach (var ch in changes.OrderBy(c => c.At))
            {
                if (ch.To is TicketStatus.Pending or TicketStatus.Resolved) from ??= ch.At < createdUtc ? createdUtc : ch.At;
                else if (from.HasValue) { paused += clock.BusinessMinutes(from.Value, ch.At); from = null; }
            }
            return clock.AddBusinessMinutes(createdUtc, hours * 60.0 + paused);
        }
    }
}
