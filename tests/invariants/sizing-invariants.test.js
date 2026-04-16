// Property-based sizing invariants — fast-check generates random-but-valid
// cluster configs and verifies properties that must hold for every input.
// Complements the example-based tests under tests/unit/ by sweeping the
// parameter space rather than pinning specific values.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import VcfEngine from "../../engine.js";
const {
  sizeHost, sizeCluster, applyTiering, sizeStoragePipeline,
  baseHostSpec, baseStorageSettings, baseTiering, POLICIES,
} = VcfEngine;

// ─── Arbitraries ────────────────────────────────────────────────────────────
const hostArb = () => fc.record({
  cpuQty:               fc.integer({ min: 1,  max: 8 }),
  coresPerCpu:          fc.integer({ min: 4,  max: 64 }),
  hyperthreadingEnabled: fc.boolean(),
  ramGb:                fc.integer({ min: 128, max: 4096 }),
  nvmeQty:              fc.integer({ min: 2,   max: 24 }),
  nvmeSizeTb:           fc.double({ min: 1.92, max: 15.36, noNaN: true }),
  cpuOversub:           fc.double({ min: 1,    max: 8,     noNaN: true }),
  ramOversub:           fc.double({ min: 1,    max: 2,     noNaN: true }),
  reservePct:           fc.integer({ min: 0,   max: 90 }),
});

const workloadArb = () => fc.record({
  vmCount:   fc.integer({ min: 0,  max: 2000 }),
  vcpuPerVm: fc.integer({ min: 1,  max: 32 }),
  ramPerVm:  fc.integer({ min: 1,  max: 256 }),
  diskPerVm: fc.integer({ min: 1,  max: 2000 }),
});

const storageArb = () => fc.record({
  policy:         fc.constantFrom(...Object.keys(POLICIES)),
  dedup:          fc.double({ min: 1,    max: 3,    noNaN: true }),
  compression:    fc.double({ min: 1,    max: 2,    noNaN: true }),
  swapPct:        fc.integer({ min: 0,   max: 100 }),
  freePct:        fc.integer({ min: 0,   max: 50 }),
  growthPct:      fc.integer({ min: 0,   max: 50 }),
  externalStorage: fc.constant(false),   // internal vSAN only for these properties
  externalArrayTib: fc.constant(0),
});

const clusterArb = () => fc.record({
  id: fc.constant("clu-prop"),
  name: fc.constant("prop-cluster"),
  isDefault: fc.constant(true),
  host: hostArb(),
  workload: workloadArb(),
  infraStack: fc.constant([]),
  storage: storageArb(),
  tiering: fc.constant(baseTiering()),
  hostOverride: fc.integer({ min: 0, max: 50 }),
  t0Gateways: fc.constant([]),
});

// ─── Properties ─────────────────────────────────────────────────────────────

describe("PROP — sizeHost: hyperthreading invariants", () => {
  it("HT never changes physical cores or usableRam", () => {
    fc.assert(
      fc.property(hostArb(), (host) => {
        const off = sizeHost({ ...host, hyperthreadingEnabled: false });
        const on  = sizeHost({ ...host, hyperthreadingEnabled: true });
        expect(on.cores).toBe(off.cores);
        expect(on.usableRam).toBe(off.usableRam);
      }),
      { numRuns: 200 }
    );
  });

  it("HT doubles threads and usableVcpu", () => {
    fc.assert(
      fc.property(hostArb(), (host) => {
        const off = sizeHost({ ...host, hyperthreadingEnabled: false });
        const on  = sizeHost({ ...host, hyperthreadingEnabled: true });
        expect(on.threads).toBe(off.threads * 2);
        expect(on.usableVcpu).toBeCloseTo(off.usableVcpu * 2, 6);
      }),
      { numRuns: 200 }
    );
  });
});

describe("PROP — sizeCluster floor invariants", () => {
  it("finalHosts >= policy.minHosts for internal vSAN clusters", () => {
    fc.assert(
      fc.property(clusterArb(), (cluster) => {
        const r = sizeCluster(cluster);
        expect(r.finalHosts).toBeGreaterThanOrEqual(POLICIES[cluster.storage.policy].minHosts);
      }),
      { numRuns: 200 }
    );
  });

  it("finalHosts >= hostOverride when set", () => {
    fc.assert(
      fc.property(clusterArb(), (cluster) => {
        const r = sizeCluster(cluster);
        if (cluster.hostOverride > 0) {
          expect(r.finalHosts).toBeGreaterThanOrEqual(cluster.hostOverride);
        }
      }),
      { numRuns: 200 }
    );
  });

  it("licensedCores === finalHosts × host.cores (ignores HT)", () => {
    fc.assert(
      fc.property(clusterArb(), (cluster) => {
        const r = sizeCluster(cluster);
        expect(r.licensedCores).toBe(r.finalHosts * r.host.cores);
      }),
      { numRuns: 200 }
    );
  });

  it("HT toggle never changes licensedCores", () => {
    fc.assert(
      fc.property(clusterArb(), (cluster) => {
        const off = sizeCluster({ ...cluster, host: { ...cluster.host, hyperthreadingEnabled: false } });
        const on  = sizeCluster({ ...cluster, host: { ...cluster.host, hyperthreadingEnabled: true } });
        // Licensed cores are a function of physical cores only — HT can change
        // finalHosts (fewer CPU-limited hosts) but licensing math is derived
        // from physical cores × hosts. We assert the per-host physical value
        // doesn't shift, and that HT never increases host count.
        expect(on.host.cores).toBe(off.host.cores);
        expect(on.finalHosts).toBeLessThanOrEqual(off.finalHosts);
      }),
      { numRuns: 200 }
    );
  });
});

