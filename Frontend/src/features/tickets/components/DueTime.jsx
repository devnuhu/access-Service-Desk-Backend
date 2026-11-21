import {
  formatDueWat,
  formatWat,
  isPast,
  parseUtc,
  relativeText,
} from "@/shared/lib/time";

/**
 * When the ticket's time runs out (slaDueAt, from the API; never computed here). Nothing when the API
 * sends null: requesters, tickets that are not running, tickets older than SLA tracking.
 *
 * List (default): "Due Today 14:00", or red "Overdue since ..." text once it has passed.
 * `full` (ticket details): the full WAT date and time with "in 5 hours" / "2 hours ago" under it.
 * The Overdue SLA chip still comes from slaLevel; this only shows the date.
 */
export default function DueTime({ at, full = false }) {
  if (!parseUtc(at)) return null;
  const passed = isPast(at);

  if (full) {
    return (
      <span data-testid="detail-due" data-passed={passed}>
        <time dateTime={at}>{formatWat(at)}</time>
        <span
          className={`block text-xs ${passed ? "font-semibold text-danger" : "text-muted"}`}
        >
          {relativeText(at)}
        </span>
      </span>
    );
  }

  const when = formatDueWat(at);
  return passed ? (
    <time
      dateTime={at}
      title={formatWat(at)}
      data-testid="due"
      data-passed="true"
      className="text-xs whitespace-nowrap text-danger"
    >
      Overdue since {when}
    </time>
  ) : (
    <time
      dateTime={at}
      title={formatWat(at)}
      data-testid="due"
      className="text-xs whitespace-nowrap text-muted"
    >
      Due {when}
    </time>
  );
}
