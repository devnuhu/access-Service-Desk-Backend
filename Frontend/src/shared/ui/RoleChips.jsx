import { roleLabel, sortRoles } from "@/shared/lib/roles";
import Chip from "./Chip.jsx";

const TONE = {
  SuperAdmin: "orange",
  HOD: "navy",
  HeadOfUnit: "navy",
  CaseWorker: "green",
  Requester: "grey",
};

export function RoleChip({ role, children }) {
  return (
    <Chip tone={TONE[role] ?? "grey"}>
      {roleLabel(role)}
      {children}
    </Chip>
  );
}

export default function RoleChips({ roles = [], className = "" }) {
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`}>
      {sortRoles(roles).map((role) => (
        <RoleChip key={role} role={role} />
      ))}
    </span>
  );
}
