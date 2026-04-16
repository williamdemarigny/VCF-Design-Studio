// Smoke E2E — loads the shipped HTML and verifies the main UI shell renders,
// fixtures can be imported, and the topology view switches cleanly.
import { test, expect, Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";

const FIXTURE_DIR = path.resolve(__dirname, "../../test-fixtures/v5");
const HTML_PATH = path.resolve(__dirname, "../../vcf-design-studio-v5.html");
const HTML_URL = "file:///" + HTML_PATH.replace(/\\/g, "/");

// Small helper — import a fixture by triggering the hidden file input.
async function importFixture(page: Page, fileName: string) {
  const filePath = path.join(FIXTURE_DIR, fileName);
  const fileChooser = page.locator('input[type="file"]').first();
  await fileChooser.setInputFiles(filePath);
  await page.waitForTimeout(250);
}

test.describe("VCF Design Studio — smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HTML_URL);
    await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  });

  test("loads and shows the three main tabs", async ({ page }) => {
    await expect(page.getByRole("button", { name: /^Editor$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Topology Diagram$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Per-Site View$/ })).toBeVisible();
  });

  test("fleet-header controls render (pathway, federation, SSO)", async ({ page }) => {
    await expect(page.getByText("Deployment Pathway").first()).toBeVisible();
    await expect(page.getByText("NSX Federation").first()).toBeVisible();
    await expect(page.getByText("SSO Model").first()).toBeVisible();
  });

  test("imports minimal-simple fixture and shows the fleet name", async ({ page }) => {
    await importFixture(page, "minimal-simple.json");
    // The fleet name lives in a text input bound to fleet.name. Locate it
    // and assert its value — getByDisplayValue isn't available in this
    // Playwright version, so we use a value-based locator.
    const input = page.locator('input[value="Minimal Simple Fleet"]');
    await expect(input).toBeVisible();
  });

  test("topology overlay panels render after fixture import", async ({ page }) => {
    await importFixture(page, "multi-instance-federated.json");
    await page.getByRole("button", { name: /^Topology Diagram$/ }).click();
    await expect(page.getByText("T0 Gateways").first()).toBeVisible();
    await expect(page.getByText("SSO Topology")).toBeVisible();
    await expect(page.getByText("DR Pairs")).toBeVisible();
    await expect(page.getByText("NSX Federation").nth(1)).toBeVisible();
  });

  test("per-site view renders shared appliances section", async ({ page }) => {
    await importFixture(page, "stretched-50-50.json");
    await page.getByRole("button", { name: /^Per-Site View$/ }).click();
    await expect(page.getByText(/Shared Appliances/).first()).toBeVisible();
  });
});

test.describe("VCF Design Studio — fixture import round-trip", () => {
  test("all v5 fixtures load without breaking the UI shell", async ({ page }) => {
    const fixtures = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
    for (const fixture of fixtures) {
      await page.goto(HTML_URL);
      await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
      await importFixture(page, fixture);
      // If the React tree crashed, the main header would be replaced.
      await expect(page.getByText("VCF", { exact: false }).first()).toBeVisible();
    }
  });
});
