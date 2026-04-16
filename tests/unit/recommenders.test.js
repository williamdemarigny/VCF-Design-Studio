import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { recommendVcenterSize, recommendNsxSize, SIZING_LIMITS } = VcfEngine;

describe("recommendVcenterSize", () => {
  it("returns Tiny for ≤10 hosts and ≤100 VMs", () => {
    expect(recommendVcenterSize(1, 10)).toBe("Tiny");
    expect(recommendVcenterSize(10, 100)).toBe("Tiny");
  });

  it("escalates to Small at >10 hosts", () => {
    expect(recommendVcenterSize(11, 100)).toBe("Small");
  });

  it("escalates to Small at >100 VMs", () => {
    expect(recommendVcenterSize(10, 101)).toBe("Small");
  });

  it("escalates through Medium / Large / XLarge as scale grows", () => {
    expect(recommendVcenterSize(101, 1000)).toBe("Medium");
    expect(recommendVcenterSize(401, 4000)).toBe("Large");
    expect(recommendVcenterSize(1001, 10000)).toBe("XLarge");
  });

  it("returns XLarge above all documented limits", () => {
    expect(recommendVcenterSize(99999, 99999)).toBe("XLarge");
  });
});

describe("recommendNsxSize", () => {
  it("returns Medium for production at low scale", () => {
    expect(recommendNsxSize(1, 1)).toBe("Medium");
    expect(recommendNsxSize(128, 5)).toBe("Medium");
  });

  it("escalates to Large at >128 hosts", () => {
    expect(recommendNsxSize(129, 5)).toBe("Large");
  });

  it("escalates to Large at >5 clusters", () => {
    expect(recommendNsxSize(128, 6)).toBe("Large");
  });

  it("escalates to XLarge above Large limits", () => {
    expect(recommendNsxSize(1025, 256)).toBe("XLarge");
    expect(recommendNsxSize(1024, 257)).toBe("XLarge");
  });

  it("returns XLarge above all documented limits", () => {
    expect(recommendNsxSize(99999, 99999)).toBe("XLarge");
  });
});
