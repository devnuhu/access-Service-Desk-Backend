import { Link } from "react-router-dom";
import { Spinner } from "@/shared/ui";
import { formatWatClock } from "@/shared/lib/time";
import { useDashboardSummary } from "../hooks/useDashboard.js";

const RESOLVED = 5;

/** Warning amber, overdue and far past red; 0 is plain grey. */
const TONES = {
  warning: "text-brand-orange-ink",
  overdue: "text-danger",
  farPast: "text-danger",
};
const toneOf = (key, count) =>
  count === 0 ? "text-muted" : (TONES[key] ?? "text-ink");

/** A count; with `to` the whole tile is a link to the list it counts. */
function Tile({ label, count, to, tone, testId }) {
  const body = (
    <>
      <span className="text-sm font-semibold text-body">{label}</span>
      <span
        className={`text-2xl font-semibold tabular-nums ${tone}`}
        data-testid={testId}
      >
        {count}
      </span>
    </>
  );
  const box =
    "flex h-full flex-col justify-between gap-1 rounded-card border border-line bg-white px-4 py-3";
  return (
    <li>
      {to ? (
        <Link
          to={to}
          className={`${box} hover:border-brand-navy hover:bg-brand-navy-light`}
        >
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

/**
 * My work: tickets assigned to me by level, and the ones I raised. Tiles at 0 are hidden, except
 * Open. Warning and Far past have no list filter yet, so they are plain numbers. The assigned
 * tiles open my department's Work queue ("Assigned to me"); without a unit there is no queue, so
 * they stay plain numbers too.
 */
function MyWork({ mine, departmentId }) {
  const queue = departmentId
    ? (filter) =>
        `/departments/${departmentId}/tickets?tab=assigned&status=open${filter}`
    : () => undefined;
  const assigned = [
    { key: "open", label: "Open", to: queue(""), always: true },
    {
      key: "waitingToStart",
      label: "Waiting to start",
      to: queue("&waiting=1"),
    },
    { key: "warning", label: "Warning" },
    { key: "overdue", label: "Overdue", to: queue("&overdue=1") },
    { key: "farPast", label: "Far past" },
  ];
  const raised = [
    {
      key: "raisedOpen",
      label: "Open",
      to: "/tickets?status=open",
      always: true,
    },
    {
      key: "toConfirm",
      label: "Waiting for my confirmation",
      to: `/tickets?status=${RESOLVED}`,
    },
  ];
  const tiles = (items, prefix) =>
    items
      .filter((item) => item.always || mine[item.key] > 0)
      .map((item) => (
        <Tile
          key={item.key}
          label={item.label}
          count={mine[item.key]}
          to={item.to}
          tone={toneOf(item.key, mine[item.key])}
          testId={`${prefix}-${item.key}`}
        />
      ));

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div>
        <h3 className="text-sm font-semibold text-muted">Assigned to me</h3>
        <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {tiles(assigned, "mine")}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-muted">Tickets I raised</h3>
        <ul className="mt-2 grid grid-cols-2 gap-3">
          {tiles(raised, "raised")}
        </ul>
      </div>
    </div>
  );
}

/**
 * My work from GET /api/dashboard/summary, for people who oversee nothing (case workers and
 * requesters; heads get their unit dashboard, HODs the department overview). `departmentId`: the
 * department whose Work queue the assigned tiles open.
 */
export default function Dashboard({ departmentId, actions }) {
  const summary = useDashboardSummary();
  const data = summary.data;

  return (
    <>
      <section aria-labelledby="home-my-work" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="home-my-work" className="text-base font-semibold">
              My work
            </h2>
            {data && (
              <span className="text-xs text-muted">
                Updated {formatWatClock(data.generatedAt)}
              </span>
            )}
          </div>
          {actions}
        </div>
        {summary.isLoading ? (
          <div className="py-6 text-center text-muted">
            <Spinner label="Loading your counts…" />
          </div>
        ) : summary.isError && !data ? (
          <p role="alert" className="text-sm text-danger">
            {summary.error.message}
          </p>
        ) : (
          <MyWork mine={data.mine} departmentId={departmentId} />
        )}
      </section>
    </>
  );
}
