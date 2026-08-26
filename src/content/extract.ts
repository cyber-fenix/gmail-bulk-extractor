// Content-side extraction: fetch each selected thread's printable HTML and its
// attachment references via the Gmail session (same-origin, credentialed). Runs
// in the content script because only there are fetches to mail.google.com
// first-party. Produces the ThreadPayload the actions consume.
import type { AttachmentRef, ThreadPayload } from '@/types';
import type { SelectedThread } from '@/content/gmail-dom';
import { attachmentUrl, printViewUrl } from '@/lib/session';

/** How many threads to fetch at once (gentle on Gmail). */
const CONCURRENCY = 4;

/** Fetch the printable HTML for one thread. Throws on non-OK / redirect. */
async function fetchThreadHtml(url: string): Promise<string> {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`print-view HTTP ${res.status}`);
  const text = await res.text();
  // A login/consent bounce would not contain the print-view marker.
  if (/accounts\.google\.com|consent\.google\.com/.test(res.url)) {
    throw new Error('session redirected (not signed in?)');
  }
  // Strip scripts: the print view ships an auto-`window.print()` script (and
  // others) that we never want to run. Removing them here keeps the print popup
  // free of CSP violations and stops a saved email.html from self-printing.
  return text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

/**
 * Parse attachment references out of a thread's print-view HTML.
 *
 * In a multi-message thread each attachment lives on its own message, so its
 * URL carries a per-message `th` (not the thread id) — and every attachment can
 * share `attid=0.1`. So we key uniqueness on `th + attid` and build each
 * download URL from the attachment's own `th`. We use string parsing (not
 * DOMParser) to stay clear of Gmail's Trusted Types policy, and skip `disp=thd`
 * thumbnail variants (each real attachment also appears as a thumbnail).
 */
export function parseAttachments(html: string, ik: string): AttachmentRef[] {
  const seen = new Set<string>();
  const out: AttachmentRef[] = [];
  const re = /(?:href|src)="([^"]*view=att[^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const params = new URLSearchParams((m[1].replace(/&amp;/g, '&').split('?')[1] ?? ''));
    const th = params.get('th');
    const attid = params.get('attid');
    if (!th || !attid) continue;
    if (params.get('disp') === 'thd') continue; // thumbnail, not the file
    const key = `${th}:${attid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      filename: '', // real name comes from Content-Disposition at download time
      mimeType: '',
      downloadUrl: attachmentUrl(ik, th, attid),
    });
  }
  return out;
}

/** Fetch HTML + attachment refs for one selected thread. */
async function collectThread(t: SelectedThread, ik: string): Promise<ThreadPayload> {
  const printUrl = printViewUrl(ik, t.threadId);
  const html = await fetchThreadHtml(printUrl);
  return {
    threadId: t.threadId,
    subject: t.subject,
    sender: t.sender,
    date: t.date,
    html,
    printUrl,
    attachments: parseAttachments(html, ik),
  };
}

export interface CollectProgress {
  done: number;
  total: number;
}

/**
 * Fetch all selected threads with bounded concurrency. `onProgress` fires after
 * each completes. Failed threads are collected in `errors` and skipped.
 */
export async function collectThreads(
  selected: SelectedThread[],
  ik: string,
  onProgress?: (p: CollectProgress) => void,
): Promise<{ payloads: ThreadPayload[]; errors: { threadId: string; error: string }[] }> {
  const payloads: ThreadPayload[] = [];
  const errors: { threadId: string; error: string }[] = [];
  let index = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (index < selected.length) {
      const t = selected[index++];
      try {
        payloads.push(await collectThread(t, ik));
      } catch (e) {
        errors.push({ threadId: t.threadId, error: (e as Error).message });
      } finally {
        done++;
        onProgress?.({ done, total: selected.length });
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, selected.length) }, worker);
  await Promise.all(workers);
  return { payloads, errors };
}
