// Bulk print: combine each selected thread's print-view HTML into one document,
// one email per printed page. Rendered in a popup that inherits mail.google.com
// origin, so Gmail's relative image URLs (resolved via <base>) load same-origin
// with the user's cookies — no broken images.
import { accountIndex } from '@/lib/session';
import type { ThreadPayload } from '@/types';

/** Pull the <body> contents out of a full print-view HTML document. */
function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return m ? m[1] : html;
}

/** Build one printable HTML document with a page break between each email. */
export function buildPrintDocument(threads: ThreadPayload[]): string {
  const base = `https://mail.google.com/mail/u/${accountIndex()}/`;
  const sections = threads
    .map((t) => `<section class="gbe-email">${extractBody(t.html)}</section>`)
    .join('\n');
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<base href="${base}">` +
    `<title>Gmail — ${threads.length} email${threads.length !== 1 ? 's' : ''}</title>` +
    `<style>` +
    `body{font-family:arial,sans-serif;margin:0;color:#000}` +
    `.gbe-email{padding:24px}` +
    `.gbe-email + .gbe-email{page-break-before:always}` +
    `</style></head><body>${sections}</body></html>`
  );
}
