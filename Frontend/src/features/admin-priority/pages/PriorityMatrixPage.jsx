import { useState } from "react";
import { Info, RotateCcw, ShieldOff } from "lucide-react";
import {
  defaultPriorityFor,
  PRIORITY,
  PRIORITY_LABELS,
  usePriorityMatrix,
} from "@/features/catalogue";
import {
  Button,
  Card,
  ConfirmDialog,
  MessageCard,
  PageHeader,
  Spinner,
  useToast,
} from "@/shared/ui";
import { useSavePriorityMatrix } from "../hooks/usePriorityMatrixAdmin.js";

/** The cell colours follow PriorityChip: Low grey, Medium navy, High orange, Critical red. */
const TONE = {
  [PRIORITY.Low]: "bg-page text-body ring-line",
  [PRIORITY.Medium]: "bg-brand-navy-light text-brand-navy ring-brand-navy/25",
  [PRIORITY.High]:
    "bg-brand-orange-light text-brand-orange-ink ring-brand-orange-ink/30",
  [PRIORITY.Critical]: "bg-danger-light text-danger ring-danger/30",
};

const key = (impact, urgency) => `${impact}-${urgency}`;
const NOT_ALLOWED = "This page is for Super Admin only.";

/**
 * Administration > Priority matrix (Super Admin): the priority a request gets for each answer pair
 * of "Who does this affect?" (rows) and "How urgent is it?" (columns). Save sends only the changed
 * cells; Reset sends every edited cell back at its default (impact + urgency: 2-3 Low, 4-5 Medium,
 * 6-7 High, 8 Critical), which the server treats as not edited.
 */
export default function PriorityMatrixPage() {
  const toast = useToast();
  const matrix = usePriorityMatrix();
  const save = useSavePriorityMatrix();
  // Unsaved choices by "impact-urgency".
  const [edits, setEdits] = useState({});
  const [failure, setFailure] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (matrix.isLoading)
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the priority matrix…" />
      </div>
    );
  if (matrix.isError)
    return matrix.error.status === 403 ? (
      <MessageCard icon={ShieldOff} title="You are not allowed to see this">
        <p>{NOT_ALLOWED}</p>
      </MessageCard>
    ) : (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {matrix.error.message}
      </p>
    );

  const { impacts, urgencies, cells } = matrix.data;
  const cellOf = (impact, urgency) =>
    cells.find((c) => c.impact === impact && c.urgency === urgency);
  const valueOf = (cell) =>
    edits[key(cell.impact, cell.urgency)] ?? cell.priority;
  const changed = cells.filter((cell) => valueOf(cell) !== cell.priority);
  const edited = cells.filter((cell) => !cell.isDefault);

  const send = async (toSend, done) => {
    setFailure(null);
    try {
      await save.mutateAsync(toSend);
      setEdits({});
      toast.success(done);
    } catch (error) {
      setFailure(error.status === 403 ? NOT_ALLOWED : error.message);
    }
  };

  const saveChanges = () =>
    send(
      changed.map((cell) => ({
        impact: cell.impact,
        urgency: cell.urgency,
        priority: valueOf(cell),
      })),
      `${changed.length} ${changed.length === 1 ? "cell" : "cells"} saved. New requests use them from now on.`,
    );

  const resetAll = async () => {
    setConfirmReset(false);
    await send(
      edited.map((cell) => ({
        impact: cell.impact,
        urgency: cell.urgency,
        priority: defaultPriorityFor(cell.impact, cell.urgency),
      })),
      "The priority matrix is back to its defaults.",
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Priority matrix"
        description="The priority a request gets from the requester's two answers: who it affects and how urgent it is."
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={saveChanges}
            disabled={!changed.length}
            busy={save.isPending}
            busyText="Saving…"
          >
            Save changes
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmReset(true)}
            disabled={!edited.length || save.isPending}
          >
            <RotateCcw aria-hidden="true" size={15} />
            Reset all to default
          </Button>
        </div>
      </PageHeader>

      {failure && (
        <p
          role="alert"
          className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-sm text-danger"
        >
          {failure}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">
              Priority by who it affects (rows) and how urgent it is (columns)
            </caption>
            <thead>
              <tr className="border-b border-line bg-page/60">
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-[12px] font-semibold tracking-wider text-muted uppercase"
                >
                  Who it affects{" "}
                  <span aria-hidden="true" className="text-line">
                    /
                  </span>{" "}
                  How urgent
                </th>
                {urgencies.map((urgency) => (
                  <th
                    key={urgency.value}
                    scope="col"
                    title={urgency.description || undefined}
                    className="px-3 py-3 text-left font-semibold text-ink"
                  >
                    {urgency.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {impacts.map((impact) => (
                <tr key={impact.value}>
                  <th
                    scope="row"
                    title={impact.description || undefined}
                    className="px-4 py-3 text-left font-semibold whitespace-nowrap text-ink"
                  >
                    {impact.label}
                  </th>
                  {urgencies.map((urgency) => {
                    const cell = cellOf(impact.value, urgency.value);
                    if (!cell) return <td key={urgency.value} />;
                    const value = valueOf(cell);
                    const unsaved = value !== cell.priority;
                    return (
                      <td
                        key={urgency.value}
                        data-testid={`cell-${impact.value}-${urgency.value}`}
                        className="px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <select
                            aria-label={`${impact.label}, ${urgency.label}`}
                            value={value}
                            onChange={(event) =>
                              setEdits((current) => ({
                                ...current,
                                [key(cell.impact, cell.urgency)]: Number(
                                  event.target.value,
                                ),
                              }))
                            }
                            className={`h-9 min-w-28 rounded-md border-0 px-2.5 text-sm font-semibold ring-1 ring-inset ${TONE[value]} ${unsaved ? "outline-2 outline-offset-2 outline-brand-navy outline-dashed" : ""}`}
                          >
                            {Object.values(PRIORITY).map((p) => (
                              <option key={p} value={p}>
                                {PRIORITY_LABELS[p]}
                              </option>
                            ))}
                          </select>
                          {unsaved ? (
                            <span className="text-[12px] font-medium text-brand-navy">
                              Unsaved
                            </span>
                          ) : cell.isDefault ? (
                            <span className="text-[12px] text-muted">
                              default
                            </span>
                          ) : (
                            <span
                              title="Edited"
                              className="h-2 w-2 rounded-full bg-brand-orange"
                            >
                              <span className="sr-only">Edited</span>
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="flex gap-2 text-sm text-muted">
        <Info aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
        Changes apply to requests raised from now on. Tickets already raised
        keep their priority. The service levels (response and resolution times)
        follow the priority.
      </p>

      <ConfirmDialog
        open={confirmReset}
        title="Reset the priority matrix?"
        message={`${edited.length} edited ${edited.length === 1 ? "cell goes" : "cells go"} back to the default. New requests use the defaults from now on.`}
        confirmLabel="Reset all to default"
        onConfirm={resetAll}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
