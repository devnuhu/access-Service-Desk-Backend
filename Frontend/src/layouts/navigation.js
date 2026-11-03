import {
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  House,
  Inbox,
  ListTree,
  Mail,
  Network,
  UsersRound,
  Users,
} from "lucide-react";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";

const { HeadOfUnit, HOD, SuperAdmin } = ROLES;

/** One section per department in org/me, titled with the department's name from data (rule 14). */
function departmentSection(department) {
  const items = [];
  if (department.units.some((unit) => unit.isMember)) {
    items.push({ label: "Work queue", icon: Inbox, comingSoon: true });
  }
  for (const unit of department.units) {
    if (unit.isHead || unit.isDeputy) {
      items.push({
        label: `${unit.name} availability`,
        icon: UsersRound,
        to: `/availability/units/${unit.id}`,
      });
    }
  }
  if (department.isHod) {
    items.push({
      label: "Department availability",
      icon: Building2,
      to: `/availability/departments/${department.id}`,
    });
  }
  return { id: `department-${department.id}`, title: department.name, items };
}

/**
 * The sidebar for one person: sections of items. An item has `to` (a link) or `comingSoon`.
 * Department sections come from GET /api/org/me; a Super Admin who is in no department gets one
 * section per active department (GET /api/org/departments) with "Department availability".
 *
 * @param {{ roles?: string[] }} user
 * @param {{ departments: any[] } | undefined} org  GET /api/org/me
 * @param {any[] | undefined} allDepartments  GET /api/org/departments (Super Admin only)
 * @returns {{ id: string, title: string | null, items: { label: string, icon: any, to?: string, comingSoon?: boolean }[] }[]}
 */
export function buildNavigation(user, org, allDepartments) {
  const departments = org?.departments ?? [];
  const sections = [
    {
      id: "main",
      title: null,
      items: [
        { label: "Home", icon: House, to: "/" },
        { label: "My requests", icon: FileText, comingSoon: true },
        ...(departments.length
          ? [
              {
                label: "My availability",
                icon: CalendarDays,
                to: "/availability",
              },
            ]
          : []),
      ],
    },
  ];

  for (const department of departments) {
    const section = departmentSection(department);
    if (section.items.length) sections.push(section);
  }

  if (!departments.length && hasAnyRole(user, [SuperAdmin])) {
    for (const department of allDepartments ?? []) {
      sections.push({
        id: `department-${department.id}`,
        title: department.name,
        items: [
          {
            label: "Department availability",
            icon: Building2,
            to: `/availability/departments/${department.id}`,
          },
        ],
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
        { label: "Units", icon: Network, to: "/admin/units" },
        { label: "Categories", icon: ListTree, to: "/admin/categories" },
        { label: "Email", icon: Mail, to: "/admin/email" },
      ],
    });
  }

  return sections;
}
