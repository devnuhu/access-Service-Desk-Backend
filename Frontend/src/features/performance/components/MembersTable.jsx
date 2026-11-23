import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatHours, formatPercent } from "../format.js";

const COLUMNS = [
  ["assigned", "Assigned", (f) => f.assigned, String],
  ["resolved", "Resolved", (f) => f.resolved, String],
  ["openNow", "Open", (f) => f.openNow, String],
  ["onHold", "On hold", (f) => f.onHold, String],
  ["within", "Within time", (f) => f.withinSlaPercent, formatPercent],
  ["avgResolution", "Avg resolution", (f) => f.avgResolutionHours, formatHours],
  [
    "avgFirstResponse",
    "Avg first response",
    (f) => f.avgFirstResponseHours,
    formatHours,
  ],
  [
    "answeredInTime",
    "Answered in time",
    (f) => f.respondedInTimePercent,
    formatPercent,
  ],
  ["noResponse", "No response in time", (f) => f.noResponseInTime, String],
  ["reopened", "Reopened", (f) => f.reopenedPercent, formatPercent],
];

/**
 * Every member with their figures; each column sorts (again to reverse). "No data" always sorts
 * last. A member with a userId opens their performance (name button or the row).
 */
export default function MembersTable({ members, onSelect }) {
  const [sort, setSort] = useState({ key: "resolved", desc: true });
  const column = COLUMNS.find(([key]) => key === sort.key);
  const value = (m) => (column ? column[2](m.figures) : m.name);
  const sorted = [...members].sort((a, b) => {
    if (sort.key === "name")
      return (sort.desc ? -1 : 1) * a.name.localeCompare(b.name);
    const x = value(a);
    const y = value(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    return (sort.desc ? y - x : x - y) || a.name.localeCompare(b.name);
  });
  const sortBy = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : { key, desc: key !== "name" },
    );

  const header = (key, label, numeric = true) => {
    const active = sort.key === key;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
        className={`px-3 py-2.5 ${numeric ? "text-right" : "text-left"}`}
      >
        <button
          type="button"
          onClick={() => sortBy(key)}
          className={`inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase ${active ? "text-brand-navy" : "text-muted"} hover:text-brand-navy`}
        >
          {label}
          {active && <Arrow aria-hidden="true" size={12} />}
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
      <table className="w-full min-w-[56rem] text-sm">
        <caption className="sr-only">
          Members and their figures. Select a column heading to sort.
        </caption>
        <thead className="border-b border-line bg-page/60">
          <tr>
            {header("name", "Name", false)}
            {COLUMNS.map(([key, label]) => header(key, label))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.map((m, i) => {
            const open = m.userId ? () => onSelect(m) : null;
            return (
              <tr
                key={m.userId ?? `${m.name}-${i}`}
                data-testid={`member-row-${m.name}`}
                onClick={open ?? undefined}
                className={open ? "cursor-pointer hover:bg-page" : ""}
              >
                <th scope="row" className="px-3 py-2.5 text-left font-semibold">
                  {open ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        open();
                      }}
                      className="text-left text-brand-navy hover:underline"
                    >
                      {m.name}
                    </button>
                  ) : (
                    <span className="text-ink">{m.name}</span>
                  )}
                  {m.isHead && (
                    <span className="ml-1.5 rounded bg-brand-navy-light px-1.5 py-0.5 text-[10px] font-semibold text-brand-navy uppercase">
                      Head
                    </span>
                  )}
                </th>
                {COLUMNS.map(([key, , read, show]) => {
                  const v = read(m.figures);
                  return (
                    <td
                      key={key}
                      className={`px-3 py-2.5 text-right tabular-nums ${v == null ? "text-muted" : "text-ink"}`}
                    >
                      {v == null ? "No data" : show(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
