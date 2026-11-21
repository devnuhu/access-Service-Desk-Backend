import { useEffect, useState } from "react";
import { Link, useBlocker, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgDepartments } from "@/features/org";
import {
  Button,
  Card,
  ConfirmDialog,
  MessageCard,
  Spinner,
  useToast,
  PageHeader,
} from "@/shared/ui";
import CoverBanner from "../components/CoverBanner.jsx";
import SkillsGrid from "../components/SkillsGrid.jsx";
import {
  refreshCatalogue,
  useSetSkills,
  useUnitSkills,
} from "../hooks/useCatalogueAdmin.js";
import { isShortOfCover, sameSet, skillsModel } from "../skills.js";

/**
 * The skills matrix of one unit (Super Admin): which members handle which of its categories.
 * Ticks stay local until Save changes, which sends one PUT per changed person, one after another,
 * then refetches the matrix and the cover warnings. A failed PUT stops the run and keeps the rows
 * that were not saved.
 */
export default function SkillsMatrixPage() {
  const { unitId } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();
  const matrix = useUnitSkills(unitId);
  const departments = useOrgDepartments();
  const setSkills = useSetSkills();
  const [edits, setEdits] = useState({});
  const [failedId, setFailedId] = useState(null);
  const [saving, setSaving] = useState(false);

  const model = matrix.data ? skillsModel(matrix.data, edits) : null;
  const dirty = Boolean(model?.changed.length);

  // Leaving with unsaved ticks asks first: in-app links and the back button (blocker), and
  // reloading or closing the tab (beforeunload).
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (matrix.isLoading) {
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the skills matrix…" />
      </div>
    );
  }
  if (matrix.isError) {
    return matrix.error.status === 404 ? (
      <MessageCard
        title="Unit not found"
        linkTo="/admin/categories"
        linkText="Back to Categories"
      >
        <p>This unit does not exist, or it was removed.</p>
      </MessageCard>
    ) : (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {matrix.error.message}
      </p>
    );
  }

  const { unitName, categories, members, warnings } = matrix.data;
  const department = departments.data?.find((d) =>
    d.units.some((u) => u.id === unitId),
  );

  // Saved rows leave the local edits only after the refetch (so they never flash their old ticks),
  // and only if they still hold the set that was sent: a tick made while saving is kept.
  const save = async () => {
    setSaving(true);
    setFailedId(null);
    const saved = [];
    try {
      for (const member of model.changed) {
        const sent = edits[member.userId];
        try {
          const result = await setSkills.mutateAsync({
            unitId,
            userId: member.userId,
            categoryIds: [...sent],
          });
          if (isShortOfCover(result.message)) toast.warning(result.message);
          else toast.success(result.message);
          saved.push([member.userId, sent]);
        } catch (error) {
          setFailedId(member.userId);
          toast.error(error.message, {
            title: `Not saved for ${member.fullName || member.userName}`,
          });
          break;
        }
      }
    } finally {
      await refreshCatalogue(queryClient);
      setEdits((current) => {
        const next = { ...current };
        for (const [userId, sent] of saved) {
          if (next[userId] && sameSet(next[userId], sent)) delete next[userId];
        }
        return next;
      });
      setSaving(false);
    }
  };

  const discard = () => {
    setEdits({});
    setFailedId(null);
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          back={`/admin/units/${unitId}`}
          title={`${unitName}: skills matrix`}
          crumb="Skills"
          trail={[
            { label: "Units", to: "/admin/units" },
            ...(department ? [{ label: department.name }] : []),
            { label: unitName, to: `/admin/units/${unitId}` },
          ]}
          description="Tick the categories each member handles. Each active category needs at least two case workers."
        />
        <Link
          to="/admin/categories"
          className="text-sm font-semibold text-brand-navy hover:underline"
        >
          Categories
        </Link>
      </div>

      <CoverBanner warnings={warnings} matrixLinks={false} />

      <Card>
        {categories.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            {unitName} owns no categories yet.{" "}
            <Link
              to="/admin/categories"
              className="font-semibold text-brand-navy hover:underline"
            >
              Add one in Categories
            </Link>
            .
          </p>
        ) : members.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            {unitName} has no members.{" "}
            <Link
              to={`/admin/units/${unitId}`}
              className="font-semibold text-brand-navy hover:underline"
            >
              Add members on the unit page
            </Link>
            .
          </p>
        ) : (
          <>
            <SkillsGrid
              categories={categories}
              members={members}
              valueFor={model.valueFor}
              canTick={model.canTick}
              countFor={model.countFor}
              onChange={(member, next) => {
                setEdits(model.withChange(member, next));
                if (failedId === member.userId) setFailedId(null);
              }}
              changed={model.changedIds}
              failedId={failedId}
            />
            <p
              id="skills-keyboard-hint"
              className="border-t border-line px-4 py-2 text-xs text-muted"
            >
              Keyboard: arrow keys move between cells, Space ticks or clears.
              Switched-off categories cannot be newly ticked.
            </p>
          </>
        )}
      </Card>

      {dirty && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="sticky bottom-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-card border border-brand-orange bg-white px-5 py-3 shadow-lg"
        >
          <p className="text-sm font-semibold text-ink">
            {model.changed.length === 1
              ? "1 person changed"
              : `${model.changed.length} people changed`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={discard} disabled={saving}>
              Discard
            </Button>
            <Button onClick={save} busy={saving} busyText="Saving…">
              Save changes
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Leave without saving?"
        message="Your ticks in the skills matrix have not been saved."
        confirmLabel="Leave"
        danger
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />
    </div>
  );
}
