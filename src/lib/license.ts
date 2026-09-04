// Licensing wrapper around ExtensionPay.
//
// The live ExtPay instance is owned by the background service worker (it calls
// startBackground() and listens for onPaid). The content script and popup never
// touch ExtPay directly — they query the background via runtime messages, which
// keeps a single source of truth and one place that talks to extensionpay.com.
//
// Privacy: the only data that crosses the network is ExtensionPay's own
// licensing check. Email content is never involved.
import type { User } from 'extpay';
import type { LicenseInfo, LicensePlan } from '@/types';

/** ExtensionPay extension id — register at extensionpay.com and set it here. */
export const EXTPAY_ID = 'gmail-bulk-extractor';

/** Length of the reverse trial. Enforced here (ExtPay records only the start). */
export const TRIAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Derive our LicenseInfo from an ExtensionPay user object (background-side).
 * Effective Pro = paid OR still inside the 7-day trial window. */
export function userToLicense(user: User): LicenseInfo {
  const paid = user.paid === true;

  const startedAt = user.trialStartedAt ? new Date(user.trialStartedAt).getTime() : 0;
  const trialUsed = startedAt > 0;
  const elapsedDays = trialUsed ? (Date.now() - startedAt) / DAY_MS : Infinity;
  const trialActive = trialUsed && elapsedDays < TRIAL_DAYS;
  const trialDaysLeft = trialActive ? Math.max(0, Math.ceil(TRIAL_DAYS - elapsedDays)) : 0;

  let plan: LicensePlan = 'free';
  if (paid) plan = user.plan?.interval === 'once' ? 'one-time' : 'subscription';

  return {
    pro: paid || trialActive,
    paid,
    plan,
    status: user.subscriptionStatus,
    trialActive,
    trialDaysLeft,
    trialUsed,
    email: user.email,
  };
}

/** Default (offline / not-yet-known) license: free tier. */
export const FREE_LICENSE: LicenseInfo = {
  pro: false,
  paid: false,
  plan: 'free',
  trialActive: false,
  trialDaysLeft: 0,
  trialUsed: false,
};

// --- content-script / popup helpers (message the background) -----------------

/** Ask the background for the cached license. Falls back to free on any error. */
export async function getLicense(): Promise<LicenseInfo> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: 'get-license' })) as
      | LicenseInfo
      | undefined;
    if (res && typeof res.pro === 'boolean') return res;
  } catch {
    /* background asleep or context invalidated */
  }
  return FREE_LICENSE;
}

/** Open the ExtensionPay checkout page (subscription + one-time products). */
export async function openPaymentPage(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'open-payment' });
  } catch {
    /* ignore */
  }
}

/** Open the ExtensionPay login page (restore a purchase on a new machine). */
export async function openLoginPage(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'open-login' });
  } catch {
    /* ignore */
  }
}

/** Open the ExtensionPay trial page to start the 7-day reverse trial. */
export async function openTrialPage(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'open-trial' });
  } catch {
    /* ignore */
  }
}
