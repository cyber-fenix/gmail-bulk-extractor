// Popup: shows whether the active tab is Gmail. Settings (PDF headers, ZIP
// layout, naming) can be added here later.
const status = document.getElementById('status')!;

async function refresh(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isGmail = !!tab?.url && /^https:\/\/mail\.google\.com\//.test(tab.url);
  status.textContent = isGmail
    ? 'Gmail detected. Select emails and use the toolbar buttons.'
    : 'Open a Gmail tab to use the extractor.';
}

refresh();