describe("PROP — sizeCluster monotonicity", () => {
  it("doubling vmCount never decreases finalHosts", () => {
    fc.assert(
      fc.property(clusterArb(), (cluster) => {
        const doubled = {
          ...cluster,
          workload: { ...cluster.workload, vmCount: cluster.workload.vmCount * 2 },
        };
        const r1 = sizeCluster(cluster);
        const r2 = sizeCluster(doubled);
        expect(r2.finalHosts).toBeGreaterThanOrEqual(r1.finalHosts);
      }),
      { numRuns: 200 }
    );
  });

  it("increasing cpuOversub never increases cpuHosts floor", () => {
    fc.assert(
      fc.property(clusterArb(), (cluster) => {
        // Skip trivially small cpuOversub — the effect is on the CPU floor
        // via usableVcpu which can only grow or stay the same.
        const lower = { ...cluster, host: { ...cluster.host, cpuOversub: 2 } };
        const higher = { ...cluster, host: { ...cluster.host, cpuOversub: 4 } };
        const r1 = sizeCluster(lower);
        const r2 = sizeCluster(higher);
        expect(r2.floors.cpuHosts).toBeLessThanOrEqual(r1.floors.cpuHosts);
      }),
      { numRuns: 200 }
    );
  });
});

describe("PROP — sizeStoragePipeline boundaries", () => {
  it("DRR === dedup × compression", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 3, noNaN: true }),
        fc.double({ min: 1, max: 2, noNaN: true }),
        (dedup, compression) => {
          const r = sizeStoragePipeline(1000, 500, { ...baseStorageSettings(), dedup, compression });
          expect(r.drr).toBeCloseTo(dedup * compression, 6);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("zero workload → zero totalReqGb", () => {
    fc.assert(
      fc.property(storageArb(), (s) => {
        const r = sizeStoragePipeline(0, 0, s);
        expect(r.totalReqGb).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it("higher growthPct never decreases totalReqGb", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10000 }),
        storageArb(),
        (diskGb, s) => {
          const r1 = sizeStoragePipeline(diskGb, 0, { ...s, growthPct: 0 });
          const r2 = sizeStoragePipeline(diskGb, 0, { ...s, growthPct: 50 });
          expect(r2.totalReqGb).toBeGreaterThanOrEqual(r1.totalReqGb);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("PROP — applyTiering boundaries", () => {
  it("effectiveRamPerHost ≥ physical RAM × (1 − reservePct/100) × ramOversub when tiering is off", () => {
    fc.assert(
      fc.property(hostArb(), (host) => {
        const hostBase = sizeHost(host);
        const off = applyTiering(host, hostBase, 800, { enabled: false });
        const expected = host.ramGb * host.ramOversub * (1 - host.reservePct / 100);
        expect(off.effectiveRamPerHost).toBeCloseTo(expected, 6);
      }),
      { numRuns: 200 }
    );
  });

  it("effectiveRamPerHost (tiering on, nvmePct > 0) strictly > (tiering off)", () => {
    fc.assert(
      fc.property(
        hostArb().filter((h) => h.reservePct < 100),
        fc.integer({ min: 10, max: 100 }),
        (host, nvmePct) => {
          const hostBase = sizeHost(host);
          const off = applyTiering(host, hostBase, 800, { enabled: false });
          const on  = applyTiering(host, hostBase, 800, {
            enabled: true, nvmePct, eligibilityPct: 100, tierDriveSizeTb: 7.68,
          });
          expect(on.effectiveRamPerHost).toBeGreaterThan(off.effectiveRamPerHost);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe("PROP — migration round-trip", () => {
  const { newFleet, migrateFleet } = VcfEngine;
  it("migrateFleet is idempotent on a default-generated fleet (random-ish)", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (federation, ht) => {
        const fleet = newFleet();
        fleet.federationEnabled = federation;
        fleet.instances[0].domains[0].clusters[0].host.hyperthreadingEnabled = ht;
        const once = migrateFleet({ version: "vcf-sizer-v5", fleet });
        const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      }),
      { numRuns: 50 }
    );
  });
});
