import { useMyOrganisation, useOrgDepartments } from "@/features/org";
import { hasAnyRole, ROLES } from "@/shared/lib/roles";
import { buildNavigation } from "./navigation.js";

/** The menu sections for this person (org/me; every department for a Super Admin in none). */
export function useNavigationSections(user) {
  const org = useMyOrganisation();
  const isSuperAdmin = hasAnyRole(user, [ROLES.SuperAdmin]);
  const all = useOrgDepartments({
    enabled: isSuperAdmin && org.isSuccess && !org.data.departments.length,
  });
  return buildNavigation(user, org.data, all.data);
}

const sectionLabel = (section) => section?.title ?? section?.label ?? null;

/**
 * Where a path sits in the menu: the item whose link is the path or its longest parent
 * (/tickets/CP-1 belongs to My requests), its section, and whether it is that item's own page.
 */
export function findPlace(sections, pathname) {
  let best = null;
  for (const section of sections) {
    for (const item of section.items) {
      if (!item.to) continue;
      const exact = pathname === item.to;
      const inside = item.to !== "/" && pathname.startsWith(`${item.to}/`);
      if ((exact || inside) && (!best || item.to.length > best.item.to.length))
        best = { section, item, exact };
    }
  }
  return best;
}

/**
 * The eyebrow and the breadcrumb trail for a page. A menu item's own page: "Section > Title".
 * A page inside one (a ticket, a unit): "Section > Item (link) > Title". A page's own `trail`
 * replaces the middle part.
 */
export function describePlace(place, header) {
  const title = header?.title ?? null;
  const trail = header?.trail;
  if (!place) {
    return {
      eyebrow: "Access Service Desk",
      crumbs: [
        { label: "Access Service Desk" },
        ...(title ? [{ label: title }] : []),
      ],
    };
  }
  const { section, item, exact } = place;
  const root = { label: sectionLabel(section) ?? "Access Service Desk" };
  if (trail?.length)
    return {
      eyebrow: exact ? root.label : item.label,
      crumbs: [root, ...trail, ...(title ? [{ label: title }] : [])],
    };
  if (exact)
    return {
      eyebrow: root.label,
      crumbs: [root, { label: title ?? item.label }],
    };
  return {
    eyebrow: item.label,
    crumbs: [
      root,
      { label: item.label, to: item.to },
      ...(title ? [{ label: title }] : []),
    ],
  };
}
