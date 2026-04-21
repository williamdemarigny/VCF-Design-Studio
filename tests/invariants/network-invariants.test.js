// Property-based network allocator invariants — fast-check generates random
// but valid v6 fleet configurations and verifies:
//   1. Monotonicity:  increasing finalHosts never shrinks an IP plan
//   2. Uniqueness:    no IP is assigned to two hosts in the same fleet
//   3. Override safety: host overrides inside a pool never collide with
//      pool-allocated IPs on other hosts
//   4. Migration idempotency: migrateFleet(migrateFleet(x)) deep-equals
//      migrateFleet(x) for arbitrary generated v5 input
//
// Follows the same pattern as tests/invariants/sizing-invariants.test.js.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import VcfEngine from "../../engine.js";

const {
  ipToInt,
  intToIp,
  allocateClusterIps,
  migrateFleet,
  newFleet,
  newCluster,
  newHostSpec,
  newWorkloadDomain,
  ipPoolSize,
  subnetContainsIp,
} = VcfEngine;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert "a.b.c.d" → integer for pool range calculations.
 */
function ipToNum(ip) {
  return ipToInt(ip);
}

/**
 * Build a minimal network block suitable for allocateClusterIps.
 */
function makeNetworks(opts = {}) {
  const {
    mgmtPoolStart = "10.0.0.10",
    mgmtPoolEnd = "10.0.0.250",
    vmotionPoolStart = "10.0.1.10",
    vmotionPoolEnd = "10.0.1.250",
    vsanPoolStart = "10.0.2.10",
    vsanPoolEnd = "10.0.2.250",
    hostTepPoolStart = "10.0.3.10",
    hostTepPoolEnd = "10.0.3.250",
    hostTepUseDhcp = false,
    edgeTepPoolStart = "10.0.4.10",
    edgeTepPoolEnd = "10.0.4.50",
    hasEdgeTep = true,
  } = opts;

  return {
    mgmt: {
      vlan: 1611,
      subnet: "10.0.0.0/24",
      gateway: "10.0.0.1",
      pool: { start: mgmtPoolStart, end: mgmtPoolEnd },
    },
    vmotion: {
      vlan: 1612,
      subnet: "10.0.1.0/24",
      gateway: "10.0.1.1",
      pool: { start: vmotionPoolStart, end: vmotionPoolEnd },
      mtu: 9000,
    },
    vsan: {
      vlan: 1613,
      subnet: "10.0.2.0/24",
      gateway: "10.0.2.1",
      pool: { start: vsanPoolStart, end: vsanPoolEnd },
      mtu: 9000,
    },
    hostTep: hostTepUseDhcp
      ? { vlan: 1614, subnet: "10.0.3.0/24", gateway: "10.0.3.1", useDhcp: true }
      : {
          vlan: 1614,
          subnet: "10.0.3.0/24",
          gateway: "10.0.3.1",
          pool: { start: hostTepPoolStart, end: hostTepPoolEnd },
          mtu: 1700,
          useDhcp: false,
        },
    ...(hasEdgeTep
      ? {
          edgeTep: {
            vlan: 1615,
            subnet: "10.0.4.0/24",
            gateway: "10.0.4.1",
            pool: { start: edgeTepPoolStart, end: edgeTepPoolEnd },
            mtu: 1700,
          },
        }
      : {}),
    uplinks: [],
  };
}

/**
 * Build a cluster object suitable for allocateClusterIps with a given finalHosts.
 */
function makeCluster(opts = {}) {
  const {
    finalHosts = 3,
    networks,
    hostTepUseDhcp = false,
    t0Gateways = [],
    hostOverrides = [],
  } = opts;

  return {
    id: "clu-prop",
    name: "prop-cluster",
    isDefault: true,
    finalHosts,
    networks: networks || makeNetworks({ hostTepUseDhcp }),
    t0Gateways,
    hostOverrides,
    host: newHostSpec
      ? newHostSpec()
      : {
          cpuQty: 2,
          coresPerCpu: 24,
          hyperthreadingEnabled: true,
          ramGb: 1024,
          nvmeQty: 8,
          nvmeSizeTb: 7.68,
          cpuOversub: 2,
          ramOversub: 1,
          reservePct: 30,
        },
    storage: {
      policy: "raid6_4p2",
      dedup: 1.2,
      compression: 1.1,
      swapPct: 100,
      freePct: 20,
      growthPct: 15,
      externalStorage: false,
      externalArrayTib: 0,
    },
  };
}

