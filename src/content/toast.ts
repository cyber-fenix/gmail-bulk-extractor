// In-page toast for progress and error feedback during an action.

const TOAST_ID = 'gbe-toast';
const STYLE_ID = 'gbe-toast-style';

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${TOAST_ID} {
      position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
      z-index: 2147483647; max-width: 460px;
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px; border-radius: 10px;
      font: 500 13px/1.4 'Google Sans', Roboto, Arial, sans-serif;
      color: #fff; background: #202124;
      box-shadow: 0 4px 16px rgba(0,0,0,.35);
      opacity: 0; transition: opacity .18s ease;
    }
    #${TOAST_ID}.gbe-show { opacity: 1; }
    #${TOAST_ID}.gbe-error { background: #c5221f; }
    #${TOAST_ID} .gbe-spin {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
      animation: gbe-rot .7s linear infinite;
    }
    @keyframes gbe-rot { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}

function el(): HTMLElement {
  ensureStyles();
  let t = document.getElementById(TOAST_ID);
  if (!t) {
    t = document.createElement('div');
    t.id = TOAST_ID;
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  return t;
}

let hideTimer: number | undefined;

/** Show a persistent toast (e.g. progress). `spinner` adds a spinner. */
export function showToast(message: string, opts: { spinner?: boolean; error?: boolean } = {}): void {
  const t = el();
  window.clearTimeout(hideTimer);
  t.classList.toggle('gbe-error', !!opts.error);
  t.innerHTML = opts.spinner ? '<span class="gbe-spin"></span>' : '';
  t.appendChild(document.createTextNode(message));
  requestAnimationFrame(() => t.classList.add('gbe-show'));
}

/** Show a toast and auto-dismiss after `ms`. */
export function flashToast(message: string, ms = 3200, opts: { error?: boolean } = {}): void {
  showToast(message, opts);
  hideTimer = window.setTimeout(hideToast, ms);
}

export function hideToast(): void {
  const t = document.getElementById(TOAST_ID);
  if (!t) return;
  t.classList.remove('gbe-show');
}
