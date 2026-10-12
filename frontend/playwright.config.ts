import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Browser tests against the real backend serving the built frontend (npm run build,
// then npm run e2e:portal builds the Go binary). Every run starts on a new database.
const port = 18095;
const upstreamPort = 18096;
const dataPath = join(tmpdir(), `portal-e2e-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    locale: 'en-US',
    // axe measures colour contrast; an overlay mid-fade would read as too faint.
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/upstream.mjs',
      url: `http://127.0.0.1:${upstreamPort}/healthz`,
      env: { UPSTREAM_PORT: String(upstreamPort) },
      reuseExistingServer: false,
    },
    {
      command: process.env.PORTAL_BIN ?? '../backend/.e2e/portal',
      url: `http://127.0.0.1:${port}/readyz`,
      reuseExistingServer: false,
      env: {
        PORT: String(port),
        DATA_PATH: dataPath,
        STATIC_DIR: 'dist',
        PROXY_ALLOW_LOOPBACK: 'true',
        COOKIE_SECURE: 'false',
        BOOTSTRAP_ADMIN_PASSWORD: 'E2e-Bootstrap-Pw-9001',
        DATA_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
        SPEC_REFRESH_INTERVAL: '0',
        LOG_FORMAT: 'text',
        LOG_LEVEL: 'warn',
      },
    },
  ],
});
