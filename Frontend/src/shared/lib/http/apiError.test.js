import { describe, expect, it } from "vitest";
import { ApiError, isCsrfFailure, toApiError } from "./apiError.js";

const httpError = (status, data) => ({ response: { status, data } });

describe("toApiError", () => {
  it("reads { message } bodies and field errors given as plain strings", () => {
    const error = toApiError(
      httpError(400, {
        message: "Choose a role.",
        errors: { roleId: "Choose a role." },
      }),
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("validation");
    expect(error.message).toBe("Choose a role.");
    expect(error.fieldErrors).toEqual({ roleId: ["Choose a role."] });
  });

  it("reads the AuthController ApiResponse shape", () => {
    const error = toApiError(
      httpError(401, {
        statusCode: 401,
        message: "Invalid username or password",
        data: null,
        errors: null,
      }),
    );
    expect(error.kind).toBe("unauthorized");
    expect(error.message).toBe("Invalid username or password");
  });

  it("maps ValidationProblemDetails to field errors", () => {
    const error = toApiError(
      httpError(400, {
        title: "One or more validation errors occurred.",
        errors: { To: ["Required"], "$.isActive": ["Invalid value"] },
      }),
    );
    expect(error.fieldErrors).toEqual({
      to: ["Required"],
      isActive: ["Invalid value"],
    });
    expect(error.message).toBe("Required");
  });

  it("gives a 403 with an empty body a clear message, and keeps a 403 message", () => {
    expect(toApiError(httpError(403, "")).message).toBe(
      "You do not have access to this.",
    );
    const csrf = toApiError(
      httpError(403, {
        statusCode: 403,
        message: "Security check failed. Refresh the page and try again.",
      }),
    );
    expect(isCsrfFailure(csrf)).toBe(true);
    expect(isCsrfFailure(toApiError(httpError(403, "")))).toBe(false);
  });

  it("shows a fixed text for 429 and the API message for 503", () => {
    expect(toApiError(httpError(429, "Too many")).message).toBe(
      "Too many attempts. Wait a minute and try again.",
    );
    const unavailable = toApiError(
      httpError(503, { message: "The staff directory could not be searched." }),
    );
    expect(unavailable.kind).toBe("server");
    expect(unavailable.message).toBe(
      "The staff directory could not be searched.",
    );
  });

  it("marks 404 and 409", () => {
    expect(
      toApiError(httpError(404, { message: "Person not found." })).kind,
    ).toBe("notFound");
    const conflict = toApiError(
      httpError(409, { message: "They already have this role." }),
    );
    expect(conflict.kind).toBe("conflict");
    expect(conflict.message).toBe("They already have this role.");
  });

  it("treats a missing response as a network error", () => {
    const error = toApiError(new Error("Network Error"));
    expect(error.kind).toBe("network");
    expect(error.status).toBeNull();
    expect(error.message).toBe(
      "Access Desk cannot be reached right now. Try again shortly.",
    );
  });
});
