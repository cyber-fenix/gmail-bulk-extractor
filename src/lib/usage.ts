// Free-tier weekly email counter, metered client-side in chrome.storage.local.
//
// This is a *soft* cap by design: ExtensionPay validates Pro status server-side
// (un-bypassable), but it can't count usage, so the free allowance is tracked
// locally. A determined user could reset this counter — that only affects the
// free tier, never the Pro unlock. The window is a rolling 7 days from the first
// counted email; it resets lazily on the next read after it lapses.

/** Emails a free user may process per rolling week. Tune 50–100. */
export const FREE_WEEKLY_EMAILS = 100;

const STORAGE_KEY = 'gbe_usage';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface UsageRecord {
  /** Epoch ms when the current window started (first counted email). */
  weekStart: number;
  /** Emails counted in the current window. */
  count: number;
}

export interface UsageSnapshot {
  count: number;
  remaining: number;
  /** Epoch ms when the current window resets. */
  resetsAt: number;
}

/** Read the current record, resetting (and persisting) a lapsed window.
 * Degrades to a fresh in-memory record if storage is unavailable (e.g. an
 * orphaned content script after an extension reload → "context invalidated"). */
async function readFresh(): Promise<UsageRecord> {
  const now = Date.now();
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const rec = got[STORAGE_KEY] as UsageRecord | undefined;
    if (!rec || typeof rec.weekStart !== 'number' || now - rec.weekStart >= WEEK_MS) {
      const reset: UsageRecord = { weekStart: now, count: 0 };
      await chrome.storage.local.set({ [STORAGE_KEY]: reset });
      return reset;
    }
    return rec;
  } catch {
    return { weekStart: now, count: 0 };
  }
}

/** Current usage snapshot for gating and UI. */
export async function getUsage(): Promise<UsageSnapshot> {
  const rec = await readFresh();
  return {
    count: rec.count,
    remaining: Math.max(0, FREE_WEEKLY_EMAILS - rec.count),
    resetsAt: rec.weekStart + WEEK_MS,
  };
}

/** Add `n` processed emails to the current window (call only on success). */
export async function addUsage(n: number): Promise<void> {
  if (n <= 0) return;
  try {
    const rec = await readFresh();
    rec.count += n;
    await chrome.storage.local.set({ [STORAGE_KEY]: rec });
  } catch {
    /* storage unavailable (orphaned content script) — drop silently */
  }
}
