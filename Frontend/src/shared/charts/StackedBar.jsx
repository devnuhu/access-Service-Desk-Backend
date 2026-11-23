import { Swatch } from "./ChartLegend.jsx";

/**
 * Parts of a whole in one horizontal bar, with a labelled key under it (name, count and share), so
 * nothing relies on colour alone. `items`: [{ key, label, count, color }]. Each segment and key
 * entry shows its exact figures on hover (title) and to screen readers.
 */
export default function StackedBar({
  items,
  emptyText = "Nothing open right now",
  label,
  testId,
}) {
  const shown = items.filter((item) => item.count > 0);
  const total = shown.reduce((sum, item) => sum + item.count, 0);
  const share = (count) => `${Math.round((count / total) * 100)}%`;
  if (!total)
    return (
      <p
        data-testid={testId}
        className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted"
      >
        {emptyText}
      </p>
    );
  return (
    <figure data-testid={testId} aria-label={label} className="space-y-3">
      <div className="flex h-5 w-full gap-0.5 overflow-hidden rounded-md">
        {shown.map((item) => (
          <span
            key={item.key}
            title={`${item.label}: ${item.count} (${share(item.count)})`}
            className="h-full"
            style={{ flex: `${item.count} 0 0`, background: item.color }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
        {shown.map((item) => (
          <li
            key={item.key}
            data-testid={`part-${item.key}`}
            className="flex items-center gap-2"
          >
            <Swatch color={item.color} />
            <span className="min-w-0 truncate text-body">{item.label}</span>
            <span className="ml-auto font-semibold text-ink tabular-nums">
              {item.count}
            </span>
            <span className="w-9 text-right text-xs text-muted tabular-nums">
              {share(item.count)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
