// Builds the injected toolbar button group and its styles.
//
// Integration note: Gmail's light/dark theme is chosen in Gmail settings and is
// INDEPENDENT of the OS `prefers-color-scheme`. So we detect Gmail's actual
// surface luminance at inject time and theme the toolbar to match, rather than
// keying off a media query.
import type { ExtractAction } from '@/types';

interface ButtonSpec {
  action: ExtractAction;
  label: string;
  title: string;
  /** Accent color used for the icon + hover tint. */
  accent: string;
  /** Inline SVG path markup (16x16 viewBox, currentColor stroke). */
  icon: string;
  /** Pro-only action: shows a gold star badge until the user upgrades. */
  pro?: boolean;
}

const BUTTONS: ButtonSpec[] = [
  {
    action: 'merge',
    label: 'Merge',
    title: 'Merge selected emails into one PDF, opened in a new tab (Pro)',
    accent: '#1a73e8',
    icon: '<path d="M2 4h5l1.5 2H14v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1zM8 8v3M6.5 9.5h3"/>',
    pro: true,
  },
  {
    action: 'pdf',
    label: 'PDF',
    title: 'Save selected emails as PDFs',
    accent: '#d93025',
    icon: '<path d="M9 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.5zM9 1.5V5.5h4M5.5 9h1M5.5 11h5"/>',
  },
  {
    action: 'attachments',
    label: 'Attachments',
    title: 'Download attachments from selected emails',
    accent: '#188038',
    icon: '<path d="M13 7.5l-5.6 5.6a3 3 0 0 1-4.2-4.2l5.6-5.6a2 2 0 0 1 2.8 2.8l-5.6 5.6a1 1 0 0 1-1.4-1.4l5.2-5.2"/>',
  },
  {
    action: 'zip',
    label: 'ZIP',
    title: 'Export selected emails + attachments as a ZIP (Pro)',
    accent: '#e37400',
    icon: '<path d="M2.5 5.5 8 2l5.5 3.5v5L8 14l-5.5-3.5zM2.5 5.5 8 9m0 0 5.5-3.5M8 9v5M8 4v1M8 6v1"/>',
    pro: true,
  },
];

const STYLE_ID = 'gbe-toolbar-style';
const TOOLBAR_ID = 'gbe-toolbar';

/** Parse a CSS color string into rgba components (or null). */
function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  const m = input.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

/** Relative luminance (0 dark .. 1 light) of the first opaque ancestor bg. */
function surfaceLuminance(start: Element | null): number {
  let node: Element | null = start;
  while (node) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c && c.a > 0) {
      return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    }
    node = node.parentElement;
  }
  return 1; // default to light
}

