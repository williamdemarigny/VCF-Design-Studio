import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { sizeCluster, baseHostSpec, baseStorageSettings, baseTiering, POLICIES } = VcfEngine;

const makeCluster = (overrides = {}) => ({
  id: "clu-test",
  name: "test-cluster",
  isDefault: true,
  host: baseHostSpec(),
  workload: { vmCount: 0, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
  infraStack: [],
  storage: baseStorageSettings(),
  tiering: baseTiering(),
  hostOverride: 0,
  ...overrides,
});

describe("sizeCluster — limiter selection", () => {
  it("Policy limiter wins on an empty workload (only floor non-zero is policyMin)", () => {
    const r = sizeCluster(makeCluster());
    expect(r.limiter).toBe("Policy");
    expect(r.finalHosts).toBe(POLICIES.raid5_2p1.minHosts);
  });

  it("Compute limiter wins under heavy CPU demand", () => {
    const r = sizeCluster(makeCluster({
      workload: { vmCount: 5000, vcpuPerVm: 8, ramPerVm: 1, diskPerVm: 1 },
    }));
    expect(r.limiter).toBe("Compute");
    expect(r.finalHosts).toBe(r.floors.cpuHosts);
  });

  it("Memory limiter wins under heavy RAM demand", () => {
    const r = sizeCluster(makeCluster({
      workload: { vmCount: 1000, vcpuPerVm: 1, ramPerVm: 256, diskPerVm: 1 },
    }));
    expect(r.limiter).toBe("Memory");
  });

  it("Storage limiter wins under heavy disk demand", () => {
    const r = sizeCluster(makeCluster({
      workload: { vmCount: 5000, vcpuPerVm: 1, ramPerVm: 1, diskPerVm: 2000 },
    }));
    expect(r.limiter).toBe("Storage");
  });

  it("Manual override wins when set above all architectural floors", () => {
    const r = sizeCluster(makeCluster({ hostOverride: 99 }));
    expect(r.limiter).toBe("Manual");
    expect(r.finalHosts).toBe(99);
  });

  it("Manual override loses to higher architectural floor", () => {
    const r = sizeCluster(makeCluster({
      hostOverride: 1,
      workload: { vmCount: 5000, vcpuPerVm: 8, ramPerVm: 1, diskPerVm: 1 },
    }));
    expect(r.limiter).not.toBe("Manual");
    expect(r.finalHosts).toBeGreaterThan(1);
  });
});

describe("sizeCluster — vsanMinWarning flag", () => {
  it("warns when finalHosts === 3 and policy.minHosts <= 3", () => {
    const r = sizeCluster(makeCluster({ storage: { ...baseStorageSettings(), policy: "raid5_2p1" } }));
    expect(r.finalHosts).toBe(3);
    expect(r.vsanMinWarning).toBe(true);
  });

  it("does not warn when finalHosts > 3", () => {
    const r = sizeCluster(makeCluster({
      hostOverride: 4,
      storage: { ...baseStorageSettings(), policy: "raid5_2p1" },
    }));
    expect(r.finalHosts).toBe(4);
    expect(r.vsanMinWarning).toBe(false);
  });

  it("does not warn for policies with minHosts > 3", () => {
    const r = sizeCluster(makeCluster({
      storage: { ...baseStorageSettings(), policy: "raid5_4p1" },
    }));
    expect(r.vsanMinWarning).toBe(false);
  });

  it("does not warn for external storage even at 3 hosts", () => {
    const r = sizeCluster(makeCluster({
      storage: { ...baseStorageSettings(), externalStorage: true, externalArrayTib: 100 },
    }));
    expect(r.vsanMinWarning).toBe(false);
  });
});

describe("sizeCluster — external storage", () => {
  it("zeros rawTib and skips storage floor", () => {
    const r = sizeCluster(makeCluster({
      storage: { ...baseStorageSettings(), externalStorage: true, externalArrayTib: 100 },
    }));
    expect(r.rawTib).toBe(0);
    expect(r.externalStorage).toBe(true);
    expect(r.pipeline).toBeNull();
  });

  it("includes storageHosts floor when external storage is off", () => {
    const r = sizeCluster(makeCluster());
    expect(r.pipeline).not.toBeNull();
  });
});

describe("sizeCluster — licensed cores", () => {
  it("licensedCores = finalHosts * physical cores (HT does not change it)", () => {
    const off = sizeCluster(makeCluster());
    const on  = sizeCluster(makeCluster({
      host: { ...baseHostSpec(), hyperthreadingEnabled: true },
    }));
    expect(off.licensedCores).toBe(off.finalHosts * off.host.cores);
    expect(on.licensedCores).toBe(on.finalHosts * on.host.cores);
  });
});

describe("sizeCluster — vsanMinWarning matrix on all 6 policies", () => {
  it.each(Object.entries(POLICIES))("%s flags warning iff minHosts<=3 AND finalHosts===3", (policyKey, policyDef) => {
    // Scenario A — empty workload, floor lifts to policy.minHosts only
    const r = sizeCluster(makeCluster({ storage: { ...baseStorageSettings(), policy: policyKey } }));
    expect(r.finalHosts).toBe(policyDef.minHosts);
    if (policyDef.minHosts === 3) {
      expect(r.vsanMinWarning).toBe(true);
    } else {
      expect(r.vsanMinWarning).toBe(false);
    }
  });
});
