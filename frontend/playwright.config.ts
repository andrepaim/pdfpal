import { defineConfig, devices } from '@playwright/test';

// PDFPAL_E2E_PORT lets two checkouts run their browser tests at the same time.
const port = Number(process.env.PDFPAL_E2E_PORT) || 8201;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
      : {}),
  },
  webServer: {
    command: `cd .. && PDFPAL_DATA_DIR=/tmp/pdfpal_e2e_data_${process.pid} node dist/cli/index.js serve --no-open --port ${port}`,
    // Provider discovery must never inspect the developer's installed accounts.
    // Tests that need assistants mock /api/agents and generation responses.
    env: {
      CLAUDE_BIN: `/tmp/pdfpal_e2e_data_${process.pid}/uninstalled-claude`,
      CODEX_BIN: `/tmp/pdfpal_e2e_data_${process.pid}/uninstalled-codex`,
      OPENCODE_BIN: `/tmp/pdfpal_e2e_data_${process.pid}/uninstalled-opencode`,
    },
    port,
    reuseExistingServer: false,
    timeout: 15_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
