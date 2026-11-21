import { lazy, Suspense } from "react";
import Spinner from "./Spinner.jsx";

// TipTap is large; it loads with the first page that shows an editor, not with the app.
const RichTextEditorCore = lazy(() => import("./RichTextEditorCore.jsx"));

/** The formatted text editor (props: see RichTextEditorCore.jsx), loaded on first use. */
export default function RichTextEditor(props) {
  return (
    <Suspense
      fallback={
        <div
          className={`flex items-center justify-center rounded-lg border border-line bg-white text-muted ${props.compact ? "min-h-[180px]" : "min-h-[260px]"}`}
        >
          <Spinner label="Loading the editor…" />
        </div>
      }
    >
      <RichTextEditorCore {...props} />
    </Suspense>
  );
}
