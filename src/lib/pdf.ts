// PDF engine behind a swappable interface. Primary impl uses a background tab +
// chrome.debugger -> Page.printToPDF for high-fidelity, automated output. A
// no-debugger fallback (jsPDF/html2canvas) could be dropped in later without
// touching callers.
//
// Only usable from the service worker (needs chrome.debugger / chrome.tabs).

export interface PdfEngine {
  /** Render a Gmail print-view URL to base64-encoded PDF data. */
  renderUrlToPdf(printUrl: string): Promise<string>;
}

const DEBUGGER_PROTOCOL = '1.3';
const LOAD_TIMEOUT_MS = 20000;
const SETTLE_MS = 500; // let images/layout settle after load

// --- promisified chrome.debugger (callback form avoids lastError foot-guns) ---

function attach(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, DEBUGGER_PROTOCOL, () => {
      const err = chrome.runtime.lastError;
      err ? reject(new Error(err.message)) : resolve();
    });
  });
}

function detach(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      void chrome.runtime.lastError; // ignore; best-effort cleanup
      resolve();
    });
  });
}

function sendCommand<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      const err = chrome.runtime.lastError;
      err ? reject(new Error(err.message)) : resolve(result as T);
    });
  });
}

/** Resolve when a specific CDP event fires for this tab (or after timeout). */
function onceEvent(tabId: number, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (
      source: chrome.debugger.Debuggee,
      method: string,
    ): void => {
      if (source.tabId === tabId && method === event) {
        chrome.debugger.onEvent.removeListener(listener);
        resolve();
      }
    };
    chrome.debugger.onEvent.addListener(listener);
    setTimeout(() => {
      chrome.debugger.onEvent.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Debugger-driven engine. Renders one print-view URL to a PDF (base64). */
export const debuggerPdfEngine: PdfEngine = {
  async renderUrlToPdf(printUrl: string): Promise<string> {
    // Start from a blank tab so we can neutralize Gmail's auto window.print()
    // (the print view calls it on load) BEFORE navigating to the real URL.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    const tabId = tab.id;
    if (tabId === undefined) throw new Error('could not open render tab');

    try {
      await attach(tabId);
      await sendCommand(tabId, 'Page.enable');
      await sendCommand(tabId, 'Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.print = function(){};',
      });

      const loaded = onceEvent(tabId, 'Page.loadEventFired', LOAD_TIMEOUT_MS);
      await sendCommand(tabId, 'Page.navigate', { url: printUrl });
      await loaded;
      await delay(SETTLE_MS);

      const { data } = await sendCommand<{ data: string }>(tabId, 'Page.printToPDF', {
        printBackground: true,
        preferCSSPageSize: true,
      });
      return data;
    } finally {
      await detach(tabId);
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab already gone */
      }
    }
  },
};
