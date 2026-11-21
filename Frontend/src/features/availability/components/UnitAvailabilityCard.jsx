import { useState } from "react";
import { formatShortRange } from "@/shared/lib/dates";
import { Button, Card, Chip, Dialog } from "@/shared/ui";
import { STAFF_CATEGORY } from "../api/endpoints.js";
import { awayUntil } from "../absenceText.js";
import AbsenceForm from "./AbsenceForm.jsx";
import AbsenceList from "./AbsenceList.jsx";

const MIN_AVAILABLE = 2;

function Status({ member }) {
  if (!member.accountActive) return <Chip tone="grey">Blocked</Chip>;
  if (member.availableNow) return <Chip tone="green">Available</Chip>;
  return (
    <Chip tone="orange">
      {member.current ? awayUntil(member.current, { short: true }) : "Away"}
    </Chip>
  );
}

function Upcoming({ absences }) {
  if (absences.length === 0) return <span className="text-muted">—</span>;
  const shown = absences.slice(0, 2);
  return (
    <span className="text-sm">
      {shown
        .map((absence) => formatShortRange(absence.startDate, absence.endDate))
        .join(", ")}
      {absences.length > 2 && (
        <span className="text-muted"> +{absences.length - 2} more</span>
      )}
    </span>
  );
}

/**
 * One unit's people and who is available today ("today" from the API). The head, the HOD and
 * Super Admins record leave for a person and cancel or end their periods (the server decides).
 */
export default function UnitAvailabilityCard({ unit, headingLevel = "h2" }) {
  const [person, setPerson] = useState(null);
  const Heading = headingLevel;
  const low = unit.availableCount < MIN_AVAILABLE;
  const member = person && unit.members.find((m) => m.userId === person);

  return (
    <Card aria-labelledby={`unit-${unit.unitId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <Heading id={`unit-${unit.unitId}`} className="text-base font-semibold">
          {unit.name}
        </Heading>
        <div
          className={`text-right text-sm ${low ? "text-brand-orange-ink" : "text-body"}`}
          data-testid="available-count"
        >
          <p>
            <strong>
              {unit.availableCount} of {unit.memberCount}
            </strong>{" "}
            available today
          </p>
          {low && (
            <p className="text-xs">
              Tickets may wait for an available case worker.
            </p>
          )}
        </div>
      </div>

      {unit.members.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No members yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-page/60 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <tr>
                <th scope="col" className="px-5 py-4">
                  Name
                </th>
                <th scope="col" className="px-5 py-4">
                  Status
                </th>
                <th scope="col" className="px-5 py-4">
                  Upcoming
                </th>
                <th scope="col" className="px-5 py-4">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {unit.members.map((row) => (
                <tr key={row.userId}>
                  <td className="px-5 py-3">
                    <span className="font-semibold text-ink">
                      {row.fullName || row.userName}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.isHead && <Chip tone="orange">Head</Chip>}
                      <Chip
                        tone={
                          row.staffCategory === STAFF_CATEGORY.HeadOfUnit
                            ? "navy"
                            : "grey"
                        }
                      >
                        {row.staffCategory === STAFF_CATEGORY.HeadOfUnit
                          ? "Head of Unit"
                          : "Employee"}
                      </Chip>
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Status member={row} />
                  </td>
                  <td className="px-5 py-3">
                    <Upcoming absences={row.upcoming} />
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setPerson(row.userId)}
                      aria-label={`Record leave for ${row.fullName || row.userName}`}
                    >
                      Record leave
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={Boolean(member)}
        onClose={() => setPerson(null)}
        title={member ? `Leave for ${member.fullName || member.userName}` : ""}
        description={unit.name}
      >
        {member && (
          <div className="space-y-6">
            <AbsenceForm
              userId={member.userId}
              today={unit.today}
              idPrefix={`absence-${member.userId}`}
              onRecorded={() => setPerson(null)}
            />
            <section aria-labelledby="person-periods">
              <h3 id="person-periods" className="text-sm font-semibold">
                Current and upcoming
              </h3>
              <AbsenceList
                absences={[
                  ...(member.current ? [member.current] : []),
                  ...member.upcoming,
                ]}
                today={unit.today}
                emptyText="Nothing recorded."
              />
            </section>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
