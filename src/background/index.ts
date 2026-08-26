// Service worker: runs the actions that need privileged APIs — attachment
// downloads and PDF generation (chrome.debugger -> Page.printToPDF), plus the
// download of the content-built ZIP. Print and ZIP assembly happen in the
// content script; only their final download comes here.
import ExtPay from 'extpay';
import { PDFDocument } from 'pdf-lib';
import type { ExtractAction, LicenseInfo, RunActionMessage, ThreadPayload } from '@/types';
import { dateStamp, sanitizeFilename } from '@/lib/download';
import { debuggerPdfEngine } from '@/lib/pdf';
import { EXTPAY_ID, FREE_LICENSE, userToLicense } from '@/lib/license';
import { getProSettings } from '@/lib/settings';
import { applyTemplate } from '@/lib/naming';

interface ActionResult {
  ok: boolean;
  message?: string;
}

// --- ExtensionPay (licensing) ------------------------------------------------
// The background owns the single live ExtPay instance. Content/popup query the
// cached license via messages. extpay talks only to extensionpay.com/Stripe —
// email content never leaves the device.
const extpay = ExtPay(EXTPAY_ID);
extpay.startBackground();

let cachedLicense: LicenseInfo = FREE_LICENSE;

async function refreshLicense(): Promise<LicenseInfo> {
  try {
    cachedLicense = userToLicense(await extpay.getUser());
  } catch (e) {
    console.warn('[gmail-bulk-extractor] license refresh failed', e);
  }
  return cachedLicense;
}

/** Tell every open Gmail tab to re-read entitlements (e.g. after a purchase). */
function broadcastLicense(): void {
  chrome.tabs.query({ url: 'https://mail.google.com/*' }, (tabs) => {
    for (const t of tabs) {
      if (t.id !== undefined) chrome.tabs.sendMessage(t.id, { type: 'license-updated' }).catch(() => undefined);
    }
  });
}

extpay.onPaid.addListener(() => {
  void refreshLicense().then(broadcastLicense);
});

void refreshLicense();

// Licensing messages from content script / popup.
chrome.runtime.onMessage.addListener(
  (msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type === 'get-license') {
      // Serve the cache immediately; kick a refresh for next time.
      sendResponse(cachedLicense);
      void refreshLicense();
      return; // sync response already sent
    }
    if (msg?.type === 'open-payment') {
      extpay.openPaymentPage().then(() => sendResponse({ ok: true })).catch((e: unknown) =>
        sendResponse({ ok: false, message: (e as Error).message }),
      );
      return true;
    }
    if (msg?.type === 'open-login') {
      extpay.openLoginPage().then(() => sendResponse({ ok: true })).catch((e: unknown) =>
        sendResponse({ ok: false, message: (e as Error).message }),
      );
      return true;
    }
    return; // not ours
  },
);

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
    case 'merge':
      return renderMergedPdf(msg.threads, tabId);
    default:
      // zip is handled in the content script and never reaches here.
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

/** Decode base64 PDF data to bytes (service worker has no Buffer). */
function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode bytes to base64, chunked to avoid String.fromCharCode arg limits. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Merge several PDFs (as bytes) into one document (Pro: single merged PDF). */
async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const bytes of parts) {
    const doc = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }
  return merged.save();
}

/**
 * Merge (Pro): render each selected email to a PDF, then combine them into one
 * document with pdf-lib and return it as base64 for the content script to open
 * in a tab. (Merging bytes avoids the cookie/origin problems of rendering
 * combined HTML.) No download here — the content script opens the result.
 */
async function renderMergedPdf(
  threads: ThreadPayload[],
  tabId?: number,
): Promise<ActionResult & { base64?: string }> {
  const total = threads.length;
  let done = 0;
  let failed = 0;
  const parts: Uint8Array[] = [];

  for (const t of threads) {
    try {
      parts.push(base64ToBytes(await debuggerPdfEngine.renderUrlToPdf(t.printUrl)));
    } catch (e) {
      failed++;
      console.warn('[gmail-bulk-extractor] merge render failed for', t.threadId, e);
    } finally {
      done++;
      reportProgress(tabId, 'merge', 'Merging', done, total);
    }
  }

  if (parts.length === 0) return { ok: false, message: 'Could not render the selected emails.' };
  const base64 = bytesToBase64(await mergePdfs(parts));
  const suffix = failed ? ` (${failed} failed)` : '';
  return {
    ok: true,
    base64,
    message: `Merged ${parts.length} email${parts.length > 1 ? 's' : ''}${suffix}.`,
  };
}

async function savePdfs(threads: ThreadPayload[], tabId?: number): Promise<ActionResult> {
  const pro = cachedLicense.pro;
  const settings = pro ? await getProSettings() : null;
  const folder = `gmail-pdf-${dateStamp()}`;
  const total = threads.length;
  let done = 0;
  let failed = 0;

  // Per-email PDFs. Sequential: one debugger-attached tab at a time.
  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    try {
      const base64 = await debuggerPdfEngine.renderUrlToPdf(t.printUrl);
      const url = `data:application/pdf;base64,${base64}`;
      const name =
        pro && settings
          ? applyTemplate(settings.pdfNameTemplate, { thread: t, index: i })
          : sanitizeFilename(t.subject, t.threadId);
      const filename = `${folder}/${name}.pdf`;
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
  const pro = cachedLicense.pro;
  const settings = pro ? await getProSettings() : null;
  const dateFolder = `gmail-extract-${dateStamp()}`;
  const jobs: Promise<void>[] = [];
  let count = 0;

  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    if (t.attachments.length === 0) continue;
    const folderName =
      pro && settings
        ? applyTemplate(settings.attachmentFolderTemplate, { thread: t, index: i })
        : sanitizeFilename(t.subject, t.threadId);
    const folder = `${dateFolder}/${folderName}/`;
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

