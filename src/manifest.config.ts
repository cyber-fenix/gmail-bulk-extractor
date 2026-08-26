import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json';

// MV3 manifest. Data-access approach is DOM/session (no Gmail API / OAuth),
// so permissions are limited to what's needed to read the logged-in Gmail
// session and drive downloads + printToPDF.
export default defineManifest({
  manifest_version: 3,
  name: 'Gmail Bulk Extractor',
  version: pkg.version,
  description:
    'Bulk-print, save as PDF, download attachments, and ZIP-export selected Gmail emails.',
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: 'Gmail Bulk Extractor',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'icons/icon16.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://mail.google.com/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
    {
      // Runs in the page's main world to read window.GLOBALS (the `ik` source)
      // and bridge it to the isolated world via a shared DOM attribute.
      matches: ['https://mail.google.com/*'],
      js: ['src/mainworld/ik.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
  ],
  permissions: ['debugger', 'downloads', 'storage', 'scripting', 'tabs', 'activeTab'],
  host_permissions: ['https://mail.google.com/*'],
});
