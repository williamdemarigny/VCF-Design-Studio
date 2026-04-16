// Smoke tests — confirm engine.js loads in Node and exposes the expected
// symbol surface. Deeper per-function tests come in Phase 2.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const EXPECTED_SYMBOLS = [
  "APPLIANCE_DB", "DEPLOYMENT_PROFILES", "DEPLOYMENT_PATHWAYS", "DEFAULT_MGMT_STACK_TEMPLATE", "SIZING_LIMITS",
  "POLICIES", "TB_TO_TIB", "TIB_PER_CORE", "NVME_TIER_PARTITION_CAP_GB",
  "recommendVcenterSize", "recommendNsxSize",
  "cryptoKey", "baseHostSpec", "baseStorageSettings", "baseTiering",
  "newCluster", "newMgmtCluster", "newWorkloadCluster",
  "newMgmtDomain", "newWorkloadDomain", "newInstance", "newSite", "newFleet",
  "buildDefaultPlacement", "ensurePlacement",
  "getInitialInstance", "isInitialInstance", "getHostSplitPct", "stackForInstance",
  "promoteToInitial", "inferDeploymentPathway", "inferFederationEnabled",
  "SSO_MODES", "inferSsoMode", "ssoInstancesPerBroker", "SSO_INSTANCES_PER_BROKER_LIMIT",
  "DR_POSTURES", "DR_REPLICATED_COMPONENTS", "DR_BACKUP_COMPONENTS", "isWarmStandby", "countActivePerFleetEntries",
  "T0_HA_MODES", "T0_MAX_T0S_PER_EDGE_NODE", "T0_MAX_UPLINKS_PER_EDGE_AA", "newT0Gateway", "validateT0Gateways",
  "EDGE_DEPLOYMENT_MODELS",
  "migrateV2ToV3", "domainStructureMatches", "stackSignature", "liftV3Instance",
  "migrateV3ToV5", "migrateFleet",
  "stackTotals", "sizeHost", "applyTiering", "sizeStoragePipeline", "sizeCluster",
  "analyzeStretchedFailover", "minHostsForVerdict", "sizeDomain", "sizeInstance",
  "projectInstanceOntoSite", "sizeFleet",
];

describe("engine module surface", () => {
  it("exports every expected symbol", () => {
    for (const sym of EXPECTED_SYMBOLS) {
      expect(VcfEngine, `missing export: ${sym}`).toHaveProperty(sym);
    }
  });

  it("exports exactly the expected symbols (no orphans)", () => {
    const actual = Object.keys(VcfEngine).sort();
    const expected = [...EXPECTED_SYMBOLS].sort();
    expect(actual).toEqual(expected);
  });
});

describe("default fleet sizing", () => {
  const { newFleet, sizeFleet } = VcfEngine;
  const fleet = newFleet();
  const result = sizeFleet(fleet);

  it("produces a positive host count", () => {
    expect(result.totalHosts).toBeGreaterThan(0);
  });

  it("reports totalCores equal to sum of cluster licensedCores", () => {
    let sum = 0;
    for (const ir of result.instanceResults) {
      for (const dr of ir.domainResults) {
        for (const cr of dr.clusterResults) {
          sum += cr.licensedCores;
        }
      }
    }
    expect(result.totalCores).toBe(sum);
  });

  it("attaches vsanMinWarning flag on every cluster result", () => {
    for (const ir of result.instanceResults) {
      for (const dr of ir.domainResults) {
        for (const cr of dr.clusterResults) {
          expect(typeof cr.vsanMinWarning).toBe("boolean");
        }
      }
    }
  });
});

describe("hyperthreading invariants", () => {
  const { newFleet, sizeHost } = VcfEngine;
  const fleet = newFleet();
  const host = fleet.instances[0].domains[0].clusters[0].host;

  it("doubles threads when hyperthreading enabled, keeps physical cores", () => {
    const off = sizeHost({ ...host, hyperthreadingEnabled: false });
    const on  = sizeHost({ ...host, hyperthreadingEnabled: true  });
    expect(on.cores).toBe(off.cores);
    expect(on.threads).toBe(off.threads * 2);
  });

  it("doubles usableVcpu when hyperthreading enabled", () => {
    const off = sizeHost({ ...host, hyperthreadingEnabled: false });
    const on  = sizeHost({ ...host, hyperthreadingEnabled: true  });
    expect(on.usableVcpu).toBeCloseTo(off.usableVcpu * 2, 6);
  });

  it("leaves usableRam unchanged when hyperthreading toggled", () => {
    const off = sizeHost({ ...host, hyperthreadingEnabled: false });
    const on  = sizeHost({ ...host, hyperthreadingEnabled: true  });
    expect(on.usableRam).toBe(off.usableRam);
  });
});

describe("migrateFleet", () => {
  const { migrateFleet, newFleet } = VcfEngine;

  it("returns a valid fleet for null input", () => {
    const result = migrateFleet(null);
    expect(result).toHaveProperty("sites");
    expect(result).toHaveProperty("instances");
  });

  it("normalizes hyperthreadingEnabled on v5 imports missing the field", () => {
    const v5 = newFleet();
    // Strip the field to simulate an older v5 export
    for (const inst of v5.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          delete clu.host.hyperthreadingEnabled;
        }
      }
    }
    const wrapped = { version: "vcf-sizer-v5", fleet: v5 };
    const migrated = migrateFleet(wrapped);
    for (const inst of migrated.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          expect(clu.host.hyperthreadingEnabled).toBe(false);
        }
      }
    }
  });

  it("is idempotent on v5 input", () => {
    const v5 = newFleet();
    const once = migrateFleet({ version: "vcf-sizer-v5", fleet: v5 });
    const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
