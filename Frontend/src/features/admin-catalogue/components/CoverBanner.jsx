import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { coverTitle } from "../skills.js";

/**
 * Orange banner listing active categories with fewer than two eligible case workers (BRD 5.2).
 * Nothing is blocked; it is a warning. Hidden when the list is empty. `matrixLinks` adds a link to
 * each unit's skills matrix (not needed on the matrix itself).
 */
export default function CoverBanner({ warnings, matrixLinks = true }) {
  if (!warnings?.length) return null;
  return (
    <section
      aria-labelledby="cover-banner-title"
      data-testid="cover-banner"
      className="rounded-card border border-brand-orange bg-brand-orange-light px-5 py-4"
    >
      <h2
        id="cover-banner-title"
        className="flex items-center gap-2 text-sm font-semibold text-brand-orange-ink"
      >
        <TriangleAlert aria-hidden="true" size={18} />
        {coverTitle(warnings.length)}
      </h2>
      <ul className="mt-2 space-y-1 text-sm text-ink">
        {warnings.map((warning) => (
          <li
            key={warning.categoryId}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <span className="font-semibold">{warning.categoryName}</span>
            <span className="text-body">· {warning.unitName}</span>
            <span className="text-body">
              · {warning.eligibleCount} case worker
              {warning.eligibleCount === 1 ? "" : "s"}
            </span>
            {matrixLinks && (
              <Link
                to={`/admin/units/${warning.unitId}/skills`}
                className="font-semibold text-brand-navy hover:underline"
              >
                Skills matrix{" "}
                <span className="sr-only">for {warning.unitName}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
