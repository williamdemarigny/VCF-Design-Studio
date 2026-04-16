// T0 gateway invariants — VCF-INV-060..065 from VCF-DEPLOYMENT-PATTERNS.md §3.
// Exercises HA-mode limits, T0/edge binding rules, stateful A/A constraints,
// and VKS / Automation All-Apps feature requirements.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const {
  migrateFleet, newT0Gateway, validateT0Gateways, T0_HA_MODES,
  T0_MAX_T0S_PER_EDGE_NODE, T0_MAX_UPLINKS_PER_EDGE_AA,
} = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
  return migrateFleet(raw);
}

function makeCluster(t0s = []) {
  return { id: "clu-test", t0Gateways: t0s, infraStack: [] };
}

describe("T0_HA_MODES — metadata", () => {
  it("exposes the two documented HA modes", () => {
    expect(Object.keys(T0_HA_MODES).sort()).toEqual(["active-active", "active-standby"].sort());
  });

  it("A/S max edge nodes = 2", () => {
    expect(T0_HA_MODES["active-standby"].maxEdgeNodes).toBe(2);
  });

  it("A/A max edge nodes = 8", () => {
    expect(T0_HA_MODES["active-active"].maxEdgeNodes).toBe(8);
  });

  it("constants are at the research-doc values", () => {
    expect(T0_MAX_T0S_PER_EDGE_NODE).toBe(1);
    expect(T0_MAX_UPLINKS_PER_EDGE_AA).toBe(2);
  });
});

describe("newT0Gateway default state", () => {
  it("defaults to active-standby with empty edge bindings and no stateful/BGP", () => {
    const t0 = newT0Gateway();
    expect(t0.haMode).toBe("active-standby");
    expect(t0.edgeNodeKeys).toEqual([]);
    expect(t0.stateful).toBe(false);
    expect(t0.bgpEnabled).toBe(false);
    expect(t0.featureRequirements).toEqual([]);
  });
});

describe("VCF-INV-060: edge-node count limit per HA mode", () => {
  it("A/S with 2 edges passes", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-standby", edgeNodeKeys: ["e1", "e2"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-060")).toBe(false);
  });

  it("A/S with 3 edges fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-standby", edgeNodeKeys: ["e1", "e2", "e3"] },
    ]));
    const hit = issues.find((i) => i.ruleId === "VCF-INV-060");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("critical");
  });

  it("A/A with 8 edges passes", () => {
    const keys = Array.from({ length: 8 }, (_, i) => `e${i}`);
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", edgeNodeKeys: keys },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-060")).toBe(false);
  });

  it("A/A with 9 edges fails critical", () => {
    const keys = Array.from({ length: 9 }, (_, i) => `e${i}`);
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", edgeNodeKeys: keys },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-060" && i.severity === "critical")).toBe(true);
  });
});

describe("VCF-INV-061: each edge node hosts at most one T0", () => {
  it("shared edge across two T0s fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway("a"), edgeNodeKeys: ["e1"] },
      { ...newT0Gateway("b"), edgeNodeKeys: ["e1"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-061" && i.severity === "critical")).toBe(true);
  });

  it("non-overlapping edges pass", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway("a"), edgeNodeKeys: ["e1"] },
      { ...newT0Gateway("b"), edgeNodeKeys: ["e2"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-061")).toBe(false);
  });
});

describe("VCF-INV-062: stateful A/A requires even edge-node count ≥ 2", () => {
  it("stateful A/A with 3 edges fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", stateful: true, edgeNodeKeys: ["e1","e2","e3"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-062" && i.severity === "critical")).toBe(true);
  });

  it("stateful A/A with 4 edges passes (sub-cluster pairs)", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", stateful: true, edgeNodeKeys: ["e1","e2","e3","e4"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-062" && i.severity === "critical")).toBe(false);
  });

  it("stateful A/A with 0 edges fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", stateful: true, edgeNodeKeys: [] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-062" && i.severity === "critical")).toBe(true);
  });
});

describe("VCF-INV-063: VKS / VCF Automation All-Apps require A/S T0", () => {
  it("VKS requirement on A/S T0 passes", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-standby", edgeNodeKeys: ["e1","e2"], featureRequirements: ["vks"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-063")).toBe(false);
  });

  it("VKS requirement on A/A T0 fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", edgeNodeKeys: ["e1","e2"], featureRequirements: ["vks"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-063" && i.severity === "critical")).toBe(true);
  });

  it("vcfAutomationAllApps on A/A fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", edgeNodeKeys: ["e1","e2"], featureRequirements: ["vcfAutomationAllApps"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-063" && i.severity === "critical")).toBe(true);
  });
});

describe("VCF-INV-064: stateful A/A flagged as requiring Day-2 NSX Manager UI", () => {
  it("stateful A/A always emits a VCF-INV-064 warning", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", stateful: true, edgeNodeKeys: ["e1","e2"] },
    ]));
    const hit = issues.find((i) => i.ruleId === "VCF-INV-064");
    expect(hit).toBeDefined();
    expect(hit.severity).toBe("warn");
  });

  it("stateless A/A does NOT emit VCF-INV-064", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", stateful: false, edgeNodeKeys: ["e1","e2"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-064")).toBe(false);
  });
});

