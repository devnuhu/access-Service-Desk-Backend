import { useState } from "react";
import { Eye } from "lucide-react";
import {
  CoverBanner,
  isShortOfCover,
  SkillsGrid,
  skillsModel,
} from "@/features/admin-catalogue";
import { ABSENCE_KIND, useUnitAvailability } from "@/features/availability";
import { Card, Chip, Spinner, useToast } from "@/shared/ui";
import { useMyUnitSkills, useSaveMemberSkills } from "../hooks/useMyUnit.js";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const formatDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  return match
    ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]}`
    : (value ?? "");
};

/**
 * Team and skills: members in rows, the unit's categories in columns. A tick saves that member's
 * whole set at once (PUT skills/{userId}, optimistic, put back on error); the server's message
 * shows as a toast (a warning when it leaves categories short of cover). The cover warnings sit
 * above. Who is away today comes from the unit's availability, when the person may see it.
 * `canEdit` false (the HOD): the matrix is shown, the ticks cannot change.
 */
export default function TeamSkillsTab({ unitId, canEdit }) {
  const toast = useToast();
  const skills = useMyUnitSkills(unitId);
  const availability = useUnitAvailability(unitId);
  const save = useSaveMemberSkills(unitId);
  const [saving, setSaving] = useState(() => new Set());

  if (skills.isLoading)
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the team…" />
      </div>
    );
  if (skills.isError)
    return (
      <p role="alert" className="py-10 text-center text-sm text-danger">
        {skills.error.message}
      </p>
    );

  const { categories, members, warnings } = skills.data;
  const model = skillsModel(skills.data, {});
  const away = new Map(
    (availability.data?.members ?? [])
      .filter((m) => m.current)
      .map((m) => [m.userId, m.current]),
  );

  const mark = (userId, on) =>
    setSaving((current) => {
      const next = new Set(current);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });

  const change = async (member, next) => {
    const name = member.fullName || member.userName;
    mark(member.userId, true);
    try {
      const result = await save.mutateAsync({
        userId: member.userId,
        categoryIds: [...next],
      });
      if (isShortOfCover(result.message)) toast.warning(result.message);
      else toast.success(result.message || `Saved for ${name}.`);
    } catch (error) {
      toast.error(error.message, { title: `Not saved for ${name}` });
    } finally {
      mark(member.userId, false);
    }
  };

  return (
    <div className="space-y-3">
      <CoverBanner warnings={warnings} matrixLinks={false} />
      {!canEdit && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Eye aria-hidden="true" size={16} className="text-brand-navy" />
          You can see who handles what. The head of the unit changes it.
        </p>
      )}
      <Card>
        {categories.length === 0 || members.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            {categories.length === 0
              ? "This unit owns no categories yet."
              : "This unit has no members yet."}{" "}
            The Super Admin sets these up.
          </p>
        ) : (
          <>
            <SkillsGrid
              categories={categories}
              members={members}
              valueFor={model.valueFor}
              canTick={model.canTick}
              countFor={model.countFor}
              onChange={change}
              changed={saving}
              changedLabel="Saving…"
              failedId={null}
              readOnly={!canEdit}
              noteFor={(member) => {
                const absence = away.get(member.userId);
                if (!absence) return null;
                return (
                  <Chip tone="orange">
                    {absence.kind === ABSENCE_KIND.OutOfOffice
                      ? "Out of office"
                      : "On leave"}{" "}
                    until {formatDay(absence.endDate)}
                  </Chip>
                );
              }}
            />
            <p
              id="skills-keyboard-hint"
              className="border-t border-line px-4 py-2 text-xs text-muted"
            >
              {canEdit
                ? "Each tick is saved at once. Keyboard: arrow keys move between cells, Space ticks or clears."
                : "Read only."}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
