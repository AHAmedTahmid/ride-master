import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  // NestJS DI depends on emitDecoratorMetadata, which esbuild cannot emit.
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.e2e-spec.ts'],
    setupFiles: ['src/test/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Specs share one MySQL test database; run files one at a time.
    fileParallelism: false,
  },
})
