import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * "Back": to the page the person came from in the app, or, when they landed here directly (a
 * link, a refresh), to `to`, the page this one sits under.
 */
export default function BackLink({ to, label = "Back" }) {
  const navigate = useNavigate();
  const location = useLocation();
  // The first page of a visit has the key "default": there is nothing in the app to go back to.
  const hasHistory = location.key !== "default";
  return (
    <button
      type="button"
      onClick={() => (hasHistory ? navigate(-1) : navigate(to))}
      className="-ml-1.5 mb-3 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-muted hover:bg-white hover:text-brand-navy"
    >
      <ArrowLeft aria-hidden="true" size={16} />
      {label}
    </button>
  );
}
