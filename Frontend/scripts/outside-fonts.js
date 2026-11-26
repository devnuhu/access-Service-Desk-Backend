/**
 * Finds outside font (and stylesheet) references in HTML or CSS text. Used by the source test
 * (scripts/no-outside-fonts.test.js) and by the check of the production build (check-dist-fonts.js).
 */

/** Hosts that serve web fonts. Any http(s) host is refused anyway; these name the usual suspects. */
export const FONT_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "use.typekit.net",
  "p.typekit.net",
  "fonts.bunny.net",
  "fonts.cdnfonts.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
];

const OUTSIDE = /^(https?:)?\/\//i;

/**
 * Problems in one file's text, as short descriptions (an empty list when it is clean).
 * HTML: a <link> (stylesheet, preconnect, dns-prefetch, preload) to another host.
 * CSS: an @import or a url() that points at another host.
 * Both: any mention of a known font host.
 */
export function outsideFontProblems(text, fileName = "") {
  const problems = [];
  if (/\.html?$/i.test(fileName)) {
    for (const tag of text.match(/<link\b[^>]*>/gi) ?? []) {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
      if (OUTSIDE.test(href)) problems.push(`outside <link>: ${tag}`);
    }
  }
  if (/\.(css|svg)$/i.test(fileName) || /<style\b/i.test(text)) {
    for (const rule of text.match(/@import[^;]*;/gi) ?? []) {
      const target =
        /url\(\s*["']?([^"')]+)/i.exec(rule)?.[1] ??
        /@import\s+["']([^"']+)/i.exec(rule)?.[1] ??
        "";
      if (OUTSIDE.test(target.trim()))
        problems.push(`outside @import: ${rule}`);
    }
    for (const match of text.matchAll(/url\(\s*["']?([^"')]+)/gi)) {
      if (OUTSIDE.test(match[1].trim()))
        problems.push(`outside url(): ${match[1]}`);
    }
  }
  for (const host of FONT_HOSTS)
    if (text.includes(host)) problems.push(`mentions ${host}`);
  return problems;
}
