// Content script entry: injects the toolbar into Gmail, keeps it present across
// Gmail's SPA view changes, keeps its selection count in sync, and runs the
// four actions (print / PDF / attachments / ZIP) on the selected emails.
import { ACTION_ATTR, buildToolbar, setSelectionCount, TOOLBAR_ELEMENT_ID } from '@/content/toolbar';
import {
  diagnostics,
  findToolbarAnchor,
  selectedCount,
  selectedThreads,
} from '@/content/gmail-dom';
import { collectThreads } from '@/content/extract';
import { blobToDataUrl, buildZip } from '@/content/zip';
import { buildPrintDocument } from '@/content/print';
import { flashToast, hideToast, showToast } from '@/content/toast';
import { dateStamp } from '@/lib/download';
import { inboxKey } from '@/lib/session';
import type { ExtractAction, RunActionMessage } from '@/types';

let busy = false;

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

  const ik = inboxKey();
  if (!ik) {
    flashToast('Could not read the Gmail session key. Try reloading Gmail.', 4000, { error: true });
    return;
  }

  // Print needs a popup opened *synchronously* within the click's activation,
  // before the async collect below — otherwise Chrome's pop-up blocker kills it.
  let printWindow: Window | null = null;
  if (action === 'print') {
    printWindow = window.open('', '_blank');
    if (!printWindow) {
      flashToast('Allow pop-ups for mail.google.com to use Print.', 4500, { error: true });
      return;
    }
    printWindow.document.write(
      '<!doctype html><title>Preparing…</title><body style="font:14px arial;padding:24px">Preparing print…</body>',
    );
  }

  busy = true;
  try {
    showToast(`Reading ${selected.length} email${selected.length > 1 ? 's' : ''}…`, {
      spinner: true,
    });
    const { payloads, errors } = await collectThreads(selected, ik, ({ done, total }) => {
      showToast(`Reading ${done}/${total} email${total > 1 ? 's' : ''}…`, { spinner: true });
    });

    if (payloads.length === 0) {
      printWindow?.close();
      flashToast('Could not read the selected emails.', 4000, { error: true });
      return;
    }

    // Bulk print: fill the pre-opened popup and invoke the native print dialog.
    if (action === 'print' && printWindow) {
      printWindow.document.open();
      printWindow.document.write(buildPrintDocument(payloads));
      printWindow.document.close();
      // Wait for the popup (incl. images) to finish, capped, before printing.
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        printWindow!.addEventListener('load', finish, { once: true });
        setTimeout(finish, 3000);
      });
      printWindow.focus();
      printWindow.print();
      const skippedPrint = errors.length ? ` (${errors.length} skipped)` : '';
      flashToast(`Printing ${payloads.length} email${payloads.length > 1 ? 's' : ''}${skippedPrint}.`);
      return;
    }

    // ZIP is assembled and downloaded locally (needs same-origin attachment
    // fetches + JSZip); no background round-trip.
    if (action === 'zip') {
      showToast('Building ZIP…', { spinner: true });
      const blob = await buildZip(payloads, (d, total) =>
        showToast(`Zipping ${d}/${total}…`, { spinner: true }),
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

    const skipped = errors.length ? ` (${errors.length} skipped)` : '';
    if (res?.message) {
      flashToast(res.message + skipped, 3600, { error: !res.ok });
    } else {
      flashToast(`Prepared ${payloads.length} email${payloads.length > 1 ? 's' : ''}${skipped}.`);
    }
  } finally {
    hideToast();
    busy = false;
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

// Progress updates from background long-running actions (e.g. PDF generation).
chrome.runtime.onMessage.addListener((msg: { type?: string; label?: string; done?: number; total?: number }) => {
  if (msg?.type === 'progress' && typeof msg.done === 'number' && typeof msg.total === 'number') {
    showToast(`${msg.label ?? 'Working'} ${msg.done}/${msg.total}…`, { spinner: true });
  }
});

// Expose a diagnostic (window.__gbeDiag()) to inspect selector matches if Gmail's
// markup changes on a given account. Silent unless called.
(window as unknown as { __gbeDiag?: () => unknown }).__gbeDiag = diagnostics;
