/**
 * Lists that can grow show this many rows per page, and search on the server (the `search` query
 * parameter) so every row in the database is searched, never only the page on screen.
 */
export const LIST_PAGE_SIZE = 10;

/** How long typing must pause before a search goes to the server. */
export const SEARCH_DEBOUNCE_MS = 400;

/** The number of pages for `total` rows (at least 1). */
export function pageCount(total, pageSize = LIST_PAGE_SIZE) {
  return Math.max(1, Math.ceil((total ?? 0) / pageSize));
}

/**
 * The page numbers to show around `page`: always the first and the last, the current one and its
 * neighbours, and "…" (null) for the gaps. [1, null, 4, 5, 6, null, 14]
 */
export function pageWindow(page, pages) {
  const wanted = new Set([1, pages, page - 1, page, page + 1]);
  const numbers = [...wanted]
    .filter((n) => n >= 1 && n <= pages)
    .sort((a, b) => a - b);
  const out = [];
  numbers.forEach((n, i) => {
    if (i > 0 && n - numbers[i - 1] === 2) out.push(n - 1);
    else if (i > 0 && n - numbers[i - 1] > 2) out.push(null);
    out.push(n);
  });
  return out;
}
