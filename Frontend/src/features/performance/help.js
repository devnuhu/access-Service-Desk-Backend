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
  /** Ticket tasks (components/TaskFigures.jsx). */
  tasks: {
    onTime:
      "On time = done on time ÷ (done + overdue and still open + cancelled after it was overdue). Rejected tasks are neutral.",
    given: "Tasks given in the period.",
    doneOnTime: "Done by their due date (or with no due date).",
    doneLate: "Done after their due date.",
    openNow: "Open right now, whatever the period.",
    overdueOpen: "Open right now and past their due date: counted against.",
    rejected:
      "Sent back with a reason. Not counted against: the task goes to someone else.",
    cancelled:
      "Cancelled because they were no longer needed. Not counted against, unless cancelled after the due date had passed (shown apart).",
  },
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
