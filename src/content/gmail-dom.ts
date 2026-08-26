// ALL Gmail DOM selectors + URL patterns live here. This is the single most
// fragile part of the extension: Gmail's markup is undocumented and changes.
// Keep every selector isolated in this module so breakage has one place to fix.
// Every accessor is defensive and returns a safe empty value.
//
// Grounded in gmail.js (github.com/KartikTalwar/gmail.js) + InboxSDK community:
//   - list rows are `tr.zA`
//   - a row is selected when its checkbox has aria-checked="true"
//     (Gmail also toggles the `x7` class on selected rows)
//   - `data-legacy-thread-id` is the Gmail-API-compatible thread id

export interface SelectedThread {
  threadId: string;
  subject: string;
}

const ROW_SELECTOR = 'tr.zA';
const CHECKED_CHECKBOX = 'div[role="checkbox"][aria-checked="true"]';

/** Attributes that may carry a usable thread id, in preference order. */
const THREAD_ID_ATTRS = ['data-legacy-thread-id', 'data-thread-id'] as const;

/** Subject text candidates within a row. */
const SUBJECT_SELECTORS = ['.bog', '.y6 span', '.bqe'];

/**
 * Anchor candidates for the toolbar, best-first. Each says where to insert:
 *  - `[gh="mtb"] .G-tF` is the button STRIP (checkbox / refresh / more) inside
 *    Gmail's main list toolbar — we append after those buttons, the natural
 *    home for bulk actions.
 *  - broader `[gh="mtb"]` and search-filter containers are fallbacks.
 */
const ANCHOR_CANDIDATES: { sel: string; mode: 'append' | 'prepend' }[] = [
  { sel: '[gh="mtb"] .G-tF', mode: 'append' },
  { sel: '[gh="mtb"]', mode: 'prepend' },
  { sel: '[gh="tm"] .G-tF', mode: 'append' },
  { sel: '.aeH', mode: 'prepend' },
  { sel: '.ar5', mode: 'prepend' },
];

export interface ToolbarAnchor {
  element: Element;
  /** Insert `bar` into this anchor at the intended position. */
  place: (bar: HTMLElement) => void;
}

/** True if the row is currently selected (checkbox checked, or x7 class). */
function isRowSelected(row: Element): boolean {
  const box = row.querySelector('div[role="checkbox"]');
  if (box) return box.getAttribute('aria-checked') === 'true';
  return row.classList.contains('x7');
}

/** Extract a usable thread id from a row (searches row + descendants). */
export function threadIdOfRow(row: Element): string | null {
  for (const attr of THREAD_ID_ATTRS) {
    const own = row.getAttribute(attr);
    if (own) return normalizeThreadId(own);
    const desc = row.querySelector(`[${attr}]`);
    const v = desc?.getAttribute(attr);
    if (v) return normalizeThreadId(v);
  }
  return null;
}

/** Strip Gmail's `#thread-f:` / `#msg-f:` prefixes to the bare id. */
function normalizeThreadId(raw: string): string {
  return raw.replace(/^#(thread|msg)-[af]:/, '').trim();
}

/** Best-effort subject text for a row (used for filenames). */
export function subjectOfRow(row: Element): string {
  for (const sel of SUBJECT_SELECTORS) {
    const el = row.querySelector(sel);
    const t = el?.textContent?.trim();
    if (t) return t;
  }
  return '';
}

/** Collect selected threads (deduped by thread id) from the list view. */
export function selectedThreads(): SelectedThread[] {
  const rows = document.querySelectorAll(ROW_SELECTOR);
  const seen = new Set<string>();
  const out: SelectedThread[] = [];
  rows.forEach((row) => {
    if (!isRowSelected(row)) return;
    const threadId = threadIdOfRow(row);
    if (!threadId || seen.has(threadId)) return;
    seen.add(threadId);
    out.push({ threadId, subject: subjectOfRow(row) });
  });
  return out;
}

/** Count of currently selected rows (cheap; for enabling/disabling UI). */
export function selectedCount(): number {
  return document.querySelectorAll(`${ROW_SELECTOR} ${CHECKED_CHECKBOX}`).length;
}

/** Find the best available anchor + how to place the toolbar within it. */
export function findToolbarAnchor(): ToolbarAnchor | null {
  for (const c of ANCHOR_CANDIDATES) {
    const el = document.querySelector(c.sel);
    if (el) {
      const mode = c.mode;
      return {
        element: el,
        place: (bar) => (mode === 'append' ? el.appendChild(bar) : el.prepend(bar)),
      };
    }
  }
  return null;
}

/**
 * Diagnostic dump for locking selectors to a specific Gmail build. Call from the
 * page console as `window.__gbeDiag()`. Returns and logs what we can detect.
 */
export function diagnostics(): Record<string, unknown> {
  const rows = document.querySelectorAll(ROW_SELECTOR);
  const anchorSel = ANCHOR_CANDIDATES.find((c) => document.querySelector(c.sel))?.sel ?? null;
  const info = {
    rowsFound: rows.length,
    selectedByCheckbox: document.querySelectorAll(CHECKED_CHECKBOX).length,
    selectedThreads: selectedThreads(),
    anchorSelector: anchorSel,
  };
  console.info('[gmail-bulk-extractor] diagnostics', info);
  return info;
}

export const SELECTORS = { ROW_SELECTOR, CHECKED_CHECKBOX };
