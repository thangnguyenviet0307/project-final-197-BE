// Read-only UI probes for this review; reuse the existing FE toolchain.
import original from '../../../project-final-197-FE/vitest.config.ts';
import { fileURLToPath } from 'node:url';
export default {
  ...original,
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../../../project-final-197-FE/node_modules/.vite/review-probes-02/', import.meta.url)),
  resolve: {
    ...original.resolve,
    alias: {
      ...original.resolve.alias,
      ...Object.fromEntries(['react', 'react-dom', 'react-router-dom', '@testing-library/react', 'vitest'].map(name => [name, fileURLToPath(new URL('../../../project-final-197-FE/node_modules/' + name, import.meta.url))])),
    },
  },
  server: { fs: { allow: [fileURLToPath(new URL('../../../', import.meta.url))] } },
  test: {
    ...original.test,
    fsModuleCache: false,
    include: ['project-final-197-BE/docs/reviews/review-probes-2026-10-31-02.test.tsx'],
    setupFiles: [fileURLToPath(new URL('../../../project-final-197-FE/tests/setup.ts', import.meta.url))],
  },
};
