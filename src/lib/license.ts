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

/** Derive our LicenseInfo from an ExtensionPay user object (background-side). */
export function userToLicense(user: User): LicenseInfo {
  const pro = user.paid === true;
  let plan: LicensePlan = 'free';
  if (pro) plan = user.plan?.interval === 'once' ? 'one-time' : 'subscription';
  return { pro, plan, status: user.subscriptionStatus, email: user.email };
}

/** Default (offline / not-yet-known) license: free tier. */
export const FREE_LICENSE: LicenseInfo = { pro: false, plan: 'free' };

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
