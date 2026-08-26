// chrome.downloads wrapper + filename sanitizing helpers.

/** Strip characters unsafe for filenames/paths and trim length. */
export function sanitizeFilename(name: string, fallback = 'untitled'): string {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/** Today's date as YYYY-MM-DD, for dated folders/archives. */
export function dateStamp(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Trigger a download of a Blob to a relative path under the Downloads dir. */
export async function downloadBlob(blob: Blob, filename: string): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    return await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Revoke after a delay so the download has a chance to start reading.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
