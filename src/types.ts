// Shared types across content script, background service worker, and popup.

/** Actions a user can trigger from the injected Gmail toolbar. */
export type ExtractAction = 'print' | 'pdf' | 'attachments' | 'zip';

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
  /** Clean printable HTML from Gmail's `view=pt` print view. */
  html: string;
  /** The `view=pt` print-view URL (used by the PDF engine to render). */
  printUrl: string;
  attachments: AttachmentRef[];
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
