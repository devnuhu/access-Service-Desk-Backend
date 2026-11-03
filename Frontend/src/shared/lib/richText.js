import DOMPurify from "dompurify";

/** Formatted text limits (the server refuses above 200 000 characters of cleaned HTML). */
export const RICH_TEXT_WARN = 150_000;
export const RICH_TEXT_MAX = 200_000;

/**
 * The server's allowlist (Infrastructure/Tickets/RichText.cs), applied again in the browser before
 * stored HTML is shown: defence in depth if the server ever sent something it should not.
 */
const TAGS = [
  "p",
  "br",
  "hr",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "sub",
  "sup",
  "mark",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "a",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
  "caption",
];
const ATTRIBUTES = [
  "href",
  "style",
  "colspan",
  "rowspan",
  "colwidth",
  "start",
  "target",
  "rel",
];
const SAFE_LINK = /^(?:https?:|mailto:)/i;

let hooked = false;
function addLinkHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName !== "A") return;
    const href = node.getAttribute("href");
    if (href && !SAFE_LINK.test(href.trim())) node.removeAttribute("href");
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  });
}

/** Stored HTML made safe to show: allowlisted tags and attributes, links only http, https, mailto. */
export function sanitizeRichText(html) {
  addLinkHook();
  return DOMPurify.sanitize(html ?? "", {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
  });
}

/** The visible text of editor HTML (table cells and paragraphs separated by spaces). */
export function richTextToText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(
    html.replace(/<\/(p|td|th|li|h\d|tr|blockquote|pre)>/gi, " </$1>"),
    "text/html",
  );
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** An editor with no text is empty, even when it holds an empty table or blank paragraphs. */
export function isRichTextEmpty(html) {
  return richTextToText(html).length === 0;
}

/** "PEN" and 12 digits, like the server's duplicate check. */
export const RSA_PIN = /\bPEN\d{12}\b/i;

export const IMAGE_HINT = "Add pictures and screenshots as attachments.";

/** Links the editor accepts: web addresses and mailto. */
export const SAFE_EDITOR_LINK = /^(?:https?:\/\/|mailto:)/i;

/** "example.com" -> "https://example.com"; null when it is not an http, https or mailto address. */
export function normaliseLink(text) {
  const value = text.trim();
  if (!value) return null;
  const withScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")
      ? value
      : `https://${value}`;
  if (!SAFE_EDITOR_LINK.test(withScheme)) return null;
  try {
    const url = new URL(withScheme);
    return url.protocol === "mailto:" || url.hostname ? withScheme : null;
  } catch {
    return null;
  }
}
