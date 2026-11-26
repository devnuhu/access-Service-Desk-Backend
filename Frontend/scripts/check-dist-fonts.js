/**
 * After `vite build`: the production build loads no font (or stylesheet) from another site, and the
 * wordmark's font files are among the app's own assets. Run by `npm run check` after the build.
 *
 * Usage: node scripts/check-dist-fonts.js [dist folder]. Exits 1 when something is wrong.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outsideFontProblems } from "./outside-fonts.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.resolve(process.argv[2] ?? path.join(ROOT, "dist"));

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(full);
  }
  return out;
}

const files = await filesUnder(DIST);
const problems = [];
for (const file of files.filter((f) => /\.(html|css)$/i.test(f))) {
  const text = await readFile(file, "utf8");
  for (const problem of outsideFontProblems(text, file))
    problems.push(`${path.relative(DIST, file)}: ${problem}`);
}

const fonts = files.filter((f) => /\.(woff2?|ttf|otf)$/i.test(f));
const own = fonts.filter((f) => /plus-jakarta-sans-latin-800-normal/i.test(f));
if (!own.some((f) => f.endsWith(".woff2")))
  problems.push(
    "the wordmark font (plus-jakarta-sans latin 800, woff2) is not in the build",
  );
const others = fonts.filter((f) => !own.includes(f));
if (others.length)
  problems.push(
    `unexpected font files (only latin 800 should be bundled): ${others.map((f) => path.basename(f)).join(", ")}`,
  );

if (problems.length) {
  for (const problem of problems) console.error(`FONT CHECK: ${problem}`);
  process.exit(1);
}
console.log(
  `fonts: no outside font host; bundled ${own.map((f) => path.relative(DIST, f)).join(", ")}`,
);
