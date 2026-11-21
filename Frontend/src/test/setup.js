import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(cleanup);

// findBy*/waitFor wait up to 1 s by default. A full parallel run on this machine is slower than
// that (debounced searches, first render of a page), so allow 4 s before a query fails.
configure({ asyncUtilTimeout: 4000 });

// jsdom does no layout. The rich-text editor (ProseMirror) measures the cursor when content is
// inserted from outside (saved replies, placeholders) to scroll it into view; give it empty boxes.
const emptyRects = () => ({
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
});
const emptyBox = () => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});
if (typeof window !== "undefined") {
  for (const proto of [Range.prototype, Element.prototype]) {
    if (!proto.getClientRects) proto.getClientRects = emptyRects;
    if (!proto.getBoundingClientRect) proto.getBoundingClientRect = emptyBox;
  }
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
}
