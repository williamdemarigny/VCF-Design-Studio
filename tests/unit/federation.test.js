// Federation flag tests — VCF-INV-021 now keys off fleet.federationEnabled
// explicitly, with inference from deploymentProfile only as a migration
// backfill default.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const { newFleet, migrateFleet, inferFederationEnabled } = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
  return migrateFleet(raw);
}

describe("inferFederationEnabled", () => {
  it("returns true when any instance uses a Federation profile", () => {
    const fleet = {
      instances: [{ deploymentProfile: "haFederation" }, { deploymentProfile: "ha" }],
    };
    expect(inferFederationEnabled(fleet)).toBe(true);
  });

  it("returns true for haFederationSiteProtection", () => {
    const fleet = { instances: [{ deploymentProfile: "haFederationSiteProtection" }] };
    expect(inferFederationEnabled(fleet)).toBe(true);
  });

  it("returns false when no instance uses a Federation profile", () => {
    const fleet = {
      instances: [{ deploymentProfile: "ha" }, { deploymentProfile: "haSiteProtection" }],
    };
    expect(inferFederationEnabled(fleet)).toBe(false);
  });

  it("returns false for an empty fleet", () => {
    expect(inferFederationEnabled({})).toBe(false);
    expect(inferFederationEnabled({ instances: [] })).toBe(false);
  });

  it("preserves explicit fleet.federationEnabled when set (both true and false)", () => {
    expect(inferFederationEnabled({ federationEnabled: true, instances: [{ deploymentProfile: "ha" }] })).toBe(true);
    expect(inferFederationEnabled({ federationEnabled: false, instances: [{ deploymentProfile: "haFederation" }] })).toBe(false);
  });
});

describe("newFleet default federationEnabled", () => {
  it("defaults to false", () => {
    expect(newFleet().federationEnabled).toBe(false);
  });
});

describe("migrateFleet backfills federationEnabled", () => {
  it("v5 import without the field gets inferred value from profiles", () => {
    const fed = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", sites: [{ id: "s" }],
        instances: [{ id: "i", siteIds: ["s"], deploymentProfile: "haFederation", domains: [] }],
      },
    });
    expect(fed.federationEnabled).toBe(true);

    const noFed = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", sites: [{ id: "s" }],
        instances: [{ id: "i", siteIds: ["s"], deploymentProfile: "ha", domains: [] }],
      },
    });
    expect(noFed.federationEnabled).toBe(false);
  });

  it("v5 import with explicit federationEnabled preserves the value", () => {
    const explicit = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", federationEnabled: true,
        sites: [{ id: "s" }],
        instances: [{ id: "i", siteIds: ["s"], deploymentProfile: "ha", domains: [] }],
      },
    });
    expect(explicit.federationEnabled).toBe(true);
  });
});

describe("Every v5 fixture has a boolean federationEnabled flag", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    expect(typeof fleet.federationEnabled).toBe("boolean");
  });

  it("fixtures containing nsxGlobalMgr have federationEnabled === true", () => {
    for (const file of fixtureFiles) {
      const fleet = loadFixture(file);
      let hasGlobal = false;
      for (const inst of fleet.instances) {
        for (const dom of inst.domains) {
          for (const clu of dom.clusters) {
            for (const e of clu.infraStack || []) {
              if (e.id === "nsxGlobalMgr") hasGlobal = true;
            }
          }
        }
      }
      if (hasGlobal) {
        expect(fleet.federationEnabled,
          `${file}: contains nsxGlobalMgr but federationEnabled is not true`
        ).toBe(true);
      }
    }
  });
});
