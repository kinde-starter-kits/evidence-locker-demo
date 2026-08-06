import {defineConfig} from 'vitest/config';

// Runs the single end-to-end narrative script under vitest (convex-test needs
// Vite's import.meta.glob). Console output is not intercepted, so the beats print
// straight to stdout in order.
export default defineConfig({
  test: {
    include: ['scripts/e2e-narrative.ts'],
    disableConsoleIntercept: true,
    testTimeout: 30000
  }
});
