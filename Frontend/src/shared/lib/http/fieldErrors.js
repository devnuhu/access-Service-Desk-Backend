/**
 * Every API error is { message, errors: { field: text } } (rule 6). The message goes in the toast or
 * error box; a field error whose key matches a form field (camelCase, for example "startDate") goes
 * under that field. toApiError has already read errors into error.fieldErrors.
 */

/**
 * The text for one field, or undefined.
 * @param {unknown} error  an ApiError
 * @param {string} field
 */
export function fieldError(error, field) {
  return /** @type {any} */ (error)?.fieldErrors?.[field]?.[0];
}

/**
 * Puts the API's field errors under the matching react-hook-form fields.
 * @param {unknown} error  an ApiError
 * @param {(name: string, error: { type: string, message: string }) => void} setError  from useForm
 * @param {string[]} fields  the form's field names
 * @returns {boolean} true when at least one field got a message
 */
export function applyFieldErrors(error, setError, fields) {
  let applied = false;
  for (const field of fields) {
    const message = fieldError(error, field);
    if (message) {
      setError(field, { type: "server", message });
      applied = true;
    }
  }
  return applied;
}
