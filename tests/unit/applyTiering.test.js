import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { applyTiering, sizeHost, NVME_TIER_PARTITION_CAP_GB } = VcfEngine;

const baseHost = {
  cpuQty: 2, coresPerCpu: 16, hyperthreadingEnabled: false,
  ramGb: 1024, nvmeQty: 6, nvmeSizeTb: 7.68,
  cpuOversub: 2, ramOversub: 1, reservePct: 30,
};

describe("applyTiering — disabled path", () => {
  it("passes through when tiering.enabled is false", () => {
    const hostBase = sizeHost(baseHost);
    const r = applyTiering(baseHost, hostBase, 800, { enabled: false });
    expect(r.effectiveRamPerHost).toBe(hostBase.usableRam);
    expect(r.tieredDemandRamGb).toBe(800);
    expect(r.tierPartitionGb).toBe(0);
    expect(r.activeRatio).toBe(0);
  });
});

describe("applyTiering — enabled path", () => {
  it("computes tier partition from nvmePct of physical RAM", () => {
    const hostBase = sizeHost(baseHost);
    // 1024 * 50% = 512 (well under 4 TB cap and well under 7.68 TB drive cap)
    const r = applyTiering(baseHost, hostBase, 800, {
      enabled: true, nvmePct: 50, eligibilityPct: 100, tierDriveSizeTb: 7.68,
    });
    expect(r.tierPartitionGb).toBe(512);
    expect(r.activeRatio).toBe(0.5);
  });

  it("clamps partition at NVME_TIER_PARTITION_CAP_GB (4 TB)", () => {
    expect(NVME_TIER_PARTITION_CAP_GB).toBe(4096);
    const bigHost = { ...baseHost, ramGb: 16384 };
    const hostBase = sizeHost(bigHost);
    // 16384 * 50% = 8192 → clamped to 4096
    const r = applyTiering(bigHost, hostBase, 800, {
      enabled: true, nvmePct: 50, eligibilityPct: 100, tierDriveSizeTb: 8,
    });
    expect(r.tierPartitionGb).toBe(NVME_TIER_PARTITION_CAP_GB);
  });

  it("clamps partition at drive capacity when drive < cap", () => {
    const hostBase = sizeHost(baseHost);
    // drive cap = 0.5 TB = 500 GB; requested = 1024 * 100% = 1024 → clamped to 500
    const r = applyTiering(baseHost, hostBase, 800, {
      enabled: true, nvmePct: 100, eligibilityPct: 100, tierDriveSizeTb: 0.5,
    });
    expect(r.tierPartitionGb).toBe(500);
  });

  it("effectiveRamPerHost increases with active ratio", () => {
    const hostBase = sizeHost(baseHost);
    const off = applyTiering(baseHost, hostBase, 800, { enabled: false });
    const on  = applyTiering(baseHost, hostBase, 800, {
      enabled: true, nvmePct: 50, eligibilityPct: 100, tierDriveSizeTb: 7.68,
    });
    expect(on.effectiveRamPerHost).toBeGreaterThan(off.effectiveRamPerHost);
    // 1024 * (1 + 0.5) * 1 * (1 - 0.3) = 1075.2
    expect(on.effectiveRamPerHost).toBeCloseTo(1075.2, 6);
  });

  it("eligibilityPct splits demand between tiered and untiered", () => {
    const hostBase = sizeHost(baseHost);
    // 800 GB demand, 50% eligible = 400 tiered + 400 untiered
    // active ratio 0.5 → tiered eligible = 400 / 1.5 ≈ 266.67
    // tieredDemandRamGb = 266.67 + 400 = 666.67
    const r = applyTiering(baseHost, hostBase, 800, {
      enabled: true, nvmePct: 50, eligibilityPct: 50, tierDriveSizeTb: 7.68,
    });
    expect(r.tieredDemandRamGb).toBeCloseTo(666.67, 1);
  });

  it("100% eligibility produces lowest tieredDemandRamGb", () => {
    const hostBase = sizeHost(baseHost);
    const cfg = { enabled: true, nvmePct: 50, tierDriveSizeTb: 7.68 };
    const r100 = applyTiering(baseHost, hostBase, 800, { ...cfg, eligibilityPct: 100 });
    const r50  = applyTiering(baseHost, hostBase, 800, { ...cfg, eligibilityPct: 50  });
    const r0   = applyTiering(baseHost, hostBase, 800, { ...cfg, eligibilityPct: 0   });
    expect(r100.tieredDemandRamGb).toBeLessThan(r50.tieredDemandRamGb);
    expect(r50.tieredDemandRamGb).toBeLessThan(r0.tieredDemandRamGb);
    expect(r0.tieredDemandRamGb).toBe(800);  // nothing tiered
  });
});
