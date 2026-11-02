import {
  Building2,
  ClipboardList,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { firstNameOf, useSession } from "@/features/auth";
import { roleLabel, ROLES, sortRoles } from "@/shared/lib/roles";
import { Card, RoleChips } from "@/shared/ui";

/** One line per role (BRD Section 4). Platform wording: no department names. */
const ROLE_CARDS = {
  [ROLES.Requester]: {
    icon: ClipboardList,
    text: "Raise requests to any department and follow each one until it is resolved.",
  },
  [ROLES.CaseWorker]: {
    icon: UserCog,
    text: "Work the requests assigned to you and keep them within their response and resolution times.",
  },
  [ROLES.HeadOfUnit]: {
    icon: Users,
    text: "Run your unit's queue: set up case workers, reassign work and handle first escalations.",
  },
  [ROLES.HOD]: {
    icon: Building2,
    text: "Oversee your department's requests and performance, and handle escalations that reach you.",
  },
  [ROLES.SuperAdmin]: {
    icon: ShieldCheck,
    text: "Manage people and roles, and keep Access Desk set up and running.",
  },
};

export default function HomePage() {
  const { user } = useSession();
  const roles = sortRoles(user.roles);

  return (
    <div className="space-y-6">
      <Card className="px-6 py-5">
        <h1 className="text-2xl font-semibold">Welcome, {firstNameOf(user)}</h1>
        <p className="mt-1 text-sm text-muted">
          {[user.department, user.jobTitle].filter(Boolean).join(" · ") ||
            "Access Pensions"}
        </p>
        <RoleChips roles={roles} className="mt-3" />
      </Card>

      <section aria-labelledby="home-roles">
        <h2 id="home-roles" className="text-base font-semibold">
          What you can do
        </h2>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roles
            .filter((role) => ROLE_CARDS[role])
            .map((role) => {
              const { icon: Icon, text } = ROLE_CARDS[role];
              return (
                <li key={role}>
                  <Card as="div" className="flex h-full gap-3 px-5 py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-navy-light text-brand-navy">
                      <Icon aria-hidden="true" size={18} />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">
                        {roleLabel(role)}
                      </h3>
                      <p className="mt-1 text-sm text-body">{text}</p>
                    </div>
                  </Card>
                </li>
              );
            })}
        </ul>
      </section>
    </div>
  );
}