describe("VCF-INV-065: A/A T0 uplink accounting", () => {
  it("A/A T0 with 2 uplinks per edge node is OK", () => {
    const issues = validateT0Gateways(makeCluster([
      {
        ...newT0Gateway(),
        haMode: "active-active",
        edgeNodeKeys: ["e1", "e2"],
        uplinksPerEdge: [2, 2],
      },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-065")).toBe(false);
  });

  it("A/A T0 with 3 uplinks on a single Edge node fails critical", () => {
    const issues = validateT0Gateways(makeCluster([
      {
        ...newT0Gateway(),
        haMode: "active-active",
        edgeNodeKeys: ["e1"],
        uplinksPerEdge: [3],
      },
    ]));
    const hit = issues.find((i) => i.ruleId === "VCF-INV-065" && i.severity === "critical");
    expect(hit).toBeDefined();
    expect(hit.message).toMatch(/max 2 per Edge node/);
  });

  it("A/A T0 with total uplinks over 16 fails critical", () => {
    // 8 edges × 3 uplinks = 24 (exceeds total 16). Each individual node also
    // trips the per-node cap, so we expect multiple VCF-INV-065 issues.
    const keys = Array.from({ length: 8 }, (_, i) => `e${i}`);
    const uplinks = Array.from({ length: 8 }, () => 3);
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", edgeNodeKeys: keys, uplinksPerEdge: uplinks },
    ]));
    const crit = issues.filter((i) => i.ruleId === "VCF-INV-065" && i.severity === "critical");
    expect(crit.length).toBeGreaterThanOrEqual(1);
  });

  it("A/A T0 with no uplinksPerEdge passes VCF-INV-065 (implicit default)", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "active-active", edgeNodeKeys: ["e1", "e2"] },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-065" && i.severity === "critical")).toBe(false);
  });

  it("A/A T0 with orphan uplink entries emits info (not critical)", () => {
    const issues = validateT0Gateways(makeCluster([
      {
        ...newT0Gateway(),
        haMode: "active-active",
        edgeNodeKeys: ["e1"],
        uplinksPerEdge: [1, 1, 1],   // 3 entries vs 1 bound edge
      },
    ]));
    const info = issues.find((i) => i.ruleId === "VCF-INV-065" && i.severity === "info");
    expect(info).toBeDefined();
  });

  it("A/S T0 is not subject to VCF-INV-065 (A/S caps differ)", () => {
    const issues = validateT0Gateways(makeCluster([
      {
        ...newT0Gateway(),
        haMode: "active-standby",
        edgeNodeKeys: ["e1", "e2"],
        uplinksPerEdge: [5, 5],   // would be crazy on A/A but rule doesn't apply here
      },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-065")).toBe(false);
  });
});

describe("Empty / boundary inputs", () => {
  it("no T0 gateways → no issues", () => {
    expect(validateT0Gateways(makeCluster([]))).toEqual([]);
    expect(validateT0Gateways({})).toEqual([]);
    expect(validateT0Gateways(null)).toEqual([]);
  });

  it("unknown haMode is reported as VCF-INV-060 critical", () => {
    const issues = validateT0Gateways(makeCluster([
      { ...newT0Gateway(), haMode: "fake-mode" },
    ]));
    expect(issues.some((i) => i.ruleId === "VCF-INV-060" && i.severity === "critical")).toBe(true);
  });
});

describe("Migration backfills cluster.t0Gateways on legacy imports", () => {
  it("legacy cluster without t0Gateways gets an empty array", () => {
    const r = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: {
        id: "f", name: "x", sites: [{ id: "s" }],
        instances: [{
          id: "i", siteIds: ["s"],
          domains: [{
            id: "d", type: "mgmt", clusters: [{ id: "c", host: {}, infraStack: [] }],
          }],
        }],
      },
    });
    expect(r.instances[0].domains[0].clusters[0].t0Gateways).toEqual([]);
  });
});

describe("T0 fixtures — all ship without critical validator issues", () => {
  it.each(["t0-active-standby-basic.json", "t0-active-active-stateless.json"])(
    "%s has no critical T0 issues",
    (file) => {
      const fleet = loadFixture(file);
      for (const inst of fleet.instances) {
        for (const dom of inst.domains) {
          for (const clu of dom.clusters) {
            const issues = validateT0Gateways(clu);
            const crit = issues.filter((i) => i.severity === "critical");
            expect(crit, `${file} / ${clu.id}: unexpected critical T0 issues: ${JSON.stringify(crit)}`).toEqual([]);
          }
        }
      }
    }
  );

  it("t0-stateful-aa-daytwo.json emits VCF-INV-064 warning (Day-2 flag)", () => {
    const fleet = loadFixture("t0-stateful-aa-daytwo.json");
    let saw064 = false;
    for (const inst of fleet.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          const issues = validateT0Gateways(clu);
          if (issues.some((i) => i.ruleId === "VCF-INV-064")) saw064 = true;
        }
      }
    }
    expect(saw064).toBe(true);
  });
});

describe("Every v5 fixture has cluster.t0Gateways as an array", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    for (const inst of fleet.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          expect(Array.isArray(clu.t0Gateways)).toBe(true);
        }
      }
    }
  });
});
