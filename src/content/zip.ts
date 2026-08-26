// ZIP export, handled entirely in the content script: it already holds each
// thread's printable HTML, can fetch attachment bytes same-origin (with real
// filenames from Content-Disposition), assemble the archive with JSZip, and
// trigger the download locally — no large-blob round-trip to the background.
import JSZip from 'jszip';
import type { ThreadPayload } from '@/types';
import { dateStamp, sanitizeFilename } from '@/lib/download';

interface IndexEntry {
  folder: string;
  subject: string;
  attachments: number;
}

/** Fetch one attachment's bytes + its real filename (from Content-Disposition). */
async function fetchAttachment(url: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`attachment HTTP ${res.status}`);
  const blob = await res.blob();
  return { blob, filename: filenameFromContentDisposition(res.headers.get('Content-Disposition')) };
}

/** Parse a filename from a Content-Disposition header (RFC 5987 aware). */
function filenameFromContentDisposition(cd: string | null): string {
  if (!cd) return '';
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? plain[1].trim() : '';
}

/** Return `name`, or a `(n)`-suffixed variant if already used; records the result. */
function uniquify(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  let candidate: string;
  do {
    candidate = `${base} (${i++})${ext}`;
  } while (used.has(candidate));
  used.add(candidate);
  return candidate;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

function buildIndexHtml(entries: IndexEntry[]): string {
  const rows = entries
    .map(
      (e) =>
        `<li><a href="./${encodeURIComponent(e.folder)}/email.html">${escapeHtml(e.subject)}</a>` +
        ` <span class="c">(${e.attachments} attachment${e.attachments !== 1 ? 's' : ''})</span></li>`,
    )
    .join('\n');
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>Gmail export</title>` +
    `<style>body{font:14px/1.6 Arial,sans-serif;margin:32px;max-width:760px;color:#202124}` +
    `h1{font-size:18px}li{margin:8px 0}.c{color:#5f6368;font-size:12px}</style></head><body>` +
    `<h1>Gmail export — ${entries.length} email${entries.length !== 1 ? 's' : ''}` +
    ` <span class="c">(${dateStamp()})</span></h1><ul>${rows}</ul></body></html>`
  );
}

/**
 * Build a ZIP: one folder per thread containing `email.html` + its attachments,
 * plus a top-level `index.html`. Attachment failures are logged and skipped.
 */
export async function buildZip(
  threads: ThreadPayload[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const usedFolders = new Set<string>();
  const index: IndexEntry[] = [];
  const total = threads.length;
  let done = 0;

  for (const t of threads) {
    const folderName = uniquify(sanitizeFilename(t.subject, t.threadId), usedFolders);
    const folder = zip.folder(folderName)!;
    folder.file('email.html', t.html);
    const usedFiles = new Set<string>(['email.html']);

    for (const att of t.attachments) {
      try {
        const { blob, filename } = await fetchAttachment(att.downloadUrl);
        folder.file(uniquify(sanitizeFilename(filename || 'attachment'), usedFiles), blob);
      } catch (e) {
        console.warn('[gmail-bulk-extractor] zip attachment failed', att.downloadUrl, e);
      }
    }

    index.push({ folder: folderName, subject: t.subject || t.threadId, attachments: t.attachments.length });
    done++;
    onProgress?.(done, total);
  }

  zip.file('index.html', buildIndexHtml(index));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Read a Blob as a base64 data URL (for handing to the background downloader). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('could not read blob'));
    fr.readAsDataURL(blob);
  });
}
