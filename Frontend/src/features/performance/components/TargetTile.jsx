import { formatHours, formatPercent, timeVerdict } from "../format.js";
import InfoTip from "./InfoTip.jsx";

const VERDICT_TONE = {
  "Better than the team": "text-brand-green-text",
  "Slower than the team": "text-brand-orange-ink",
  "Same as the team": "text-body",
};

/** One labelled bar on the shared scale; "No data" when there is nothing to measure. */
function Bar({ label, hours, max, color, thin = false, testId }) {
  return (
    <div className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {hours == null ? (
        <span data-testid={testId} className="text-xs text-muted">
          No data
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`${thin ? "h-2" : "h-3"} rounded-r`}
            style={{
              width: `${Math.max(1, (hours / max) * 78)}%`,
              background: color,
            }}
          />
          <span
            data-testid={testId}
            className="shrink-0 text-xs font-semibold text-ink tabular-nums"
          >
            {formatHours(hours)}
          </span>
        </span>
      )}
    </div>
  );
}

/**
 * A time against its target: the person's average and the team's on one scale, the target (the
 * Medium priority's) as a dashed line, a plain verdict against the team, and the in-time share.
 * Lower is better.
 */
export default function TargetTile({
  title,
  help,
  mine,
  team,
  target,
  targetLines,
  percentLabel,
  percent,
  testId,
}) {
  const known = [mine, team, target].filter((v) => v != null);
  const max = Math.max(1, ...known) * 1.1;
  const verdict = timeVerdict(mine, team);
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="flex flex-col gap-3 rounded-card border border-line bg-white px-4 py-4 shadow-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-ink">
          {title}
          <InfoTip
            text={[help, "Targets by priority:", ...targetLines]}
            label={`About ${title}`}
          />
        </h3>
        {verdict && (
          <span
            data-testid={`${testId}-verdict`}
            className={`text-xs font-semibold ${VERDICT_TONE[verdict]}`}
          >
            {verdict}
          </span>
        )}
      </div>
      <p className="flex items-baseline gap-2">
        <span
          data-testid={`${testId}-mine`}
          className={
            mine == null
              ? "text-base font-medium text-muted"
              : "text-2xl font-semibold text-ink tabular-nums"
          }
        >
          {formatHours(mine)}
        </span>
        <span className="text-xs text-muted">
          average
          {target != null && <> · target {formatHours(target)} (Medium)</>}
        </span>
      </p>
      <div className="relative space-y-1.5">
        <Bar label="You" hours={mine} max={max} color="#003883" />
        <Bar
          label="Team"
          hours={team}
          max={max}
          color="#9aa6b8"
          thin
          testId={`${testId}-team`}
        />
        {target != null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-[-4px] right-0 left-[calc(3.25rem+0.5rem)]"
          >
            <span
              className="absolute inset-y-0 border-l-2 border-dashed"
              style={{
                left: `${(target / max) * 78}%`,
                borderColor: "var(--viz-guide)",
              }}
            />
          </div>
        )}
      </div>
      <p className="flex items-center justify-between border-t border-line pt-2.5 text-sm">
        <span className="text-muted">{percentLabel}</span>
        <span
          data-testid={`${testId}-percent`}
          className={
            percent == null
              ? "text-sm text-muted"
              : "font-semibold text-ink tabular-nums"
          }
        >
          {formatPercent(percent)}
        </span>
      </p>
    </section>
  );
}
