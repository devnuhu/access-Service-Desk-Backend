import { useId, useRef, useState } from "react";
import {
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Upload,
  X,
} from "lucide-react";
import {
  checkFiles,
  FILE_ACCEPT,
  formatSize,
  MAX_FILES,
} from "@/shared/lib/files";

function iconFor(name) {
  if (/\.(jpe?g|png)$/i.test(name)) return FileImage;
  if (/\.(xlsx|csv)$/i.test(name)) return FileSpreadsheet;
  return FileText;
}

/**
 * Attachments: a drop zone and "Choose files". Checks each file in the browser (type, 1 MB, at most
 * 6) and says what is wrong per file; the server checks again and `error` shows its answer.
 *
 * @param {{ id: string, label?: string, files: File[], onChange: (files: File[]) => void,
 *           error?: string, disabled?: boolean }} props
 */
export default function FilePicker({
  id,
  label = "Attachments",
  files,
  onChange,
  error,
  disabled = false,
}) {
  const inputRef = useRef(null);
  const [problems, setProblems] = useState([]);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const problemsId = useId();

  const add = (picked) => {
    const { accepted, problems: found } = checkFiles(files, [...picked]);
    setProblems(found);
    if (accepted.length) onChange([...files, ...accepted]);
  };

  const remove = (index) => {
    setProblems([]);
    onChange(files.filter((_, i) => i !== index));
  };

  const full = files.length >= MAX_FILES;
  const describedBy = [
    hintId,
    problems.length && problemsId,
    error && `${id}-error`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div>
      <p id={`${id}-label`} className="block text-sm font-semibold text-ink">
        {label} <span className="font-normal text-muted">(optional)</span>
      </p>
      <div
        onDragOver={(event) => {
          if (disabled) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          if (!disabled) add(event.dataTransfer?.files ?? []);
        }}
        className={`mt-1 flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center sm:flex-row sm:justify-between sm:text-left ${
          over
            ? "border-brand-navy bg-brand-navy-light"
            : error
              ? "border-danger"
              : "border-line bg-page"
        }`}
      >
        <div className="flex items-center gap-2 text-sm text-body">
          <Upload
            aria-hidden="true"
            size={18}
            className="shrink-0 text-muted"
          />
          <span>Drop files here, or</span>
        </div>
        <input
          ref={inputRef}
          id={id}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            add(event.target.files ?? []);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={disabled || full}
          aria-describedby={describedBy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand-navy bg-white px-3 text-sm font-semibold text-brand-navy hover:bg-brand-navy-light disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Paperclip aria-hidden="true" size={15} />
          Choose files
        </button>
      </div>
      <p id={hintId} className="mt-1 text-xs text-muted">
        {files.length} of {MAX_FILES} files · each at most 1 MB · PDF, DOCX,
        XLSX, CSV, JPG or PNG
      </p>

      {problems.length > 0 && (
        <ul id={problemsId} role="alert" className="mt-1 space-y-0.5">
          {problems.map((problem) => (
            <li key={problem} className="text-xs font-medium text-danger">
              {problem}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul
          aria-label="Chosen files"
          className="mt-2 divide-y divide-line rounded-lg border border-line"
        >
          {files.map((file, index) => {
            const Icon = iconFor(file.name);
            return (
              <li
                key={`${file.name}-${index}`}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <Icon
                  aria-hidden="true"
                  size={16}
                  className="shrink-0 text-muted"
                />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {file.name}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {formatSize(file.size)}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(index)}
                  aria-label={`Remove ${file.name}`}
                  title={`Remove ${file.name}`}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-muted hover:bg-page hover:text-danger"
                >
                  <X aria-hidden="true" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
