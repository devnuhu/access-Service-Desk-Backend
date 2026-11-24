/**
 * The product's name and words: the only place they are spelled. Everything else reads BRAND.
 * `descriptor` is shown small next to the name (login page, sidebar footer) for the first months.
 */
export const BRAND = Object.freeze({
  name: "Access Desk",
  caption: "One platform. Every service. Connected.",
  descriptor: "Access Service Desk",
  company: "Access Pensions",
  /** The legal name, for the copyright lines. */
  legalName: "Access Pensions Ltd",
});

/** A page's browser tab title: "Access Desk" alone, or "<Page> · Access Desk". */
export const pageTitle = (page) =>
  page ? `${page} · ${BRAND.name}` : BRAND.name;
