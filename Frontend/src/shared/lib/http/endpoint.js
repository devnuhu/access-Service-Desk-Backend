import { ApiContractError, ApiError } from "./apiError.js";

/**
 * Every API route the frontend calls is declared once with defineEndpoint, in
 * src/features/<feature>/api/endpoints.js. scripts/check-api.js reads those declarations and
 * compares them with swagger.json. endpoints.js files use relative imports only so Node can load them.
 *
 * @typedef {"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} HttpMethod
 *
 * @typedef {Object} EndpointDefinition
 * @property {HttpMethod} method
 * @property {string} path  swagger-style template, for example "/api/admin/users/{userId}"
 * @property {string[]} [query]  query parameter names the endpoint accepts
 * @property {import("zod").ZodType} [body]  request body schema (JSON, or the form fields)
 * @property {"json" | "multipart"} [bodyType]  "multipart" sends the parsed body as FormData: arrays
 *   repeat their key, Blobs are files, booleans and numbers become text, undefined/null are left out.
 *   No Content-Type is set, so the browser adds the boundary.
 * @property {import("zod").ZodType} [response]  response schema; a mismatch throws ApiContractError
 * @property {"json" | "blob"} [responseType]  "blob": the answer is a file; the call resolves
 *   { blob, fileName } (the name from Content-Disposition) and has no response schema
 * @property {boolean} [skipAuthRedirect]  a 401 is an expected answer (login), not an expired session
 * @property {string} [swaggerDeviation]  why the real response differs from swagger.json (the
 *   schema follows the real response; check-api reports the difference as a warning with this reason)
 */

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const ENDPOINT_BRAND = Symbol.for("sd.endpoint");

/**
 * @param {EndpointDefinition} definition
 * @returns {Readonly<EndpointDefinition>}
 */
export function defineEndpoint(definition) {
  const { method, path } = definition;
  if (!METHODS.has(method))
    throw new Error(`Unsupported HTTP method "${method}".`);
  if (typeof path !== "string" || !path.startsWith("/api/")) {
    throw new Error(`Endpoint path must start with /api/ (got "${path}").`);
  }
  return Object.freeze({
    bodyType: definition.body ? "json" : undefined,
    responseType: "json",
    query: [],
    ...definition,
    [ENDPOINT_BRAND]: true,
  });
}

/** @param {unknown} value */
export function isEndpoint(value) {
  return Boolean(value && typeof value === "object" && value[ENDPOINT_BRAND]);
}

/**
 * Fills "{name}" placeholders. Every placeholder needs a value.
 * @param {string} template
 * @param {Record<string, string | number>} [params]
 */
export function buildPath(template, params = {}) {
  return template.replace(/\{([^}]+)\}/g, (_, name) => {
    const value = params[name];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing path parameter "${name}" for ${template}.`);
    }
    return encodeURIComponent(String(value));
  });
}

/** A parsed form body to FormData. Keys keep the zod names (camelCase). */
export function toFormData(values) {
  const form = new FormData();
  const append = (key, value) => {
    if (value === undefined || value === null) return;
    if (value instanceof Blob) form.append(key, value, value.name ?? "file");
    else form.append(key, String(value));
  };
  for (const [key, value] of Object.entries(values ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => append(key, item));
    else append(key, value);
  }
  return form;
}

/**
 * The file name of a download: RFC 5987 filename* first, then filename, else the fallback.
 * @param {string | undefined} header  Content-Disposition
 */
export function fileNameFrom(header, fallback = "download") {
  if (!header) return fallback;
  const extended = header.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (extended) {
    try {
      return decodeURIComponent(extended[2].trim().replace(/^"|"$/g, ""));
    } catch {
      // A malformed encoding falls through to the plain name.
    }
  }
  const plain = header.match(/filename\s*=\s*("([^"]*)"|[^;]+)/i);
  return plain ? (plain[2] ?? plain[1]).trim() : fallback;
}

/** A failed download carries its JSON error body as a Blob; read its message. */
async function readBlobError(error) {
  const body = error?.cause?.response?.data;
  if (!(error instanceof ApiError) || !(body instanceof Blob)) return error;
  try {
    const { message } = JSON.parse(await body.text());
    if (typeof message !== "string" || !message.trim()) return error;
    return new ApiError({
      kind: error.kind,
      status: error.status,
      message,
      cause: error.cause,
    });
  } catch {
    return error;
  }
}

function cleanQuery(endpoint, query = {}) {
  const entries = Object.entries(query).filter(
    ([, value]) => value !== undefined && value !== null && value !== "",
  );
  const unknown = entries
    .map(([name]) => name)
    .filter((name) => !endpoint.query.includes(name));
  if (unknown.length) {
    throw new Error(
      `${endpoint.method} ${endpoint.path} does not accept query parameter(s): ${unknown.join(", ")}.`,
    );
  }
  return Object.fromEntries(entries);
}

/**
 * Calls an endpoint through the shared client. Validates the request body before sending and
 * the response after receiving, so a contract mismatch fails here, not inside a screen.
 *
 * @param {import("axios").AxiosInstance} http
 * @param {Readonly<EndpointDefinition>} endpoint
 * @param {{ params?: Record<string, string | number>, query?: Record<string, unknown>, body?: unknown }} [input]
 */
export async function callEndpoint(
  http,
  endpoint,
  { params, query, body } = {},
) {
  let data;
  if (endpoint.body) {
    data = endpoint.body.parse(body);
  } else if (body !== undefined) {
    throw new Error(
      `${endpoint.method} ${endpoint.path} does not declare a request body.`,
    );
  }

  const downloads = endpoint.responseType === "blob";
  let response;
  try {
    response = await http.request({
      method: endpoint.method,
      url: buildPath(endpoint.path, params),
      params: cleanQuery(endpoint, query),
      data: endpoint.bodyType === "multipart" ? toFormData(data) : data,
      skipAuthRedirect: endpoint.skipAuthRedirect === true,
      ...(downloads ? { responseType: "blob" } : {}),
    });
  } catch (error) {
    throw downloads ? await readBlobError(error) : error;
  }

  if (downloads) {
    const headers = response.headers ?? {};
    const disposition =
      typeof headers.get === "function"
        ? headers.get("content-disposition")
        : headers["content-disposition"];
    return { blob: response.data, fileName: fileNameFrom(disposition) };
  }

  if (!endpoint.response) return response.data;

  const parsed = endpoint.response.safeParse(response.data);
  if (!parsed.success) {
    const error = new ApiContractError(endpoint, parsed.error);
    console.error(error.message, parsed.error.issues);
    throw error;
  }
  return parsed.data;
}
