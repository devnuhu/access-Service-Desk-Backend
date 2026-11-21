/**
 * The product's name and words: the only place they are spelled. Everything else reads BRAND.
 * `descriptor` is shown small next to the name (login page, sidebar footer) for the first months.
 */
export const BRAND = Object.freeze({
  name: "Servio",
  caption: "One platform. Every service. Connected.",
  descriptor: "Access Service Desk",
  company: "Access Pensions",
});

/** A page's browser tab title: "Servio" alone, or "<Page> · Servio". */
export const pageTitle = (page) =>
  page ? `${page} · ${BRAND.name}` : BRAND.name;
