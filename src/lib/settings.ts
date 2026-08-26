// Pro settings persistence (chrome.storage.local). These only take effect when
// the user is Pro; the background checks the license before honoring them.
import type { ProSettings } from '@/types';

const STORAGE_KEY = 'gbe_settings';

export const DEFAULT_PRO_SETTINGS: ProSettings = {
  pdfNameTemplate: '{subject}',
  attachmentFolderTemplate: '{subject}',
  zipFolderTemplate: '{subject}',
};

/** Read Pro settings merged over defaults (missing keys fall back). */
export async function getProSettings(): Promise<ProSettings> {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  const saved = (got[STORAGE_KEY] ?? {}) as Partial<ProSettings>;
  return { ...DEFAULT_PRO_SETTINGS, ...saved };
}

/** Persist a partial update to Pro settings. */
export async function setProSettings(patch: Partial<ProSettings>): Promise<ProSettings> {
  const next = { ...(await getProSettings()), ...patch };
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}
