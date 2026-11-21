import { Link } from "react-router-dom";
import { Plus } from "lucide-react";

/** The primary "Raise a ticket" link (My requests, Home). */
export default function RaiseTicketLink({ className = "" }) {
  return (
    <Link
      to="/tickets/new"
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border-b-[3px] border-brand-orange bg-brand-navy px-4 text-sm font-semibold text-white hover:bg-brand-navy-dark ${className}`}
    >
      <Plus aria-hidden="true" size={16} />
      Raise a ticket
    </Link>
  );
}
