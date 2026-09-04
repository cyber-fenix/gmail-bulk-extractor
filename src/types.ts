// Shared types across content script, background service worker, and popup.

/** Actions a user can trigger from the injected Gmail toolbar.
 * `merge` is Pro-only: render all selected emails into one PDF opened in a tab. */
export type ExtractAction = 'merge' | 'pdf' | 'attachments' | 'zip';

/** Metadata for a single attachment discovered in a thread. */
export interface AttachmentRef {
  filename: string;
  mimeType: string;
  /** Same-origin Gmail URL to fetch the raw bytes (credentialed). */
  downloadUrl: string;
}

/** A selected Gmail thread plus everything we extracted for it. */
export interface ThreadPayload {
  threadId: string;
  subject: string;
  /** Sender display name (best-effort from the list row). May be ''. */
  sender: string;
  /** Message date as YYYY-MM-DD (best-effort from the list row). May be ''. */
  date: string;
  /** Clean printable HTML from Gmail's `view=pt` print view. */
  html: string;
  /** The `view=pt` print-view URL (used by the PDF engine to render). */
  printUrl: string;
  attachments: AttachmentRef[];
}

/** Which paid plan (if any) unlocked Pro, for display in the popup. */
export type LicensePlan = 'free' | 'subscription' | 'one-time';

/** Licensing snapshot the background derives from ExtensionPay and hands to
 * the content script / popup. Never contains email content. */
export interface LicenseInfo {
  /** Effective Pro: paid OR inside the 7-day reverse trial. Gates all features. */
  pro: boolean;
  /** True only for an actual paid unlock (subscription or one-time). */
  paid: boolean;
  plan: LicensePlan;
  /** ExtensionPay subscriptionStatus, when the plan is a subscription. */
  status?: 'active' | 'past_due' | 'canceled';
  /** True while the reverse trial is still within its window. */
  trialActive: boolean;
  /** Whole days left in the trial (0 when not in a trial). */
  trialDaysLeft: number;
  /** True once a trial has ever been started (so we don't re-offer it). */
  trialUsed: boolean;
  email?: string | null;
}

/** Pro-only preferences, persisted in chrome.storage.local. Ignored unless Pro. */
export interface ProSettings {
  /** Template for per-email PDF filenames (tokens: {date} {sender} {subject} {index}). */
  pdfNameTemplate: string;
  /** Template for the per-email attachment folder name. */
  attachmentFolderTemplate: string;
  /** Template for the per-email ZIP folder name. */
  zipFolderTemplate: string;
}

/** Message sent content-script -> background to run an action. */
export interface RunActionMessage {
  type: 'run-action';
  action: ExtractAction;
  threads: ThreadPayload[];
}

/** Progress/status message sent background -> content-script. */
export interface ProgressMessage {
  type: 'progress';
  action: ExtractAction;
  done: number;
  total: number;
  error?: string;
}

export type RuntimeMessage = RunActionMessage | ProgressMessage;
