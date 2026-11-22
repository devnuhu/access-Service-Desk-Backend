import { useState } from "react";
import { Info, Plus, ShieldOff } from "lucide-react";
import { PRIORITY_LABELS, PriorityChip } from "@/features/catalogue";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  ConfirmDialog,
  MessageCard,
  PageHeader,
  Spinner,
  useToast,
} from "@/shared/ui";
import PolicyDialog from "../components/PolicyDialog.jsx";
import { useDeleteSlaPolicy, useSlaPolicies } from "../hooks/useSlaPolicies.js";

const th =
  "px-4 py-3 text-[11px] font-semibold tracking-wider text-muted uppercase";
const td = "px-4 py-3";
const hours = (n) => `${n} h`;

/** Who a row is for: its scope and name. */
const scopeLabel = (row) =>
  row.scope === "category"
    ? "Category"
    : row.scope === "department"
      ? "Department"
      : "Default";
const nameOf = (row) => row.categoryName ?? row.departmentName ?? "";

/**
 * Administration > Service levels (Super Admin): the default first-response and resolution targets
 * per priority, and the department and category overrides. The most specific level wins: category,
 * then department, then the default. A 403 shows a plain "not allowed".
 */
export default function ServiceLevelsPage() {
  const toast = useToast();
  const policies = useSlaPolicies();
  const remove = useDeleteSlaPolicy();
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);

  if (policies.isError && policies.error.status === 403)
    return (
      <MessageCard icon={ShieldOff} title="You are not allowed to see this">
        <p>{policies.error.message}</p>
      </MessageCard>
    );

  const saved = (row) => {
    setEditing(null);
    toast.success(
      `First response ${hours(row.responseHours)}, resolution ${hours(row.resolutionHours)}.`,
      {
        title: `${PRIORITY_LABELS[row.priority]} ${row.scope === "global" ? "default" : `for ${nameOf(row)}`} saved`,
      },
    );
  };

  const confirmRemove = async () => {
    try {
      const result = await remove.mutateAsync(removing.id);
      toast.success(result.message, {
        title:
          removing.scope === "global"
            ? `${PRIORITY_LABELS[removing.priority]} is back to the built-in default`
            : `Override for ${nameOf(removing)} removed`,
      });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRemoving(null);
    }
  };

  const global = policies.data?.global ?? [];
  const overrides = policies.data?.overrides ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Service levels"
        description="How fast requests must be answered and resolved, by priority."
      />

      <p
        data-testid="sla-help"
        className="flex items-start gap-2.5 rounded-card border border-brand-navy/15 bg-brand-navy-light px-4 py-3 text-sm text-ink"
      >
        <Info
          aria-hidden="true"
          size={17}
          className="mt-0.5 shrink-0 text-brand-navy"
        />
        Hours are working hours (Mon-Fri 8-5, Lagos, holidays excluded). The
        most specific level wins: category, then department, then default. First
        response is counted from when the request is raised.
      </p>

      {policies.isLoading ? (
        <div className="py-10 text-center text-muted">
          <Spinner label="Loading service levels…" />
        </div>
      ) : policies.isError ? (
        <p role="alert" className="text-sm text-danger">
          {policies.error.message}
        </p>
      ) : (
        <>
          <Card>
            <CardHeader
              title="Default targets"
              description="Used for every ticket unless a department or category has its own."
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-page/60">
                  <tr>
                    <th scope="col" className={th}>
                      Priority
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      First response (working hours)
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Resolution (working hours)
                    </th>
                    <th scope="col" className={th}>
                      <span className="sr-only">Source</span>
                    </th>
                    <th scope="col" className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {global.map((row) => {
                    const label = PRIORITY_LABELS[row.priority];
                    return (
                      <tr key={row.priority} data-testid={`default-${label}`}>
                        <th scope="row" className={`${td} font-normal`}>
                          <PriorityChip priority={row.priority} />
                        </th>
                        <td className={`${td} text-right tabular-nums`}>
                          {hours(row.responseHours)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {hours(row.resolutionHours)}
                        </td>
                        <td className={td}>
                          {row.isDefault && (
                            <Chip tone="grey">Built-in default</Chip>
                          )}
                        </td>
                        <td className={td}>
                          <span className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing(row)}
                            >
                              Edit <span className="sr-only">{label}</span>
                            </Button>
                            {!row.isDefault && row.id && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => setRemoving(row)}
                              >
                                Reset to default{" "}
                                <span className="sr-only">{label}</span>
                              </Button>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Overrides"
              description="A department's or a category's own targets for a priority."
              actions={
                <Button onClick={() => setEditing({})}>
                  <Plus aria-hidden="true" size={16} />
                  Add override
                </Button>
              }
            />
            {overrides.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">
                No overrides. Every ticket uses the default targets.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-page/60">
                    <tr>
                      <th scope="col" className={th}>
                        Applies to
                      </th>
                      <th scope="col" className={th}>
                        Priority
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        First response
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Resolution
                      </th>
                      <th scope="col" className={th}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {overrides.map((row) => (
                      <tr
                        key={row.id}
                        data-testid={`override-${nameOf(row)}-${PRIORITY_LABELS[row.priority]}`}
                      >
                        <th
                          scope="row"
                          className={`${td} text-left font-normal`}
                        >
                          <span className="block font-semibold text-ink">
                            {nameOf(row)}
                          </span>
                          <span className="text-xs text-muted">
                            {scopeLabel(row)}
                          </span>
                        </th>
                        <td className={td}>
                          <PriorityChip priority={row.priority} />
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {hours(row.responseHours)}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>
                          {hours(row.resolutionHours)}
                        </td>
                        <td className={td}>
                          <span className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing(row)}
                            >
                              Edit{" "}
                              <span className="sr-only">
                                {nameOf(row)} {PRIORITY_LABELS[row.priority]}
                              </span>
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setRemoving(row)}
                            >
                              Remove{" "}
                              <span className="sr-only">
                                {nameOf(row)} {PRIORITY_LABELS[row.priority]}
                              </span>
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {editing && (
        <PolicyDialog
          row={editing.priority ? editing : undefined}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={
          removing?.scope === "global"
            ? `Reset ${PRIORITY_LABELS[removing.priority]} to the built-in default?`
            : `Remove the override for ${removing ? nameOf(removing) : ""}?`
        }
        message={
          removing?.scope === "global"
            ? "Tickets of this priority go back to the built-in targets."
            : "Its tickets use the level above (the department's, or the default) again."
        }
        confirmLabel={removing?.scope === "global" ? "Reset" : "Remove"}
        danger
        busy={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
