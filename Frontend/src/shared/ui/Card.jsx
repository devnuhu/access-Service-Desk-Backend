/** White card with a 1px line border and 6px radius; no heavy shadow. */
export default function Card({
  as: Tag = "section",
  className = "",
  children,
  ...rest
}) {
  return (
    <Tag
      className={`rounded-card border border-line bg-white ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, actions, className = "" }) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 ${className}`}
    >
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        )}
      </div>
      {actions}
    </div>
  );
}
