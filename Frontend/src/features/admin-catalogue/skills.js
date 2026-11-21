/** staffCategory: 1 Employee, 2 Head of Unit. */
export const STAFF_CATEGORY = Object.freeze({ Employee: 1, HeadOfUnit: 2 });

/** "N categories have fewer than two case workers" (cover banner and Home). */
export const coverTitle = (count) =>
  count === 1
    ? "1 category has fewer than two case workers"
    : `${count} categories have fewer than two case workers`;

/** The API's message when a save leaves categories with fewer than two case workers. */
export const isShortOfCover = (message) =>
  /fewer than two/i.test(message ?? "");

export function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * The matrix with local, unsaved edits on top of the API's answer.
 * `edits` maps userId -> Set of categoryIds (the person's full set); only changed people are in it.
 *
 * Rules (as the API applies them):
 * - a switched-off category cannot be newly ticked; an existing tick can be removed and put back;
 * - a blocked person cannot be given new categories;
 * - the count per category is the API's eligibleCount (active accounts only) adjusted by the
 *   edits of people with an active account.
 *
 * @param {{ categories: any[], members: any[] }} matrix  GET /api/admin/units/{unitId}/skills
 * @param {Record<string, Set<string>>} edits
 */
export function skillsModel(matrix, edits) {
  const original = new Map(
    matrix.members.map((m) => [m.userId, new Set(m.categoryIds)]),
  );
  const categoryById = new Map(matrix.categories.map((c) => [c.id, c]));
  const changed = matrix.members.filter((m) => edits[m.userId]);

  const valueFor = (member) =>
    edits[member.userId] ?? original.get(member.userId) ?? new Set();

  // The head is not assigned automatically: their row is shown, never changed here.
  const canTick = (member, categoryId) =>
    !member.isHead &&
    (original.get(member.userId)?.has(categoryId) ||
      (Boolean(categoryById.get(categoryId)?.isActive) &&
        member.accountActive));

  const countFor = (categoryId) => {
    let count = categoryById.get(categoryId)?.eligibleCount ?? 0;
    // eligibleCount counts real case workers only (never the head), as the API does.
    for (const member of changed) {
      if (!member.accountActive || member.isHead) continue;
      count +=
        Number(edits[member.userId].has(categoryId)) -
        Number(original.get(member.userId).has(categoryId));
    }
    return count;
  };

  /** The next edits after a person's set changes: back to the original drops the entry. */
  const withChange = (member, next) => {
    const rest = { ...edits };
    if (sameSet(next, original.get(member.userId) ?? new Set()))
      delete rest[member.userId];
    else rest[member.userId] = next;
    return rest;
  };

  return {
    valueFor,
    canTick,
    countFor,
    withChange,
    changed,
    changedIds: new Set(changed.map((m) => m.userId)),
  };
}
