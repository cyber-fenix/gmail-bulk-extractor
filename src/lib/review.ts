// Web Store review prompt, asked only after the extension has actually done
// something useful.
//
// Rules kept deliberately conservative: we count *successful* action runs and
// ask at two fixed points, never on a timer and never after the user acts on
// it. A prompt that fires before the tool has proven itself costs a rating
// instead of earning one.

export const REVIEW_URL =
  'https://chromewebstore.google.com/detail/gmail-bulk-extractor/kiplmkbhobmlolkeodgophegcdphiolp/reviews';

/** Successful runs at which we ask. Second value is the last chance. */
const ASK_AT_RUNS = [3, 25];

const STORAGE_KEY = 'gbe_review';

interface ReviewRecord {
  /** Successful action runs since install. */
  runs: number;
  /** Set once the user clicks through — we never ask again. */
  done?: boolean;
}

async function read(): Promise<ReviewRecord> {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const rec = got[STORAGE_KEY] as ReviewRecord | undefined;
    if (rec && typeof rec.runs === 'number') return rec;
  } catch {
    /* storage unavailable (orphaned content script) */
  }
  return { runs: 0 };
}

/**
 * Count one successful run and report whether this is a moment to ask.
 * Safe to call on every success; it self-limits.
 */
export async function recordRun(): Promise<boolean> {
  try {
    const rec = await read();
    if (rec.done) return false;
    rec.runs += 1;
    await chrome.storage.local.set({ [STORAGE_KEY]: rec });
    return ASK_AT_RUNS.includes(rec.runs);
  } catch {
    return false;
  }
}

/** Record that the user acted on the prompt, so it never appears again. */
export async function markReviewed(): Promise<void> {
  try {
    const rec = await read();
    await chrome.storage.local.set({ [STORAGE_KEY]: { ...rec, done: true } });
  } catch {
    /* ignore */
  }
}
