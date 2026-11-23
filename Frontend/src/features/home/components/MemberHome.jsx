import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck2, CalendarX2, CircleAlert, Hand } from "lucide-react";
import { firstNameOf, useSession } from "@/features/auth";
import { ABSENCE_KIND, useMyAvailability } from "@/features/availability";
import { MyPerformancePanel } from "@/features/performance";
import { RaiseTicketLink, usePool, useTicketList } from "@/features/tickets";
import { formatWatClock } from "@/shared/lib/time";
import { Card, PageHeader, Spinner } from "@/shared/ui";
import { useDashboardSummary } from "../hooks/useDashboard.js";

const RESOLVED = 5;
const UNIT_KEY = "asd.home.unit";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** "2026-11-24" -> "24 Nov 2026" (a calendar date). */
function formatDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return value ?? "";
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

function readStoredUnit() {
  try {
    return window.localStorage.getItem(UNIT_KEY);
  } catch {
    return null;
  }
}

function storeUnit(id) {
  try {
    window.localStorage.setItem(UNIT_KEY, id);
  } catch {
    // Private windows may refuse storage: the switch still works for this visit.
  }
}

const TONES = {
  warning: "text-brand-orange-ink",
  overdue: "text-danger",
  farPast: "text-danger",
  escalated: "text-brand-orange-ink",
};

