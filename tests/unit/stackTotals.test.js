import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { stackTotals, APPLIANCE_DB } = VcfEngine;

describe("stackTotals — aggregation", () => {
  it("returns zeros for empty stack", () => {
    expect(stackTotals([])).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("returns zeros for null/undefined stack", () => {
    expect(stackTotals(undefined)).toEqual({ vcpu: 0, ram: 0, disk: 0 });
    expect(stackTotals(null)).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("sums vcpu/ram/disk across appliances", () => {
    const vc = APPLIANCE_DB.vcenter.sizes.Medium;
    const total = stackTotals([{ id: "vcenter", size: "Medium", instances: 1 }]);
    expect(total.vcpu).toBe(vc.vcpu);
    expect(total.ram).toBe(vc.ram);
    expect(total.disk).toBe(vc.disk);
  });

  it("multiplies by instances count", () => {
    const nsx = APPLIANCE_DB.nsxMgr.sizes.Medium;
    const total = stackTotals([{ id: "nsxMgr", size: "Medium", instances: 3 }]);
    expect(total.vcpu).toBe(nsx.vcpu * 3);
    expect(total.ram).toBe(nsx.ram * 3);
    expect(total.disk).toBe(nsx.disk * 3);
  });

  it("skips entries with unknown id", () => {
    const total = stackTotals([
      { id: "doesNotExist", size: "Medium", instances: 1 },
      { id: "vcenter", size: "Medium", instances: 1 },
    ]);
    const vc = APPLIANCE_DB.vcenter.sizes.Medium;
    expect(total.vcpu).toBe(vc.vcpu);
  });

  it("skips entries with unknown size", () => {
    const total = stackTotals([
      { id: "vcenter", size: "DoesNotExist", instances: 1 },
    ]);
    expect(total).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("skips entries with zero instances", () => {
    const total = stackTotals([
      { id: "vcenter", size: "Medium", instances: 0 },
    ]);
    expect(total).toEqual({ vcpu: 0, ram: 0, disk: 0 });
  });

  it("aggregates a multi-appliance stack", () => {
    const stack = [
      { id: "vcenter", size: "Medium", instances: 1 },
      { id: "nsxMgr",  size: "Medium", instances: 3 },
      { id: "sddcMgr", size: "Default", instances: 1 },
    ];
    const total = stackTotals(stack);
    let expectVcpu = 0, expectRam = 0, expectDisk = 0;
    for (const e of stack) {
      const sz = APPLIANCE_DB[e.id]?.sizes?.[e.size];
      if (!sz) continue;
      expectVcpu += sz.vcpu * e.instances;
      expectRam  += sz.ram  * e.instances;
      expectDisk += sz.disk * e.instances;
    }
    expect(total.vcpu).toBe(expectVcpu);
    expect(total.ram).toBe(expectRam);
    expect(total.disk).toBe(expectDisk);
  });
});
