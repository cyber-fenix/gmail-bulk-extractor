// MAIN-world content script. Runs in the Gmail page's own JS context (not the
// isolated content-script world), so it can read page globals like
// `window.GLOBALS`, where Gmail keeps the inbox key (`ik`). It writes the ik
// onto a shared DOM attribute (data-gbe-ik on <html>) that the isolated-world
// content script reads via session.ts. The DOM is shared across worlds, so this
// is a clean, CSP-safe bridge (no inline <script> injection).

const ATTR = 'data-gbe-ik';

function extractIk(): string | null {
  const g = (window as unknown as { GLOBALS?: unknown }).GLOBALS;
  if (!Array.isArray(g)) return null;
  const strings = g.filter((x): x is string => typeof x === 'string');
  // Gmail historically keeps ik at GLOBALS[9]; verify shape before trusting it.
  const atNine = g[9];
  if (typeof atNine === 'string' && /^[a-z0-9]{6,}$/i.test(atNine)) return atNine;
  // Otherwise prefer a clean 10-char hex token, then any 8+ alphanumeric run.
  return (
    strings.find((s) => /^[a-f0-9]{10}$/i.test(s)) ??
    strings.find((s) => /^[a-z0-9]{8,}$/i.test(s)) ??
    null
  );
}

/** Try to publish the ik; returns true once it's set. */
function publish(): boolean {
  const ik = extractIk();
  if (ik) {
    document.documentElement.setAttribute(ATTR, ik);
    return true;
  }
  return false;
}

// GLOBALS may not exist yet at injection time; retry briefly until it appears.
if (!publish()) {
  let tries = 0;
  const timer = window.setInterval(() => {
    if (publish() || ++tries >= 40) window.clearInterval(timer); // ~20s max
  }, 500);
}
