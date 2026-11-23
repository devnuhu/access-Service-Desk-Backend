import { HEADLINE_NOTE, headlineIndicators } from "../headline.js";
import { HELP } from "../help.js";
import InfoTip from "./InfoTip.jsx";

/**
 * The six headline indicators (../headline.js), each a tile with its count and its share, and the
 * note on how time is counted. Breaches and misses turn amber only above 0; overdue turns red only
 * above 0. `testId` prefixes each tile ("perf-headline" -> "perf-headline-resolved").
 */
export default function HeadlinePanel({ figures, testId = "headline" }) {
  const items = headlineIndicators(figures);
  return (
    <section aria-label="Headline indicators" className="@container space-y-2">
      <ul
        data-testid={`${testId}-panel`}
        className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @5xl:grid-cols-6"
      >
        {items.map((item) => (
          <li
            key={item.key}
            data-testid={`${testId}-${item.key}`}
            data-alert={item.alert ? "true" : undefined}
            className={`flex h-full flex-col gap-1.5 rounded-card border px-4 py-3.5 shadow-card ${item.alert ? "border-brand-orange bg-brand-orange-light/50" : "border-line bg-white"}`}
          >
            <span className="flex items-center gap-1 text-sm text-muted">
              {item.label}
              {HELP.headline[item.key] && (
                <InfoTip
                  text={HELP.headline[item.key]}
                  label={`About ${item.label}`}
                />
              )}
            </span>
            <span
              data-testid={`${testId}-${item.key}-count`}
              className={`text-2xl font-semibold tabular-nums sm:text-3xl ${item.alert ? "text-brand-orange-ink" : "text-ink"}`}
            >
              {item.count}
            </span>
            {item.lines.map((line) => (
              <span
                key={line.key}
                data-testid={`${testId}-${item.key}-${line.key}`}
                className={`text-xs ${line.alert ? "font-semibold text-danger" : "text-muted"}`}
              >
                {line.text}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p data-testid={`${testId}-note`} className="text-xs text-muted">
        {HEADLINE_NOTE}
      </p>
    </section>
  );
}
