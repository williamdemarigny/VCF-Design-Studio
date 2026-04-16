import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { sizeHost } = VcfEngine;

const baseHost = {
  cpuQty: 2, coresPerCpu: 16, hyperthreadingEnabled: false,
  ramGb: 1024, nvmeQty: 6, nvmeSizeTb: 7.68,
  cpuOversub: 2, ramOversub: 1, reservePct: 30,
};

describe("sizeHost — physical capacity math", () => {
  it("returns physical cores = cpuQty * coresPerCpu", () => {
    expect(sizeHost({ ...baseHost, cpuQty: 2, coresPerCpu: 16 }).cores).toBe(32);
    expect(sizeHost({ ...baseHost, cpuQty: 4, coresPerCpu: 24 }).cores).toBe(96);
    expect(sizeHost({ ...baseHost, cpuQty: 1, coresPerCpu: 64 }).cores).toBe(64);
  });

  it("returns rawGb = nvmeQty * nvmeSizeTb * 1000", () => {
    expect(sizeHost({ ...baseHost, nvmeQty: 6, nvmeSizeTb: 7.68 }).rawGb).toBeCloseTo(46080, 6);
    expect(sizeHost({ ...baseHost, nvmeQty: 4, nvmeSizeTb: 3.84 }).rawGb).toBeCloseTo(15360, 6);
  });

  it("computes usableVcpu = threads * cpuOversub * (1 - reservePct/100)", () => {
    // 32 cores * 2 oversub * 0.70 = 44.8
    expect(sizeHost({ ...baseHost, cpuOversub: 2, reservePct: 30 }).usableVcpu).toBeCloseTo(44.8, 6);
    // No oversub, no reserve: pure physical
    expect(sizeHost({ ...baseHost, cpuOversub: 1, reservePct: 0 }).usableVcpu).toBeCloseTo(32, 6);
    // Heavy oversub
    expect(sizeHost({ ...baseHost, cpuOversub: 8, reservePct: 0 }).usableVcpu).toBeCloseTo(256, 6);
  });

  it("computes usableRam = ramGb * ramOversub * (1 - reservePct/100)", () => {
    expect(sizeHost({ ...baseHost, ramGb: 1024, ramOversub: 1, reservePct: 30 }).usableRam).toBeCloseTo(716.8, 6);
    expect(sizeHost({ ...baseHost, ramGb: 1024, ramOversub: 1.5, reservePct: 0 }).usableRam).toBeCloseTo(1536, 6);
  });
});

describe("sizeHost — hyperthreading", () => {
  it("doubles threads when HT enabled, leaves cores unchanged", () => {
    const off = sizeHost({ ...baseHost, hyperthreadingEnabled: false });
    const on  = sizeHost({ ...baseHost, hyperthreadingEnabled: true });
    expect(on.cores).toBe(off.cores);
    expect(on.threads).toBe(off.threads * 2);
    expect(off.threads).toBe(off.cores);
  });

  it("doubles usableVcpu when HT enabled", () => {
    const off = sizeHost({ ...baseHost, hyperthreadingEnabled: false });
    const on  = sizeHost({ ...baseHost, hyperthreadingEnabled: true });
    expect(on.usableVcpu).toBeCloseTo(off.usableVcpu * 2, 6);
  });

  it("leaves usableRam unchanged when HT toggled", () => {
    const off = sizeHost({ ...baseHost, hyperthreadingEnabled: false });
    const on  = sizeHost({ ...baseHost, hyperthreadingEnabled: true });
    expect(on.usableRam).toBe(off.usableRam);
  });

  it("treats undefined hyperthreadingEnabled as false (back-compat)", () => {
    const { hyperthreadingEnabled: _omit, ...noHtField } = baseHost;
    const result = sizeHost(noHtField);
    expect(result.threads).toBe(result.cores);
  });
});

describe("sizeHost — boundary conditions", () => {
  it("handles 100% reserve → zero usable capacity", () => {
    const r = sizeHost({ ...baseHost, reservePct: 100 });
    expect(r.usableVcpu).toBe(0);
    expect(r.usableRam).toBe(0);
  });

  it("handles 0% reserve → full nominal capacity", () => {
    const r = sizeHost({ ...baseHost, reservePct: 0, cpuOversub: 1, ramOversub: 1 });
    expect(r.usableVcpu).toBe(r.cores);
    expect(r.usableRam).toBe(baseHost.ramGb);
  });
});
