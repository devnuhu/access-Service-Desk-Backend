import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BRAND } from "@/shared/brand";
import BrandLockup from "./BrandLockup.jsx";
import BrandMark from "./BrandMark.jsx";

describe("BrandMark", () => {
  it("draws the colour mark on light backgrounds, with the name for screen readers", () => {
    render(<BrandMark />);
    const mark = screen.getByRole("img", { name: BRAND.name });
    expect(mark).toHaveAttribute("data-variant", "color");
    expect(mark).toHaveAttribute("width", "32");
    const fills = [...mark.querySelectorAll("circle")].map((c) =>
      c.getAttribute("fill"),
    );
    expect(fills).toEqual(["#E07B00", "#0B3B78", "#4C8A1E"]);
    expect(mark.querySelector("path")).toHaveAttribute("stroke", "#0B3B78");
  });

  it("draws the light mark for dark backgrounds, at the size asked", () => {
    render(<BrandMark variant="light" size={48} title="Home" />);
    const mark = screen.getByRole("img", { name: "Home" });
    expect(mark).toHaveAttribute("width", "48");
    const fills = [...mark.querySelectorAll("circle")].map((c) =>
      c.getAttribute("fill"),
    );
    expect(fills).toEqual(["#FF9A1F", "#FFFFFF", "#7BC043"]);
    expect(mark.querySelector("path")).toHaveAttribute("stroke", "#FFFFFF");
  });

  it("is hidden from screen readers when the name is written next to it", () => {
    const { container } = render(<BrandMark decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("the lockup says the name once and writes the lowercase wordmark", () => {
    render(<BrandLockup />);
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByRole("img", { name: BRAND.name })).toHaveTextContent(
      BRAND.name.toLowerCase(),
    );
  });
});
