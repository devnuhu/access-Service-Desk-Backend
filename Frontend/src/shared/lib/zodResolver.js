/**
 * Connects a zod schema to react-hook-form (same job as @hookform/resolvers/zod, without the package).
 * Field errors are keyed by field name; the parsed (and transformed) values go to onSubmit.
 *
 * @param {import("zod").ZodType} schema
 */
export function zodResolver(schema) {
  return async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data, errors: {} };

    const errors = {};
    for (const issue of result.error.issues) {
      const name = issue.path.join(".") || "root";
      if (!errors[name])
        errors[name] = { type: issue.code, message: issue.message };
    }
    return { values: {}, errors };
  };
}
