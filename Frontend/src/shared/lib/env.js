/**
 * Runtime configuration from Vite environment variables. See .env.example.
 *
 * @typedef {Object} AppEnv
 * @property {string} apiBaseUrl  "" means same origin (the Vite dev proxy in local development).
 */

/**
 * Reads and validates the environment. An unset VITE_API_BASE_URL means same origin; a value that
 * is not an http(s) URL throws, so a misconfigured build fails at start-up instead of calling a wrong URL.
 *
 * @param {Record<string, string | undefined>} [source]
 * @returns {AppEnv}
 */
export function readEnv(source = import.meta.env) {
  const apiBaseUrl = source.VITE_API_BASE_URL ?? "";
  if (apiBaseUrl !== "" && !/^https?:\/\//.test(apiBaseUrl)) {
    throw new Error(
      `VITE_API_BASE_URL must be empty or start with http:// or https:// (got "${apiBaseUrl}").`,
    );
  }
  return Object.freeze({ apiBaseUrl: apiBaseUrl.replace(/\/+$/, "") });
}
