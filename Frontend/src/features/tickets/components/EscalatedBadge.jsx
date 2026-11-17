import { ArrowUpRight } from "lucide-react";
import { formatWat } from "@/shared/lib/time";
import { Chip } from "@/shared/ui";
import { sinceText } from "../ticketText.js";

/** "Escalated to unit head 2 hours ago" (WAT tooltip); `short` says "Escalated" for lists. */
export default function EscalatedBadge({ at, short = false }) {
  return (
    <Chip tone="orange" title={formatWat(at)} data-testid="escalated-badge">
      <ArrowUpRight aria-hidden="true" size={11} />
      {short ? "Escalated" : `Escalated to unit head ${sinceText(at)}`}
    </Chip>
  );
}
