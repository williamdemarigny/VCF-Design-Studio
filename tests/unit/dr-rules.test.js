// DR posture invariants — VCF-DR-001..050 from VCF-DEPLOYMENT-PATTERNS.md §5.5.
// Covers warm-standby posture, DR pairing references, and the "fleet services
// remain dormant on standby" semantics.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const {
  newFleet, newInstance, migrateFleet,
  DR_POSTURES, DR_REPLICATED_COMPONENTS, DR_BACKUP_COMPONENTS,
  isWarmStandby, countActivePerFleetEntries, APPLIANCE_DB,
} = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
  return migrateFleet(raw);
}

describe("DR_POSTURES — metadata", () => {
  it("exposes active and warm-standby postures", () => {
    expect(Object.keys(DR_POSTURES).sort()).toEqual(["active", "warm-standby"].sort());
  });

  it("warm-standby references VCF-DR-001", () => {
    expect(DR_POSTURES["warm-standby"].ruleId).toBe("VCF-DR-001");
  });
});

describe("VCF-DR-010 / VCF-DR-020 — protection method classification", () => {
  it("replication covers Operations stack components", () => {
    expect(DR_REPLICATED_COMPONENTS).toContain("vcfOps");
    expect(DR_REPLICATED_COMPONENTS).toContain("fleetMgr");
    expect(DR_REPLICATED_COMPONENTS).toContain("vcfOpsLogs");
    expect(DR_REPLICATED_COMPONENTS).toContain("vcfOpsNet");
  });

  it("backup/restore covers Automation + Identity Broker", () => {
    expect(DR_BACKUP_COMPONENTS).toContain("vcfAuto");
    expect(DR_BACKUP_COMPONENTS).toContain("identityBroker");
  });

  it("every DR-tracked appliance exists in APPLIANCE_DB", () => {
    for (const id of [...DR_REPLICATED_COMPONENTS, ...DR_BACKUP_COMPONENTS]) {
      expect(APPLIANCE_DB[id], `${id} missing from APPLIANCE_DB`).toBeDefined();
    }
  });
});

describe("isWarmStandby helper", () => {
  it("returns true when drPosture === 'warm-standby'", () => {
    expect(isWarmStandby({ drPosture: "warm-standby" })).toBe(true);
  });

  it("returns false for active or undefined posture", () => {
    expect(isWarmStandby({ drPosture: "active" })).toBe(false);
    expect(isWarmStandby({})).toBe(false);
    expect(isWarmStandby(null)).toBe(false);
  });
});

describe("countActivePerFleetEntries — excludes warm-standby instances", () => {
  it("does not count stack entries on warm-standby instances", () => {
    const fleet = {
      instances: [
        {
          id: "primary", drPosture: "active",
          domains: [{ type: "mgmt", clusters: [{ infraStack: [{ id: "vcfOps", instances: 3 }] }] }],
        },
        {
          id: "standby", drPosture: "warm-standby",
          domains: [{ type: "mgmt", clusters: [{ infraStack: [{ id: "vcfOps", instances: 3 }] }] }],
        },
      ],
    };
    // Standby's vcfOps copies are dormant replicas; they don't count.
    expect(countActivePerFleetEntries(fleet, "vcfOps")).toBe(1);
  });

  it("counts active instances normally", () => {
    const fleet = {
      instances: [
        { id: "i1", drPosture: "active", domains: [{ type: "mgmt", clusters: [{ infraStack: [{ id: "vcfOps", instances: 3 }] }] }] },
      ],
    };
    expect(countActivePerFleetEntries(fleet, "vcfOps")).toBe(1);
  });

  it("returns 0 for an appliance id that does not appear", () => {
    const fleet = { instances: [{ domains: [] }] };
    expect(countActivePerFleetEntries(fleet, "vcfOps")).toBe(0);
  });
});

describe("VCF-DR-030: per-instance appliances (SDDC Manager) stay with their instance", () => {
  it("warm-standby fixtures still carry sddcMgr on the standby instance", () => {
    for (const file of fixtureFiles) {
      const fleet = loadFixture(file);
      for (const inst of fleet.instances) {
        if (!isWarmStandby(inst)) continue;
        let hasSddc = false;
        for (const dom of inst.domains) {
          for (const clu of dom.clusters) {
            for (const e of clu.infraStack || []) {
              if (e.id === "sddcMgr") hasSddc = true;
            }
          }
        }
        expect(hasSddc,
          `${file}: warm-standby instance ${inst.id} should still carry sddcMgr (per-instance, not failed over)`
        ).toBe(true);
      }
    }
  });
});

describe("VCF-DR-040: warm-standby instances do not duplicate per-fleet services", () => {
  it.each(fixtureFiles)("%s — active-only count for per-fleet appliances ≤ 1", (file) => {
    const fleet = loadFixture(file);
    const perFleetIds = Object.entries(APPLIANCE_DB)
      .filter(([, def]) => def.scope === "per-fleet")
      .map(([id]) => id);
    for (const id of perFleetIds) {
      const n = countActivePerFleetEntries(fleet, id);
      expect(n, `${file}: active-only count for ${id} must be ≤ 1`).toBeLessThanOrEqual(1);
    }
  });
});

describe("newInstance default DR state", () => {
  it("defaults to active with null paired-instance", () => {
    const inst = newInstance("test", ["site-1"]);
    expect(inst.drPosture).toBe("active");
    expect(inst.drPairedInstanceId).toBeNull();
  });
});

describe("Migration backfills DR posture on legacy imports", () => {
  it("legacy v5 instance without drPosture defaults to active", () => {
    const r = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", sites: [{ id: "s" }], instances: [{ id: "i", siteIds: ["s"], domains: [] }] },
    });
    expect(r.instances[0].drPosture).toBe("active");
    expect(r.instances[0].drPairedInstanceId).toBeNull();
  });

  it("explicit drPosture preserved", () => {
    const r = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", sites: [{ id: "s" }],
        instances: [{ id: "i", siteIds: ["s"], drPosture: "warm-standby", drPairedInstanceId: "other", domains: [] }],
      },
    });
    expect(r.instances[0].drPosture).toBe("warm-standby");
    expect(r.instances[0].drPairedInstanceId).toBe("other");
  });
});

describe("Warm-standby fixture shape", () => {
  it("warm-standby-pair.json has exactly one warm-standby instance paired to initial", () => {
    const fleet = loadFixture("warm-standby-pair.json");
    const standbys = fleet.instances.filter(isWarmStandby);
    expect(standbys.length).toBe(1);
    expect(standbys[0].drPairedInstanceId).toBe(fleet.instances[0].id);
  });

  it("multi-region-dr.json has one warm-standby instance paired to the initial", () => {
    const fleet = loadFixture("multi-region-dr.json");
    const standbys = fleet.instances.filter(isWarmStandby);
    expect(standbys.length).toBe(1);
    expect(standbys[0].drPairedInstanceId).toBe(fleet.instances[0].id);
  });
});
