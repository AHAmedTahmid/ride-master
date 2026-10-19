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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.e2e-spec.ts',
        'src/test/**',
        'src/database/migrate.ts',
        'src/database/seed.ts',
        'src/database/reset.ts',
        'src/main.ts',
        'src/database/prisma.service.ts',
        'src/database/database.module.ts',
        'src/redis/redis.module.ts',
        'src/**/*module.ts',
        'src/**/dto/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
})
