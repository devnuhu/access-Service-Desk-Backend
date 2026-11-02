import { BarChart3, FileText, House, Inbox, Mail, Users } from "lucide-react";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";

const { CaseWorker, HeadOfUnit, HOD, SuperAdmin } = ROLES;

/**
 * Department modules. Each department that receives tickets is one entry here; the next department
 * is added as data, not new layout code. Department names appear only in these module sections.
 */
export const MODULES = [
  {
    id: "contribution-processing",
    title: "Contribution Processing",
    roles: [CaseWorker, HeadOfUnit, HOD, SuperAdmin],
    items: [{ label: "Work queue", icon: Inbox, comingSoon: true }],
  },
];

/**
 * The sidebar for one person: sections of items. An item has `to` (a link) or `comingSoon`.
 * @returns {{ id: string, title: string | null, items: { label: string, icon: any, to?: string, comingSoon?: boolean }[] }[]}
 */
export function buildNavigation(user) {
  const sections = [
    {
      id: "main",
      title: null,
      items: [
        { label: "Home", icon: House, to: "/" },
        { label: "My requests", icon: FileText, comingSoon: true },
      ],
    },
  ];

  for (const module of MODULES) {
    if (hasAnyRole(user, module.roles)) {
      sections.push({
        id: module.id,
        title: module.title,
        items: module.items,
      });
    }
  }

  if (hasAnyRole(user, [HeadOfUnit, HOD, SuperAdmin])) {
    sections.push({
      id: "insight",
      title: null,
      items: [{ label: "Reports", icon: BarChart3, comingSoon: true }],
    });
  }

  if (hasAnyRole(user, [SuperAdmin])) {
    sections.push({
      id: "administration",
      title: "Administration",
      items: [
        { label: "People and roles", icon: Users, to: "/admin/people" },
        { label: "Email", icon: Mail, to: "/admin/email" },
      ],
    });
  }

  return sections;
}
