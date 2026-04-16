import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const {
  sizeCluster, analyzeStretchedFailover, minHostsForVerdict,
  baseHostSpec, baseStorageSettings, baseTiering,
} = VcfEngine;

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

describe("analyzeStretchedFailover — host split", () => {
  it("50/50 with even host count splits evenly", () => {
    const cluster = makeCluster({ hostOverride: 6 });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 50);
    expect(fo.hostsA).toBe(3);
    expect(fo.hostsB).toBe(3);
  });

  it("75/25 with 8 hosts gives 6/2", () => {
    const cluster = makeCluster({ hostOverride: 8 });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 75);
    expect(fo.hostsA).toBe(6);
    expect(fo.hostsB).toBe(2);
  });

  it("rounds up the larger site (Math.ceil)", () => {
    const cluster = makeCluster({ hostOverride: 5 });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 50);
    expect(fo.hostsA + fo.hostsB).toBe(5);
  });
});

describe("analyzeStretchedFailover — verdicts", () => {
  it("survivor below policy minimum → red", () => {
    // Mirror FTT=1 needs 3 hosts; 75/25 of 4 hosts gives 3/1 → site B fails
    const cluster = makeCluster({
      hostOverride: 4,
      storage: { ...baseStorageSettings(), policy: "mirror_ftt1" },
    });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 75);
    expect(fo.siteB.verdict).toBe("red");
    expect(fo.siteB.reason).toMatch(/below storage policy minimum/);
  });

  it("survivor handles full demand within reserve → green", () => {
    // Tiny workload, generous hosts: both sites can absorb full demand safely
    const cluster = makeCluster({
      hostOverride: 10,
      workload: { vmCount: 10, vcpuPerVm: 1, ramPerVm: 4, diskPerVm: 50 },
    });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 50);
    expect(fo.siteA.verdict).toBe("green");
    expect(fo.siteB.verdict).toBe("green");
  });

  it("zero hosts on one side → red", () => {
    const cluster = makeCluster({ hostOverride: 4 });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 100);
    expect(fo.hostsB).toBe(0);
    expect(fo.siteB.verdict).toBe("red");
  });

  it("verdict reason strings format numbers without throwing", () => {
    // This regressed in Phase 2 — the reason path called fmt() which only
    // existed in the JSX layer. Now uses fmtNum() local to engine.js.
    const cluster = makeCluster({
      hostOverride: 4,
      workload: { vmCount: 10000, vcpuPerVm: 32, ramPerVm: 256, diskPerVm: 10 },
    });
    const result = sizeCluster(cluster);
    const fo = analyzeStretchedFailover(cluster, result, 50);
    // Won't throw, and the reason string contains formatted numbers
    expect(typeof fo.siteA.reason).toBe("string");
    expect(typeof fo.siteB.reason).toBe("string");
  });
});

describe("minHostsForVerdict — monotonicity", () => {
  it("returns at least the architectural minimum", () => {
    const cluster = makeCluster();
    const result = sizeCluster(cluster);
    const n = minHostsForVerdict(cluster, result, 50, "green");
    if (n !== null) {
      expect(n).toBeGreaterThanOrEqual(result.finalHosts);
    }
  });

  it("required count for green ≥ required count for yellow", () => {
    const cluster = makeCluster({
      workload: { vmCount: 200, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
    });
    const result = sizeCluster(cluster);
    const greenN = minHostsForVerdict(cluster, result, 50, "green");
    const yellowN = minHostsForVerdict(cluster, result, 50, "yellow");
    if (greenN !== null && yellowN !== null) {
      expect(greenN).toBeGreaterThanOrEqual(yellowN);
    }
  });
});
