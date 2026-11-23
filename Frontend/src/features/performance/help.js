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
  reopened: "Of the tickets resolved in the period, the share reopened since.",
  noResponseInTime:
    "Tickets raised in the period that were not answered within their response time.",
};
