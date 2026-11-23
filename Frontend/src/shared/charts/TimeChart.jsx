import { useState } from "react";
import ChartLegend from "./ChartLegend.jsx";
import ChartTooltip from "./ChartTooltip.jsx";
import useWidth from "./useWidth.js";

const M = { left: 40, right: 12, top: 14, bottom: 26 };

/** 0..max with round ticks; counts get whole-number ticks (at least 0..4). */
function scale(max, type) {
  if (type === "percent") return { max: 100, step: 25 };
  if (max <= 4) return { max: 4, step: 1 };
  const raw = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((s) => s * magnitude).find((s) => s >= raw) ?? raw;
  const whole = Math.max(1, Math.ceil(step));
  return { max: whole * 4, step: whole };
}

/** A column with a 4px rounded top on the baseline. */
function columnPath(x, width, top, bottom) {
  const r = Math.min(4, width / 2, bottom - top);
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
}

/**
 * A chart over time buckets, on one value axis: grouped columns (kind "bar") or lines (kind
 * "line"). `labels` are the short axis labels, `titles` the tooltip titles. A line draws a point
 * only where its value is not null; across a gap the line continues dashed (always). Hover or
 * focus a bucket for the exact figures; the legend shows and hides series when there are two or
 * more. With nothing to show (every value null or 0) it says `emptyText`.
 */
export default function TimeChart({
  labels,
  titles = labels,
  series,
  kind = "bar",
  type = "count",
  format = (v) => String(v),
  height = 220,
  emptyText = "Nothing in this period",
  label,
  testId,
}) {
  const [ref, width] = useWidth();
  const [hidden, setHidden] = useState([]);
  const [hover, setHover] = useState(null);
  const shown = series.filter((s) => !hidden.includes(s.key));
  const toggle = (key) =>
    setHidden((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );

  const values = shown.flatMap((s) => s.values);
  const empty =
    !labels.length ||
    values.every((v) => v == null || (type !== "percent" && v === 0));

  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const { max, step } = scale(
    Math.max(0, ...values.filter((v) => v != null)),
    type,
  );
  const band = plotW / Math.max(1, labels.length);
  const xMid = (i) => M.left + band * (i + 0.5);
  const y = (v) => M.top + plotH - (Math.min(v, max) / max) * plotH;
  const baseline = M.top + plotH;
  const every = Math.max(1, Math.ceil(labels.length / Math.floor(plotW / 58)));
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);

  const tipFor = (i) => ({
    x: xMid(i),
    y: M.top + 4,
    title: titles[i],
    lines: shown.map((s) => ({
      label: s.label,
      value: s.values[i] == null ? "No data" : format(s.values[i]),
      color: s.color,
      line: kind === "line",
    })),
  });

  const legend =
    series.length > 1 ? (
      <ChartLegend
        items={series.map((s) => ({
          key: s.key,
          label: s.label,
          color: s.color,
          line: kind === "line",
        }))}
        hidden={hidden}
        onToggle={toggle}
      />
    ) : null;

  return (
    <figure data-testid={testId} className="space-y-2">
      {legend}
      {/* The SVG sits out of the flow, so its size never feeds back into the measured width. */}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {empty ? (
          <p
            className="flex items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted"
            style={{ height }}
          >
            {emptyText}
          </p>
        ) : (
          <svg
            role="img"
            aria-label={label}
            width={width}
            height={height}
            className="absolute inset-0 overflow-visible"
          >
            <g fontSize="11" style={{ fill: "var(--viz-text)" }}>
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={M.left}
                    x2={M.left + plotW}
                    y1={y(tick)}
                    y2={y(tick)}
                    style={{ stroke: "var(--viz-grid)" }}
                  />
                  <text x={M.left - 6} y={y(tick) + 4} textAnchor="end">
                    {type === "percent" ? `${tick}%` : tick}
                  </text>
                </g>
              ))}
              {labels.map((text, i) =>
                i % every === 0 ? (
                  <text key={i} x={xMid(i)} y={height - 8} textAnchor="middle">
                    {text}
                  </text>
                ) : null,
              )}
            </g>

            {hover !== null && kind === "bar" && (
              <rect
                x={M.left + band * hover}
                y={M.top}
                width={band}
                height={plotH}
                style={{ fill: "var(--viz-grid)", opacity: 0.5 }}
              />
            )}
            {hover !== null && kind === "line" && (
              <line
                x1={xMid(hover)}
                x2={xMid(hover)}
                y1={M.top}
                y2={baseline}
                strokeDasharray="3 3"
                style={{ stroke: "var(--viz-guide)" }}
              />
            )}

            {kind === "bar" &&
              (() => {
                const gap = 2;
                const n = shown.length;
                const barW = Math.max(
                  2,
                  Math.min(18, (band * 0.72 - gap * (n - 1)) / n),
                );
                const groupW = barW * n + gap * (n - 1);
                return labels.map((_, i) =>
                  shown.map((s, k) => {
                    const v = s.values[i];
                    if (!v) return null;
                    const x = M.left + band * i + (band - groupW) / 2;
                    return (
                      <path
                        key={`${s.key}-${i}`}
                        data-testid="chart-bar"
                        d={columnPath(
                          x + k * (barW + gap),
                          barW,
                          y(v),
                          baseline,
                        )}
                        style={{ fill: s.color }}
                      />
                    );
                  }),
                );
              })()}

            {kind === "line" &&
              shown.map((s) => {
                const points = s.values
                  .map((v, i) =>
                    v == null ? null : { i, x: xMid(i), y: y(v) },
                  )
                  .filter(Boolean);
                const solid = [];
                const dashed = [];
                points.forEach((p, n) => {
                  if (!n) return;
                  const prev = points[n - 1];
                  (p.i - prev.i === 1 ? solid : dashed).push(
                    `M${prev.x},${prev.y} L${p.x},${p.y}`,
                  );
                });
                return (
                  <g key={s.key}>
                    {dashed.length > 0 && (
                      <path
                        data-testid="chart-gap"
                        d={dashed.join(" ")}
                        fill="none"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        style={{ stroke: s.color, opacity: 0.7 }}
                      />
                    )}
                    <path
                      d={solid.join(" ")}
                      fill="none"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      style={{ stroke: s.color }}
                    />
                    {points.map((p) => (
                      <circle
                        key={p.i}
                        data-testid="chart-point"
                        cx={p.x}
                        cy={p.y}
                        r={hover === p.i ? 5 : 4}
                        strokeWidth="2"
                        style={{ fill: s.color, stroke: "var(--viz-surface)" }}
                      />
                    ))}
                  </g>
                );
              })}

            <line
              x1={M.left}
              x2={M.left + plotW}
              y1={baseline}
              y2={baseline}
              style={{ stroke: "var(--viz-axis)" }}
            />

            {labels.map((_, i) => (
              <rect
                key={i}
                x={M.left + band * i}
                y={M.top}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${titles[i]}: ${shown
                  .map(
                    (s) =>
                      `${s.label} ${s.values[i] == null ? "No data" : format(s.values[i])}`,
                  )
                  .join(", ")}`}
                className="outline-none focus:stroke-brand-navy"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
        )}
        {!empty && hover !== null && (
          <ChartTooltip tip={tipFor(hover)} width={width} />
        )}
      </div>
    </figure>
  );
}
