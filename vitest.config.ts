import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/apps/api/dist/**',
      'tests/e2e/**',
      'tests/e2e-preview/**',
      'tests/e2e-real/**',
      'apps/api/tests/integration/**',
    ],
  },
});
