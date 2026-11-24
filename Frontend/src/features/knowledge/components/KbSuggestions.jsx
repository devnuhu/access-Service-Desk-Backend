import { useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import useDebouncedValue from "@/shared/hooks/useDebouncedValue";
import { useArticleSuggestions } from "../hooks/useKnowledge.js";

export const SUGGEST_MIN_CHARS = 3;
export const SUGGEST_DELAY = 500;

/**
 * On the raise form: once a category is chosen, up to 3 published articles that may answer the
 * request, refined by the subject (3+ characters, 500 ms after typing stops). Each opens in a new
 * tab. "Hide" dismisses it for this form. Nothing shows when there is nothing to offer or the call
 * fails: it never blocks raising a request.
 */
export default function KbSuggestions({ categoryId, subject }) {
  const [hidden, setHidden] = useState(false);
  const typed = useDebouncedValue(subject.trim(), SUGGEST_DELAY);
  const text = typed.length >= SUGGEST_MIN_CHARS ? typed : "";
  const suggestions = useArticleSuggestions(categoryId, text, {
    enabled: !hidden,
  });
  const items = suggestions.data ?? [];
  if (hidden || suggestions.isError || items.length === 0) return null;

  return (
    <section
      aria-labelledby="kb-suggestions-heading"
      data-testid="kb-suggestions"
      className="rounded-card border border-brand-navy/20 bg-brand-navy-light px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id="kb-suggestions-heading"
          className="flex items-center gap-1.5 text-sm font-semibold text-ink"
        >
          <BookOpen aria-hidden="true" size={15} />
          These articles may answer your question
        </h2>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="text-xs font-semibold text-brand-navy hover:underline"
        >
          Hide
        </button>
      </div>
      <ul className="mt-2 space-y-2">
        {items.slice(0, 3).map((item) => (
          <li key={item.id}>
            <a
              href={`/knowledge/${item.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group block rounded-md py-1 text-sm"
            >
              <span className="inline-flex items-center gap-1 font-semibold text-brand-navy group-hover:underline">
                {item.title}
                <ExternalLink aria-hidden="true" size={12} />
                <span className="sr-only">(opens in a new tab)</span>
              </span>
              <span className="block text-body">{item.summary}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
