import { describe, expect, it, vi } from "vitest";
import { toApiError } from "./apiError.js";
import { applyFieldErrors, fieldError } from "./fieldErrors.js";

const apiError = toApiError({
  response: {
    status: 400,
    data: {
      message: "Some details are missing or not valid.",
      errors: { endDate: "Must be on or after the start date.", other: "x" },
    },
  },
});

describe("field errors", () => {
  it("reads one field's text", () => {
    expect(fieldError(apiError, "endDate")).toBe(
      "Must be on or after the start date.",
    );
    expect(fieldError(apiError, "startDate")).toBeUndefined();
    expect(fieldError(new Error("x"), "endDate")).toBeUndefined();
  });

  it("puts matching field errors on the form and ignores the rest", () => {
    const setError = vi.fn();
    expect(applyFieldErrors(apiError, setError, ["startDate", "endDate"])).toBe(
      true,
    );
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("endDate", {
      type: "server",
      message: "Must be on or after the start date.",
    });
    expect(applyFieldErrors(apiError, vi.fn(), ["note"])).toBe(false);
  });
});
