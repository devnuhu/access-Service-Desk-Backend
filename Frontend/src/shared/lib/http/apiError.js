/**
 * One error shape for every failed API call.
 *
 * Bodies the Service Desk API sends on failure:
 * - { message } or { message, errors: { field: "text" } }   admin, directory and email controllers
 * - ApiResponse { statusCode, message, errors: string[] }   AuthController
 * - { statusCode: 403, message: "Security check failed..." }  CSRF middleware
 * - ValidationProblemDetails { title, errors: { Field: [..] } }   model binding failures
 * - empty body                                              403 from authorization policies
 *
 * @typedef {"network" | "unauthorized" | "forbidden" | "notFound" | "conflict" | "validation" | "rateLimited" | "server" | "http"} ApiErrorKind
 */

const DEFAULT_MESSAGES = {
  network: "Access Desk cannot be reached right now. Try again shortly.",
  unauthorized: "Your session has ended. Sign in again.",
  forbidden: "You do not have access to this.",
  notFound: "This record was not found, or you do not have access to it.",
  conflict: "This change has already been made.",
  validation: "Some details are not valid. Check the form and try again.",
  rateLimited: "Too many attempts. Wait a minute and try again.",
  server: "Access Desk cannot be reached right now. Try again shortly.",
  http: "The request failed.",
};

export class ApiError extends Error {
  /**
   * @param {{ kind: ApiErrorKind, status: number | null, message?: string,
   *           fieldErrors?: Record<string, string[]>, cause?: unknown }} details
   */
  constructor({ kind, status, message, fieldErrors = {}, cause }) {
    super(message || DEFAULT_MESSAGES[kind], { cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

/** A response that does not match the zod schema of its endpoint: a frontend/backend contract break. */
export class ApiContractError extends Error {
  /**
   * @param {{ method: string, path: string }} endpoint
   * @param {import("zod").ZodError} zodError
   */
  constructor(endpoint, zodError) {
    super(
      `Response of ${endpoint.method} ${endpoint.path} does not match the expected shape.`,
      { cause: zodError },
    );
    this.name = "ApiContractError";
    this.endpoint = endpoint;
    this.issues = zodError.issues;
  }
}

function kindForStatus(status) {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "notFound";
  if (status === 409) return "conflict";
  if (status === 429) return "rateLimited";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "http";
}

/** "JobTitle" -> "jobTitle", "$.roleId" -> "roleId" */
function normalizeFieldName(key) {
  const name = key.replace(/^\$\.?/, "");
  return name ? name.charAt(0).toLowerCase() + name.slice(1) : "form";
}

function readFieldErrors(errors) {
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) return {};
  return Object.fromEntries(
    Object.entries(errors).map(([key, messages]) => [
      normalizeFieldName(key),
      (Array.isArray(messages) ? messages : [messages]).map(String),
    ]),
  );
}

function readMessage(body, fieldErrors) {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return undefined;
  if (typeof body.message === "string" && body.message.trim())
    return body.message;
  if (Array.isArray(body.errors) && body.errors.length)
    return body.errors.join(" ");
  const firstFieldMessage = Object.values(fieldErrors)[0]?.[0];
  return (
    firstFieldMessage ||
    (typeof body.title === "string" ? body.title : undefined)
  );
}

/**
 * Converts any error thrown by the HTTP client into an ApiError.
 * 429 always shows the fixed "Too many attempts" text; 503 and every other status show the API
 * message when there is one.
 * @param {unknown} error
 * @returns {ApiError}
 */
export function toApiError(error) {
  if (error instanceof ApiError) return error;

  const response = /** @type {any} */ (error)?.response;
  if (!response) {
    return new ApiError({ kind: "network", status: null, cause: error });
  }

  const status = response.status;
  const kind = kindForStatus(status);
  const fieldErrors = readFieldErrors(response.data?.errors);
  return new ApiError({
    kind,
    status,
    message:
      kind === "rateLimited"
        ? undefined
        : readMessage(response.data, fieldErrors),
    fieldErrors,
    cause: error,
  });
}

/** The CSRF middleware's refusal: the token is missing or stale, not a permission problem. */
export function isCsrfFailure(error) {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    /security check failed/i.test(error.message)
  );
}
