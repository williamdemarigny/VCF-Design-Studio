// Ops & Automation placement invariants — regression guard for the
// per-fleet appliance duplication bug we fixed after the audit. The studio
// must NEVER place vcfOps/vcfAuto/fleetMgr/vcfOpsLogs/vcfOpsNet on a
// non-initial instance (VCF-INV-011). The test covers:
//   - the `stackForInstance` helper directly
//   - `promoteToInitial` re-stacking behavior
//   - every shipped v5 fixture — no stale state
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const {
  newFleet, newInstance, migrateFleet,
  stackForInstance, promoteToInitial, APPLIANCE_DB,
  DEPLOYMENT_PROFILES,
} = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));
const loadFixture = (file) =>
  migrateFleet(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")));

const PER_FLEET_IDS = Object.entries(APPLIANCE_DB)
  .filter(([, def]) => def.scope === "per-fleet")
  .map(([id]) => id);

describe("Per-fleet appliances live only on the initial instance (VCF-INV-011)", () => {
  it("PER_FLEET_IDS include vcfOps, vcfAuto, fleetMgr, vcfOpsLogs, vcfOpsNet", () => {
    for (const id of ["vcfOps", "vcfAuto", "fleetMgr", "vcfOpsLogs", "vcfOpsNet"]) {
      expect(PER_FLEET_IDS, `${id} must be scope=per-fleet`).toContain(id);
    }
  });

  it("stackForInstance(profile, true) includes every per-fleet appliance in the profile", () => {
    for (const profileKey of Object.keys(DEPLOYMENT_PROFILES)) {
      const initial = stackForInstance(profileKey, true);
      const full = DEPLOYMENT_PROFILES[profileKey].stack;
      const perFleetInProfile = full.filter((e) => PER_FLEET_IDS.includes(e.id));
      for (const e of perFleetInProfile) {
        expect(initial.find((i) => i.id === e.id),
          `${profileKey} initial stack must include ${e.id}`
        ).toBeDefined();
      }
    }
  });

  it("stackForInstance(profile, false) NEVER includes per-fleet appliances", () => {
    for (const profileKey of Object.keys(DEPLOYMENT_PROFILES)) {
      const nonInitial = stackForInstance(profileKey, false);
      for (const e of nonInitial) {
        expect(PER_FLEET_IDS,
          `${profileKey} non-initial stack contains per-fleet appliance ${e.id}`
        ).not.toContain(e.id);
      }
    }
  });

  it.each(fixtureFiles)("%s — no non-initial instance carries a per-fleet appliance", (file) => {
    const fleet = loadFixture(file);
    fleet.instances.forEach((inst, i) => {
      if (i === 0) return;
      for (const dom of inst.domains || []) {
        for (const clu of dom.clusters || []) {
          for (const e of clu.infraStack || []) {
            expect(PER_FLEET_IDS,
              `${file}: non-initial instance ${inst.id} (index ${i}) carries ${e.id} — violates VCF-INV-011`
            ).not.toContain(e.id);
          }
        }
      }
    });
  });
});

describe("promoteToInitial re-stacks per-fleet appliances onto the new initial", () => {
  it("moves vcfOps/vcfAuto from the old initial to the new initial (ha profile)", () => {
    // Build a 2-instance fleet with full HA stacks on instance[0].
    const fleet = newFleet();
    fleet.instances[0].deploymentProfile = "ha";
    fleet.instances[0].domains[0].clusters[0].infraStack =
      stackForInstance("ha", true).map((e) => ({ ...e, key: "k-" + e.id }));
    const inst2 = newInstance("vcf-2", [fleet.sites[0].id]);
    inst2.deploymentProfile = "ha";
    inst2.domains[0].clusters[0].infraStack =
      stackForInstance("ha", false).map((e) => ({ ...e, key: "k2-" + e.id }));
    fleet.instances.push(inst2);

    // Sanity: before promote — per-fleet appliances on instance[0], not instance[1]
    const hasPerFleet = (clu) => (clu.infraStack || [])
      .some((e) => PER_FLEET_IDS.includes(e.id));
    expect(hasPerFleet(fleet.instances[0].domains[0].clusters[0])).toBe(true);
    expect(hasPerFleet(fleet.instances[1].domains[0].clusters[0])).toBe(false);

    // Promote instance[1] to initial.
    const promoted = promoteToInitial(fleet, inst2.id);

    // After promote:
    //   - instance[0] is now the old vcf-2 (new initial) — carries per-fleet
    //   - instance[1] is the old initial (now demoted) — no per-fleet
    expect(promoted.instances[0].id).toBe(inst2.id);
    expect(hasPerFleet(promoted.instances[0].domains[0].clusters[0])).toBe(true);
    expect(hasPerFleet(promoted.instances[1].domains[0].clusters[0])).toBe(false);
  });

  it("is a no-op when promoting the already-initial instance", () => {
    const fleet = newFleet();
    const initialId = fleet.instances[0].id;
    const result = promoteToInitial(fleet, initialId);
    expect(result.instances[0].id).toBe(initialId);
  });

  it("does not mutate the input fleet", () => {
    const fleet = newFleet();
    const inst2 = newInstance("vcf-2", [fleet.sites[0].id]);
    inst2.deploymentProfile = "ha";
    fleet.instances.push(inst2);
    const beforeOrder = fleet.instances.map((i) => i.id);
    promoteToInitial(fleet, inst2.id);
    expect(fleet.instances.map((i) => i.id)).toEqual(beforeOrder);
  });
});

describe("Specifically: vcfOps, vcfAuto, and fleetMgr appear at most once per fleet", () => {
  it.each(["vcfOps", "vcfAuto", "fleetMgr", "vcfOpsLogs", "vcfOpsNet"])(
    "%s appears at most once across every v5 fixture (active-instance count)",
    (id) => {
      for (const file of fixtureFiles) {
        const fleet = loadFixture(file);
        let count = 0;
        for (const inst of fleet.instances) {
          if (inst.drPosture === "warm-standby") continue;   // VCF-DR-040
          for (const dom of inst.domains || []) {
            for (const clu of dom.clusters || []) {
              for (const e of clu.infraStack || []) {
                if (e.id === id) count += 1;
              }
            }
          }
        }
        expect(count, `${file}: ${id} appears ${count} times (expected ≤ 1)`)
          .toBeLessThanOrEqual(1);
      }
    }
  );
});
