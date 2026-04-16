// vitest.config.js — shared config for unit, migration, snapshot suites.
// Coverage thresholds are enforced when running `npm run coverage`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["engine.js"],
      reporter: ["text", "html", "json-summary"],
      // Thresholds are set slightly under observed coverage so the gate
      // doesn't flake on refactor-induced ~1% swings. Current numbers sit
      // at ~98/79/97/98 (stmts/branches/funcs/lines).
      thresholds: {
        lines:      95,
        functions:  95,
        branches:   75,
        statements: 95,
      },
    },
  },
});
