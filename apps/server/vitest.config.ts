import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    // Run test files sequentially to avoid buildApp() timeout failures.
    // Multiple integration tests bootstrap full Fastify instances in beforeAll,
    // which is slow under CPU contention when Turbo also runs web/shared tests
    // in parallel. Sequential execution within this package prevents 5+ Fastify
    // instances from booting simultaneously. Tests within each file still run
    // concurrently (this only affects cross-file parallelism).
    fileParallelism: false,
    // Integration tests call buildApp() in beforeAll, which boots Fastify with
    // 10+ plugins (helmet, JWT, CSRF, Swagger, Scalar, rate-limit, etc.).
    // Under CPU contention (Turbo runs web/shared tests in parallel, CI load),
    // this cold bootstrap can exceed vitest's default 10s hookTimeout.
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.d.ts"],
    },
  },
});
