import { useEffect, useId, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  Indent,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Minus,
  Outdent,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Table as TableIcon,
  TableProperties,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import {
  IMAGE_HINT,
  RICH_TEXT_MAX,
  RICH_TEXT_WARN,
  SAFE_EDITOR_LINK as SAFE_LINK,
  normaliseLink,
} from "@/shared/lib/richText";
import Button from "./Button.jsx";
import Dialog from "./Dialog.jsx";

const TEXT_COLOURS = [
  ["Navy", "#003883"],
  ["Orange", "#c25e00"],
  ["Green", "#3f6b0f"],
  ["Red", "#b42318"],
  ["Black", "#0b1f3a"],
];
const HIGHLIGHTS = [
  ["Yellow", "#fff3a3"],
  ["Light green", "#dcf2c4"],
  ["Light blue", "#d6e6fa"],
  ["Light orange", "#ffe1bf"],
];
function ToolButton({
  label,
  shortcut,
  icon: Icon,
  active,
  disabled,
  onClick,
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      data-tool
      aria-label={label}
      title={title}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-body hover:bg-page disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-brand-navy-light text-brand-navy" : ""}`}
    >
      <Icon aria-hidden="true" size={16} />
    </button>
  );
}

/** A toolbar button that opens a small panel (colours, table actions). Escape or a click outside closes it. */
function MenuButton({ label, icon: Icon, disabled, children }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div
      ref={wrapperRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          wrapperRef.current?.querySelector("[data-tool]")?.focus();
        }
      }}
    >
      <button
        type="button"
        data-tool
        aria-label={label}
        title={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-8 items-center gap-0.5 rounded-[4px] px-1.5 text-body hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon aria-hidden="true" size={16} />
        <ChevronDown aria-hidden="true" size={12} />
      </button>
      {open && (
        <div
          id={menuId}
          role="group"
          aria-label={label}
          className="absolute top-9 left-0 z-30 min-w-44 rounded-[6px] border border-line bg-white p-1 shadow-lg"
          onClick={(event) => {
            if (event.target.closest("button")) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, disabled, swatch }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-sm text-ink hover:bg-page disabled:cursor-not-allowed disabled:opacity-40"
    >
      {swatch && (
        <span
          aria-hidden="true"
          className="h-4 w-4 rounded-full border border-line"
          style={{ background: swatch }}
        />
      )}
      {label}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;
}

function LinkDialog({ open, initial, onClose, onSave }) {
  const inputId = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const save = (event) => {
    event.preventDefault();
    const href = normaliseLink(value);
    if (!href) {
      setError("Use a web address (http or https) or a mailto: address.");
      return;
    }
    onSave(href);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Link"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${inputId}-form`}>
            Save link
          </Button>
        </>
      }
    >
      <form id={`${inputId}-form`} onSubmit={save} noValidate>
        <label
          htmlFor={inputId}
          className="block text-sm font-semibold text-ink"
        >
          Address
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="url"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
          placeholder="https://… or mailto:…"
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={`mt-1 h-10 w-full rounded-[6px] border px-3 text-sm text-ink ${error ? "border-danger" : "border-line"}`}
        />
        {error && (
          <p
            id={`${inputId}-error`}
            className="mt-1 text-xs font-medium text-danger"
          >
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}

const BLOCKS = [
  ["paragraph", "Paragraph"],
  ["h1", "Heading 1"],
  ["h2", "Heading 2"],
  ["h3", "Heading 3"],
];

/**
 * Formatted text editor (TipTap). Emits editor.getHTML() through onChange; the server cleans it.
 * Images cannot be pasted or dropped in (a hint points to attachments); tables, lists, colours,
 * links (http, https, mailto) and alignment are kept. `compact` drops the headings select and
 * starts smaller (reply box). Shows a warning from 150 000 characters of HTML and an error above
 * 200 000; the form decides whether to block.
 *
 * @param {{
 *   id: string, value: string, onChange: (html: string) => void, labelledBy?: string,
 *   describedBy?: string, invalid?: boolean, placeholder?: string, compact?: boolean,
 *   toolbarLabel?: string,
 * }} props
 */
export default function RichTextEditor({
  id,
  value,
  onChange,
  labelledBy,
  describedBy,
  invalid = false,
  placeholder = "",
  compact = false,
  toolbarLabel = "Formatting",
}) {
  const [hint, setHint] = useState("");
  const [fullScreen, setFullScreen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const toolbarRef = useRef(null);
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  const hintId = `${id}-hint-live`;
  const lengthId = `${id}-length`;

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Hints clear themselves after a while.
  useEffect(() => {
    if (!hint) return undefined;
    const timer = setTimeout(() => setHint(""), 6000);
    return () => clearTimeout(timer);
  }, [hint]);

  // Attributes of the editable area. useEditor applies changed options on every render (TipTap 3),
  // so they live in the options, never set separately.
  const attributes = {
    id,
    role: "textbox",
    "aria-multiline": "true",
    class: `rich-text px-3 py-2 outline-none ${fullScreen ? "min-h-full" : compact ? "min-h-[140px]" : "min-h-[220px]"}`,
  };
  if (labelledBy) attributes["aria-labelledby"] = labelledBy;
  const described = [describedBy, hint && hintId, lengthId]
    .filter(Boolean)
    .join(" ");
  if (described) attributes["aria-describedby"] = described;
  if (invalid) attributes["aria-invalid"] = "true";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["mailto"],
          isAllowedUri: (url) => SAFE_LINK.test(url),
          HTMLAttributes: { rel: "noopener noreferrer nofollow" },
        },
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: true } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    editorProps: {
      attributes,
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        const files = [...(data?.files ?? [])];
        if (files.some((file) => file.type.startsWith("image/"))) {
          setHint(IMAGE_HINT);
          return true;
        }
        // Word and web pages may carry pictures in the HTML: the rest pastes, the pictures do not.
        if (/<img[\s>]/i.test(data?.getData("text/html") ?? "")) {
          setHint(IMAGE_HINT);
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length) return false;
        setHint(
          files.some((file) => file.type.startsWith("image/"))
            ? IMAGE_HINT
            : "Add files as attachments.",
        );
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML();
      emitted.current = html;
      onChangeRef.current(html);
    },
  });

  // A value set from outside (a restored draft, a cleared form) replaces the content.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  // Escape leaves full screen.
  useEffect(() => {
    if (!fullScreen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setFullScreen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            bulletList: e.isActive("bulletList"),
            orderedList: e.isActive("orderedList"),
            blockquote: e.isActive("blockquote"),
            link: e.isActive("link"),
            inTable: e.isActive("table"),
            inList: e.isActive("listItem"),
            alignLeft: e.isActive({ textAlign: "left" }),
            alignCenter: e.isActive({ textAlign: "center" }),
            alignRight: e.isActive({ textAlign: "right" }),
            block: e.isActive("heading", { level: 1 })
              ? "h1"
              : e.isActive("heading", { level: 2 })
                ? "h2"
                : e.isActive("heading", { level: 3 })
                  ? "h3"
                  : "paragraph",
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
            canSink: e.can().sinkListItem("listItem"),
            canLift: e.can().liftListItem("listItem"),
            canMerge: e.can().mergeCells(),
            canSplit: e.can().splitCell(),
          }
        : null,
  });

  // Toolbar keyboard: one Tab stop, arrow keys / Home / End move between the controls.
  useEffect(() => {
    const tools = [
      ...(toolbarRef.current?.querySelectorAll("[data-tool]") ?? []),
    ];
    if (!tools.length) return;
    // Keep the current stop while it is usable; otherwise the first enabled control takes it.
    const current = tools.find(
      (tool) => tool.getAttribute("tabindex") === "0" && !tool.disabled,
    );
    const stop = current ?? tools.find((tool) => !tool.disabled) ?? tools[0];
    tools.forEach((tool) => {
      tool.tabIndex = tool === stop ? 0 : -1;
    });
  });
  const onToolbarKey = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (event.target.tagName === "SELECT" && event.key.startsWith("Arrow"))
      return;
    const tools = [
      ...toolbarRef.current.querySelectorAll("[data-tool]"),
    ].filter((tool) => !tool.disabled);
    const index = tools.indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tools.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tools.length) %
            tools.length;
    toolbarRef.current
      .querySelectorAll("[data-tool]")
      .forEach((tool) => (tool.tabIndex = -1));
    tools[next].tabIndex = 0;
    tools[next].focus();
  };

  const length = value?.length ?? 0;
  const chain = () => editor.chain().focus();
  const s = state ?? {};

  return (
    <div
      className={
        fullScreen
          ? "fixed inset-0 z-50 flex flex-col bg-black/40 p-4 sm:p-8"
          : ""
      }
    >
      <div
        className={`flex flex-col rounded-[6px] border bg-white ${invalid ? "border-danger" : "border-line"} ${fullScreen ? "h-full shadow-xl" : ""}`}
      >
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label={toolbarLabel}
          aria-controls={id}
          onKeyDown={onToolbarKey}
          className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1"
        >
          <ToolButton
            label="Undo"
            shortcut="Ctrl+Z"
            icon={Undo2}
            disabled={!editor || !s.canUndo}
            onClick={() => chain().undo().run()}
          />
          <ToolButton
            label="Redo"
            shortcut="Ctrl+Y"
            icon={Redo2}
            disabled={!editor || !s.canRedo}
            onClick={() => chain().redo().run()}
          />
          <Divider />
          {!compact && (
            <>
              <select
                data-tool
                aria-label="Text style"
                title="Text style"
                value={s.block ?? "paragraph"}
                disabled={!editor}
                onChange={(event) => {
                  const block = event.target.value;
                  if (block === "paragraph") chain().setParagraph().run();
                  else
                    chain()
                      .setHeading({ level: Number(block.slice(1)) })
                      .run();
                }}
                className="h-8 rounded-[4px] border border-line bg-white px-1.5 text-sm text-ink"
              >
                {BLOCKS.map(([key, text]) => (
                  <option key={key} value={key}>
                    {text}
                  </option>
                ))}
              </select>
              <Divider />
            </>
          )}
          <ToolButton
            label="Bold"
            shortcut="Ctrl+B"
            icon={Bold}
            active={Boolean(s.bold)}
            disabled={!editor}
            onClick={() => chain().toggleBold().run()}
          />
          <ToolButton
            label="Italic"
            shortcut="Ctrl+I"
            icon={Italic}
            active={Boolean(s.italic)}
            disabled={!editor}
            onClick={() => chain().toggleItalic().run()}
          />
          <ToolButton
            label="Underline"
            shortcut="Ctrl+U"
            icon={Underline}
            active={Boolean(s.underline)}
            disabled={!editor}
            onClick={() => chain().toggleUnderline().run()}
          />
          <ToolButton
            label="Strikethrough"
            shortcut="Ctrl+Shift+S"
            icon={Strikethrough}
            active={Boolean(s.strike)}
            disabled={!editor}
            onClick={() => chain().toggleStrike().run()}
          />
          <ToolButton
            label="Code"
            shortcut="Ctrl+E"
            icon={Code}
            active={Boolean(s.code)}
            disabled={!editor}
            onClick={() => chain().toggleCode().run()}
          />
          <Divider />
          <MenuButton label="Text colour" icon={Baseline} disabled={!editor}>
            {TEXT_COLOURS.map(([name, colour]) => (
              <MenuItem
                key={name}
                label={name}
                swatch={colour}
                onClick={() => chain().setColor(colour).run()}
              />
            ))}
            <MenuItem
              label="Default colour"
              onClick={() => chain().unsetColor().run()}
            />
          </MenuButton>
          <MenuButton label="Highlight" icon={Highlighter} disabled={!editor}>
            {HIGHLIGHTS.map(([name, colour]) => (
              <MenuItem
                key={name}
                label={name}
                swatch={colour}
                onClick={() => chain().setHighlight({ color: colour }).run()}
              />
            ))}
            <MenuItem
              label="No highlight"
              onClick={() => chain().unsetHighlight().run()}
            />
          </MenuButton>
          <ToolButton
            label="Clear formatting"
            icon={RemoveFormatting}
            disabled={!editor}
            onClick={() => chain().unsetAllMarks().clearNodes().run()}
          />
          <Divider />
          <ToolButton
            label="Bulleted list"
            shortcut="Ctrl+Shift+8"
            icon={List}
            active={Boolean(s.bulletList)}
            disabled={!editor}
            onClick={() => chain().toggleBulletList().run()}
          />
          <ToolButton
            label="Numbered list"
            shortcut="Ctrl+Shift+7"
            icon={ListOrdered}
            active={Boolean(s.orderedList)}
            disabled={!editor}
            onClick={() => chain().toggleOrderedList().run()}
          />
          <ToolButton
            label="Indent"
            shortcut="Tab"
            icon={Indent}
            disabled={!editor || !s.canSink}
            onClick={() => chain().sinkListItem("listItem").run()}
          />
          <ToolButton
            label="Outdent"
            shortcut="Shift+Tab"
            icon={Outdent}
            disabled={!editor || !s.canLift}
            onClick={() => chain().liftListItem("listItem").run()}
          />
          <ToolButton
            label="Blockquote"
            shortcut="Ctrl+Shift+B"
            icon={Quote}
            active={Boolean(s.blockquote)}
            disabled={!editor}
            onClick={() => chain().toggleBlockquote().run()}
          />
          <ToolButton
            label="Horizontal rule"
            icon={Minus}
            disabled={!editor}
            onClick={() => chain().setHorizontalRule().run()}
          />
          <Divider />
          <ToolButton
            label="Align left"
            shortcut="Ctrl+Shift+L"
            icon={AlignLeft}
            active={Boolean(s.alignLeft)}
            disabled={!editor}
            onClick={() => chain().setTextAlign("left").run()}
          />
          <ToolButton
            label="Align centre"
            shortcut="Ctrl+Shift+E"
            icon={AlignCenter}
            active={Boolean(s.alignCenter)}
            disabled={!editor}
            onClick={() => chain().setTextAlign("center").run()}
          />
          <ToolButton
            label="Align right"
            shortcut="Ctrl+Shift+R"
            icon={AlignRight}
            active={Boolean(s.alignRight)}
            disabled={!editor}
            onClick={() => chain().setTextAlign("right").run()}
          />
          <Divider />
          <ToolButton
            label="Link"
            icon={LinkIcon}
            active={Boolean(s.link)}
            disabled={!editor}
            onClick={() => setLinkOpen(true)}
          />
          <ToolButton
            label="Remove link"
            icon={Unlink}
            disabled={!editor || !s.link}
            onClick={() => chain().extendMarkRange("link").unsetLink().run()}
          />
          <Divider />
          <ToolButton
            label="Insert table"
            icon={TableIcon}
            disabled={!editor || s.inTable}
            onClick={() =>
              chain()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
          />
          <MenuButton
            label="Table options"
            icon={TableProperties}
            disabled={!editor || !s.inTable}
          >
            <MenuItem
              label="Add row above"
              onClick={() => chain().addRowBefore().run()}
            />
            <MenuItem
              label="Add row below"
              onClick={() => chain().addRowAfter().run()}
            />
            <MenuItem
              label="Remove row"
              onClick={() => chain().deleteRow().run()}
            />
            <MenuItem
              label="Add column left"
              onClick={() => chain().addColumnBefore().run()}
            />
            <MenuItem
              label="Add column right"
              onClick={() => chain().addColumnAfter().run()}
            />
            <MenuItem
              label="Remove column"
              onClick={() => chain().deleteColumn().run()}
            />
            <MenuItem
              label="Header row on/off"
              onClick={() => chain().toggleHeaderRow().run()}
            />
            <MenuItem
              label="Merge cells"
              disabled={!s.canMerge}
              onClick={() => chain().mergeCells().run()}
            />
            <MenuItem
              label="Split cell"
              disabled={!s.canSplit}
              onClick={() => chain().splitCell().run()}
            />
            <MenuItem
              label="Delete table"
              onClick={() => chain().deleteTable().run()}
            />
          </MenuButton>
          <span className="ml-auto" />
          <ToolButton
            label={fullScreen ? "Leave full screen" : "Full screen"}
            shortcut={fullScreen ? "Esc" : undefined}
            icon={fullScreen ? Minimize2 : Maximize2}
            active={fullScreen}
            disabled={!editor}
            onClick={() => {
              setFullScreen((value) => !value);
              editor?.commands.focus();
            }}
          />
        </div>

        <div
          className={`overflow-y-auto ${fullScreen ? "flex-1" : "max-h-[600px]"}`}
          onClick={(event) => {
            if (event.target === event.currentTarget)
              editor?.commands.focus("end");
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      <div className="mt-1 space-y-1">
        {hint && (
          <p
            id={hintId}
            role="status"
            className="text-xs font-medium text-brand-orange-ink"
          >
            {hint}
          </p>
        )}
        <p
          id={lengthId}
          className={
            length > RICH_TEXT_MAX
              ? "text-xs font-medium text-danger"
              : length > RICH_TEXT_WARN
                ? "text-xs font-medium text-brand-orange-ink"
                : "sr-only"
          }
        >
          {length > RICH_TEXT_MAX
            ? `Too long to send (${length.toLocaleString("en-GB")} of ${RICH_TEXT_MAX.toLocaleString("en-GB")} characters). Attach large tables as files.`
            : length > RICH_TEXT_WARN
              ? `Getting long: ${length.toLocaleString("en-GB")} of ${RICH_TEXT_MAX.toLocaleString("en-GB")} characters. Attach large tables as files.`
              : ""}
        </p>
      </div>

      {linkOpen && (
        <LinkDialog
          open
          initial={editor?.getAttributes("link").href ?? ""}
          onClose={() => setLinkOpen(false)}
          onSave={(href) => {
            setLinkOpen(false);
            const { empty } = editor.state.selection;
            if (empty && !editor.isActive("link")) {
              chain()
                .insertContent({
                  type: "text",
                  text: href,
                  marks: [{ type: "link", attrs: { href } }],
                })
                .run();
            } else {
              chain().extendMarkRange("link").setLink({ href }).run();
            }
          }}
        />
      )}
    </div>
  );
}
