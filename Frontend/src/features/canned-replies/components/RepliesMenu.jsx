import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, MessageSquareText, Search } from "lucide-react";
import { Chip, Spinner } from "@/shared/ui";
import { useTicketReplies } from "../hooks/useCannedReplies.js";

/** The text of some HTML, for searching (the browser parses it; nothing runs). */
function plainText(html) {
  const doc = new DOMParser().parseFromString(html ?? "", "text/html");
  return doc.body.textContent ?? "";
}

/**
 * "Replies" beside the comment box (staff for the ticket): the ticket's saved replies, its unit's
 * first then the shared ones (the server's order), with a search. Choosing one calls
 * onChoose(bodyHtml); nothing is sent. A 404 (not staff for this ticket) hides the button.
 */
export default function RepliesMenu({ ticketId, onChoose }) {
  const replies = useTicketReplies(ticketId);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const wrapperRef = useRef(null);
  const buttonRef = useRef(null);
  const searchRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    searchRef.current?.focus();
    const onDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (replies.isError) return null;

  const list = replies.data ?? [];
  const words = text.trim().toLowerCase();
  const shown = words
    ? list.filter((reply) =>
        `${reply.title} ${plainText(reply.bodyHtml)}`
          .toLowerCase()
          .includes(words),
      )
    : list;

  const close = () => {
    setOpen(false);
    setText("");
    buttonRef.current?.focus();
  };

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-brand-navy hover:border-brand-navy"
      >
        <MessageSquareText aria-hidden="true" size={15} />
        Replies
        <ChevronDown aria-hidden="true" size={14} />
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Saved replies"
          className="absolute top-10 right-0 z-30 w-80 rounded-card border border-line bg-white shadow-xl"
        >
          <div className="border-b border-line p-2">
            <label className="relative block">
              <span className="sr-only">Search replies</span>
              <Search
                aria-hidden="true"
                size={15}
                className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
              />
              <input
                ref={searchRef}
                type="search"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Search replies"
                className="h-9 w-full rounded-lg border border-line pr-2 pl-8 text-sm text-ink"
              />
            </label>
          </div>
          {replies.isLoading ? (
            <div className="px-3 py-6 text-center text-muted">
              <Spinner label="Loading replies…" />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              {list.length
                ? "No reply matches."
                : "No saved replies for this unit yet."}
            </p>
          ) : (
            <ul className="max-h-72 overflow-y-auto p-1" aria-label="Replies">
              {shown.map((reply) => (
                <li key={reply.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChoose(reply.bodyHtml);
                      close();
                    }}
                    className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left hover:bg-page"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {reply.title}
                      {reply.isShared && <Chip tone="grey">Shared</Chip>}
                    </span>
                    <span className="line-clamp-2 text-xs text-muted">
                      {plainText(reply.bodyHtml)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
