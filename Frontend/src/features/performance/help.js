/** What each figure counts (the "i" next to it). All times are business hours. */
export const HELP = {
  assigned:
    "Tickets assigned in the period, counted by the date each was assigned.",
  resolved:
    "Tickets resolved in the period, counted by the date each was resolved.",
  openNow: "Open right now, whatever the period.",
  onHold: "Pending (on hold) right now, whatever the period.",
  withinTime:
    "Of the tickets resolved in the period, the share resolved within their resolution time.",
  answeredInTime:
    "Of the tickets raised in the period and held by the person, the share first answered within their response time.",
  avgResolution:
    "Average time to resolve, over the tickets resolved in the period. Business hours.",
  avgFirstResponse:
    "Average time to the first answer, over the tickets raised in the period and held by the person. Business hours.",
  reopened:
    "Tickets resolved in the period and reopened at least once, and their share of all resolved.",
  noResponseInTime:
    "Tickets raised in the period that were not answered within their response time.",
  /** The six headline indicators (../headline.js). */
  headline: {
    resolved:
      "Tickets resolved in the period, and that as a share of those assigned in the period (it can pass 100% when older tickets are cleared).",
    resolvedWithinSla:
      "Tickets resolved in the period and finished within the time allowed, and their share of all resolved.",
    resolvedLate:
      "Tickets resolved in the period after their deadline. Counted apart from first-response misses.",
    firstResponseMet:
      "Tickets raised in the period that were acknowledged or answered within the response time, and their share.",
    noResponseInTime:
      "Tickets raised in the period not acknowledged or answered within the response time. Counted apart from resolution breaches.",
    openNow:
      "Open right now, whatever the period: how many are already past the time allowed, and how many are on hold (Pending).",
  },
};
