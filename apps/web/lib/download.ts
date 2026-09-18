/**
 * Saves the file at `url` under `fileName`.
 *
 * A data: URL — which is how POST /resumes/{id}/pdf returns the PDF — is
 * decoded in place: there is nothing to fetch, and browsers refuse to open
 * data: URLs in a new tab, so no fallback could rescue it anyway.
 *
 * Anything else is fetched as a blob rather than linked: a plain
 * <a download> pointing at a cross-origin storage URL opens the file instead
 * of saving it. If that fetch fails, the file is opened in a new tab so the
 * user still gets it.
 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  let blob: Blob;
  if (url.startsWith("data:")) {
    blob = dataUrlToBlob(url);
  } else {
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

function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(",");
  const meta = url.slice(5, comma); // after "data:"
  const payload = url.slice(comma + 1);
  const type = meta.split(";")[0] || "application/octet-stream";
  if (meta.endsWith(";base64")) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(payload)], { type });
}

/** "Jane Doe - Resume.pdf", or "Resume.pdf" without a name. Characters a
 * file system rejects are dropped. */
export function resumeFileName(name: string | null | undefined): string {
  const clean = (name ?? "").replace(/[\\/:*?"<>|]+/g, "").trim();
  return clean ? `${clean} - Resume.pdf` : "Resume.pdf";
}
