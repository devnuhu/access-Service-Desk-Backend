import { Link } from "react-router-dom";
import {
  Settings2,
  BarChart3,
  CalendarDays,
  Compass,
  Hand,
  ShieldOff,
} from "lucide-react";
import {
  Card,
  CardHeader,
  Chip,
  MessageCard,
  PageHeader,
  Spinner,
  UnitEyebrow,
} from "@/shared/ui";
import { formatDueWat, formatWatClock, relativeText } from "@/shared/lib/time";
import { useUnitDashboard } from "../hooks/useDashboard.js";
import { UnitPerformance } from "@/features/performance";
import { unitQueue } from "../links.js";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "2026-11-24" -> "24 Nov 2026" (a calendar date: no time zone). */
function formatDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return value ?? "";
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

const th = "px-4 py-3 font-semibold";
const td = "px-4 py-3 align-top";
const thead =
  "border-b border-line bg-page/60 text-left text-[11px] font-semibold tracking-wider text-muted uppercase";

/** A table in a card, or a quiet line when there is nothing to list. */
function Section({ id, title, description, actions, empty, children }) {
  return (
    <Card aria-labelledby={id} data-testid={id}>
      <CardHeader
        title={<span id={id}>{title}</span>}
        description={description}
        actions={actions}
      />
      {empty ? (
        <p className="px-5 py-6 text-sm text-muted">{empty}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </Card>
  );
}

const ATTENTION = [
  { key: "unassigned", label: "Unassigned", filter: "&status=1" },
  { key: "escalated", label: "Escalated", filter: "&escalated=1" },
  // No list filter for it: a figure, not a link.
  { key: "responseOverdue", label: "Response overdue", tone: "red" },
  { key: "overdue", label: "Overdue", filter: "&overdue=1", tone: "red" },
  // There is no far-past list filter: it opens the overdue list (far past is past the deadline too).
  { key: "farPast", label: "Far past", filter: "&overdue=1", tone: "red" },
];

function NeedsAttention({ dashboard }) {
  const { counts } = dashboard;
  return (
    <section aria-labelledby="unit-attention" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="unit-attention" className="text-base font-semibold">
          Needs attention
        </h2>
        <p className="text-sm text-muted">
          {counts.open} open · {counts.waitingToStart} waiting to start ·{" "}
          {counts.warning} near the deadline
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {ATTENTION.map(({ key, label, filter, tone }) => {
          const count = counts[key];
          const box =
            "flex h-full flex-col justify-between gap-2 rounded-card border border-line bg-white px-4 py-3.5 shadow-card";
          const Tag = filter === undefined ? "div" : Link;
          const link =
            filter === undefined ? {} : { to: unitQueue(dashboard, filter) };
          return (
            <li key={key}>
              <Tag
                {...link}
                className={
                  filter === undefined
                    ? box
                    : `${box} hover:border-brand-navy hover:bg-brand-navy-light/40`
                }
              >
                <span className="flex items-center gap-2 text-sm text-muted">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${count > 0 ? (tone === "red" ? "bg-danger" : "bg-brand-orange") : "bg-line"}`}
                  />
                  {label}
                </span>
                <span
                  data-testid={`attention-${key}`}
                  className={`text-3xl font-semibold tabular-nums ${count === 0 ? "text-ink" : tone === "red" ? "text-danger" : "text-brand-orange-ink"}`}
                >
                  {count}
                </span>
              </Tag>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Pool({ dashboard, own }) {
  const pickLink = unitQueue(dashboard, "", "pool");
  return (
    <Section
      id="unit-pool"
      title="Unit pool"
      description="New tickets nobody has taken yet, by category."
      empty={dashboard.pool.length ? null : "The pool is empty."}
      actions={
        own &&
        dashboard.pool.length > 0 && (
          <Link
            to={pickLink}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-brand-navy hover:border-brand-navy"
          >
            <Hand aria-hidden="true" size={16} />
            Pick
          </Link>
        )
      }
    >
      <table className="w-full text-sm">
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>
              Category
            </th>
            <th scope="col" className={`${th} text-right`}>
              Waiting
            </th>
            <th scope="col" className={th}>
              Oldest wait
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dashboard.pool.map((row) => (
            <tr key={row.categoryId}>
              <th scope="row" className={`${td} text-left font-medium`}>
                {row.categoryName}
              </th>
              <td className={`${td} text-right font-semibold tabular-nums`}>
                {row.waiting}
              </td>
              <td className={`${td} text-body`}>
                <time
                  dateTime={row.oldestWaitingAt}
                  title={formatDueWat(row.oldestWaitingAt)}
                >
                  Since {relativeText(row.oldestWaitingAt)}
                </time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function TicketLink({ reference }) {
  return (
    <Link
      to={`/tickets/${reference}`}
      className="font-semibold whitespace-nowrap text-brand-navy hover:underline"
    >
      {reference}
    </Link>
  );
}

function Escalated({ dashboard, own }) {
  return (
    <Section
      id="unit-escalated"
      title={own ? "Escalated to me" : "Escalated to the head"}
      description="Tickets a case worker passed up to the head of the unit."
      empty={dashboard.escalated.length ? null : "Nothing has been escalated."}
    >
      <table className="w-full text-sm">
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>
              Ticket
            </th>
            <th scope="col" className={th}>
              Passed up by
            </th>
            <th scope="col" className={th}>
              Why
            </th>
            <th scope="col" className={th}>
              When
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dashboard.escalated.map((item) => (
            <tr key={item.ticketId} data-testid={`escalated-${item.reference}`}>
              <td className={td}>
                <TicketLink reference={item.reference} />
                <div className="text-xs text-muted">{item.categoryName}</div>
              </td>
              <td className={td}>{item.assigneeName ?? "—"}</td>
              <td className={`${td} max-w-md text-body`}>
                {item.note || "No reason given."}
              </td>
              <td className={`${td} whitespace-nowrap text-body`}>
                {formatDueWat(item.since)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

const RESPONSE_COLUMNS = [
  "No response (now)",
  "Missed (30 days)",
  "Responded in time",
];
const RESPONSE_HELP =
  "Counted from when the ticket was assigned to them, in working hours (8 to 5, Monday to Friday, holidays excluded). Acknowledging or replying publicly to the requester counts as a response.";

/** Responded in time: amber under 90%, red under 75%. */
const metTone = (percent) =>
  percent === null
    ? "text-muted"
    : percent < 75
      ? "font-semibold text-danger"
      : percent < 90
        ? "font-semibold text-brand-orange-ink"
        : "text-ink";

function Team({ dashboard }) {
  return (
    <Section
      id="unit-team"
      title="Team"
      description="Open work per person. Overdue includes far past."
      empty={dashboard.team.length ? null : "Nobody is in this unit yet."}
    >
      <table className="w-full text-sm">
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>
              Name
            </th>
            <th scope="col" className={`${th} text-right`}>
              Open
            </th>
            <th scope="col" className={`${th} text-right`}>
              Waiting to start
            </th>
            <th scope="col" className={`${th} text-right`}>
              Overdue
            </th>
            {RESPONSE_COLUMNS.map((label) => (
              <th
                key={label}
                scope="col"
                title={RESPONSE_HELP}
                aria-describedby="response-help"
                className={`${th} text-right`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dashboard.team.map((person) => {
            const overdue = person.overdue + person.farPast;
            const percent = person.responseMetPercent;
            return (
              <tr key={person.userId} data-testid={`member-${person.userName}`}>
                <th scope="row" className={`${td} text-left font-medium`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {person.fullName ?? person.userName}
                    {person.isHead && <Chip tone="navy">Head</Chip>}
                    {person.onLeave && (
                      <Chip tone="orange">
                        {person.leaveUntil
                          ? `On leave until ${formatDay(person.leaveUntil)}`
                          : "On leave"}
                      </Chip>
                    )}
                  </div>
                </th>
                <td className={`${td} text-right tabular-nums`}>
                  {person.openTickets}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {person.waitingToStart}
                </td>
                <td
                  className={`${td} text-right tabular-nums ${overdue > 0 ? "font-semibold text-danger" : "text-muted"}`}
                >
                  {overdue}
                </td>
                {person.isHead ? (
                  RESPONSE_COLUMNS.map((label) => (
                    <td key={label} className={`${td} text-right text-muted`}>
                      -
                    </td>
                  ))
                ) : (
                  <>
                    <td
                      data-testid="response-overdue"
                      className={`${td} text-right tabular-nums ${person.responseOverdue > 0 ? "font-semibold text-danger" : "text-muted"}`}
                    >
                      {person.responseOverdue}
                    </td>
                    <td
                      data-testid="response-missed"
                      className={`${td} text-right tabular-nums ${person.responseMissed > 0 ? "text-ink" : "text-muted"}`}
                    >
                      {person.responseMissed}
                    </td>
                    <td
                      data-testid="response-met"
                      className={`${td} text-right tabular-nums ${metTone(percent)}`}
                    >
                      {percent === null ? "-" : `${Math.round(percent)}%`}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p
        id="response-help"
        className="border-t border-line px-4 py-2.5 text-xs text-muted"
      >
        First response: {RESPONSE_HELP}
      </p>
    </Section>
  );
}

function Categories({ dashboard }) {
  return (
    <Section
      id="unit-categories"
      title="Categories"
      description="A category needs cover when fewer than two people handle it."
      empty={
        dashboard.categories.length ? null : "This unit owns no categories."
      }
    >
      <table className="w-full text-sm">
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>
              Category
            </th>
            <th scope="col" className={`${th} text-right`}>
              People who handle it
            </th>
            <th scope="col" className={`${th} text-right`}>
              Open tickets
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dashboard.categories.map((category) => (
            <tr
              key={category.categoryId}
              data-testid={`category-${category.categoryName}`}
            >
              <th scope="row" className={`${td} text-left font-medium`}>
                <div className="flex flex-wrap items-center gap-2">
                  {category.categoryName}
                  {category.needsCover && <Chip tone="red">Needs cover</Chip>}
                  {!category.isActive && <Chip tone="grey">Switched off</Chip>}
                </div>
              </th>
              <td className={`${td} text-right tabular-nums`}>
                {category.eligibleCount}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {category.openTickets}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

const LEVEL = {
  farPast: ["darkRed", "Far past"],
  overdue: ["red", "Overdue"],
};

function PastDeadline({ dashboard }) {
  return (
    <Section
      id="unit-past-deadline"
      title="Past deadline"
      description="Open tickets past their deadline, far past first."
      empty={
        dashboard.attention.length ? null : "No ticket is past its deadline."
      }
    >
      <table className="w-full text-sm">
        <thead className={thead}>
          <tr>
            <th scope="col" className={th}>
              Ticket
            </th>
            <th scope="col" className={th}>
              Assignee
            </th>
            <th scope="col" className={th}>
              Level
            </th>
            <th scope="col" className={th}>
              Raised
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {dashboard.attention.map((item) => {
            const [tone, label] = LEVEL[item.level] ?? ["red", item.level];
            return (
              <tr key={item.ticketId} data-testid={`late-${item.reference}`}>
                <td className={td}>
                  <TicketLink reference={item.reference} />
                  <div className="text-xs text-muted">{item.categoryName}</div>
                </td>
                <td className={td}>
                  {item.assigneeName ?? (
                    <span className="text-muted">Unassigned</span>
                  )}
                </td>
                <td className={td}>
                  <Chip tone={tone}>{label}</Chip>
                </td>
                <td className={`${td} whitespace-nowrap text-body`}>
                  {formatDueWat(item.since)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

const quietLink =
  "inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-sm font-semibold text-brand-navy hover:border-brand-navy";

/**
 * One unit's dashboard (GET /api/dashboard/unit/{unitId}), refreshed every 2 minutes: Needs
 * attention, Unit pool, Escalated to me, Team, Categories, Past deadline. `eyebrow`, `actions` and
 * `children` (a unit switcher) go into the page header. `own`: the head looking at their own unit
 * ("Escalated to me", and Pick); an HOD or Super Admin sees "Escalated to the head" and no Pick.
 * `embedded`: only the sections, for the Overview tab of My unit (which has its own header).
 * The unit's tools (categories, team and skills, replies) are on My unit (/units/{unitId}).
 */
export default function UnitDashboard({
  unitId,
  own = false,
  embedded = false,
  back,
  eyebrow,
  actions,
  children,
}) {
  const query = useUnitDashboard(unitId);

  if (query.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the unit dashboard…" />
      </div>
    );
  }
  if (query.isError && !query.data) {
    const { status, message } = query.error;
    if (status === 403)
      return (
        <MessageCard icon={ShieldOff} title="You are not allowed to see this">
          <p>
            A unit dashboard is for the head of the unit, the Head of
            Department, the Department Admin and Super Admin.
          </p>
        </MessageCard>
      );
    if (status === 404)
      return (
        <MessageCard icon={Compass} title="Unit not found">
          <p>This unit does not exist, or it has been removed.</p>
        </MessageCard>
      );
    return (
      <p role="alert" className="text-sm text-danger">
        {message}
      </p>
    );
  }

  const dashboard = query.data;
  const sections = (
    <>
      <NeedsAttention dashboard={dashboard} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Pool dashboard={dashboard} own={own} />
        <Escalated dashboard={dashboard} own={own} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Team dashboard={dashboard} />
        <Categories dashboard={dashboard} />
      </div>
      <PastDeadline dashboard={dashboard} />
      <UnitPerformance
        unitId={dashboard.unitId}
        unitName={dashboard.unitName}
        queueLink={(filter) => unitQueue(dashboard, filter)}
      />
    </>
  );
  if (embedded) return <div className="space-y-6">{sections}</div>;
  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={dashboard.unitName}
        eyebrow={
          eyebrow ?? (
            <UnitEyebrow
              unitName={dashboard.unitName}
              departmentName={dashboard.departmentName}
            />
          )
        }
        description={`Dashboard · Updated ${formatWatClock(dashboard.generatedAt)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={`/units/${dashboard.unitId}`} className={quietLink}>
              <Settings2 aria-hidden="true" size={16} />
              {own ? "My unit" : "Unit details"}
            </Link>
            <Link
              to={`/reports?unit=${dashboard.unitId}`}
              state={{ unitName: dashboard.unitName }}
              className={quietLink}
            >
              <BarChart3 aria-hidden="true" size={16} />
              Unit reports
            </Link>
            <Link
              to={`/availability/units/${dashboard.unitId}`}
              className={quietLink}
            >
              <CalendarDays aria-hidden="true" size={16} />
              Availability
            </Link>
            {actions}
          </div>
        }
      >
        {children}
      </PageHeader>
      {sections}
    </div>
  );
}
