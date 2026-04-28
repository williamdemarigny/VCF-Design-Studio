// Smoke tests — confirm engine.js loads in Node and exposes the expected
// symbol surface. Deeper per-function tests come in Phase 2.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const EXPECTED_SYMBOLS = [
  "APPLIANCE_DB", "DEPLOYMENT_PROFILES", "DEPLOYMENT_PATHWAYS", "DEFAULT_MGMT_STACK_TEMPLATE", "SIZING_LIMITS",
  "POLICIES", "TB_TO_TIB", "TIB_PER_CORE", "NVME_TIER_PARTITION_CAP_GB", "VLAN_ID_MIN", "VLAN_ID_MAX", "MTU_MGMT", "MTU_VMOTION", "MTU_VSAN", "MTU_TEP_MIN", "MTU_TEP_RECOMMENDED", "DEFAULT_BGP_ASN_AA", "TEP_POOL_GROWTH_FACTOR", "NIC_PROFILES",
  "recommendVcenterSize", "recommendNsxSize",
  "cryptoKey", "baseHostSpec", "baseStorageSettings", "baseTiering",
  "newCluster", "newMgmtCluster", "newWorkloadCluster",
  "newMgmtDomain", "newWorkloadDomain", "newInstance", "newSite", "newFleet",
  "domainSites", "buildDefaultPlacement", "ensurePlacement",
  "getInitialInstance", "isInitialInstance", "getHostSplitPct", "stackForInstance",
  "promoteToInitial", "inferDeploymentPathway", "inferFederationEnabled",
  "SSO_MODES", "inferSsoMode", "ssoInstancesPerBroker", "SSO_INSTANCES_PER_BROKER_LIMIT",
  "DR_POSTURES", "DR_REPLICATED_COMPONENTS", "DR_BACKUP_COMPONENTS", "isWarmStandby", "countActivePerFleetEntries",
  "T0_HA_MODES", "T0_MAX_T0S_PER_EDGE_NODE", "T0_MAX_UPLINKS_PER_EDGE_AA", "newT0Gateway", "validateT0Gateways",
  "EDGE_DEPLOYMENT_MODELS",
  "migrateV2ToV3", "domainStructureMatches", "stackSignature", "liftV3Instance",
  "migrateV3ToV5", "migrateV5ToV6", "migrateFleet",
  "stackTotals", "sizeHost", "applyTiering", "sizeStoragePipeline", "sizeCluster",
  "analyzeStretchedFailover", "minHostsForVerdict", "sizeDomain", "sizeInstance",
  "projectInstanceOntoSite", "sizeFleet",   "createFleetNetworkConfig", "createClusterNetworks", "createHostIpOverride",
  "ipToInt", "intToIp", "ipPoolSize", "subnetContainsIp", "allocateClusterIps", "validateNetworkDesign", "emitInstallerJson", "emitWorkbookRows",
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

describe("multi-site VCF instance sizing", () => {
  const {
    newFleet, newSite, newInstance, newWorkloadDomain, sizeFleet,
    projectInstanceOntoSite,
  } = VcfEngine;

  function buildThreeSiteFleet() {
    // Fleet with three sites: A (primary), B (stretched pair peer), C (remote).
    const fleet = newFleet();
    const siteA = fleet.sites[0];
    const siteB = newSite("Site B", "");
    const siteC = newSite("Site C", "");
    fleet.sites.push(siteB, siteC);

    // Replace the default instance with one that touches all three sites.
    const inst = newInstance("multi-site", [siteA.id, siteB.id, siteC.id]);
    // Mgmt domain (from newInstance) is stretched A↔B by default.
    // Add a workload domain local to Site C.
    const wldC = newWorkloadDomain("Remote WLD @ C");
    wldC.placement = "local";
    wldC.localSiteId = siteC.id;
    wldC.stretchSiteIds = null;
    inst.domains.push(wldC);
    fleet.instances = [inst];
    return { fleet, siteA, siteB, siteC };
  }

  it("mgmt domain stretched A↔B has both siteA and siteB in its projection", () => {
    const { fleet, siteA, siteB } = buildThreeSiteFleet();
    const result = sizeFleet(fleet);
    const projA = projectInstanceOntoSite(result.instanceResults[0], siteA.id);
    const projB = projectInstanceOntoSite(result.instanceResults[0], siteB.id);
    expect(projA.projectedDomains.some((pd) => pd.domain.type === "mgmt")).toBe(true);
    expect(projB.projectedDomains.some((pd) => pd.domain.type === "mgmt")).toBe(true);
    expect(projA.role).toBe("primary");
    expect(projB.role).toBe("secondary");
    expect(projA.otherSiteId).toBe(siteB.id);
    expect(projB.otherSiteId).toBe(siteA.id);
  });

  it("remote workload domain at C projects onto C only", () => {
    const { fleet, siteA, siteB, siteC } = buildThreeSiteFleet();
    const result = sizeFleet(fleet);
    const projA = projectInstanceOntoSite(result.instanceResults[0], siteA.id);
    const projB = projectInstanceOntoSite(result.instanceResults[0], siteB.id);
    const projC = projectInstanceOntoSite(result.instanceResults[0], siteC.id);
    expect(projA.projectedDomains.some((pd) => pd.domain.type === "workload")).toBe(false);
    expect(projB.projectedDomains.some((pd) => pd.domain.type === "workload")).toBe(false);
    expect(projC.projectedDomains.some((pd) => pd.domain.type === "workload")).toBe(true);
  });

  it("siteC has role from siteIds fallback (no stretched pair includes it)", () => {
    const { fleet, siteC } = buildThreeSiteFleet();
    const result = sizeFleet(fleet);
    const projC = projectInstanceOntoSite(result.instanceResults[0], siteC.id);
    // siteC is at index 2 → no primary/secondary role from pairs, fallback null
    expect(projC.role).toBeNull();
    expect(projC.otherSiteId).toBeNull();
  });

  it("witness sizing fires when any domain is stretched (even if instance touches 3 sites)", () => {
    const { fleet } = buildThreeSiteFleet();
    fleet.instances[0].witnessEnabled = true;
    const result = sizeFleet(fleet);
    expect(result.instanceResults[0].witness).not.toBeNull();
    // One mgmt cluster is stretched → witness should be sized for 1 cluster.
    expect(result.instanceResults[0].witness.instances).toBe(1);
  });

  it("total host count is stable when a local domain is added at a third site", () => {
    const { fleet } = buildThreeSiteFleet();
    const result = sizeFleet(fleet);
    // Sum hosts across all site projections should equal the instance total.
    let perSiteSum = 0;
    for (const sr of result.siteResults) {
      for (const p of sr.projections) {
        for (const pd of p.projectedDomains) {
          for (const pc of pd.projectedClusters) perSiteSum += pc.hostsHere;
        }
      }
    }
    expect(perSiteSum).toBe(result.totalHosts);
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
