import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import useDocumentTitle from "./hooks/useDocumentTitle.js";
import { BRAND, pageTitle } from "./brand.js";

// Tests run from the project folder.
const SRC = join(process.cwd(), "src");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("BRAND", () => {
  it("is the only place in src/ that spells the old name", () => {
    // Built from parts so this file does not spell it either.
    const oldName = ["Access", "Service", "Desk"].join(" ");
    const offenders = files(SRC)
      .filter((path) => /\.(jsx?|css|html)$/.test(path))
      .filter((path) => relative(SRC, path) !== join("shared", "brand.js"))
      .filter((path) => readFileSync(path, "utf8").includes(oldName))
      .map((path) => relative(SRC, path).split(sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it('titles pages as the name alone, or "<Page> · <name>"', () => {
    expect(pageTitle()).toBe(BRAND.name);
    expect(pageTitle("Work queue")).toBe(`Work queue · ${BRAND.name}`);
  });

  it("useDocumentTitle sets the browser tab", () => {
    const { rerender } = renderHook(({ page }) => useDocumentTitle(page), {
      initialProps: { page: "Reports" },
    });
    expect(document.title).toBe(`Reports · ${BRAND.name}`);
    rerender({ page: null });
    expect(document.title).toBe(BRAND.name);
  });
});
