// Content script entry: injects the toolbar into Gmail, keeps it present across
// Gmail's SPA view changes, keeps its selection count in sync, and runs the
// four actions (print / PDF / attachments / ZIP) on the selected emails.
import {
  ACTION_ATTR,
  buildToolbar,
  setProState,
  setSelectionCount,
  TOOLBAR_ELEMENT_ID,
} from '@/content/toolbar';
import {
  diagnostics,
  findToolbarAnchor,
  selectedCount,
  selectedThreads,
} from '@/content/gmail-dom';
import { collectThreads } from '@/content/extract';
import { blobToDataUrl, buildZip } from '@/content/zip';
import { flashToast, hideToast, showToast, upsellToast } from '@/content/toast';
import { dateStamp } from '@/lib/download';
import { inboxKey } from '@/lib/session';
import { FREE_LICENSE, getLicense, openPaymentPage } from '@/lib/license';
import { addUsage, getUsage } from '@/lib/usage';
import { checkAction } from '@/lib/entitlements';
import { getProSettings } from '@/lib/settings';
import { applyTemplate } from '@/lib/naming';
import type { ExtractAction, LicenseInfo, RunActionMessage } from '@/types';

let busy = false;

// Cached entitlements so the gate can run synchronously (before the print popup
// must open within the click's user-activation). Refreshed on load, on focus,
// and when the background signals a license change.
let license: LicenseInfo = FREE_LICENSE;
let usageCount = 0;

async function refreshEntitlements(): Promise<void> {
  // After an extension reload this content script is orphaned and chrome.* APIs
  // throw "Extension context invalidated". Bail quietly — the user is told to
  // reload the tab when they next click an action.
  if (!chrome.runtime?.id) return;
  try {
    license = await getLicense();
    usageCount = (await getUsage()).count;
    setProState(license.pro); // hide/show the Pro star badge on the toolbar
  } catch {
    /* context invalidated mid-flight */
  }
}

