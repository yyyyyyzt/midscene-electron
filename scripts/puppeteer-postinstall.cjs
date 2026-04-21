/**
 * Download Chromium for Puppeteer unless PUPPETEER_SKIP_DOWNLOAD=1.
 * This app prefers system Google Chrome (puppeteer.launch({ channel: 'chrome' })),
 * but keeping Puppeteer's browser cache can help on machines without Chrome.
 */
if (process.env.PUPPETEER_SKIP_DOWNLOAD === '1') {
  process.exit(0);
}

const { downloadBrowsers } = require('puppeteer/lib/cjs/puppeteer/node/install.js');

downloadBrowsers().catch((err) => {
  console.error(err);
  process.exit(1);
});
