/** Results shown at most. */
export const MAX_RESULTS = 8;

const words = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Request types matching every word of `text` (any order, case-insensitive) in the category name,
 * its description or the department name. Name matches come first, then description, then
 * department; at most MAX_RESULTS. Each result: { department, category, terms }.
 */
export function searchCatalogue(departments, text) {
  const terms = words(text);
  if (!terms.length) return [];
  const found = [];
  for (const department of departments) {
    for (const category of department.categories) {
      const name = category.name.toLowerCase();
      const description = (category.description ?? "").toLowerCase();
      const place = department.name.toLowerCase();
      const all = `${name} ${description} ${place}`;
      if (!terms.every((term) => all.includes(term))) continue;
      const rank = terms.every((term) => name.includes(term))
        ? 0
        : terms.some((term) => name.includes(term))
          ? 1
          : terms.some((term) => description.includes(term))
            ? 2
            : 3;
      found.push({ department, category, terms, rank });
    }
  }
  return found
    .sort(
      (a, b) =>
        a.rank - b.rank || a.category.name.localeCompare(b.category.name),
    )
    .slice(0, MAX_RESULTS);
}

/**
 * `text` split into [{ text, hit }] parts, where hit parts match one of `terms`
 * (case-insensitive), for highlighting.
 */
export function highlightParts(text, terms) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const marks = new Array(text.length).fill(false);
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (term && at !== -1) {
      for (let i = at; i < at + term.length; i += 1) marks[i] = true;
      at = lower.indexOf(term, at + term.length);
    }
  }
  const parts = [];
  for (let i = 0; i < text.length; i += 1) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}

/** The raise form for one request type. */
export const requestLink = (categoryId) =>
  `/tickets/new?categoryId=${encodeURIComponent(categoryId)}`;
