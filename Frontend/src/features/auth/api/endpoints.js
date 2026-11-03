import { z } from "zod";
import { defineEndpoint } from "../../../shared/lib/http/endpoint.js";

/** AuthController wraps every answer in ApiResponse { statusCode, message, data, errors: { field: text } }. */
const apiResponse = (data) =>
  z.object({
    statusCode: z.number(),
    message: z.string().nullable(),
    data,
    errors: z.record(z.string(), z.unknown()).nullable().optional(),
  });

/**
 * The signed-in person (UserProfileDto from GET /api/Auth/me).
 * @typedef {Object} UserProfile
 * @property {string} id
 * @property {string | null} username
 * @property {string | null} email
 * @property {string | null} fullName
 * @property {string | null} firstName
 * @property {string | null} lastName
 * @property {string | null} corporateEmail
 * @property {string | null} department
 * @property {string | null} jobTitle
 * @property {string[]} roles
 * @property {number} unreadNotificationCount
 */
const userProfileSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  corporateEmail: z.string().nullable(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  roles: z
    .array(z.string())
    .nullable()
    .transform((roles) => roles ?? []),
  unreadNotificationCount: z.number(),
});

// The login and refresh answers also carry accessToken and refreshToken. The web app never reads
// them: the tokens travel in HttpOnly cookies (check:api fails if this schema names them).
const sessionSchema = z.object({
  csrfToken: z.string().nullable(),
  accessTokenExpiresAt: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string().nullable(),
    fullName: z.string().nullable(),
    firstName: z.string().nullable(),
    roles: z.array(z.string()).nullable(),
  }),
});

// A 401 here means wrong credentials: the server message is shown, no refresh is attempted.
export const login = defineEndpoint({
  method: "POST",
  path: "/api/Auth/login",
  body: z.object({
    username: z.string().trim().min(1, "Enter your username."),
    password: z.string().min(1, "Enter your password."),
  }),
  response: apiResponse(sessionSchema),
  skipAuthRedirect: true,
});

// No body: the refresh-token cookie carries the token. Never retried or refreshed itself.
export const refresh = defineEndpoint({
  method: "POST",
  path: "/api/Auth/refresh",
  response: apiResponse(sessionSchema),
  skipAuthRedirect: true,
});

export const me = defineEndpoint({
  method: "GET",
  path: "/api/Auth/me",
  response: apiResponse(userProfileSchema),
});

// A fresh CSRF token for a signed-in browser (after a page reload, or a "Security check failed").
export const csrf = defineEndpoint({
  method: "GET",
  path: "/api/Auth/csrf",
  response: apiResponse(z.string()),
});

// Always 200; open to anonymous callers so an expired session can still sign out.
export const logout = defineEndpoint({
  method: "POST",
  path: "/api/Auth/logout",
  skipAuthRedirect: true,
});
