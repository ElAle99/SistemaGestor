const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30000,
  use: { channel: 'msedge', headless: true, screenshot: 'only-on-failure', viewport: { width: 1280, height: 960 } }
});
