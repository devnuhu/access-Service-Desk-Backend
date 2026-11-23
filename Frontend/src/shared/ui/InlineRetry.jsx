import { RotateCw } from "lucide-react";

/**
 * A block that could not load: a short message and Try again, so one failing call never blanks
 * the rest of the page.
 */
export default function InlineRetry({ message, onRetry, testId }) {
  return (
    <p
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-body"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1 font-semibold text-brand-navy hover:underline"
      >
        <RotateCw aria-hidden="true" size={14} />
        Try again
      </button>
    </p>
  );
}
