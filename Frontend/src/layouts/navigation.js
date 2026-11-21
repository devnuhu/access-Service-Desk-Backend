import {
  BarChart3,
  Building,
  Building2,
  CalendarDays,
  CalendarOff,
  FileText,
  House,
  LayoutDashboard,
  Inbox,
  ListTree,
  Mail,
  MapPin,
  MessageSquareText,
  Network,
  UsersRound,
  Users,
} from "lucide-react";
import { BRAND } from "@/shared/brand";
import { hasAnyRole, REPORT_ROLES, ROLES } from "@/shared/lib/roles";

const { SuperAdmin } = ROLES;

/** HOD and Department Admin: their department's items (rule 14: its name from data, never hard-coded). */
function departmentItems(department) {
  const items = [
    {
      label: "Work queue",
      icon: Inbox,
      to: `/departments/${department.id}/tickets`,
    },
  ];
  for (const unit of department.units.filter((u) => u.isHead)) {
    items.push({
      label: `${unit.name} availability`,
      icon: UsersRound,
      to: `/availability/units/${unit.id}`,
    });
  }
  if (department.isHod) {
    items.push({
      label: "Department availability",
      icon: Building2,
      to: `/availability/departments/${department.id}`,
    });
  }
  return items;
}

/**
 * The menu groups for one department of org/me. The HOD and the Department Admin oversee the whole
 * department: one group titled with the department. Case workers and heads work in a unit: one
 * group per unit, titled with the unit and the department as its subtitle (a person is in at most
 * one unit per department, so the department's Work queue is that unit's).
 */
function departmentSections(department) {
  if (department.isHod || department.isAdmin) {
    return [
      {
        id: `department-${department.id}`,
        title: department.name,
        items: departmentItems(department),
      },
    ];
  }
  return department.units
    .filter((unit) => unit.isMember || unit.isHead)
    .map((unit) => ({
      id: `unit-${unit.id}`,
      title: unit.name,
      subtitle: department.name,
      items: [
        {
          label: "Work queue",
          icon: Inbox,
          to: `/departments/${department.id}/tickets`,
        },
        // The head runs the unit: who is in, and its categories, skills and replies.
        ...(unit.isHead
          ? [
              {
                label: "Team availability",
                icon: UsersRound,
                to: `/availability/units/${unit.id}`,
              },
              {
                label: "My unit",
                icon: Building,
                to: `/units/${unit.id}`,
              },
            ]
          : []),
      ],
    }));
}

/** My requests and My availability: in the menu for case workers and requesters, else in the account menu. */
function personalItems(departments) {
  return [
    { label: "My requests", icon: FileText, to: "/tickets" },
    ...(departments.some((d) => d.units.some((unit) => unit.isMember))
      ? [{ label: "My availability", icon: CalendarDays, to: "/availability" }]
      : []),
  ];
}

/**
 * Who leads what (org/me): "oversee" for an HOD or Department Admin (Super Admin keeps the usual
 * menu plus Administration), "head" for a unit head, otherwise null.
 */
function leadership(departments) {
  if (departments.some((d) => d.isHod || d.isAdmin)) return "oversee";
  if (departments.some((d) => d.units.some((unit) => unit.isHead)))
    return "head";
  return null;
}

/**
 * The sidebar for one person: sections of items. An item has `to` (a link) or `comingSoon`.
 * Department sections come from GET /api/org/me; a Super Admin who is in no department gets one
 * section per active department (GET /api/org/departments) with "Department availability".
 *
 * Case workers and heads get a group per unit (titled with the unit, the department below); the
 * HOD and Department Admin a group per department. Someone in exactly one unit with no department
 * role (and not a Super Admin) gets no group: its items join the main list, each keeping the unit
 * as the root of its breadcrumb (`crumbRoot`); the page header names the unit and department. A head's Home is "Dashboard" (their unit's). Heads, HODs
 * and Department Admins have My requests and My availability in the account menu (`accountLinks`)
 * instead; Raise a ticket stays on Home.
 *
 * @param {{ roles?: string[] }} user
 * @param {{ departments: any[] } | undefined} org  GET /api/org/me
 * @param {any[] | undefined} allDepartments  GET /api/org/departments (Super Admin only)
 * A section without a menu heading has a `label` for the page eyebrow and the breadcrumb; a unit
 * group has a `subtitle` (its department).
 *
 * @returns {{ id: string, title: string | null, subtitle?: string, label?: string, items: { label: string, icon: any, to?: string, comingSoon?: boolean, crumbRoot?: string }[] }[]}
 */
export function buildNavigation(user, org, allDepartments) {
  const departments = org?.departments ?? [];
  const leads = hasAnyRole(user, [SuperAdmin]) ? null : leadership(departments);
  const sections = [
    {
      id: "main",
      title: null,
      label: BRAND.name,
      items: [
        {
          label: leads === "head" ? "Dashboard" : "Home",
          icon: leads === "head" ? LayoutDashboard : House,
          to: "/",
        },
        ...(leads ? [] : personalItems(departments)),
      ],
    },
  ];

  const groups = departments.flatMap(departmentSections);
  const isSuperAdmin = hasAnyRole(user, [SuperAdmin]);
  const oneUnit =
    !isSuperAdmin &&
    leads !== "oversee" &&
    groups.length === 1 &&
    groups[0].id.startsWith("unit-");
  if (oneUnit) {
    // One unit: the group header would only repeat what the page header says.
    sections[0].items.push(
      ...groups[0].items.map((item) => ({
        ...item,
        crumbRoot: groups[0].title,
      })),
    );
  } else {
    sections.push(...groups);
  }

  if (!departments.length && hasAnyRole(user, [SuperAdmin])) {
    for (const department of allDepartments ?? []) {
      sections.push({
        id: `department-${department.id}`,
        title: department.name,
        items: [
          {
            label: "Work queue",
            icon: Inbox,
            to: `/departments/${department.id}/tickets`,
          },
          {
            label: "Department availability",
            icon: Building2,
            to: `/availability/departments/${department.id}`,
          },
        ],
      });
    }
  }

  if (hasAnyRole(user, REPORT_ROLES)) {
    sections.push({
      id: "insight",
      title: null,
      label: "Insight",
      items: [{ label: "Reports", icon: BarChart3, to: "/reports" }],
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
        { label: "Locations", icon: MapPin, to: "/admin/locations" },
        { label: "Holidays", icon: CalendarOff, to: "/admin/holidays" },
        {
          label: "Shared replies",
          icon: MessageSquareText,
          to: "/admin/replies",
        },
        { label: "Email", icon: Mail, to: "/admin/email" },
      ],
    });
  }

  return sections;
}

/**
 * The account menu's links: My requests and My availability when the sidebar leaves them out
 * (heads and HODs), so nothing is lost.
 */
export function accountLinks(user, org) {
  const shown = new Set(
    buildNavigation(user, org)
      .flatMap((section) => section.items)
      .map((item) => item.to),
  );
  return personalItems(org?.departments ?? []).filter(
    (item) => !shown.has(item.to),
  );
}
