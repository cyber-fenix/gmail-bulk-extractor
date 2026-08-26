// Filename/folder template engine (Pro). Expands tokens like
// {date} {sender} {subject} {index} {threadId} into a filesystem-safe string.
// Free tier ignores templates and uses the existing defaults.
import { sanitizeFilename, dateStamp } from '@/lib/download';
import type { ThreadPayload } from '@/types';

export interface NamingContext {
  thread: ThreadPayload;
  /** Zero-based position of this email in the selection. */
  index: number;
}

/** Supported template tokens, for popup help text. */
export const NAMING_TOKENS = ['{date}', '{sender}', '{subject}', '{index}', '{threadId}'] as const;

/**
 * Expand `template` for one thread and sanitize the result. Unknown tokens are
 * left literal (helps the user notice a typo); missing values degrade
 * gracefully (blank sender/date fall back to sensible defaults).
 */
export function applyTemplate(template: string, ctx: NamingContext): string {
  const { thread, index } = ctx;
  const values: Record<string, string> = {
    date: thread.date || dateStamp(),
    sender: thread.sender || 'unknown',
    subject: thread.subject || 'untitled',
    index: String(index + 1).padStart(2, '0'),
    threadId: thread.threadId,
  };
  const expanded = template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? values[key] : whole,
  );
  return sanitizeFilename(expanded, thread.threadId);
}
