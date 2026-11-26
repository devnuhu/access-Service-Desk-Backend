import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Inbox, LayoutDashboard, MapPin, Network } from "lucide-react";
import { BRAND } from "@/shared/brand";
import { PageContext, PageHeader } from "@/shared/ui";
import { describePlace, findPlace } from "./useNavigation.js";

const SECTIONS = [
  {
    id: "main",
    title: null,
    label: BRAND.name,
    items: [
      { label: "Dashboard", icon: LayoutDashboard, to: "/" },
      { label: "My requests", icon: Inbox, to: "/tickets" },
    ],
  },
  {
    id: "administration",
    title: "Administration",
    items: [
      { label: "Units", icon: Network, to: "/admin/units" },
      { label: "Locations", icon: MapPin, to: "/admin/locations" },
    ],
  },
];

const trail = (path, header) =>
  describePlace(findPlace(SECTIONS, path), header);

describe("page place: eyebrow and breadcrumbs", () => {
  it("a menu item's own page: section, then the page title", () => {
    expect(trail("/admin/locations", { title: "Locations" })).toEqual({
      eyebrow: "Administration",
      crumbs: [{ label: "Administration" }, { label: "Locations" }],
    });
    expect(trail("/", { title: "Dashboard" }).crumbs).toEqual([
      { label: BRAND.name },
      { label: "Dashboard" },
    ]);
  });

  it("a page inside an item links back to it; the Dashboard (/) never swallows other paths", () => {
    expect(
      trail("/tickets/CP-2026-000001", { title: "CP-2026-000001" }),
    ).toEqual({
      eyebrow: "My requests",
      crumbs: [
        { label: BRAND.name },
        { label: "My requests", to: "/tickets" },
        { label: "CP-2026-000001" },
      ],
    });
    expect(findPlace(SECTIONS, "/somewhere")).toBeNull();
  });

  it("a unit item in the main list (one-unit staff) keeps the unit as the breadcrumb root", () => {
    const sections = [
      {
        id: "main",
        title: null,
        label: BRAND.name,
        items: [
          { label: "Dashboard", to: "/" },
          {
            label: "Work queue",
            to: "/departments/d-cp/tickets",
            crumbRoot: "Fund Unit",
          },
        ],
      },
    ];
    expect(
      describePlace(findPlace(sections, "/departments/d-cp/tickets"), {
        title: "Fund Unit work queue",
      }).crumbs,
    ).toEqual([{ label: "Fund Unit" }, { label: "Fund Unit work queue" }]);
  });

  it("a page's own trail replaces the middle part", () => {
    expect(
      trail("/admin/units/u-rf/skills", {
        title: "Skills",
        trail: [
          { label: "Units", to: "/admin/units" },
          { label: "Contribution Processing" },
          { label: "Refund", to: "/admin/units/u-rf" },
        ],
      }).crumbs,
    ).toEqual([
      { label: "Administration" },
      { label: "Units", to: "/admin/units" },
      { label: "Contribution Processing" },
      { label: "Refund", to: "/admin/units/u-rf" },
      { label: "Skills" },
    ]);
  });
});

describe("PageHeader", () => {
  it("shows the layout's eyebrow and hands its title and trail to the layout once", () => {
    const setHeader = vi.fn();
    const page = { eyebrow: "Administration", setHeader };
    const ui = (
      <PageContext.Provider value={page}>
        <PageHeader
          title="Locations"
          description="Where people work."
          trail={[{ label: "Units", to: "/admin/units" }]}
        />
      </PageContext.Provider>
    );
    const { rerender, unmount } = render(ui);
    expect(screen.getByText("Administration")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Locations" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Where people work.")).toBeInTheDocument();
    // An inline trail is a new array each render: still one call.
    rerender(ui);
    expect(setHeader).toHaveBeenCalledTimes(1);
    expect(setHeader).toHaveBeenCalledWith({
      title: "Locations",
      trail: [{ label: "Units", to: "/admin/units" }],
    });
    unmount();
    expect(setHeader).toHaveBeenLastCalledWith(null);
  });

  it("works outside the layout (no eyebrow unless given)", () => {
    render(<PageHeader title="Reports" eyebrow="Insight" />);
    expect(screen.getByText("Insight")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Reports" }),
    ).toBeInTheDocument();
  });
});
