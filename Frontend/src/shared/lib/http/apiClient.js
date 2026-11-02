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
 * Calls a declared endpoint with the configured client.
 * @param {Readonly<import("./endpoint.js").EndpointDefinition>} endpoint
 * @param {Parameters<typeof callEndpoint>[2]} [input]
 */
export function request(endpoint, input) {
  return callEndpoint(getHttp(), endpoint, input);
}
