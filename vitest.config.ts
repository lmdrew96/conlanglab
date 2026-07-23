import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Deliberately scoped to tests/ only — keeps vitest from ever needing
    // to touch convex/ (whose bundler is not meant to see test-framework
    // imports) or node_modules while scanning for test files.
    include: ["tests/**/*.test.ts"],
  },
});
