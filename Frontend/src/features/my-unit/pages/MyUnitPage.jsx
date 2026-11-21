import { useParams, useSearchParams } from "react-router-dom";
import { Compass, ShieldOff } from "lucide-react";
import { useSession } from "@/features/auth";
import { UnitAvailabilityPanel } from "@/features/availability";
import { ReplyLibrary, useReplyLibrary } from "@/features/canned-replies";
import { UnitDashboard, useUnitDashboard } from "@/features/home";
import { useMyOrganisation } from "@/features/org";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import { MessageCard, PageHeader, Spinner } from "@/shared/ui";
import TeamSkillsTab from "../components/TeamSkillsTab.jsx";
import UnitCategoriesTab from "../components/UnitCategoriesTab.jsx";

/**
 * Who may change the unit (skills, replies): its head, its department's Admin, a Super Admin.
 * The HOD reads only. The server decides in the end.
 */
function canChange(org, isSuperAdmin, unitId, departmentId) {
  if (isSuperAdmin) return true;
  return Boolean(
    org?.departments?.some(
      (d) =>
        d.id === departmentId &&
        (d.isAdmin || d.units.some((u) => u.id === unitId && u.isHead)),
    ),
  );
}

/**
 * My unit (/units/:unitId): one unit's area, in tabs (?tab=): Overview (the unit dashboard),
 * Categories (read only), Team and skills, Replies, Availability. For the unit's head, its
 * department's HOD (read only) and Department Admin, and Super Admin; anyone else gets a plain
 * "not allowed" (the unit dashboard answers 403). Replies shows only when the library answers.
 */
export default function MyUnitPage() {
  const { unitId } = useParams();
  const { user } = useSession();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  const org = useMyOrganisation();
  const dashboard = useUnitDashboard(unitId);
  const library = useReplyLibrary(unitId);
  const [params, setParams] = useSearchParams();

  if (dashboard.isLoading || org.isLoading)
    return (
      <div className="py-10 text-center text-muted">
        <Spinner label="Loading the unit…" />
      </div>
    );
  if (dashboard.isError && !dashboard.data) {
    const { status, message } = dashboard.error;
    if (status === 403)
      return (
        <MessageCard icon={ShieldOff} title="You are not allowed to see this">
          <p>
            A unit&apos;s area is for its head, the Head of Department, the
            Department Admin and Super Admin.
          </p>
        </MessageCard>
      );
    if (status === 404)
      return (
        <MessageCard icon={Compass} title="Unit not found">
          <p>This unit does not exist, or it has been removed.</p>
        </MessageCard>
      );
    return (
      <p role="alert" className="text-sm text-danger">
        {message}
      </p>
    );
  }

  const { unitName, departmentName, departmentId } = dashboard.data;
  const editable = canChange(org.data, isSuperAdmin, unitId, departmentId);
  const isHead = Boolean(
    org.data?.departments?.some((d) =>
      d.units.some((u) => u.id === unitId && u.isHead),
    ),
  );
  const tabs = [
    ["overview", "Overview"],
    ["categories", "Categories"],
    ["team", "Team and skills"],
    ...(library.isSuccess ? [["replies", "Replies"]] : []),
    ["availability", "Availability"],
  ];
  const asked = params.get("tab");
  const tab = tabs.some(([id]) => id === asked) ? asked : "overview";
  const label = tabs.find(([id]) => id === tab)[1];

  return (
    <div className="space-y-5">
      <PageHeader
        title={unitName}
        crumb={label}
        eyebrow={isHead ? "My unit" : "Unit"}
        description={departmentName}
      />

      <div
        role="tablist"
        aria-label={unitName}
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {tabs.map(([id, text]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() =>
              setParams(id === "overview" ? {} : { tab: id }, { replace: true })
            }
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? "border-brand-orange text-brand-navy" : "border-transparent text-muted hover:text-ink"}`}
          >
            {text}
            {id === "replies" && (
              <span className="ml-2 rounded-full bg-white px-1.5 text-xs text-muted tabular-nums ring-1 ring-line">
                {library.data.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-label={label}>
        {tab === "overview" && (
          <UnitDashboard unitId={unitId} own={isHead} embedded />
        )}
        {tab === "categories" && <UnitCategoriesTab unitId={unitId} />}
        {tab === "team" && <TeamSkillsTab unitId={unitId} canEdit={editable} />}
        {tab === "replies" && (
          <ReplyLibrary
            unitId={unitId}
            title="Saved replies"
            description={`Replies ${unitName} uses on its tickets. Case workers pick them from “Replies” on a ticket. Shared replies are kept by Super Admin.`}
          />
        )}
        {tab === "availability" && <UnitAvailabilityPanel unitId={unitId} />}
      </div>
    </div>
  );
}
