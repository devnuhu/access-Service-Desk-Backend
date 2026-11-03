import { callEndpoint } from "./endpoint.js";

/** The single configured HTTP client. The app sets it once at start-up (src/app/setupHttp.js). */
let instance = null;

/** @param {import("axios").AxiosInstance} http */
export function configureHttp(http) {
  instance = http;
}

export function getHttp() {
  if (!instance) {
    throw new Error(
      "HTTP client is not configured. Call configureHttp at start-up.",
    );
  }
  return instance;
}

/**
 * Renews the session cookies through the client's one shared refresh, so it never runs alongside
 * a refresh started by a 401. Resolves true when the cookies were renewed.
 * @returns {Promise<boolean>}
 */
export function refreshSessionNow() {
  return getHttp().refreshSession();
}

/**
 * Calls a declared endpoint with the configured client.
 * @param {Readonly<import("./endpoint.js").EndpointDefinition>} endpoint
 * @param {Parameters<typeof callEndpoint>[2]} [input]
 */
export function request(endpoint, input) {
  return callEndpoint(getHttp(), endpoint, input);
}
