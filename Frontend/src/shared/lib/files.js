/** Attachments per ticket or comment (decision of 3 Nov 2026): 0 to 6 files, each at most 1 MB. */
export const MAX_FILES = 6;
export const MAX_FILE_BYTES = 1024 * 1024;
export const FILE_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".xlsx",
  ".csv",
  ".jpg",
  ".jpeg",
  ".png",
];
export const FILE_ACCEPT = FILE_EXTENSIONS.join(",");

/** 2048 -> "2 KB"; under 1 KB still shows "1 KB". */
export function formatSize(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("en-GB")} KB`;
}

/**
 * Which of the newly picked files can be added to the ones already chosen, and what is wrong with
 * the rest, one sentence per file. The server checks the real file type again.
 * @param {File[]} chosen
 * @param {File[]} picked
 */
export function checkFiles(chosen, picked) {
  const accepted = [];
  const problems = [];
  let tooMany = false;
  for (const file of picked) {
    const name = file.name ?? "file";
    const extension = name.includes(".")
      ? name.slice(name.lastIndexOf(".")).toLowerCase()
      : "";
    if (!FILE_EXTENSIONS.includes(extension)) {
      problems.push(`${name}: only PDF, DOCX, XLSX, CSV, JPG or PNG.`);
    } else if (file.size > MAX_FILE_BYTES) {
      problems.push(`${name} is larger than 1 MB.`);
    } else if (file.size === 0) {
      problems.push(`${name} is empty.`);
    } else if (chosen.length + accepted.length >= MAX_FILES) {
      tooMany = true;
    } else {
      accepted.push(file);
    }
  }
  if (tooMany) problems.push(`You can attach at most ${MAX_FILES} files.`);
  return { accepted, problems };
}

/** Saves a downloaded file under `name` (never opened inline). */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
