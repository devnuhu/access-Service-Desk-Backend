import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { ageText, statusLabel } from "../ticketText.js";

/** Open tickets in the same category that mention the same RSA PIN. Raising stays allowed. */
export default function DuplicateBox({ matches }) {
  if (!matches.length) return null;
  return (
    <div
      role="status"
      data-testid="duplicate-box"
      className="flex gap-3 rounded-card border border-brand-orange bg-brand-orange-light px-4 py-3 text-sm text-brand-orange-ink"
    >
      <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
      <div>
        <ul className="space-y-0.5">
          {matches.map((match) => (
            <li key={match.reference}>
              Possible duplicate:{" "}
              {match.isYours ? (
                <Link
                  to={`/tickets/${match.reference}`}
                  className="font-semibold underline"
                >
                  {match.reference}
                </Link>
              ) : (
                <strong className="font-semibold">{match.reference}</strong>
              )}{" "}
              ({statusLabel(match.status)}, raised {ageText(match.createdAt)})
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs">
          Check it is not the same request. You can still raise this one.
        </p>
      </div>
    </div>
  );
}
