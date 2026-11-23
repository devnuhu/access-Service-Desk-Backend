import { useState } from "react";
import ChartLegend from "./ChartLegend.jsx";
import ChartTooltip from "./ChartTooltip.jsx";
import { HATCH } from "./palette.js";
import useWidth from "./useWidth.js";

/**
 * Horizontal bars, one row per item, drawn in HTML so names and figures stay readable at any
 * width. Each row can have several bars (grouped), and a bar several segments (stacked, e.g. Open
 * now with On hold inside, hatched). `rows`: [{ key, label, sub?, color?, values: { segmentKey:
 * number | null }, onSelect?, actionLabel?, extra?: [{ label, value }] }]; actionLabel names what
 * onSelect does for a screen reader ("Open 3 High priority tickets"). `bars`: [{ key, label, segments: [{
 * key, label, color, hatched? }] }]. A bar whose values are all null shows "No data". The value is
 * printed at the end of each bar; hovering or focusing a row shows every figure. `reference`: a
 * dashed guide line { value, label, note }. With two or more legend items the legend toggles them.
 */
export default function BarList({
  rows,
  bars,
  max: fixedMax,
  format = (v) => String(v),
  reference,
  emptyText = "Nothing in this period",
  highlight,
  label,
  testId,
}) {
  const [ref, width] = useWidth();
  const [hidden, setHidden] = useState([]);
  const [tip, setTip] = useState(null);
  const legendItems = bars.flatMap((bar) =>
    bar.segments.map((s) => ({ ...s, key: s.key })),
  );
  const visibleBars = bars
    .map((bar) => ({
      ...bar,
      segments: bar.segments.filter((s) => !hidden.includes(s.key)),
    }))
    .filter((bar) => bar.segments.length);
  const toggle = (key) =>
    setHidden((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );

  const total = (row, bar) =>
    bar.segments.reduce((sum, s) => sum + (row.values[s.key] ?? 0), 0);
  const allNull = (row, bar) =>
    bar.segments.every((s) => row.values[s.key] == null);
  const largest = Math.max(
    0,
    ...rows.flatMap((row) => visibleBars.map((bar) => total(row, bar))),
  );
  const max = fixedMax ?? (largest || 1);
  const empty =
    !rows.length ||
    rows.every((row) =>
      visibleBars.every((bar) => allNull(row, bar) || total(row, bar) === 0),
    );

  const showTip = (row, event) => {
    const box = ref.current?.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    setTip({
      x: box ? target.left - box.left + target.width / 2 : 0,
      y: box ? target.top - box.top - 4 : 0,
      title: row.label,
      lines: [
        ...bars.flatMap((bar) =>
          bar.segments.map((s) => ({
            label: s.label,
            value:
              row.values[s.key] == null ? "No data" : format(row.values[s.key]),
            color: row.color ?? s.color,
            hatched: s.hatched,
          })),
        ),
        ...(row.extra ?? []),
      ],
      note: reference?.note,
    });
  };

  return (
    <figure data-testid={testId} aria-label={label} className="space-y-2">
      {legendItems.length > 1 && (
        <ChartLegend items={legendItems} hidden={hidden} onToggle={toggle} />
      )}
      <div ref={ref} className="relative">
        {empty ? (
          <p className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted">
            {emptyText}
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => {
              const name = (
                <>
                  <span className="block truncate">{row.label}</span>
                  {row.sub && (
                    <span className="block truncate text-[11px] font-normal text-muted">
                      {row.sub}
                    </span>
                  )}
                </>
              );
              const lit = highlight != null && highlight === row.key;
              return (
                <li
                  key={row.key}
                  data-testid={`bar-row-${row.key}`}
                  className={`grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-3 rounded-md px-1 py-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] ${lit ? "bg-brand-navy-light ring-1 ring-brand-navy/30" : ""}`}
                  onMouseEnter={(event) => showTip(row, event)}
                  onMouseLeave={() => setTip(null)}
                >
                  {row.onSelect ? (
                    <button
                      type="button"
                      onClick={row.onSelect}
                      aria-label={row.actionLabel}
                      onFocus={(event) => showTip(row, event)}
                      onBlur={() => setTip(null)}
                      title={row.label}
                      className="min-w-0 rounded text-left text-sm font-semibold text-brand-navy underline-offset-2 hover:underline"
                    >
                      {name}
                    </button>
                  ) : (
                    <span
                      tabIndex={0}
                      onFocus={(event) => showTip(row, event)}
                      onBlur={() => setTip(null)}
                      title={row.label}
                      className="min-w-0 text-sm font-semibold text-ink outline-none"
                    >
                      {name}
                    </span>
                  )}
                  <div className="relative min-w-0 space-y-1">
                    {visibleBars.map((bar) => {
                      const sum = total(row, bar);
                      const none = allNull(row, bar);
                      return (
                        <div
                          key={bar.key}
                          className="flex min-w-0 items-center gap-1.5"
                        >
                          {none ? (
                            <span className="text-xs text-muted">No data</span>
                          ) : (
                            <>
                              <span
                                className="flex h-3 min-w-0 gap-0.5 overflow-hidden"
                                style={{
                                  width: `${Math.max(0, (sum / max) * 100) * 0.82}%`,
                                }}
                              >
                                {bar.segments.map((s) => {
                                  const v = row.values[s.key] ?? 0;
                                  if (!v) return null;
                                  return (
                                    <span
                                      key={s.key}
                                      data-testid="bar-segment"
                                      className="h-full first:rounded-l-sm last:rounded-r"
                                      style={{
                                        flex: `${v} 0 0`,
                                        backgroundColor: row.color ?? s.color,
                                        backgroundImage: s.hatched
                                          ? HATCH
                                          : undefined,
                                      }}
                                    />
                                  );
                                })}
                              </span>
                              <span className="shrink-0 text-xs font-semibold text-ink tabular-nums">
                                {format(sum)}
                              </span>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!empty && reference && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-3 px-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]"
            style={{ left: 0, right: 0 }}
          >
            <span />
            <span className="relative">
              <span
                className="absolute inset-y-0 border-l-2 border-dashed"
                style={{
                  left: `${(reference.value / max) * 82}%`,
                  borderColor: "var(--viz-guide)",
                }}
              />
            </span>
          </div>
        )}
        <ChartTooltip tip={tip} width={width} />
      </div>
      {!empty && reference && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <span
            aria-hidden="true"
            className="inline-block h-3 border-l-2 border-dashed"
            style={{ borderColor: "var(--viz-guide)" }}
          />
          {reference.label}
        </p>
      )}
    </figure>
  );
}
