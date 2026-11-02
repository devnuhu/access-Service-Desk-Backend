import { ApiContractError } from "./apiError.js";

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
 * @property {import("zod").ZodType} [body]  request body schema (JSON)
 * @property {import("zod").ZodType} [response]  response schema; a mismatch throws ApiContractError
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

  const response = await http.request({
    method: endpoint.method,
    url: buildPath(endpoint.path, params),
    params: cleanQuery(endpoint, query),
    data,
    skipAuthRedirect: endpoint.skipAuthRedirect === true,
  });

  if (!endpoint.response) return response.data;

  const parsed = endpoint.response.safeParse(response.data);
  if (!parsed.success) {
    const error = new ApiContractError(endpoint, parsed.error);
    console.error(error.message, parsed.error.issues);
    throw error;
  }
  return parsed.data;
}
