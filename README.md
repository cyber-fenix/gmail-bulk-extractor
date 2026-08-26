# Gmail Bulk Extractor

An open-source Chrome extension (Manifest V3) — free to use, with an optional
Pro upgrade — that adds a toolbar to Gmail so you can act on **multiple selected
emails at once**:

- **PDF** — save each selected email as a PDF
- **Attachments** — download all attachments from the selected emails
- **ZIP** — export the selected emails + attachments as a single archive
- **Merge** *(Pro)* — render all selected emails into **one PDF** and open it in
  a new tab (print or save it from there)

Works with Gmail and Google Workspace accounts.

## Free vs Pro

The extension is free to use, with an optional **Pro** upgrade (a subscription
**or** a one-time unlock) handled through [ExtensionPay](https://extensionpay.com)
(Stripe under the hood).

| | Free | Pro |
|---|---|---|
| PDF / Attachments / ZIP | ✅ | ✅ |
| Emails per week | up to **100** | **unlimited** |
| **Merge** — all emails into one PDF, opened in a tab | — | ✅ |
| Filename / folder naming | defaults | **custom templates** (`{date} {sender} {subject} {index}`) |

The weekly limit is counted across the free actions (PDF / Attachments / ZIP) by
number of emails processed and resets on a rolling 7-day window. **Merge** does
not auto-open the print dialog — it opens the combined PDF in Chrome's viewer so
you decide whether to print or save.

Open the extension's popup to see your plan and weekly usage, upgrade, manage a
subscription, restore a purchase, and configure Pro naming templates.

## How it works (no Gmail API / no OAuth)

The extension reads mail through your **existing Gmail session** rather than the
Gmail REST API:

- Email content comes from Gmail's built-in print view (`view=pt`), fetched
  same-origin with your session cookies.
- Attachment bytes come from Gmail's own attachment URLs.
- PDFs are rendered locally via the Chrome DevTools Protocol
  (`Page.printToPDF`), which is why the `debugger` permission is requested.

**Your email content never leaves your device** — all extraction, PDF
rendering, and archiving happen locally. The only network calls the extension
makes are to **extensionpay.com / Stripe**, and only to check or complete a Pro
license. No email data is ever part of those requests. Because it uses no
restricted Gmail OAuth scopes, there is **no Google Cloud project or OAuth
consent setup** required.

> While a PDF is generated, Chrome shows a *"Gmail Bulk Extractor started
> debugging this browser"* banner on a background tab. That is the `debugger`
> permission performing `Page.printToPDF`; it clears when the operation
> finishes.

## Where files are saved

- **Attachments** → `Downloads/gmail-extract-<date>/<email subject>/…`
- **PDFs** → `Downloads/gmail-pdf-<date>/<email subject>.pdf`
- **ZIP** → `Downloads/gmail-export-<date>.zip` (one folder per email containing
  `email.html` + its attachments, plus a top-level `index.html` index)

On **Pro**, the `<email subject>` folder/filename segments follow your naming
templates. **Merge** doesn't save a file — it opens the combined PDF in a new
tab, from where you can print or save it yourself.

## Install (development)

```bash
npm install
npm run build      # or: npm run dev  (rebuilds on change)
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `dist/` folder

Then open Gmail, select some emails, and use the toolbar buttons.

> After loading a new build, reload the Gmail tab as well so the updated content
> script takes effect.

## Permissions

| Permission | Why |
|------------|-----|
| `debugger` | `Page.printToPDF` for the PDF and Merge actions |
| `downloads` | saving attachments, PDFs, and the ZIP |
| `scripting`, `tabs`, `activeTab` | injecting the toolbar and rendering the print view |
| `storage` | plan/usage counter and Pro settings |
| host: `mail.google.com` | reading the logged-in Gmail session |
| host: `extensionpay.com` | Pro license check + checkout (no email data) |

## Project layout

```
src/
  manifest.config.ts     MV3 manifest (typed)
  background/index.ts     service worker: attachment/PDF downloads, Merge render, licensing
  content/
    index.ts              toolbar injection, selection, action dispatch
    toolbar.ts            toolbar UI (theme-aware, Gmail-native styling)
    gmail-dom.ts          all Gmail selectors + toolbar anchors (isolated)
    extract.ts            fetch print-view HTML + parse attachment refs
    zip.ts                JSZip assembly + attachment fetch
    toast.ts              in-page progress/error + upsell toasts
    extpay.ts             ExtensionPay handshake (runs only on extensionpay.com)
  mainworld/ik.ts         reads window.GLOBALS (ik) and bridges it via <html> attr
  lib/
    session.ts            account index / ik / session URL builders
    pdf.ts                chrome.debugger printToPDF engine
    download.ts           filename sanitizing + date stamp
    license.ts            ExtensionPay wrapper + license message helpers
    usage.ts              free-tier weekly email counter (chrome.storage)
    entitlements.ts       the single gate: may this action run?
    settings.ts           Pro settings persistence
    naming.ts             filename/folder template engine (Pro)
  popup/                  plan/usage dashboard + Pro settings
```

The freemium gate lives at **one point** — `handleAction` in `content/index.ts`,
after the selection is read. Pro status is validated server-side by
ExtensionPay; the weekly free cap is metered locally (a soft cap by design).

Gmail's internal markup is undocumented and can change; when it does, the fix is
almost always confined to `content/gmail-dom.ts` and `lib/session.ts`. Run
`window.__gbeDiag()` in the Gmail page console to inspect selector matches.

## License

MIT — see [LICENSE](./LICENSE).
