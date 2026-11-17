import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatWat } from "@/shared/lib/time";
import { ASSIGNMENT_METHOD } from "../api/endpoints.js";
import { useAssignmentHistory } from "../hooks/useTickets.js";
import { autoReasonText, personName } from "../ticketText.js";

/** The candidates the engine compared for one Auto entry; the chosen one is highlighted. */
function ScoreTable({ scores }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Candidates compared</caption>
        <thead className="text-muted uppercase">
          <tr>
            <th scope="col" className="py-1 pr-2">
              Name
            </th>
            <th scope="col" className="py-1 pr-2 text-right">
              Open
            </th>
            <th scope="col" className="py-1 pr-2 text-right">
              Workload
            </th>
            <th scope="col" className="py-1">
              Last assigned
            </th>
          </tr>
        </thead>
        <tbody>
          {scores.map((score) => (
            <tr
              key={score.userId}
              data-chosen={score.chosen || undefined}
              className={
                score.chosen
                  ? "bg-brand-green-light font-semibold text-ink"
                  : "text-body"
              }
            >
              <td className="py-1 pr-2">
                {personName(score)}
                {score.chosen && <span className="sr-only"> (chosen)</span>}
              </td>
              <td className="py-1 pr-2 text-right">{score.openTickets}</td>
              <td className="py-1 pr-2 text-right">{score.workload}</td>
              <td className="py-1">
                {score.lastAssignedAt ? formatWat(score.lastAssignedAt) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Entry({ entry }) {
  const [open, setOpen] = useState(false);
  const auto = entry.method === ASSIGNMENT_METHOD.Auto;
  const movedUnit = entry.fromUnitName !== entry.toUnitName;
  const unit = (name) => (movedUnit && name ? ` (${name})` : "");

  return (
    <li
      data-testid={`assignment-${entry.id}`}
      className="relative border-l-2 border-line pb-3 pl-3"
    >
      <span
        aria-hidden="true"
        className={`absolute top-1 -left-[5px] h-2 w-2 rounded-full ${auto ? "bg-brand-navy" : "bg-brand-orange"}`}
      />
      <p className="text-xs text-muted">{formatWat(entry.at)}</p>
      <p className="text-sm font-semibold text-ink">
        {auto
          ? "Auto"
          : `Reassigned by ${entry.by ? personName(entry.by) : "someone"}`}
      </p>
      <p className="text-sm text-body">
        {entry.from ? (
          <>
            {personName(entry.from)}
            {unit(entry.fromUnitName)} → {personName(entry.to)}
            {unit(entry.toUnitName)}
          </>
        ) : (
          <>To {personName(entry.to)}</>
        )}
      </p>
      <p className="text-sm text-body">
        {auto ? autoReasonText(entry.reason) : `“${entry.reason}”`}
      </p>
      {auto && entry.scores.length > 0 && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-brand-navy hover:underline"
          >
            {open ? (
              <ChevronDown aria-hidden="true" size={13} />
            ) : (
              <ChevronRight aria-hidden="true" size={13} />
            )}
            Why {personName(entry.to)}? ({entry.scores.length} compared)
          </button>
          {open && <ScoreTable scores={entry.scores} />}
        </>
      )}
    </li>
  );
}

/** Assignment history, oldest first; collapsed, and loaded only when opened. */
export default function AssignmentHistory({ ticketId }) {
  const [open, setOpen] = useState(false);
  const history = useAssignmentHistory(ticketId, { enabled: open });
  return (
    <div className="border-t border-line pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="assignment-history"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between text-sm font-semibold text-ink"
      >
        Assignment history
        {open ? (
          <ChevronDown aria-hidden="true" size={15} className="text-muted" />
        ) : (
          <ChevronRight aria-hidden="true" size={15} className="text-muted" />
        )}
      </button>
      {open && (
        <div id="assignment-history" className="mt-3">
          {history.isLoading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : history.isError ? (
            <p role="alert" className="text-sm text-danger">
              {history.error.message}
            </p>
          ) : history.data.length === 0 ? (
            <p className="text-sm text-muted">Not assigned yet.</p>
          ) : (
            <ol>
              {history.data.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
