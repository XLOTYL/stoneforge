import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['bun'],
  },
  ssr: {
    resolve: {
      conditions: ['bun'],
    },
  },
  test: {
    include: ['e2e/**/*.e2e.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.stoneforge/.worktrees/**',
    ],
  },
});
