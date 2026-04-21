// Playwright config — smoke + journey E2E suite for VCF Design Studio.
// The shipped vcf-design-studio-v6.html is served over a local file:// URL;
// no dev server is needed. CI installs chromium via `npm run test:e2e:install`.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
