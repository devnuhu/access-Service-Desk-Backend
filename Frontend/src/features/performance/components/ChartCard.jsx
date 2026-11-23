import InfoTip from "./InfoTip.jsx";

/** A titled chart box (with its help and optional actions on the right). */
export default function ChartCard({ title, help, actions, children, testId }) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className="min-w-0 rounded-card border border-line bg-white px-4 py-4 shadow-card"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-ink">
          {title}
          {help && <InfoTip text={help} label={`About ${title}`} />}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}
