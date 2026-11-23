import { Dialog, Spinner } from "@/shared/ui";
import { usePersonPerformance } from "../hooks/usePerformance.js";
import PersonPerformance from "./PersonPerformance.jsx";

/**
 * One of a head's people, opened from the unit view (a bar, a name or a table row): the same
 * figures and charts a case worker sees, for the same period, in a side panel. A 404 (not one of
 * theirs) shows as a plain message.
 */
export default function PersonPanel({ member, period, onClose }) {
  const query = usePersonPerformance(member.userId, period);
  return (
    <Dialog
      open
      side="right"
      size="wide"
      onClose={onClose}
      title={member.name}
      description={member.isHead ? "Head of the unit" : "Performance"}
    >
      {query.isLoading ? (
        <div className="py-10 text-center text-muted">
          <Spinner label="Loading the figures…" />
        </div>
      ) : query.isError ? (
        <p role="alert" className="text-sm text-danger">
          {query.error.status === 404
            ? "This person's figures are not available to you."
            : query.error.message}
        </p>
      ) : (
        <PersonPerformance data={query.data} />
      )}
    </Dialog>
  );
}
