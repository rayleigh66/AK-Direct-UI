import { defineConfig, devices } from '@playwright/test';

/**
 * Real-auth catalogue/inventory E2E. It expects a running Docker stack whose
 * web image was built with VITE_REAL_AUTH=true and the credentials exported by
 * scripts/real-auth-e2e.sh.
 */
export default defineConfig({
  testDir: './tests/e2e-real',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: process.env.REAL_E2E_BASE_URL ?? 'http://127.0.0.1:18080',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'real-desktop-1440',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'real-mobile-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
