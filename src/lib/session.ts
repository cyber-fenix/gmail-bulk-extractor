// Gmail session helpers: derive the account index and inbox key (`ik`) from the
// live page, and build the session-authenticated URLs we fetch same-origin
// (with the user's cookies) to get thread HTML and attachment bytes.
//
// These rely on undocumented Gmail internals. Verified against a live account:
//   - account index lives in the URL path (/mail/u/<N>/)
//   - `ik` is exposed on window.GLOBALS (a 10-char hex token), NOT in inline
//     JSON, so we read it from there first and fall back to a page regex
//   - `view=pt` returns clean printable thread HTML
//   - `view=att` returns attachment bytes

/** Account index from the current URL, e.g. /mail/u/0/ -> "0". Defaults to 0. */
export function accountIndex(): string {
  const m = location.pathname.match(/\/mail\/u\/(\d+)\//);
  return m ? m[1] : '0';
}

/**
 * Inbox key (`ik`) for building session URLs.
 *
 * `ik` lives on window.GLOBALS, which is in the PAGE's main world and invisible
 * to this isolated-world content script. The main-world script (mainworld/ik.ts)
 * reads it and publishes it onto <html data-gbe-ik>, which we read here. A
 * page-HTML regex is kept as a last-resort fallback. Returns null if unavailable.
 */
export function inboxKey(): string | null {
  const bridged = document.documentElement.getAttribute('data-gbe-ik');
  if (bridged) return bridged;
  const m = document.documentElement.innerHTML.match(
    /["']?ik["']?\s*[:=]\s*["']([\w-]{6,})["']/,
  );
  return m ? m[1] : null;
}

/** Build the `view=pt` print-view URL for a thread (clean printable HTML). */
export function printViewUrl(ik: string, threadId: string): string {
  const u = accountIndex();
  return `https://mail.google.com/mail/u/${u}/?ui=2&ik=${ik}&view=pt&search=all&th=${threadId}`;
}

/**
 * Build a download URL for one attachment. `msgId` is the per-message `th` the
 * attachment lives on (in a multi-message thread each attachment has its own,
 * not the thread id). `disp=attd` requests the original file so the response
 * carries the real filename in Content-Disposition and the original bytes.
 */
export function attachmentUrl(ik: string, msgId: string, attid: string): string {
  const u = accountIndex();
  return (
    `https://mail.google.com/mail/u/${u}/?ui=2&ik=${ik}&view=att` +
    `&th=${msgId}&attid=${encodeURIComponent(attid)}&disp=attd&safe=1&zw`
  );
}
