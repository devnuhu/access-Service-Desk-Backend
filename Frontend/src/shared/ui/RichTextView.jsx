import { useMemo } from "react";
import { sanitizeRichText } from "@/shared/lib/richText";

/**
 * Shows stored formatted text (ticket descriptions, comments). The server has cleaned it already;
 * it goes through DOMPurify again here before it is rendered. Links open in a new tab without the
 * page or a referrer; wide tables scroll inside the box.
 */
export default function RichTextView({ html, className = "" }) {
  const clean = useMemo(() => sanitizeRichText(html), [html]);
  return (
    <div
      className={`rich-text max-w-full overflow-x-auto ${className}`}
      // Sanitised above with the server's allowlist.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
