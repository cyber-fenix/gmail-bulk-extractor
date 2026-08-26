// The single policy point: given the license and current usage, decide whether
// an action of N emails may run, and phrase the upsell when it may not.
//
// Called from handleAction in the content script (one gate for all four
// actions). Pro-only *features* (merged PDF, templates) are enforced separately
// where they apply — the background only honors those settings when Pro.
import type { ExtractAction, LicenseInfo } from '@/types';
import { FREE_WEEKLY_EMAILS } from '@/lib/usage';

export interface GateResult {
  allow: boolean;
  /** User-facing message when blocked (upsell copy). */
  reason?: string;
  /** True when blocking is a paywall (offer upgrade), not a hard error. */
  upsell?: boolean;
}

/** Actions only Pro users may run at all (regardless of the weekly cap). */
const PRO_ONLY_ACTIONS: ReadonlySet<ExtractAction> = new Set(['merge']);

/**
 * Decide whether `action` (processing `count` emails) may run.
 *  - Pro-only actions (merge) require Pro, no cap.
 *  - Everything else: Pro → unlimited; free → must fit the weekly remaining.
 */
export function checkAction(
  action: ExtractAction,
  count: number,
  license: LicenseInfo,
  usedThisWeek: number,
): GateResult {
  if (PRO_ONLY_ACTIONS.has(action)) {
    if (license.pro) return { allow: true };
    return {
      allow: false,
      upsell: true,
      reason: 'Merge into one PDF is a Pro feature — tap to upgrade.',
    };
  }

  if (license.pro) return { allow: true };

  const remaining = Math.max(0, FREE_WEEKLY_EMAILS - usedThisWeek);
  if (count <= remaining) return { allow: true };

  const reason =
    remaining === 0
      ? `You've used all ${FREE_WEEKLY_EMAILS} free emails this week. Upgrade to Pro for unlimited — tap to upgrade.`
      : `This needs ${count} emails but you have ${remaining} left this week. Upgrade to Pro for unlimited — tap to upgrade.`;
  return { allow: false, upsell: true, reason };
}
