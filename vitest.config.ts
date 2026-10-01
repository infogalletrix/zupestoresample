import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/*.test.tsx'],
    setupFiles: ['tests/ui-setup.ts'],
    testTimeout: 15000,
    restoreMocks: true,
    server: { deps: { external: [/server[\\/].*\.mjs$/, 'node:sqlite'] } },
  },
});
