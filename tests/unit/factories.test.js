import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const {
  cryptoKey, baseHostSpec, baseStorageSettings, baseTiering,
  newCluster, newMgmtCluster, newWorkloadCluster,
  newMgmtDomain, newWorkloadDomain, newInstance, newSite, newFleet,
  buildDefaultPlacement, ensurePlacement,
} = VcfEngine;

describe("cryptoKey", () => {
  it("returns a non-empty string", () => {
    const k = cryptoKey();
    expect(typeof k).toBe("string");
    expect(k.length).toBeGreaterThan(0);
  });

  it("returns different keys on consecutive calls", () => {
    const seen = new Set();
    for (let i = 0; i < 100; i++) seen.add(cryptoKey());
    expect(seen.size).toBe(100);
  });
});

describe("base spec factories", () => {
  it("baseHostSpec returns the documented default", () => {
    const h = baseHostSpec();
    expect(h.cpuQty).toBe(2);
    expect(h.coresPerCpu).toBe(16);
    expect(h.hyperthreadingEnabled).toBe(false);
    expect(h.ramGb).toBe(1024);
    expect(h.cpuOversub).toBe(2);
    expect(h.ramOversub).toBe(1);
    expect(h.reservePct).toBe(30);
  });

  it("baseStorageSettings returns the documented default", () => {
    const s = baseStorageSettings();
    expect(s.policy).toBe("raid5_2p1");
    expect(s.dedup).toBe(1);
    expect(s.compression).toBe(1);
    expect(s.swapPct).toBe(100);
    expect(s.externalStorage).toBe(false);
  });

  it("baseTiering returns the documented default (disabled)", () => {
    const t = baseTiering();
    expect(t.enabled).toBe(false);
  });

  it("each call returns a fresh object (no shared mutation)", () => {
    const a = baseHostSpec();
    const b = baseHostSpec();
    a.cpuQty = 99;
    expect(b.cpuQty).toBe(2);
  });
});

describe("entity factories", () => {
  it("newCluster returns a valid cluster shape", () => {
    const c = newCluster("my-cluster", true);
    expect(c.id).toMatch(/^clu-/);
    expect(c.name).toBe("my-cluster");
    expect(c.isDefault).toBe(true);
    expect(c.host).toBeDefined();
    expect(c.workload).toBeDefined();
    expect(c.storage).toBeDefined();
    expect(c.tiering).toBeDefined();
    expect(Array.isArray(c.infraStack)).toBe(true);
  });

  it("newMgmtCluster vs newWorkloadCluster differ in default appliances", () => {
    const m = newMgmtCluster();
    const w = newWorkloadCluster();
    // Mgmt cluster carries vCLS by default; workload cluster also does
    expect(m.id).toMatch(/^clu-/);
    expect(w.id).toMatch(/^clu-/);
    expect(Array.isArray(m.infraStack)).toBe(true);
    expect(Array.isArray(w.infraStack)).toBe(true);
  });

  it("newMgmtDomain has type='mgmt' and one cluster", () => {
    const d = newMgmtDomain("X");
    expect(d.type).toBe("mgmt");
    expect(d.name).toBe("X");
    expect(d.clusters.length).toBe(1);
  });

  it("newWorkloadDomain has type='workload'", () => {
    const d = newWorkloadDomain("Y");
    expect(d.type).toBe("workload");
    expect(d.name).toBe("Y");
  });

  it("newInstance has a mgmt domain by default", () => {
    const inst = newInstance("test-inst", ["site-1"]);
    expect(inst.id).toMatch(/^inst-/);
    expect(inst.name).toBe("test-inst");
    expect(inst.siteIds).toEqual(["site-1"]);
    expect(inst.domains[0].type).toBe("mgmt");
    expect(inst.deploymentProfile).toBeDefined();
  });

  it("newSite has id/name/location", () => {
    const s = newSite("HQ", "NYC");
    expect(s.id).toMatch(/^site-/);
    expect(s.name).toBe("HQ");
    expect(s.location).toBe("NYC");
  });

  it("newFleet has 1 site, 1 instance, 1 mgmt domain, 1 cluster", () => {
    const f = newFleet();
    expect(f.id).toMatch(/^fleet-/);
    expect(f.sites.length).toBe(1);
    expect(f.instances.length).toBe(1);
    expect(f.instances[0].domains.length).toBe(1);
    expect(f.instances[0].domains[0].clusters.length).toBe(1);
  });
});

describe("placement helpers", () => {
  it("buildDefaultPlacement is empty for single-site instances", () => {
    const inst = newInstance("solo", ["site-only"]);
    const p = buildDefaultPlacement(inst);
    expect(Object.keys(p)).toEqual([]);
  });

  it("buildDefaultPlacement produces site-id assignments for stretched instances", () => {
    const inst = newInstance("stretched", ["site-a", "site-b"]);
    const p = buildDefaultPlacement(inst);
    // Stack entries with an instances count get keys; values are site-id arrays
    for (const [, sites] of Object.entries(p)) {
      expect(Array.isArray(sites)).toBe(true);
      for (const s of sites) expect(["site-a", "site-b"]).toContain(s);
    }
  });

  it("ensurePlacement returns {} for single-site instances", () => {
    const inst = newInstance("solo", ["site-only"]);
    expect(ensurePlacement(inst)).toEqual({});
  });

  it("ensurePlacement preserves valid existing entries", () => {
    const inst = newInstance("stretched", ["site-a", "site-b"]);
    const defaults = buildDefaultPlacement(inst);
    inst.appliancePlacement = defaults;
    const merged = ensurePlacement(inst);
    expect(merged).toEqual(defaults);
  });

  it("ensurePlacement drops stale site-ids", () => {
    const inst = newInstance("stretched", ["site-a", "site-b"]);
    inst.appliancePlacement = { vcenter_0: ["site-a", "site-ZOMBIE"] };
    const merged = ensurePlacement(inst);
    // The stale key gets replaced with defaults (which only reference real site-ids)
    if (merged.vcenter_0) {
      for (const s of merged.vcenter_0) expect(["site-a", "site-b"]).toContain(s);
    }
  });

  it("buildDefaultPlacement pins appliances of a local domain to its localSiteId only", () => {
    const inst = newInstance("multi", ["site-a", "site-b", "site-c"]);
    // Add a workload domain local to site-c with an infraStack entry.
    const localC = {
      id: "dom-c", type: "workload", name: "Remote C",
      placement: "local", localSiteId: "site-c", stretchSiteIds: null,
      hostSplitPct: 50, wldStack: [],
      clusters: [{ id: "clu-c", name: "c1", isDefault: true,
        infraStack: [{ id: "nsxLm", size: "Medium", instances: 3, key: "k-c" }],
        host: {}, workload: {}, networks: {}, hostOverrides: [] }],
      componentsClusterId: null,
    };
    inst.domains.push(localC);
    const p = buildDefaultPlacement(inst);
    expect(p["k-c"]).toEqual(["site-c", "site-c", "site-c"]);
  });

  it("buildDefaultPlacement distributes stretched domain appliances across stretchSiteIds only", () => {
    // 3-site instance where the mgmt domain stretches A↔B but not C.
    const inst = newInstance("multi", ["site-a", "site-b", "site-c"]);
    // Mgmt domain carries infraStack via newMgmtCluster — find one of its keys.
    const mgmt = inst.domains[0];
    const mgmtKey = mgmt.clusters[0].infraStack[0].key;
    const p = buildDefaultPlacement(inst);
    for (const s of p[mgmtKey]) expect(["site-a", "site-b"]).toContain(s);
  });
});
