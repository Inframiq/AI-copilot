/**
 * Saves the file at `url` under `fileName`.
 *
 * Fetched as a blob rather than linked: a plain <a download> pointing at a
 * cross-origin storage URL opens the file instead of saving it. If the fetch
 * itself fails, the file is opened in a new tab instead, so the user still
 * gets it.
 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    blob = await res.blob();
  } catch {
    if (!window.open(url, "_blank", "noopener")) {
      throw new Error("The PDF is ready but your browser blocked it — allow pop-ups and try again.");
    }
    return;
  }
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/** "Jane Doe - Resume.pdf", or "Resume.pdf" without a name. Characters a
 * file system rejects are dropped. */
export function resumeFileName(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/[\/:*?"<>|]+/g, "").trim();
  return clean ? `${clean} - Resume.pdf` : "Resume.pdf";
}
