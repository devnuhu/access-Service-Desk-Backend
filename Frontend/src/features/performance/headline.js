/**
 * The six headline indicators of a person's or a unit's figures, in their fixed order. Resolution
 * breaches (resolvedLate) and first-response misses (noResponseInTime) are separate indicators and
 * are never added together. A null percentage shows "–", never 0%.
 */

/** "87%"; null is "–". */
export function formatShare(value) {
  return value == null ? "–" : `${Math.round(value)}%`;
}

export const HEADLINE_NOTE =
  "Time allowed is counted in working hours; time spent Pending is not counted. First response means the case worker acknowledged or answered the requester.";

/**
 * [{ key, label, count, lines: [{ key, text, alert? }], alert }]: `alert` (warning) only for a
 * breach or a miss above 0; a line's `alert` (danger) only for overdue above 0.
 */
export function headlineIndicators(f) {
  return [
    {
      key: "resolved",
      label: "Tickets resolved",
      count: f.resolved,
      lines: [
        {
          key: "rate",
          text: `${formatShare(f.resolutionRatePercent)} of assigned`,
        },
      ],
    },
    {
      key: "resolvedWithinSla",
      label: "Resolved within time",
      count: f.resolvedWithinSla,
      lines: [
        {
          key: "share",
          text: `${formatShare(f.withinSlaPercent)} of resolved`,
        },
      ],
    },
    {
      key: "resolvedLate",
      label: "Resolution breaches",
      count: f.resolvedLate,
      alert: f.resolvedLate > 0,
      lines: [{ key: "late", text: "resolved late" }],
    },
    {
      key: "firstResponseMet",
      label: "First response in time",
      count: f.firstResponseMet,
      lines: [
        {
          key: "share",
          text: `${formatShare(f.respondedInTimePercent)} in time`,
        },
      ],
    },
    {
      key: "noResponseInTime",
      label: "First response missed",
      count: f.noResponseInTime,
      alert: f.noResponseInTime > 0,
      lines: [{ key: "missed", text: "not answered in time" }],
    },
    {
      key: "openNow",
      label: "Outstanding",
      count: f.openNow,
      lines: [
        ...(f.overdueOpen > 0
          ? [
              {
                key: "overdue",
                text: `of which overdue: ${f.overdueOpen}`,
                alert: true,
              },
            ]
          : []),
        { key: "onHold", text: `on hold: ${f.onHold}` },
      ],
    },
  ].map((item) => ({ alert: false, ...item }));
}
