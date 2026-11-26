import { Link } from "react-router-dom";
import { formatWatDateTime } from "@/shared/lib/time";
import { formatShare } from "../headline.js";
import { HELP } from "../help.js";
import InfoTip from "./InfoTip.jsx";

function Count({ label, value, help, testId, alert = false }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted">
        {label}
        {help && <InfoTip text={help} label={`About ${label}`} />}
      </dt>
      <dd
        data-testid={testId}
        data-alert={alert ? "true" : undefined}
        className={`text-lg font-semibold tabular-nums ${alert ? "text-brand-orange-ink" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * Ticket tasks in the period, for a person or (summed) a unit: the on-time share as the headline,
 * then given, done on time, done late, open and overdue. Rejected and cancelled sit apart, marked
 * "not counted against" (cancelled after the due date is the exception, and says so). A person's
 * view also lists the reasons for their latest rejections.
 */
export default function TaskFigures({
  tasks,
  rejections,
  title = "Tasks",
  testId = "perf-tasks",
}) {
  const percent = tasks.onTimePercent;
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="rounded-card border border-line bg-white px-4 py-3.5 shadow-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <p className="flex items-baseline gap-1.5">
          <span
            data-testid={`${testId}-ontime`}
            className={
              percent == null
                ? "text-base font-medium text-muted"
                : "text-2xl font-semibold text-ink tabular-nums sm:text-3xl"
            }
          >
            {percent == null ? "No data" : formatShare(percent)}
          </span>
          <span className="flex items-center gap-1 text-sm text-muted">
            on time
            <InfoTip text={HELP.tasks.onTime} label="About on time" />
          </span>
        </p>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-5">
        <Count
          label="Given"
          value={tasks.given}
          help={HELP.tasks.given}
          testId={`${testId}-given`}
        />
        <Count
          label="Done on time"
          value={tasks.doneOnTime}
          help={HELP.tasks.doneOnTime}
          testId={`${testId}-doneOnTime`}
        />
        <Count
          label="Done late"
          value={tasks.doneLate}
          help={HELP.tasks.doneLate}
          testId={`${testId}-doneLate`}
          alert={tasks.doneLate > 0}
        />
        <Count
          label="Open"
          value={tasks.openNow}
          help={HELP.tasks.openNow}
          testId={`${testId}-openNow`}
        />
        <Count
          label="Overdue"
          value={tasks.overdueOpen}
          help={HELP.tasks.overdueOpen}
          testId={`${testId}-overdueOpen`}
          alert={tasks.overdueOpen > 0}
        />
      </dl>

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-semibold text-muted">Not counted against</p>
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-5">
          <Count
            label="Rejected"
            value={tasks.rejected}
            help={HELP.tasks.rejected}
            testId={`${testId}-rejected`}
          />
          <Count
            label="Cancelled"
            value={tasks.cancelled}
            help={HELP.tasks.cancelled}
            testId={`${testId}-cancelled`}
          />
        </dl>
        {tasks.cancelledLate > 0 && (
          <p
            data-testid={`${testId}-cancelledLate`}
            className="mt-1 text-xs text-brand-orange-ink"
          >
            {tasks.cancelledLate} cancelled after the due date (counted
            against).
          </p>
        )}
      </div>

      {rejections && rejections.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="text-xs font-semibold text-muted">
            Why tasks were sent back (latest {rejections.length})
          </h4>
          <ul
            data-testid={`${testId}-rejections`}
            className="mt-1 divide-y divide-line"
          >
            {rejections.map((r, i) => (
              <li
                key={`${r.ticketReference}-${r.rejectedAt}-${i}`}
                className="py-2 text-sm"
              >
                <p className="break-words text-ink">
                  <Link
                    to={`/tickets/${r.ticketReference}`}
                    className="font-semibold text-brand-navy hover:underline"
                  >
                    {r.ticketReference}
                  </Link>{" "}
                  · {r.title}
                </p>
                <p className="text-xs break-words whitespace-pre-line text-body">
                  {r.reason}
                </p>
                <p className="text-[12px] text-muted">
                  {formatWatDateTime(r.rejectedAt)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
