import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:8201',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'cd ../backend && PDFPAL_DB=/tmp/pdfpal_e2e.db GOOGLE_CLIENT_ID="" CLAUDE_BIN=/bin/echo python3 -m uvicorn main:app --port 8201',
    port: 8201,
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
