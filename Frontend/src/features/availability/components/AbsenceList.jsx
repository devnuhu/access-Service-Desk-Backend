import { useState } from "react";
import { daysInclusive, formatRange } from "@/shared/lib/dates";
import { formatWat } from "@/shared/lib/time";
import { Button, Chip, ConfirmDialog, useToast } from "@/shared/ui";
import { ABSENCE_KIND } from "../api/endpoints.js";
import { hasStarted, kindLabel } from "../absenceText.js";
import { useCancelAbsence } from "../hooks/useAvailability.js";

/**
 * Current and future periods. A future period can be cancelled; a started one ends early (the
 * person is available from today).
 */
export default function AbsenceList({
  absences,
  today,
  emptyText = "Nothing recorded.",
}) {
  const toast = useToast();
  const cancel = useCancelAbsence();
  const [confirm, setConfirm] = useState(null);

  if (absences.length === 0)
    return <p className="text-sm text-muted">{emptyText}</p>;

  const run = async () => {
    try {
      const result = await cancel.mutateAsync(confirm.id);
      toast.success(result.message || "Done");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setConfirm(null);
    }
  };

  const started = confirm && hasStarted(confirm, today);

  return (
    <>
      <ul className="divide-y divide-line" aria-label="Leave periods">
        {absences.map((absence) => {
          const days = daysInclusive(absence.startDate, absence.endDate);
          const current = hasStarted(absence, today);
          return (
            <li
              key={absence.id}
              className="flex flex-wrap items-start justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                  <Chip
                    tone={
                      absence.kind === ABSENCE_KIND.OutOfOffice
                        ? "navy"
                        : "orange"
                    }
                  >
                    {kindLabel(absence.kind)}
                  </Chip>
                  {formatRange(absence.startDate, absence.endDate)} ({days}{" "}
                  {days === 1 ? "day" : "days"})
                </p>
                {absence.note && (
                  <p className="mt-1 text-sm text-body">{absence.note}</p>
                )}
                <p className="mt-1 text-xs text-muted">
                  Recorded by {absence.recordedBy || "—"} ·{" "}
                  {formatWat(absence.recordedAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirm(absence)}
              >
                {current ? "End early" : "Cancel"}
              </Button>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={started ? "End this period early?" : "Cancel this period?"}
        message={
          started
            ? "You will be available from today."
            : "The period is removed. Nothing has been taken yet."
        }
        confirmLabel={started ? "End early" : "Cancel period"}
        danger
        busy={cancel.isPending}
        onConfirm={run}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
