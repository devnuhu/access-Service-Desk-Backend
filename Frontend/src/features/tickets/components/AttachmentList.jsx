import { useState } from "react";
import { Download, FileImage, FileSpreadsheet, FileText } from "lucide-react";
import { formatSize } from "@/shared/lib/files";
import { Spinner, useToast } from "@/shared/ui";
import { downloadFile } from "../hooks/useTickets.js";

function iconFor(name) {
  if (/\.(jpe?g|png)$/i.test(name)) return FileImage;
  if (/\.(xlsx|csv)$/i.test(name)) return FileSpreadsheet;
  return FileText;
}

/** A ticket's or comment's files. A click downloads through the HTTP client; never opened inline. */
export default function AttachmentList({ ticketId, files, label = "Files" }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  if (!files.length) return null;

  const download = async (file) => {
    setBusyId(file.id);
    try {
      await downloadFile(ticketId, file);
    } catch (error) {
      toast.error(error.message, { title: `${file.fileName} not downloaded` });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {files.map((file) => {
        const Icon = iconFor(file.fileName);
        return (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => download(file)}
              disabled={busyId === file.id}
              aria-label={`Download ${file.fileName} (${formatSize(file.sizeBytes)})`}
              className="inline-flex max-w-72 items-center gap-2 rounded-[6px] border border-line bg-white px-2.5 py-1.5 text-left text-sm hover:border-brand-navy hover:bg-brand-navy-light"
            >
              <Icon
                aria-hidden="true"
                size={16}
                className="shrink-0 text-muted"
              />
              <span className="min-w-0 truncate text-ink">{file.fileName}</span>
              <span className="shrink-0 text-xs text-muted">
                {formatSize(file.sizeBytes)}
              </span>
              {busyId === file.id ? (
                <Spinner size={14} />
              ) : (
                <Download
                  aria-hidden="true"
                  size={14}
                  className="shrink-0 text-brand-navy"
                />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