async function handleAction(action: ExtractAction): Promise<void> {
  if (busy) return;

  // After an extension reload, this content script is orphaned and chrome.* APIs
  // throw "Extension context invalidated". Detect it and tell the user to reload
  // the tab instead of failing silently.
  if (!chrome.runtime?.id) {
    flashToast('Extension was updated — reload this Gmail tab (⌘R / Ctrl+R).', 5000, {
      error: true,
    });
    return;
  }

  const selected = selectedThreads();
  if (selected.length === 0) {
    flashToast('Select one or more emails first.');
    return;
  }

  // Freemium gate: one place, all actions. Merge is Pro-only; the capped actions
  // (pdf/attachments/zip) must fit the weekly remaining for free users. Uses
  // cached entitlements so it stays synchronous (the merge branch below opens
  // its tab within this click's activation).
  const gate = checkAction(action, selected.length, license, usageCount);
  if (!gate.allow) {
    upsellToast(gate.reason ?? 'Upgrade to Pro for unlimited.', () => void openPaymentPage());
    return;
  }

  const ik = inboxKey();
  if (!ik) {
    flashToast('Could not read the Gmail session key. Try reloading Gmail.', 4000, { error: true });
    return;
  }

  // Merge opens a tab *synchronously* within the click's activation, before the
  // async render below — otherwise Chrome's pop-up blocker kills it. We fill it
  // with the merged PDF (via a blob URL) once the background returns.
  let mergeWindow: Window | null = null;
  if (action === 'merge') {
    mergeWindow = window.open('', '_blank');
    if (!mergeWindow) {
      flashToast('Allow pop-ups for mail.google.com to use Merge.', 4500, { error: true });
      return;
    }
    mergeWindow.document.write(
      '<!doctype html><title>Preparing…</title><body style="font:14px arial;padding:24px">Preparing merged PDF…</body>',
    );
  }

  busy = true;
  // Emails actually processed by a successful action; charged to the free
  // weekly quota in `finally` (only on success — failures don't burn quota).
  let processed = 0;
  try {
    showToast(`Reading ${selected.length} email${selected.length > 1 ? 's' : ''}…`, {
      spinner: true,
    });
    const { payloads, errors } = await collectThreads(selected, ik, ({ done, total }) => {
      showToast(`Reading ${done}/${total} email${total > 1 ? 's' : ''}…`, { spinner: true });
    });

    if (payloads.length === 0) {
      mergeWindow?.close();
      flashToast('Could not read the selected emails.', 4000, { error: true });
      return;
    }

    // Merge (Pro): background renders each email and combines them into one PDF;
    // we open the result in the pre-opened tab as a blob URL. Chrome's PDF viewer
    // shows it — the user can print or save from there. No auto print dialog.
    if (action === 'merge' && mergeWindow) {
      showToast(`Merging ${payloads.length} email${payloads.length > 1 ? 's' : ''}…`, {
        spinner: true,
      });
      const msg: RunActionMessage = { type: 'run-action', action, threads: payloads };
      const res = (await chrome.runtime.sendMessage(msg)) as
        | { ok: boolean; base64?: string; message?: string }
        | undefined;
      if (!res?.ok || !res.base64) {
        mergeWindow.close();
        flashToast(res?.message ?? 'Merge failed.', 4000, { error: true });
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      mergeWindow.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const skippedMerge = errors.length ? ` (${errors.length} skipped)` : '';
      flashToast(`Opened merged PDF — ${payloads.length} email${payloads.length > 1 ? 's' : ''}${skippedMerge}.`);
      return;
    }

    // ZIP is assembled and downloaded locally (needs same-origin attachment
    // fetches + JSZip); no background round-trip.
    if (action === 'zip') {
      showToast('Building ZIP…', { spinner: true });
      // Pro: apply the custom folder template; free uses the default (subject).
      let zipNamer: ((thread: (typeof payloads)[number], index: number) => string) | undefined;
      if (license.pro) {
        const s = await getProSettings();
        zipNamer = (thread, index) => applyTemplate(s.zipFolderTemplate, { thread, index });
      }
      const blob = await buildZip(
        payloads,
        (d, total) => showToast(`Zipping ${d}/${total}…`, { spinner: true }),
        zipNamer,
      );
      // Hand the finished archive to the background to download. A page-side
      // <a download> would be dropped here: the awaits above outlive the click's
      // user-activation window, so Chrome ignores the anchor download.
      showToast('Saving ZIP…', { spinner: true });
      const dataUrl = await blobToDataUrl(blob);
      const res = (await chrome.runtime.sendMessage({
        type: 'download-file',
        dataUrl,
        filename: `gmail-export-${dateStamp()}.zip`,
      })) as { ok: boolean; message?: string } | undefined;
      const skippedZip = errors.length ? ` (${errors.length} skipped)` : '';
      if (res?.ok) {
        processed = payloads.length;
        flashToast(`ZIP downloaded — ${payloads.length} email${payloads.length > 1 ? 's' : ''}${skippedZip}.`);
      } else {
        flashToast(res?.message ?? 'ZIP download failed.', 4000, { error: true });
      }
      return;
    }

    // Attachments / PDF go to the background handlers (they need chrome APIs).
    const msg: RunActionMessage = { type: 'run-action', action, threads: payloads };
    const res = (await chrome.runtime.sendMessage(msg)) as
      | { ok: boolean; message?: string }
      | undefined;

    if (res?.ok) processed = payloads.length;
    const skipped = errors.length ? ` (${errors.length} skipped)` : '';
    if (res?.message) {
      flashToast(res.message + skipped, 3600, { error: !res.ok });
    } else {
      flashToast(`Prepared ${payloads.length} email${payloads.length > 1 ? 's' : ''}${skipped}.`);
    }
  } finally {
    hideToast();
    busy = false;
    // Charge the free quota only for what actually succeeded. Pro is unlimited,
    // so we skip metering there entirely.
    if (processed > 0 && !license.pro) {
      usageCount += processed;
      void addUsage(processed);
    }
  }
}

/**
 * Ensure the toolbar exists AND lives in the best available anchor. Gmail often
 * renders the main toolbar after `document_idle`, so on first run we may land in
 * a fallback anchor; once a better one appears we migrate into it.
 */
function ensureToolbar(): void {
  const anchor = findToolbarAnchor();
  if (!anchor) return;
  let bar = document.getElementById(TOOLBAR_ELEMENT_ID) as HTMLElement | null;
  if (bar && bar.parentElement === anchor.element) return; // already best-placed
  if (!bar) bar = buildToolbar(anchor.element);
  anchor.place(bar); // appendChild/prepend moves the node if it already existed
  setProState(license.pro); // re-apply after a rebuild drops the class
  syncSelection();
}

// Delegated activation in the CAPTURE phase on document. We listen on
// `pointerdown` (not `click`) because Gmail's toolbar strip re-renders on press:
// the button node is replaced between mousedown and mouseup, so the browser
// never emits a `click` at all. `pointerdown` fires at press time, before that
// re-render. `click` is kept for keyboard activation (Enter/Space). A short
// debounce prevents the two from double-firing for one interaction.
let lastActivate = 0;

function onToolbarActivate(e: Event): void {
  const target = e.target as Element | null;
  const btn = target?.closest?.(`[${ACTION_ATTR}]`);
  if (!btn || !btn.closest(`#${TOOLBAR_ELEMENT_ID}`)) return;
  e.preventDefault();
  e.stopPropagation();
  const now = Date.now();
  if (now - lastActivate < 500) return;
  lastActivate = now;
  const action = btn.getAttribute(ACTION_ATTR) as ExtractAction | null;
  if (action) void handleAction(action);
}

document.addEventListener('pointerdown', onToolbarActivate, true);
document.addEventListener('click', onToolbarActivate, true);

/** Push the current selection count into the toolbar UI. */
function syncSelection(): void {
  setSelectionCount(selectedCount());
}

// Gmail rebuilds its DOM on navigation and toggles selection classes/attributes
// as the user checks rows; a single observer covers both concerns. Coalesce
// bursts of mutations into one update per frame.
let rafPending = false;
const observer = new MutationObserver(() => {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    ensureToolbar();
    syncSelection();
  });
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['aria-checked', 'class'],
});

ensureToolbar();
void refreshEntitlements();
// Re-sync when the user returns to the tab (e.g. after completing checkout).
window.addEventListener('focus', () => void refreshEntitlements());

// Progress updates from background long-running actions (e.g. PDF generation),
// plus license-change broadcasts (after a purchase/onPaid).
chrome.runtime.onMessage.addListener((msg: { type?: string; label?: string; done?: number; total?: number }) => {
  if (msg?.type === 'progress' && typeof msg.done === 'number' && typeof msg.total === 'number') {
    showToast(`${msg.label ?? 'Working'} ${msg.done}/${msg.total}…`, { spinner: true });
  } else if (msg?.type === 'license-updated') {
    void refreshEntitlements();
  }
});

// Expose a diagnostic (window.__gbeDiag()) to inspect selector matches if Gmail's
// markup changes on a given account. Silent unless called.
(window as unknown as { __gbeDiag?: () => unknown }).__gbeDiag = diagnostics;
