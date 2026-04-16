import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { sizeStoragePipeline, POLICIES } = VcfEngine;

const baseSettings = {
  policy: "raid5_2p1", dedup: 1.0, compression: 1.0,
  swapPct: 100, freePct: 25, growthPct: 15,
  externalStorage: false, externalArrayTib: 0,
};

describe("sizeStoragePipeline — stages", () => {
  it("computes DRR = dedup * compression", () => {
    const r = sizeStoragePipeline(1000, 500, { ...baseSettings, dedup: 2.0, compression: 1.5 });
    expect(r.drr).toBe(3.0);
    expect(r.vmCapGb).toBeCloseTo(1000 / 3.0, 6);
  });

  it("DRR = 1.0 means no reduction", () => {
    const r = sizeStoragePipeline(1000, 500, baseSettings);
    expect(r.drr).toBe(1.0);
    expect(r.vmCapGb).toBe(1000);
  });

  it("swap = ramGb * swapPct / 100", () => {
    expect(sizeStoragePipeline(1000, 500, { ...baseSettings, swapPct: 100 }).swapGb).toBe(500);
    expect(sizeStoragePipeline(1000, 500, { ...baseSettings, swapPct: 50  }).swapGb).toBe(250);
    expect(sizeStoragePipeline(1000, 500, { ...baseSettings, swapPct: 0   }).swapGb).toBe(0);
  });

  it("interim = vmCap + swap", () => {
    const r = sizeStoragePipeline(1000, 500, baseSettings);
    expect(r.interimGb).toBe(r.vmCapGb + r.swapGb);
  });

  it("applies protection factor from POLICIES table", () => {
    for (const [policy, def] of Object.entries(POLICIES)) {
      const r = sizeStoragePipeline(1000, 500, { ...baseSettings, policy });
      expect(r.pf).toBe(def.pf);
      expect(r.protectedGb).toBeCloseTo(r.interimGb * def.pf, 6);
    }
  });

  it("applies free-space buffer multiplicatively", () => {
    const r = sizeStoragePipeline(1000, 500, { ...baseSettings, freePct: 25 });
    expect(r.withFreeGb).toBeCloseTo(r.protectedGb * 1.25, 6);
  });

  it("applies growth headroom multiplicatively", () => {
    const r = sizeStoragePipeline(1000, 500, { ...baseSettings, growthPct: 15 });
    expect(r.totalReqGb).toBeCloseTo(r.withFreeGb * 1.15, 6);
  });

  it("end-to-end: full math reproduces", () => {
    // 1000 disk, 500 ram, dedup=2, compression=1.25, swap=100%, policy=mirror_ftt2 (pf=3),
    // free=25%, growth=20%
    const r = sizeStoragePipeline(1000, 500, {
      policy: "mirror_ftt2", dedup: 2, compression: 1.25,
      swapPct: 100, freePct: 25, growthPct: 20,
      externalStorage: false, externalArrayTib: 0,
    });
    // DRR = 2.5 → vmCap = 400; swap = 500; interim = 900; pf = 3 → 2700;
    // free = 2700 * 1.25 = 3375; growth = 3375 * 1.2 = 4050
    expect(r.totalReqGb).toBeCloseTo(4050, 6);
  });
});

describe("sizeStoragePipeline — boundaries", () => {
  it("zero swap removes the swap term", () => {
    const r = sizeStoragePipeline(1000, 500, { ...baseSettings, swapPct: 0 });
    expect(r.swapGb).toBe(0);
    expect(r.interimGb).toBe(r.vmCapGb);
  });

  it("zero free + zero growth gives interim * pf as final", () => {
    const r = sizeStoragePipeline(1000, 500, { ...baseSettings, freePct: 0, growthPct: 0, swapPct: 0 });
    expect(r.totalReqGb).toBeCloseTo(r.interimGb * r.pf, 6);
  });

  it("zero workload → zero everywhere", () => {
    const r = sizeStoragePipeline(0, 0, baseSettings);
    expect(r.vmCapGb).toBe(0);
    expect(r.totalReqGb).toBe(0);
  });
});
