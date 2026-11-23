import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { headlineIndicators } from "../headline.js";

/** The six headline indicators as columns (labels and order from ../headline.js). */
const COLUMNS = headlineIndicators({}).map(({ key, label }) => ({
  key,
  label,
}));

function HeadMark() {
  return (
    <span className="ml-1.5 rounded bg-brand-navy-light px-1.5 py-0.5 text-[10px] font-semibold text-brand-navy uppercase">
      Head
    </span>
  );
}

function MemberName({ member, open }) {
  return open ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        open();
      }}
      className="text-left text-brand-navy hover:underline"
    >
      {member.name}
    </button>
  ) : (
    <span className="text-ink">{member.name}</span>
  );
}

/** One indicator's count (amber above 0 for a breach or a miss) and its lines. */
function Indicator({ item, align = "right" }) {
  return (
    <span className={`flex flex-col ${align === "right" ? "items-end" : ""}`}>
      <span
        data-alert={item.alert ? "true" : undefined}
        className={`font-semibold tabular-nums ${item.alert ? "text-brand-orange-ink" : "text-ink"}`}
      >
        {item.count}
      </span>
      {item.lines.map((line) => (
        <span
          key={line.key}
          className={`text-[11px] ${line.alert ? "font-semibold text-danger" : "text-muted"}`}
        >
          {line.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Every member (the head's own row too, marked Head) with the six headline indicators. A table
 * from md up, each column sorting (again to reverse); one card per member on a phone, in the same
 * order. A member with a userId opens their performance (name button or the row).
 */
export default function MembersTable({ members, onSelect }) {
  const [sort, setSort] = useState({ key: "resolved", desc: true });
  const rows = members.map((m) => ({
    member: m,
    items: headlineIndicators(m.figures),
  }));
  const count = (row) =>
    row.items.find((item) => item.key === sort.key)?.count ?? 0;
  const sorted = [...rows].sort((a, b) => {
    const byName = a.member.name.localeCompare(b.member.name);
    if (sort.key === "name") return (sort.desc ? -1 : 1) * byName;
    return (sort.desc ? count(b) - count(a) : count(a) - count(b)) || byName;
  });
  const sortBy = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, desc: !current.desc }
        : { key, desc: key !== "name" },
    );
  const opener = (m) => (m.userId ? () => onSelect(m) : null);

  const header = (key, label, numeric = true) => {
    const active = sort.key === key;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <th
        key={key}
        scope="col"
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
        className={`px-3 py-2.5 align-bottom ${numeric ? "text-right" : "text-left"}`}
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
    <>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-card md:block">
        <table data-testid="members-table" className="w-full text-sm">
          <caption className="sr-only">
            Members and their headline indicators. Select a column heading to
            sort.
          </caption>
          <thead className="border-b border-line bg-page/60">
            <tr>
              {header("name", "Name", false)}
              {COLUMNS.map(({ key, label }) => header(key, label))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sorted.map(({ member: m, items }, i) => {
              const open = opener(m);
              return (
                <tr
                  key={m.userId ?? `${m.name}-${i}`}
                  data-testid={`member-row-${m.name}`}
                  onClick={open ?? undefined}
                  className={open ? "cursor-pointer hover:bg-page" : ""}
                >
                  <th
                    scope="row"
                    className="px-3 py-2.5 text-left align-top font-semibold"
                  >
                    <MemberName member={m} open={open} />
                    {m.isHead && <HeadMark />}
                  </th>
                  {items.map((item) => (
                    <td
                      key={item.key}
                      data-testid={`member-${item.key}`}
                      className="px-3 py-2.5 text-right align-top"
                    >
                      <Indicator item={item} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul data-testid="members-cards" className="space-y-3 md:hidden">
        {sorted.map(({ member: m, items }, i) => {
          const open = opener(m);
          return (
            <li
              key={m.userId ?? `${m.name}-${i}`}
              data-testid={`member-card-${m.name}`}
              className="rounded-card border border-line bg-white px-4 py-3 shadow-card"
            >
              <p className="text-sm font-semibold">
                <MemberName member={m} open={open} />
                {m.isHead && <HeadMark />}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5">
                {items.map((item) => (
                  <div
                    key={item.key}
                    data-testid={`member-${item.key}`}
                    className="min-w-0"
                  >
                    <dt className="text-xs text-muted">{item.label}</dt>
                    <dd className="text-sm">
                      <Indicator item={item} align="left" />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
