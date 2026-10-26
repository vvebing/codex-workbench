import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    setupFiles: ["tests/unit/setup-language.ts"],
    include: ["tests/unit/**/*.test.ts"],
  },
});