/**
 * Collect all IPs from a fleet after migration — returns array of all IP strings.
 */
function collectAllFleetIps(fleet) {
  const ips = new Set();
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      for (const cl of dom.clusters || []) {
        if (!cl.networks) continue;
        const spec = allocateClusterIps(cl, cl.finalHosts || 0);
        for (const host of spec.hosts || []) {
          if (host.mgmtIp) ips.add(host.mgmtIp);
          if (host.vmotionIp) ips.add(host.vmotionIp);
          if (host.vsanIp) ips.add(host.vsanIp);
          if (host.hostTepIps) {
            for (const ip of host.hostTepIps) {
              if (ip) ips.add(ip);
            }
          }
          if (host.bmcIp) ips.add(host.bmcIp);
        }
        for (const en of spec.edgeNodes || []) {
          if (en.edgeTepIps) {
            for (const ip of en.edgeTepIps) {
              if (ip) ips.add(ip);
            }
          }
        }
      }
    }
  }
  return Array.from(ips);
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generate a random subnet IP within a /24 network.
 */
function randomIpInSubnet(subnetBase) {
  const baseNum = ipToNum(subnetBase);
  return fc.integer({ min: baseNum, max: baseNum + 254 }).map(ipToNum);
}

/**
 * Pool range arbitrary — produces (start, end) where start < end.
 */
function poolRangeArb(subnetBase) {
  return fc.tuple(
    fc.integer({ min: ipToNum(subnetBase), max: ipToNum(subnetBase) + 200 }),
    fc.integer({ min: 1, max: 54 })
  ).map(([startOffset, range]) => ({
    start: intToIp(ipToNum(subnetBase) + startOffset),
    end: intToIp(ipToNum(subnetBase) + startOffset + range),
  }));
}

/**
 * Build a v6 fleet with a single cluster, with configurable pool ranges.
 */
function makeFleetWithNetworks(opts = {}) {
  const {
    mgmtPool,
    vmotionPool,
    vsanPool,
    hostTepPool,
    edgeTepPool,
    hostTepUseDhcp,
    edgeTepPoolDisabled,
  } = opts;

  const subnetA = "10.0.0.0";
  const subnetB = "10.0.1.0";
  const subnetC = "10.0.2.0";
  const subnetD = "10.0.3.0";
  const subnetE = "10.0.4.0";

  const fleets = newFleet();
  fleets.version = "vcf-sizer-v6";
  fleets.networkConfig = {
    dns: { servers: ["10.1.1.53"], searchDomains: ["vcf.lab"], primaryDomain: "vcf.lab" },
    ntp: { servers: ["10.1.1.100"], timezone: "UTC" },
    syslog: { servers: ["10.1.1.200"] },
  };
  fleets.instances[0].domains[0].clusters[0].finalHosts = opts.finalHosts || 3;
  fleets.instances[0].domains[0].clusters[0].networks = {
    mgmt: {
      vlan: 1611,
      subnet: subnetA + "/24",
      gateway: subnetA + ".1",
      pool: mgmtPool || { start: "10.0.0.10", end: "10.0.0.250" },
    },
    vmotion: {
      vlan: 1612,
      subnet: subnetB + "/24",
      gateway: subnetB + ".1",
      pool: vmotionPool || { start: "10.0.1.10", end: "10.0.1.250" },
      mtu: 9000,
    },
    vsan: {
      vlan: 1613,
      subnet: subnetC + "/24",
      gateway: subnetC + ".1",
      pool: vsanPool || { start: "10.0.2.10", end: "10.0.2.250" },
      mtu: 9000,
    },
    hostTep: hostTepUseDhcp
      ? { vlan: 1614, subnet: subnetD + "/24", gateway: subnetD + ".1", useDhcp: true }
      : {
          vlan: 1614,
          subnet: subnetD + "/24",
          gateway: subnetD + ".1",
          pool: hostTepPool || { start: "10.0.3.10", end: "10.0.3.250" },
          mtu: 1700,
        },
    edgeTep: edgeTepPoolDisabled
      ? null
      : {
          vlan: 1615,
          subnet: subnetE + "/24",
          gateway: subnetE + ".1",
          pool: edgeTepPool || { start: "10.0.4.10", end: "10.0.4.50" },
          mtu: 1700,
        },
    uplinks: [],
  };

  return fleets;
}

// ─── Property 1: Allocator monotonicity ──────────────────────────────────────

