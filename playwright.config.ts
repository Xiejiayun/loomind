import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4197";

export default defineConfig({
  testDir: "./apps/web/e2e",
  outputDir: "./.tmp/mobile-tests",
  use: { baseURL, locale: "en-US", isMobile: true, hasTouch: true },
  projects: [
    { name: "chromium-320", use: { browserName: "chromium", viewport: { width: 320, height: 640 } } },
    { name: "webkit-390", use: { browserName: "webkit", viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4197 --strictPort",
    cwd: "./apps/web",
    url: baseURL,
  },
});