/** Detect whether Gmail is currently showing a dark surface near `anchor`. */
export function isGmailDark(anchor: Element | null): boolean {
  const ref =
    anchor ??
    document.querySelector('[role="main"]') ??
    document.body ??
    document.documentElement;
  return surfaceLuminance(ref) < 0.5;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${TOOLBAR_ID} {
      --gbe-btn-bg: transparent;
      --gbe-btn-text: #444746;
      --gbe-border: #dde1e6;
      --gbe-brand: #5f6368;
      --gbe-divider: #e3e7ed;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin: 0 4px;
      padding: 0;
      vertical-align: middle;
      /* Gmail's toolbar (.G-atb) stacks a layer above injected children, which
         swallows real pointer events. A positioned high z-index lifts our
         buttons above it so clicks reach them. */
      position: relative;
      z-index: 2147483000;
    }
    #${TOOLBAR_ID}.gbe-dark {
      --gbe-btn-bg: transparent;
      --gbe-btn-text: #c7c7c7;
      --gbe-border: #5f6368;
      --gbe-brand: #9aa0a6;
      --gbe-divider: #3c4043;
    }
    #${TOOLBAR_ID} .gbe-brand {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding-right: 8px;
      margin-right: 2px;
      border-right: 1px solid var(--gbe-divider);
      font: 500 11px/1 'Google Sans', Roboto, Arial, sans-serif;
      letter-spacing: .4px;
      color: var(--gbe-brand);
      text-transform: uppercase;
      user-select: none;
    }
    #${TOOLBAR_ID} .gbe-brand-dot {
      width: 14px; height: 14px; border-radius: 4px;
      background: linear-gradient(135deg, #1a73e8, #188038 55%, #e37400);
    }
    #${TOOLBAR_ID} .gbe-count {
      min-width: 18px; height: 18px; padding: 0 5px;
      display: none; align-items: center; justify-content: center;
      border-radius: 9px; margin-left: 2px;
      font: 600 11px/1 'Google Sans', Roboto, Arial, sans-serif;
      color: #fff; background: #1a73e8;
    }
    #${TOOLBAR_ID}.gbe-has-selection .gbe-count { display: inline-flex; }
    /* Dim as a hint when nothing is selected, but keep buttons clickable so we
       can show "select emails first" feedback. Gmail re-renders this toolbar on
       selection, which makes a pointer-events:none gate race and stick. */
    #${TOOLBAR_ID}:not(.gbe-has-selection) .gbe-btn { opacity: .6; }
    #${TOOLBAR_ID} .gbe-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: 500 13px/1 'Google Sans', Roboto, Arial, sans-serif;
      color: var(--gbe-btn-text);
      background: var(--gbe-btn-bg);
      border: 1px solid var(--gbe-border);
      border-radius: 16px;
      padding: 7px 14px 7px 11px;
      cursor: pointer;
      white-space: nowrap;
      transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    /* Gold "Pro" star badge in the button's corner; hidden once user is Pro. */
    #${TOOLBAR_ID} .gbe-pro-badge {
      position: absolute; top: -6px; right: -5px;
      width: 15px; height: 15px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      background: #f9ab00; color: #fff;
      font-size: 9px; line-height: 1;
      box-shadow: 0 0 0 1.5px var(--gbe-btn-bg, #fff), 0 1px 2px rgba(0,0,0,.3);
      pointer-events: none;
    }
    #${TOOLBAR_ID}.gbe-dark .gbe-pro-badge {
      box-shadow: 0 0 0 1.5px #202124, 0 1px 2px rgba(0,0,0,.5);
    }
    #${TOOLBAR_ID}.gbe-pro .gbe-pro-badge { display: none; }
    #${TOOLBAR_ID} .gbe-btn .gbe-ico {
      width: 16px; height: 16px; flex: 0 0 auto;
      color: var(--gbe-accent);
    }
    #${TOOLBAR_ID} .gbe-btn:hover {
      background: color-mix(in srgb, var(--gbe-accent) 12%, transparent);
      border-color: color-mix(in srgb, var(--gbe-accent) 50%, var(--gbe-border));
    }
    #${TOOLBAR_ID} .gbe-btn:active {
      background: color-mix(in srgb, var(--gbe-accent) 22%, transparent);
    }
    #${TOOLBAR_ID} .gbe-btn:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--gbe-accent) 55%, transparent);
    }
  `;
  document.head.appendChild(style);
}

function iconSvg(pathMarkup: string): string {
  return (
    `<svg class="gbe-ico" viewBox="0 0 16 16" fill="none" ` +
    `stroke="currentColor" stroke-width="1.4" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${pathMarkup}</svg>`
  );
}

/** Data attribute carrying a button's action, read by the delegated handler. */
export const ACTION_ATTR = 'data-gbe-action';

/**
 * Build (or return existing) the toolbar element. `anchor` (where it will be
 * inserted) is used to detect Gmail's theme so the toolbar matches.
 *
 * Note: clicks are NOT bound per-button here. Because the toolbar sits inside
 * Gmail's own toolbar (which intercepts events in the capture phase), the
 * content script handles clicks via a single document-level capture listener
 * (see wireToolbarClicks) so our handler runs before Gmail can swallow them.
 */
export function buildToolbar(anchor: Element | null = null): HTMLElement {
  ensureStyles();
  const existing = document.getElementById(TOOLBAR_ID);
  if (existing) return existing as HTMLElement;

  const bar = document.createElement('div');
  bar.id = TOOLBAR_ID;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Gmail Bulk Extractor');
  if (isGmailDark(anchor)) bar.classList.add('gbe-dark');

  const brand = document.createElement('span');
  brand.className = 'gbe-brand';
  brand.innerHTML =
    '<span class="gbe-brand-dot"></span><span>Bulk</span>' +
    '<span class="gbe-count" aria-hidden="true">0</span>';
  bar.appendChild(brand);

  for (const b of BUTTONS) {
    const btn = document.createElement('button');
    btn.className = 'gbe-btn';
    btn.type = 'button';
    btn.style.setProperty('--gbe-accent', b.accent);
    btn.title = b.title;
    btn.setAttribute('aria-label', b.title);
    btn.setAttribute(ACTION_ATTR, b.action);
    const badge = b.pro
      ? '<span class="gbe-pro-badge" title="Pro feature" aria-hidden="true">★</span>'
      : '';
    btn.innerHTML = `${iconSvg(b.icon)}<span>${b.label}</span>${badge}`;
    bar.appendChild(btn);
  }
  return bar;
}

/**
 * Reflect the current selection count in the toolbar: shows a count badge and
 * enables the buttons when > 0, dims/disables them when 0.
 */
export function setSelectionCount(count: number): void {
  const bar = document.getElementById(TOOLBAR_ID);
  if (!bar) return;
  bar.classList.toggle('gbe-has-selection', count > 0);
  const badge = bar.querySelector('.gbe-count');
  if (badge) badge.textContent = String(count);
  bar.setAttribute('aria-label', `Gmail Bulk Extractor — ${count} selected`);
}

/** Reflect Pro status: hides the gold star badge on Pro-only buttons when Pro. */
export function setProState(isPro: boolean): void {
  const bar = document.getElementById(TOOLBAR_ID);
  if (bar) bar.classList.toggle('gbe-pro', isPro);
}

export const TOOLBAR_ELEMENT_ID = TOOLBAR_ID;