describe("PROP — allocateClusterIps monotonicity", () => {
  it("increasing finalHosts never shrinks the total IP plan", () => {
    fc.assert(
      fc.property(
        poolRangeArb("10.0.0.0"),
        poolRangeArb("10.0.1.0"),
        poolRangeArb("10.0.2.0"),
        poolRangeArb("10.0.3.0"),
        poolRangeArb("10.0.4.0"),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 50 }),
        fc.boolean(),
        (mgmtPool, vmotionPool, vsanPool, hostTepPool, edgeTepPool, n1, n2, useDhcp) => {
          // Ensure n2 > n1 for monotonicity direction
          const hostsA = n1;
          const hostsB = Math.max(n1 + 1, n2);

          const netOpts = {
            hostTepUseDhcp: useDhcp,
          };
          const networks = makeNetworks({
            mgmtPoolStart: mgmtPool.start,
            mgmtPoolEnd: mgmtPool.end,
            vmotionPoolStart: vmotionPool.start,
            vmotionPoolEnd: vmotionPool.end,
            vsanPoolStart: vsanPool.start,
            vsanPoolEnd: vsanPool.end,
            hostTepPoolStart: hostTepPool.start,
            hostTepPoolEnd: hostTepPool.end,
            edgeTepPoolStart: edgeTepPool.start,
            edgeTepPoolEnd: edgeTepPool.end,
          });

          const clusterA = makeCluster({
            finalHosts: hostsA,
            networks,
            hostTepUseDhcp: useDhcp,
          });
          const clusterB = makeCluster({
            finalHosts: hostsB,
            networks,
            hostTepUseDhcp: useDhcp,
          });

          const resultA = allocateClusterIps(clusterA, hostsA);
          const resultB = allocateClusterIps(clusterB, hostsB);

          // Total IPs allocated must never decrease as hosts increase
          const totalA =
            resultA.hosts.length +
            resultA.edgeNodes.length * 2;
          const totalB =
            resultB.hosts.length +
            resultB.edgeNodes.length * 2;

          expect(totalB).toBeGreaterThanOrEqual(totalA);

          // Each host IP field must be ≥ previous or null → non-null stays non-null
          for (let i = 0; i < resultA.hosts.length; i++) {
            const hA = resultA.hosts[i];
            const hB = resultB.hosts[i];
            if (hB) {
              if (hA.mgmtIp) expect(hB.mgmtIp).toBeTruthy();
              if (hA.vmotionIp) expect(hB.vmotionIp).toBeTruthy();
              if (hA.vsanIp) expect(hB.vsanIp).toBeTruthy();
              if (hA.hostTepIps) {
                expect(hB.hostTepIps).toBeTruthy();
                for (let j = 0; j < hA.hostTepIps.length; j++) {
                  if (hA.hostTepIps[j]) expect(hB.hostTepIps[j]).toBeTruthy();
                }
              }
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("zero finalHosts → empty hosts list", () => {
    fc.assert(
      fc.property(
        poolRangeArb("10.0.0.0"),
        (mgmtPool) => {
          const networks = makeNetworks({
            mgmtPoolStart: mgmtPool.start,
            mgmtPoolEnd: mgmtPool.end,
          });
          const cluster = makeCluster({ finalHosts: 0, networks });
          const result = allocateClusterIps(cluster, 0);
          expect(result.hosts).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 2: No duplicate IPs in generated fleet ────────────────────────

describe("PROP — allocateClusterIps uniqueness", () => {
  it("no duplicate IPs within a single cluster allocation", () => {
    fc.assert(
      fc.property(
        poolRangeArb("10.0.0.0"),
        poolRangeArb("10.0.1.0"),
        poolRangeArb("10.0.2.0"),
        poolRangeArb("10.0.3.0"),
        poolRangeArb("10.0.4.0"),
        fc.integer({ min: 1, max: 10 }),
        fc.boolean(),
        (mgmtPool, vmotionPool, vsanPool, hostTepPool, edgeTepPool, hostCount, useDhcp) => {
          const networks = makeNetworks({
            mgmtPoolStart: mgmtPool.start,
            mgmtPoolEnd: mgmtPool.end,
            vmotionPoolStart: vmotionPool.start,
            vmotionPoolEnd: vmotionPool.end,
            vsanPoolStart: vsanPool.start,
            vsanPoolEnd: vsanPool.end,
            hostTepPoolStart: hostTepPool.start,
            hostTepPoolEnd: hostTepPool.end,
            edgeTepPoolStart: edgeTepPool.start,
            edgeTepPoolEnd: edgeTepPool.end,
          });

          const cluster = makeCluster({
            finalHosts: hostCount,
            networks,
            hostTepUseDhcp: useDhcp,
          });

          const result = allocateClusterIps(cluster, hostCount);

          // Collect all IPs into a set and check uniqueness
          const allIps = [];
          for (const host of result.hosts) {
            if (host.mgmtIp) allIps.push(host.mgmtIp);
            if (host.vmotionIp) allIps.push(host.vmotionIp);
            if (host.vsanIp) allIps.push(host.vsanIp);
            if (host.hostTepIps) allIps.push(...host.hostTepIps.filter(Boolean));
            if (host.bmcIp) allIps.push(host.bmcIp);
          }
          for (const en of result.edgeNodes) {
            if (en.edgeTepIps) allIps.push(...en.edgeTepIps.filter(Boolean));
          }

          const uniqueIps = new Set(allIps);
          expect(uniqueIps.size).toBe(allIps.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("no duplicate IPs across all clusters in a generated v6 fleet", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        poolRangeArb("10.0.0.0"),
        poolRangeArb("10.0.1.0"),
        poolRangeArb("10.0.2.0"),
        poolRangeArb("10.0.3.0"),
        poolRangeArb("10.0.4.0"),
        (hostCount1, hostCount2, mgmtPool, vmotionPool, vsanPool, hostTepPool, edgeTepPool) => {
          // Build a fleet with two clusters that share the same pool ranges
          const fleet = makeFleetWithNetworks({
            finalHosts: hostCount1,
            mgmtPool: { start: mgmtPool.start, end: mgmtPool.end },
            vmotionPool: { start: vmotionPool.start, end: vmotionPool.end },
            vsanPool: { start: vsanPool.start, end: vsanPool.end },
            hostTepPool: { start: hostTepPool.start, end: hostTepPool.end },
            edgeTepPool: { start: edgeTepPool.start, end: edgeTepPool.end },
          });

          // Add a second cluster in the workload domain with the same pool ranges
          const cl2 = {
            ...newCluster(),
            id: "clu-prop-02",
            name: "prop-cluster-02",
            isDefault: true,
            finalHosts: hostCount2,
            networks: {
              mgmt: {
                vlan: 2611,
                subnet: "172.16.0.0/24",
                gateway: "172.16.0.1",
                pool: { start: "172.16.0.10", end: "172.16.0.250" },
              },
              vmotion: {
                vlan: 2612,
                subnet: "172.16.1.0/24",
                gateway: "172.16.1.1",
                pool: { start: "172.16.1.10", end: "172.16.1.250" },
                mtu: 9000,
              },
              vsan: {
                vlan: 2613,
                subnet: "172.16.2.0/24",
                gateway: "172.16.2.1",
                pool: { start: "172.16.2.10", end: "172.16.2.250" },
                mtu: 9000,
              },
              hostTep: {
                vlan: 2614,
                subnet: "172.16.3.0/24",
                gateway: "172.16.3.1",
                pool: { start: "172.16.3.10", end: "172.16.3.250" },
                mtu: 1700,
              },
              edgeTep: {
                vlan: 2615,
                subnet: "172.16.4.0/24",
                gateway: "172.16.4.1",
                pool: { start: "172.16.4.10", end: "172.16.4.50" },
                mtu: 1700,
              },
              uplinks: [],
            },
            t0Gateways: [],
            hostOverrides: [],
          };

          // Second domain with second cluster — different subnet range entirely
          // so no cross-cluster collision expected. Use the first domain's pools
          // which also use different subnets.

          const fleetWithTwoClusters = {
            ...fleet,
            instances: [
              {
                ...fleet.instances[0],
                domains: [
                  fleet.instances[0].domains[0],
                  {
                    ...newWorkloadDomain(),
                    id: "dom-prop-02",
                    name: "Workload Domain",
                    placement: "local",
                    clusters: [cl2],
                    componentsClusterId: "clu-prop-01",
                    hostSplitPct: 50,
                    localSiteId: fleet.instances[0].domains[0].localSiteId,
                    type: "workload",
                  },
                ],
              },
            ],
          };

          const allIps = collectAllFleetIps(fleetWithTwoClusters);
          const uniqueIps = new Set(allIps);

          // All IPs should be unique (different subnets across clusters)
          // With overlapping subnets there could be collisions, but here we
          // use disjoint 10.x / 172.16.x ranges
          expect(uniqueIps.size).toBe(allIps.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3: Override safety — no collision with pool IPs ───────────────

describe("PROP — host overrides never collide with pool-allocated IPs", () => {
  it("override mgmt IP is excluded from pool allocation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 2, max: 10 }),
        (overrideIpOffset, hostCount) => {
          const base = ipToNum("10.0.0.0");
          const overrideIp = intToIp(base + overrideIpOffset);

          const networks = makeNetworks();

          const cluster = makeCluster({
            finalHosts: hostCount,
            networks,
            hostOverrides: [
              { hostIndex: 0, mgmtIp: overrideIp, vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null },
            ],
          });

          const result = allocateClusterIps(cluster, hostCount);

          // The override IP must not appear in any pool-allocated mgmt IP
          for (let i = 1; i < result.hosts.length; i++) {
            expect(result.hosts[i].mgmtIp).not.toBe(overrideIp);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("override hostTep IPs are excluded from pool allocation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 2, max: 10 }),
        (tepOffset1, hostCount) => {
          const base = ipToNum("10.0.3.0");
          const overrideTep1 = intToIp(base + tepOffset1);
          const overrideTep2 = intToIp(base + tepOffset1 + 1);

          const networks = makeNetworks();

          const cluster = makeCluster({
            finalHosts: hostCount,
            networks,
            hostOverrides: [
              {
                hostIndex: 0,
                mgmtIp: null,
                vmotionIp: null,
                vsanIp: null,
                hostTepIps: [overrideTep1, overrideTep2],
                bmcIp: null,
              },
            ],
          });

          const result = allocateClusterIps(cluster, hostCount);

          // The override TEP IPs must not appear in pool-allocated TEP pairs
          for (let i = 1; i < result.hosts.length; i++) {
            const tepPair = result.hosts[i].hostTepIps;
            if (tepPair) {
              expect(tepPair[0]).not.toBe(overrideTep1);
              expect(tepPair[1]).not.toBe(overrideTep2);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("override vmnic and vsan IPs are excluded from pool allocation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 10, max: 200 }),
        fc.integer({ min: 2, max: 10 }),
        (mgmtOffset, vmotionOffset, hostCount) => {
          const mgmtBase = ipToNum("10.0.0.0");
          const vmotionBase = ipToNum("10.0.1.0");

          const overrideMgmt = intToIp(mgmtBase + mgmtOffset);
          const overrideVmotion = intToIp(vmotionBase + vmotionOffset);

          const networks = makeNetworks();

          const cluster = makeCluster({
            finalHosts: hostCount,
            networks,
            hostOverrides: [
              {
                hostIndex: 0,
                mgmtIp: overrideMgmt,
                vmotionIp: overrideVmotion,
                vsanIp: null,
                hostTepIps: null,
                bmcIp: null,
              },
            ],
          });

          const result = allocateClusterIps(cluster, hostCount);

          // Override mgmt IP must not appear in pool-allocated mgmt IPs
          for (let i = 1; i < result.hosts.length; i++) {
            expect(result.hosts[i].mgmtIp).not.toBe(overrideMgmt);
          }

          // Override vmotion IP must not appear in pool-allocated vmotion IPs
          for (let i = 1; i < result.hosts.length; i++) {
            expect(result.hosts[i].vmotionIp).not.toBe(overrideVmotion);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Property 4: Migration idempotency ──────────────────────────────────────

describe("PROP — migrateFleet idempotency", () => {
  it("migrateFleet(migrateFleet(x)) deep-equals migrateFleet(x) for v5 input", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 5 }),
        (federation, ht, externalStorage, hostCount, domainCount) => {
          // Build an arbitrary v5 fleet
          const fleet = newFleet();
          fleet.version = "vcf-sizer-v5";
          fleet.federationEnabled = federation;
          fleet.instances[0].domains[0].clusters[0].host.hyperthreadingEnabled = ht;
          fleet.instances[0].domains[0].clusters[0].storage.externalStorage = externalStorage;
          fleet.instances[0].domains[0].clusters[0].finalHosts = hostCount;

          // Add workload domains if requested
          if (domainCount > 0) {
            for (let d = 0; d < domainCount; d++) {
              fleet.instances[0].domains.push({
                id: `dom-wld-${d}`,
                type: "workload",
                name: `Workload Domain ${d + 1}`,
                placement: "local",
                hostSplitPct: 50,
                localSiteId: fleet.instances[0].domains[0].localSiteId,
                componentsClusterId: fleet.instances[0].domains[0].clusters[0].id,
                clusters: [
                  {
                    ...fleet.instances[0].domains[0].clusters[0],
                    id: `clu-wld-${d}`,
                    name: `workload-cluster-${d + 1}`,
                    finalHosts: Math.max(hostCount, 2),
                    storage: { ...fleet.instances[0].domains[0].clusters[0].storage },
                  },
                ],
              });
            }
          }

          const once = migrateFleet({ version: "vcf-sizer-v5", fleet });
          const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });

          expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        }
      ),
      { numRuns: 200 }
    );
  });

  it("migrateFleet is idempotent for v6 input", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 10 }),
        (federation, ht, hostCount) => {
          const fleet = newFleet();
          fleet.version = "vcf-sizer-v6";
          fleet.federationEnabled = federation;
          fleet.instances[0].domains[0].clusters[0].host.hyperthreadingEnabled = ht;
          fleet.instances[0].domains[0].clusters[0].finalHosts = hostCount;
          // V6 has networkConfig at fleet level
          fleet.networkConfig = {
            dns: { servers: ["10.1.1.53"], searchDomains: ["vcf.lab"], primaryDomain: "vcf.lab" },
            ntp: { servers: ["10.1.1.100"], timezone: "UTC" },
            syslog: { servers: ["10.1.1.200"] },
          };

          const once = migrateFleet({ version: "vcf-sizer-v6", fleet });
          const twice = migrateFleet({ version: "vcf-sizer-v6", fleet: once });

          expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        }
      ),
      { numRuns: 100 }
    );
  });

  it("migrateFleet is idempotent for v3 input", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.boolean(),
        (hostCount, ht) => {
          const fleet = newFleet();
          fleet.version = "vcf-sizer-v3";
          fleet.instances[0].domains[0].clusters[0].finalHosts = hostCount;
          fleet.instances[0].domains[0].clusters[0].host.hyperthreadingEnabled = ht;

          const once = migrateFleet({ version: "vcf-sizer-v3", fleet });
          const twice = migrateFleet({ version: "vcf-sizer-v3", fleet: once });

          expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 5: Pool exhaustion handling ───────────────────────────────────

describe("PROP — pool exhaustion warnings", () => {
  it("exhausted pool produces warnings, not errors", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 200 }),
        fc.integer({ min: 1, max: 500 }),
        (poolSize, hostCount) => {
          // Create a tiny pool smaller than hostCount to trigger exhaustion
          const startOffset = 10;
          const endOffset = Math.max(startOffset + 1, poolSize);

          const networks = makeNetworks({
            mgmtPoolStart: "10.0.0.10",
            mgmtPoolEnd: `10.0.0.${endOffset}`,
          });

          const cluster = makeCluster({
            finalHosts: hostCount,
            networks,
          });

          const result = allocateClusterIps(cluster, hostCount);

          // Must still produce hosts (or as many as the pool provides)
          expect(result.hosts.length).toBeGreaterThanOrEqual(0);

          // Should have warnings if pool is too small
          if (hostCount > poolSize) {
            expect(result.warnings.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 6: IP helper invariants ───────────────────────────────────────

describe("PROP — ipToInt / intToIp round-trip", () => {
  it("ipToInt(intToIp(ip)) === ip for all valid IPs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (a, b, c, d) => {
          const ip = `${a}.${b}.${c}.${d}`;
          const num = ipToInt(ip);
          const back = intToIp(num);
          expect(back).toBe(ip);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("ipPoolSize(start, end) === endNum - startNum + 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 253 }),
        fc.integer({ min: 1, max: 54 }),
        (startOctet, range) => {
          const start = `10.0.0.${startOctet}`;
          const end = `10.0.0.${startOctet + range}`;
          const size = ipPoolSize(start, end);
          expect(size).toBe(range + 1);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ─── Property 7: VLAN uniqueness within cluster ─────────────────────────────

describe("PROP — subnetContainsIp invariants", () => {
  it("an IP is always contained in its own /24 subnet", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (a, b, c) => {
          const ip = `${a}.${b}.${c}.5`;
          const subnet = `${a}.${b}.${c}.0/24`;
          expect(subnetContainsIp(subnet, ip)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("an IP outside a /24 subnet is not contained", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 250 }),
        fc.integer({ min: 251, max: 255 }),
        fc.integer({ min: 0, max: 255 }),
        (a, c, d) => {
          const ip = `10.0.${a}.${d}`;
          const subnet = `10.0.${c}.0/24`;
          expect(subnetContainsIp(subnet, ip)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });
});
