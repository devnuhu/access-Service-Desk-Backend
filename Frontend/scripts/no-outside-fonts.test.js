/**
 * The app must not load fonts (or any stylesheet) from another site: a strict Content-Security-Policy
 * (font-src 'self') is set at go-live, and staff networks may block outside font hosts. The wordmark's
 * font is bundled from @fontsource (src/main.jsx); the UI uses system fonts.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { outsideFontProblems } from "./outside-fonts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function filesUnder(dir, pattern) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full, pattern)));
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

async function problemsIn(files) {
  const found = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const problem of outsideFontProblems(text, file))
      found.push(`${path.relative(ROOT, file)}: ${problem}`);
  }
  return found;
}

describe("no outside fonts", () => {
  it("finds an outside font link, preconnect, @import or url() (the check itself works)", () => {
    expect(
      outsideFontProblems(
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
        "index.html",
      ),
    ).not.toHaveLength(0);
    expect(
      outsideFontProblems(
        '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />',
        "index.html",
      ),
    ).not.toHaveLength(0);
    expect(
      outsideFontProblems(
        "@import url('https://fonts.googleapis.com/css2?family=Inter');",
        "a.css",
      ),
    ).not.toHaveLength(0);
    expect(
      outsideFontProblems(
        "@font-face { src: url(https://cdn.example.com/x.woff2); }",
        "a.css",
      ),
    ).not.toHaveLength(0);
    expect(
      outsideFontProblems(
        "@font-face { src: url(./files/x.woff2) format('woff2'); }",
        "a.css",
      ),
    ).toEqual([]);
  });

  it("index.html, the app's CSS and public/ point at no outside host", async () => {
    const files = [
      path.join(ROOT, "index.html"),
      ...(await filesUnder(path.join(ROOT, "src"), /\.css$/)),
      ...(await filesUnder(path.join(ROOT, "public"), /\.(css|svg|html)$/)),
    ];
    expect(await problemsIn(files)).toEqual([]);
  });

  it("the bundled font's CSS is local too, and main.jsx loads only latin 800", async () => {
    const pkg = path.join(
      ROOT,
      "node_modules",
      "@fontsource",
      "plus-jakarta-sans",
    );
    expect(await problemsIn([path.join(pkg, "latin-800.css")])).toEqual([]);
    const main = await readFile(path.join(ROOT, "src", "main.jsx"), "utf8");
    expect(main.match(/@fontsource\/[^"']+/g)).toEqual([
      "@fontsource/plus-jakarta-sans/latin-800.css",
    ]);
  });
});
