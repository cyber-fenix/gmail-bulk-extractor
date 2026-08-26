# Gmail Bulk Extractor

A free, open-source Chrome extension (Manifest V3) that adds a toolbar to Gmail
so you can act on **multiple selected emails at once**:

- **Print** — combine selected emails into one document and open the print dialog
- **PDF** — save each selected email as a PDF
- **Attachments** — download all attachments from the selected emails
- **ZIP** — export the selected emails + attachments as a single archive

Works with Gmail and Google Workspace accounts.

## How it works (no Gmail API / no OAuth)

The extension reads mail through your **existing Gmail session** rather than the
Gmail REST API:

- Email content comes from Gmail's built-in print view (`view=pt`), fetched
  same-origin with your session cookies.
- Attachment bytes come from Gmail's own attachment URLs.
- PDFs are rendered locally via the Chrome DevTools Protocol
  (`Page.printToPDF`), which is why the `debugger` permission is requested.

Nothing is sent to any external server — all processing is local. Because it
uses no restricted Gmail OAuth scopes, there is **no Google Cloud project or
OAuth consent setup** required.

> While a PDF is generated, Chrome shows a *"Gmail Bulk Extractor started
> debugging this browser"* banner on a background tab. That is the `debugger`
> permission performing `Page.printToPDF`; it clears when the operation
> finishes.

## Where files are saved

- **Attachments** → `Downloads/gmail-extract-<date>/<email subject>/…`
- **PDFs** → `Downloads/gmail-pdf-<date>/<email subject>.pdf`
- **ZIP** → `Downloads/gmail-export-<date>.zip` (one folder per email containing
  `email.html` + its attachments, plus a top-level `index.html` index)

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
| `debugger` | `Page.printToPDF` for the PDF action |
| `downloads` | saving attachments, PDFs, and the ZIP |
| `scripting`, `tabs`, `activeTab` | injecting the toolbar and rendering the print view |
| `storage` | remembering options |
| host: `mail.google.com` | reading the logged-in Gmail session |

## Project layout

```
src/
  manifest.config.ts     MV3 manifest (typed)
  background/index.ts     service worker: attachment/PDF/ZIP downloads
  content/
    index.ts              toolbar injection, selection, action dispatch
    toolbar.ts            toolbar UI (theme-aware, Gmail-native styling)
    gmail-dom.ts          all Gmail selectors + toolbar anchors (isolated)
    extract.ts            fetch print-view HTML + parse attachment refs
    zip.ts                JSZip assembly + attachment fetch
    print.ts              combined print document
    toast.ts              in-page progress/error toasts
  mainworld/ik.ts         reads window.GLOBALS (ik) and bridges it via <html> attr
  lib/
    session.ts            account index / ik / session URL builders
    pdf.ts                chrome.debugger printToPDF engine
    download.ts           filename sanitizing + date stamp
  popup/                  toolbar status + settings
```

Gmail's internal markup is undocumented and can change; when it does, the fix is
almost always confined to `content/gmail-dom.ts` and `lib/session.ts`. Run
`window.__gbeDiag()` in the Gmail page console to inspect selector matches.

## License

MIT — see [LICENSE](./LICENSE).
