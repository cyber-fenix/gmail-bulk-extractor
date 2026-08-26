// Service worker: runs the actions that need privileged APIs — attachment
// downloads and PDF generation (chrome.debugger -> Page.printToPDF), plus the
// download of the content-built ZIP. Print and ZIP assembly happen in the
// content script; only their final download comes here.
import type { ExtractAction, RunActionMessage, ThreadPayload } from '@/types';
import { dateStamp, sanitizeFilename } from '@/lib/download';
import { debuggerPdfEngine } from '@/lib/pdf';

interface ActionResult {
  ok: boolean;
  message?: string;
}

chrome.runtime.onMessage.addListener((msg: RunActionMessage, sender, sendResponse) => {
  if (msg?.type !== 'run-action') return;
  handleAction(msg, sender.tab?.id)
    .then(sendResponse)
    .catch((e: unknown) => sendResponse({ ok: false, message: (e as Error).message }));
  return true; // async response
});

// Download a data-URL blob the content script built (e.g. the ZIP). Registered
// in downloadJobs so onDeterminingFilename applies our filename authoritatively.
chrome.runtime.onMessage.addListener(
  (msg: { type?: string; dataUrl?: string; filename?: string }, _sender, sendResponse) => {
    if (msg?.type !== 'download-file' || !msg.dataUrl || !msg.filename) return;
    const { dataUrl, filename } = msg;
    downloadJobs.set(dataUrl, { filename });
    chrome.downloads
      .download({ url: dataUrl, filename, conflictAction: 'uniquify' })
      .then(() => sendResponse({ ok: true }))
      .catch((e: unknown) => {
        downloadJobs.delete(dataUrl);
        sendResponse({ ok: false, message: (e as Error).message });
      });
    return true; // async response
  },
);

async function handleAction(msg: RunActionMessage, tabId?: number): Promise<ActionResult> {
  switch (msg.action) {
    case 'attachments':
      return downloadAttachments(msg.threads);
    case 'pdf':
      return savePdfs(msg.threads, tabId);
    default:
      // print and zip are handled in the content script and never reach here.
      return { ok: true };
  }
}

/** Report progress back to the originating Gmail tab's toast. */
function reportProgress(
  tabId: number | undefined,
  action: ExtractAction,
  label: string,
  done: number,
  total: number,
): void {
  if (tabId === undefined) return;
  chrome.tabs
    .sendMessage(tabId, { type: 'progress', action, label, done, total })
    .catch(() => undefined);
}

// --- PDF ---------------------------------------------------------------------

async function savePdfs(threads: ThreadPayload[], tabId?: number): Promise<ActionResult> {
  const folder = `gmail-pdf-${dateStamp()}`;
  const total = threads.length;
  let done = 0;
  let failed = 0;

  // Sequential: one debugger-attached tab at a time (avoids CDP contention).
  for (const t of threads) {
    try {
      const base64 = await debuggerPdfEngine.renderUrlToPdf(t.printUrl);
      const url = `data:application/pdf;base64,${base64}`;
      const filename = `${folder}/${sanitizeFilename(t.subject, t.threadId)}.pdf`;
      downloadJobs.set(url, { filename }); // onDeterminingFilename applies it authoritatively
      await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
    } catch (e) {
      failed++;
      console.warn('[gmail-bulk-extractor] PDF failed for', t.threadId, e);
    } finally {
      done++;
      reportProgress(tabId, 'pdf', 'Generating PDFs', done, total);
    }
  }

  const saved = total - failed;
  if (saved === 0) return { ok: false, message: 'Could not generate PDFs.' };
  const suffix = failed ? ` (${failed} failed)` : '';
  return { ok: true, message: `Saved ${saved} PDF${saved > 1 ? 's' : ''}${suffix}.` };
}

// --- Attachments -------------------------------------------------------------

// Naming jobs for downloads WE initiate, keyed by the download URL. A single
// onDeterminingFilename hook handles both cases so it stays authoritative:
//  - attachments register a `folder`; the real name comes from Content-Disposition
//  - PDFs register a full `filename` (we already know it)
// This also prevents the listener from silently clobbering our PDF names into
// "download.pdf" (which happens when a registered listener doesn't suggest).
interface DownloadJob {
  folder?: string;
  filename?: string;
}
const downloadJobs = new Map<string, DownloadJob>();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const job = downloadJobs.get(item.url) ?? downloadJobs.get(item.finalUrl);
  if (!job) return; // not one of ours — leave it alone
  downloadJobs.delete(item.url);
  downloadJobs.delete(item.finalUrl);
  if (job.filename) {
    suggest({ filename: job.filename, conflictAction: 'uniquify' });
  } else if (job.folder) {
    const base = item.filename?.split(/[\\/]/).pop()?.trim() || 'attachment';
    suggest({ filename: `${job.folder}${sanitizeFilename(base)}`, conflictAction: 'uniquify' });
  }
});

async function downloadAttachments(threads: ThreadPayload[]): Promise<ActionResult> {
  const dateFolder = `gmail-extract-${dateStamp()}`;
  const jobs: Promise<void>[] = [];
  let count = 0;

  for (const t of threads) {
    if (t.attachments.length === 0) continue;
    const folder = `${dateFolder}/${sanitizeFilename(t.subject, t.threadId)}/`;
    for (const att of t.attachments) {
      downloadJobs.set(att.downloadUrl, { folder });
      count++;
      jobs.push(
        chrome.downloads
          .download({ url: att.downloadUrl }) // filename decided in onDeterminingFilename
          .then(() => undefined)
          .catch((e: unknown) => {
            downloadJobs.delete(att.downloadUrl);
            console.warn('[gmail-bulk-extractor] attachment download failed', att.downloadUrl, e);
          }),
      );
    }
  }

  if (count === 0) {
    return { ok: false, message: 'No attachments found in the selected emails.' };
  }
  await Promise.all(jobs);
  return { ok: true, message: `Downloading ${count} attachment${count > 1 ? 's' : ''}…` };
}

