// Deployment-pathway tests — VCF-PATH-001..004 from
// VCF-DEPLOYMENT-PATTERNS.md §5. Each fixture under test-fixtures/v5/ is
// expected to declare exactly one of { greenfield, expand, converge, import }.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const {
  migrateFleet, newFleet, inferDeploymentPathway, promoteToInitial,
  DEPLOYMENT_PATHWAYS, getInitialInstance,
} = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
  return migrateFleet(raw);
}

const VALID_PATHWAYS = Object.keys(DEPLOYMENT_PATHWAYS);

describe("VCF-PATH: deployment pathway metadata", () => {
  it("DEPLOYMENT_PATHWAYS exposes the four research-doc pathways", () => {
    expect(VALID_PATHWAYS.sort()).toEqual(["converge", "expand", "greenfield", "import"]);
  });

  it.each(Object.entries(DEPLOYMENT_PATHWAYS))("%s has ruleId, label, description", (key, def) => {
    expect(def.ruleId).toMatch(/^VCF-PATH-\d{3}$/);
    expect(def.label).toBeTypeOf("string");
    expect(def.description).toBeTypeOf("string");
  });
});

describe("VCF-PATH-001/002: inference for legacy fleets", () => {
  it("single-instance fleet without pathway defaults to greenfield", () => {
    expect(inferDeploymentPathway({ instances: [{}] })).toBe("greenfield");
  });

  it("multi-instance fleet without pathway defaults to expand", () => {
    expect(inferDeploymentPathway({ instances: [{}, {}] })).toBe("expand");
    expect(inferDeploymentPathway({ instances: [{}, {}, {}] })).toBe("expand");
  });

  it("fleet with explicit pathway preserves it (no override)", () => {
    expect(inferDeploymentPathway({ deploymentPathway: "converge", instances: [{}] })).toBe("converge");
    expect(inferDeploymentPathway({ deploymentPathway: "import",   instances: [{}, {}] })).toBe("import");
  });

  it("empty fleet falls back to greenfield", () => {
    expect(inferDeploymentPathway({})).toBe("greenfield");
    expect(inferDeploymentPathway({ instances: [] })).toBe("greenfield");
  });
});

describe("newFleet defaults to greenfield pathway", () => {
  it("newFleet().deploymentPathway === 'greenfield'", () => {
    expect(newFleet().deploymentPathway).toBe("greenfield");
  });
});

describe("migrateFleet backfills deploymentPathway", () => {
  it("v5 import without the field gets inferred pathway based on instance count", () => {
    // Single-instance legacy v5 -> greenfield
    const solo = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", sites: [{ id: "s" }], instances: [{ id: "i", siteIds: ["s"], domains: [] }] },
    });
    expect(solo.deploymentPathway).toBe("greenfield");

    // Multi-instance legacy v5 -> expand
    const multi = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", sites: [{ id: "s" }],
        instances: [
          { id: "i1", siteIds: ["s"], domains: [] },
          { id: "i2", siteIds: ["s"], domains: [] },
        ],
      },
    });
    expect(multi.deploymentPathway).toBe("expand");
  });

  it("v5 import with explicit pathway preserves it", () => {
    const converge = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", deploymentPathway: "converge",
        sites: [{ id: "s" }], instances: [{ id: "i", siteIds: ["s"], domains: [] }],
      },
    });
    expect(converge.deploymentPathway).toBe("converge");
  });

  it("v5 migration is idempotent with respect to pathway", () => {
    const first = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", sites: [{ id: "s" }], instances: [{ id: "i1", siteIds: ["s"], domains: [] }, { id: "i2", siteIds: ["s"], domains: [] }] },
    });
    const second = migrateFleet({ version: "vcf-sizer-v5", fleet: first });
    expect(second.deploymentPathway).toBe(first.deploymentPathway);
  });
});

describe("Every v5 fixture has a valid deploymentPathway", () => {
  it.each(fixtureFiles)("%s declares a valid pathway", (file) => {
    const fleet = loadFixture(file);
    expect(VALID_PATHWAYS).toContain(fleet.deploymentPathway);
  });

  it("multi-instance fixtures declare 'expand' (not 'greenfield')", () => {
    for (const file of fixtureFiles) {
      const fleet = loadFixture(file);
      if (fleet.instances.length > 1) {
        // Either explicitly set to expand, or the migration inferred it.
        // If a fixture leaves it as greenfield with >1 instance, that's a
        // real authoring bug — the studio would misrepresent the scenario.
        expect(fleet.deploymentPathway,
          `${file}: multi-instance fleet should declare expand pathway`).toBe("expand");
      }
    }
  });
});

describe("promoteToInitial helper", () => {
  it("moves the target instance to fleet.instances[0]", () => {
    const fleet = newFleet();
    const secondSite = fleet.sites[0];
    const inst2 = VcfEngine.newInstance("vcf-inst-2", [secondSite.id]);
    fleet.instances.push(inst2);

    const promoted = promoteToInitial(fleet, inst2.id);
    expect(promoted.instances[0].id).toBe(inst2.id);
    expect(getInitialInstance(promoted).id).toBe(inst2.id);
  });

  it("is a no-op when the target is already initial", () => {
    const fleet = newFleet();
    const initialId = fleet.instances[0].id;
    const promoted = promoteToInitial(fleet, initialId);
    expect(promoted.instances[0].id).toBe(initialId);
    // Object reference stability isn't guaranteed; shape equality is.
    expect(promoted.instances.length).toBe(fleet.instances.length);
  });

  it("is a no-op for an unknown instance id", () => {
    const fleet = newFleet();
    const promoted = promoteToInitial(fleet, "inst-DOES-NOT-EXIST");
    expect(promoted.instances.map((i) => i.id)).toEqual(fleet.instances.map((i) => i.id));
  });

  it("does not mutate the input fleet", () => {
    const fleet = newFleet();
    const inst2 = VcfEngine.newInstance("vcf-inst-2", [fleet.sites[0].id]);
    fleet.instances.push(inst2);
    const originalOrder = fleet.instances.map((i) => i.id);
    promoteToInitial(fleet, inst2.id);
    expect(fleet.instances.map((i) => i.id)).toEqual(originalOrder);
  });

  it("returns the fleet unchanged for null/empty input", () => {
    expect(promoteToInitial(null, "x")).toBe(null);
    expect(promoteToInitial({ instances: [] }, "x")).toEqual({ instances: [] });
  });
});