/** A count; with `to` the whole tile opens the list it counts. Colour only above 0. */
function Tile({ label, count, to, tone, testId }) {
  const body = (
    <>
      <span className="text-sm text-muted">{label}</span>
      <span
        data-testid={testId}
        className={`text-3xl font-semibold tabular-nums ${count > 0 && tone ? tone : "text-ink"}`}
      >
        {count ?? "–"}
      </span>
    </>
  );
  const box =
    "flex h-full flex-col justify-between gap-2 rounded-card border border-line bg-white px-4 py-3.5 shadow-card";
  return (
    <li>
      {to ? (
        <Link
          to={to}
          className={`${box} hover:border-brand-navy hover:bg-brand-navy-light/40`}
        >
          {body}
        </Link>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

function Availability() {
  const mine = useMyAvailability();
  const data = mine.data;
  const away = data?.current;
  return (
    <Card className="flex h-full flex-col justify-between gap-3 px-5 py-4">
      <div>
        <h2 className="text-sm text-muted">My availability</h2>
        {mine.isLoading ? (
          <Spinner label="Loading…" />
        ) : !data ? (
          <p className="mt-1 text-sm text-danger">{mine.error?.message}</p>
        ) : away ? (
          <p
            data-testid="my-availability"
            className="mt-1 flex items-center gap-2 text-lg font-semibold text-brand-orange-ink"
          >
            <CalendarX2 aria-hidden="true" size={20} />
            {away.kind === ABSENCE_KIND.OutOfOffice
              ? "Out of office"
              : "On leave"}{" "}
            until {formatDay(away.endDate)}
          </p>
        ) : (
          <p
            data-testid="my-availability"
            className="mt-1 flex items-center gap-2 text-lg font-semibold text-brand-green-text"
          >
            <CalendarCheck2 aria-hidden="true" size={20} />
            Available today
          </p>
        )}
      </div>
      <Link
        to="/availability"
        className="text-sm font-semibold text-brand-navy hover:underline"
      >
        Record leave or out of office
      </Link>
    </Card>
  );
}

/**
 * A case worker's home: their unit on top (a switcher when they work in more than one unit,
 * remembered in this browser), their own work from GET /api/dashboard/summary `mine`, "Escalated
 * by me" (the total of GET /api/tickets?view=assigned&escalated=true&open=true), the unit pool
 * (GET /api/pool for this unit) with Pick up, and their availability. No team workload and no head
 * controls: those are on the head's unit dashboard.
 *
 * @param {{ units: { id: string, name: string, departmentId: string, departmentName: string }[] }} props
 */
export default function MemberHome({ units }) {
  const { user } = useSession();
  const [chosen, setChosen] = useState(readStoredUnit);
  const unit = units.find((u) => u.id === chosen) ?? units[0];
  const summary = useDashboardSummary();
  const escalated = useTicketList({
    view: "assigned",
    escalated: true,
    open: true,
    page: 1,
    pageSize: 1,
  });
  const pool = usePool();
  const poolCount = pool.data?.filter((t) => t.unitId === unit.id).length;
  const mine = summary.data?.mine;

  const queue = `/departments/${unit.departmentId}/tickets`;
  const assigned = (filter = "") =>
    `${queue}?tab=assigned&status=open${filter}`;
  const tiles = [
    ["open", "Open", assigned(), mine?.open],
    [
      "waitingToStart",
      "Waiting to start",
      assigned("&waiting=1"),
      mine?.waitingToStart,
    ],
    ["warning", "Near the deadline", null, mine?.warning],
    ["overdue", "Overdue", assigned("&overdue=1"), mine?.overdue],
    ["farPast", "Far past", null, mine?.farPast],
    [
      "escalated",
      "Escalated by me",
      `${queue}?tab=assigned&escalated=1`,
      escalated.data?.total,
    ],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={unit.name}
        crumb="Home"
        eyebrow="My unit"
        description={`${unit.departmentName} · Welcome, ${firstNameOf(user)}`}
        actions={<RaiseTicketLink />}
      >
        {units.length > 1 && (
          <div
            role="group"
            aria-label="Your units"
            className="mt-4 inline-flex flex-wrap gap-1 rounded-lg border border-line bg-white p-1"
          >
            {units.map((u) => (
              <button
                key={u.id}
                type="button"
                aria-pressed={u.id === unit.id}
                onClick={() => {
                  setChosen(u.id);
                  storeUnit(u.id);
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${u.id === unit.id ? "bg-brand-navy text-white" : "text-body hover:bg-page"}`}
              >
                {u.name}
              </button>
            ))}
          </div>
        )}
      </PageHeader>

      {mine?.responseOverdue > 0 && (
        <Link
          to={assigned()}
          data-testid="response-overdue-notice"
          className="flex items-center gap-2.5 rounded-card border border-danger/30 bg-danger-light px-4 py-3 text-sm font-semibold text-danger hover:border-danger"
        >
          <CircleAlert aria-hidden="true" size={18} className="shrink-0" />
          {mine.responseOverdue}{" "}
          {mine.responseOverdue === 1 ? "ticket" : "tickets"} waiting for your
          first response. Acknowledge or reply.
        </Link>
      )}

      <section aria-labelledby="home-my-work" className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h2 id="home-my-work" className="text-base font-semibold">
            My work
          </h2>
          {summary.data && (
            <span className="text-xs text-muted">
              Updated {formatWatClock(summary.data.generatedAt)}
            </span>
          )}
        </div>
        {summary.isError && !summary.data ? (
          <p role="alert" className="text-sm text-danger">
            {summary.error.message}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {tiles.map(([key, label, to, count]) => (
              <Tile
                key={key}
                label={label}
                count={count}
                to={to ?? undefined}
                tone={TONES[key]}
                testId={`mine-${key}`}
              />
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex h-full flex-col justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="text-sm text-muted">Unit pool</h2>
            <p className="mt-1 flex items-baseline gap-2">
              <span
                data-testid="pool-waiting"
                className="text-3xl font-semibold text-ink tabular-nums"
              >
                {poolCount ?? "–"}
              </span>
              <span className="text-sm text-body">
                {poolCount === 1 ? "ticket waits" : "tickets wait"} for someone
                in {unit.name}
              </span>
            </p>
          </div>
          <Link
            to={`${queue}?tab=pool`}
            className="inline-flex h-9 w-fit items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-brand-navy hover:border-brand-navy"
          >
            <Hand aria-hidden="true" size={16} />
            Pick up
          </Link>
        </Card>
        <Availability />
      </div>

      {mine && (
        <section aria-labelledby="home-raised" className="space-y-3">
          <h2 id="home-raised" className="text-base font-semibold">
            Tickets I raised
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Tile
              label="Open"
              count={mine.raisedOpen}
              to="/tickets?status=open"
              testId="raised-raisedOpen"
            />
            <Tile
              label="Waiting for my confirmation"
              count={mine.toConfirm}
              to={`/tickets?status=${RESOLVED}`}
              tone="text-brand-orange-ink"
              testId="raised-toConfirm"
            />
          </ul>
        </section>
      )}

      <MyPerformancePanel />
    </div>
  );
}
