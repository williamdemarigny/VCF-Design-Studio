import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  ipToInt, intToIp, ipPoolSize, subnetContainsIp,
  allocateClusterIps,
  createClusterNetworks, createHostIpOverride, newMgmtCluster,
} = VcfEngine;

// ─── IP UTILITY TESTS ────

describe("ipToInt and intToIp", () => {
  it("converts 10.0.0.1 to integer and back", () => {
    const n = ipToInt("10.0.0.1");
    expect(n).toBe(167772161);
    expect(intToIp(n)).toBe("10.0.0.1");
  });

  it("converts 255.255.255.255", () => {
    expect(ipToInt("255.255.255.255")).toBe(4294967295);
    expect(intToIp(4294967295)).toBe("255.255.255.255");
  });

  it("converts 0.0.0.0", () => {
    expect(ipToInt("0.0.0.0")).toBe(0);
    expect(intToIp(0)).toBe("0.0.0.0");
  });

  it("round-trips 192.168.1.100", () => {
    expect(intToIp(ipToInt("192.168.1.100"))).toBe("192.168.1.100");
  });
});

describe("ipPoolSize", () => {
  it("10.0.0.10 to 10.0.0.20 = 11", () => {
    expect(ipPoolSize("10.0.0.10", "10.0.0.20")).toBe(11);
  });

  it("same start and end = 1", () => {
    expect(ipPoolSize("10.0.0.5", "10.0.0.5")).toBe(1);
  });

  it("null start returns 0", () => {
    expect(ipPoolSize(null, "10.0.0.20")).toBe(0);
  });

  it("null end returns 0", () => {
    expect(ipPoolSize("10.0.0.10", null)).toBe(0);
  });
});

describe("subnetContainsIp", () => {
  it("10.0.0.5 is in 10.0.0.0/24", () => {
    expect(subnetContainsIp("10.0.0.0/24", "10.0.0.5")).toBe(true);
  });

  it("10.0.1.5 is NOT in 10.0.0.0/24", () => {
    expect(subnetContainsIp("10.0.0.0/24", "10.0.1.5")).toBe(false);
  });

  it("10.0.0.255 is in 10.0.0.0/24", () => {
    expect(subnetContainsIp("10.0.0.0/24", "10.0.0.255")).toBe(true);
  });

  it("192.168.1.1 is in 192.168.0.0/16", () => {
    expect(subnetContainsIp("192.168.0.0/16", "192.168.1.1")).toBe(true);
  });

  it("null subnet returns false", () => {
    expect(subnetContainsIp(null, "10.0.0.1")).toBe(false);
  });

  it("null ip returns false", () => {
    expect(subnetContainsIp("10.0.0.0/24", null)).toBe(false);
  });
});

// ─── ALLOCATOR TESTS ───

describe("allocateClusterIps - basic allocation", () => {
  function clusterWith(overrides) {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return { id: "test-cluster", networks: networks, t0Gateways: [], hostOverrides: [], ...overrides };
  }

  it("allocates sequential IPs for 4 hosts", () => {
    var result = allocateClusterIps(clusterWith({}), 4);
    expect(result.hosts).toHaveLength(4);
    expect(result.hosts[0].mgmtIp).toBe("10.0.0.10");
    expect(result.hosts[1].mgmtIp).toBe("10.0.0.11");
    expect(result.hosts[2].mgmtIp).toBe("10.0.0.12");
    expect(result.hosts[3].mgmtIp).toBe("10.0.0.13");
  });

  it("allocates vMotion IPs sequentially", () => {
    var result = allocateClusterIps(clusterWith({}), 2);
    expect(result.hosts[0].vmotionIp).toBe("10.0.1.10");
    expect(result.hosts[1].vmotionIp).toBe("10.0.1.11");
  });

  it("allocates vSAN IPs sequentially", () => {
    var result = allocateClusterIps(clusterWith({}), 2);
    expect(result.hosts[0].vsanIp).toBe("10.0.2.10");
    expect(result.hosts[1].vsanIp).toBe("10.0.2.11");
  });

  it("allocates 2 host-TEP IPs per host", () => {
    var result = allocateClusterIps(clusterWith({}), 2);
    expect(result.hosts[0].hostTepIps).toEqual(["10.0.3.10", "10.0.3.11"]);
    expect(result.hosts[1].hostTepIps).toEqual(["10.0.3.12", "10.0.3.13"]);
  });

  it("sets source to pool for non-override hosts", () => {
    var result = allocateClusterIps(clusterWith({}), 2);
    expect(result.hosts[0].source).toBe("pool");
    expect(result.hosts[1].source).toBe("pool");
  });

  it("returns empty hosts for 0 finalHosts", () => {
    var result = allocateClusterIps(clusterWith({}), 0);
    expect(result.hosts).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("is deterministic — same input produces same output", () => {
    var cluster = clusterWith({});
    var a = allocateClusterIps(cluster, 4);
    var b = allocateClusterIps(cluster, 4);
    expect(a).toEqual(b);
  });
});

describe("allocateClusterIps - overrides", () => {
  function clusterWithOverride() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return {
      id: "test-cluster",
      networks: networks,
      t0Gateways: [],
      hostOverrides: [{ hostIndex: 0, mgmtIp: "10.0.0.99", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null }],
    };
  }

  it("host 0 uses override mgmtIp", () => {
    var result = allocateClusterIps(clusterWithOverride(), 3);
    expect(result.hosts[0].mgmtIp).toBe("10.0.0.99");
    expect(result.hosts[0].source).toBe("override");
  });

  it("host 1 uses pool mgmtIp and skips the override IP", () => {
    var result = allocateClusterIps(clusterWithOverride(), 3);
    expect(result.hosts[1].mgmtIp).toBe("10.0.0.10");
    expect(result.hosts[1].source).toBe("pool");
  });

  it("override with null fields falls back to pool", () => {
    var result = allocateClusterIps(clusterWithOverride(), 3);
    expect(result.hosts[0].vmotionIp).toBe("10.0.1.10");
  });
});

describe("allocateClusterIps - DHCP for host TEP", () => {
  function clusterWithDhcpTep() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: true };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return { id: "test-cluster", networks: networks, t0Gateways: [], hostOverrides: [] };
  }

  it("hostTepIps is null when useDhcp is true", () => {
    var result = allocateClusterIps(clusterWithDhcpTep(), 2);
    expect(result.hosts[0].hostTepIps).toBeNull();
    expect(result.hosts[1].hostTepIps).toBeNull();
  });

  it("emits VCF-IP-019 info warning for DHCP", () => {
    var result = allocateClusterIps(clusterWithDhcpTep(), 2);
    expect(result.warnings.some(function(w) { return w.ruleId === "VCF-IP-019"; })).toBe(true);
  });
});

describe("allocateClusterIps - pool exhaustion", () => {
  function clusterWithTinyPool() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.12" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return { id: "test-cluster", networks: networks, t0Gateways: [], hostOverrides: [] };
  }

  it("emits VCF-IP-002 error when pool is too small", () => {
    var result = allocateClusterIps(clusterWithTinyPool(), 5);
    expect(result.warnings.some(function(w) { return w.ruleId === "VCF-IP-002" && w.severity === "error"; })).toBe(true);
  });

  it("allocates as many IPs as the pool allows", () => {
    var result = allocateClusterIps(clusterWithTinyPool(), 5);
    expect(result.hosts[0].mgmtIp).toBe("10.0.0.10");
    expect(result.hosts[1].mgmtIp).toBe("10.0.0.11");
    expect(result.hosts[2].mgmtIp).toBe("10.0.0.12");
    expect(result.hosts[3].mgmtIp).toBeNull();
  });
});

describe("allocateClusterIps - no networks", () => {
  it("returns empty result when cluster has no networks", () => {
    var result = allocateClusterIps({ id: "test", networks: null, t0Gateways: [], hostOverrides: [] }, 4);
    expect(result.hosts).toHaveLength(0);
    expect(result.edgeNodes).toHaveLength(0);
  });
});

describe("allocateClusterIps - edge node TEP allocation", () => {
  function clusterWithEdge() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return {
      id: "test-cluster",
      networks: networks,
      t0Gateways: [{
        id: "t0-1",
        name: "t0-prod",
        haMode: "active-standby",
        edgeNodeKeys: ["edge-1", "edge-2"],
        uplinksPerEdge: [1, 1],
        stateful: false,
        bgpEnabled: false,
        asnLocal: null,
        bgpPeers: [],
        featureRequirements: [],
      }],
      hostOverrides: [],
    };
  }

  it("allocates 2 TEP IPs per edge node", () => {
    var result = allocateClusterIps(clusterWithEdge(), 4);
    expect(result.edgeNodes).toHaveLength(2);
    expect(result.edgeNodes[0].edgeTepIps).toEqual(["10.0.4.10", "10.0.4.11"]);
    expect(result.edgeNodes[1].edgeTepIps).toEqual(["10.0.4.12", "10.0.4.13"]);
  });

  it("each edge node carries t0Id and edgeNodeKey", () => {
    var result = allocateClusterIps(clusterWithEdge(), 4);
    expect(result.edgeNodes[0].t0Id).toBe("t0-1");
    expect(result.edgeNodes[0].edgeNodeKey).toBe("edge-1");
    expect(result.edgeNodes[1].edgeNodeKey).toBe("edge-2");
  });
});

// ─── Edge case: override IP equals a pool IP ────────────────────────────────

describe("allocateClusterIps - override IP that matches a pool IP", () => {
  function clusterWithCollision() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return {
      id: "test-cluster", networks: networks, t0Gateways: [],
      hostOverrides: [{ hostIndex: 0, mgmtIp: "10.0.0.10", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null }],
    };
  }

  it("override host gets the override IP, pool skips that IP for next host", () => {
    var result = allocateClusterIps(clusterWithCollision(), 3);
    expect(result.hosts[0].mgmtIp).toBe("10.0.0.10");
    expect(result.hosts[0].source).toBe("override");
    expect(result.hosts[1].mgmtIp).toBe("10.0.0.11");
    expect(result.hosts[1].source).toBe("pool");
  });

  it("no duplicate IPs across all hosts", () => {
    var result = allocateClusterIps(clusterWithCollision(), 5);
    var allMgmt = result.hosts.map(function(h) { return h.mgmtIp; }).filter(Boolean);
    var unique = new Set(allMgmt);
    expect(unique.size).toBe(allMgmt.length);
  });
});

// ─── Edge case: single-host cluster ─────────────────────────────────────────

describe("allocateClusterIps - single host", () => {
  function singleHostCluster() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.10" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.10" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.10" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.11" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    return { id: "test-cluster", networks: networks, t0Gateways: [], hostOverrides: [] };
  }

  it("allocates exactly 1 host with all IPs", () => {
    var result = allocateClusterIps(singleHostCluster(), 1);
    expect(result.hosts).toHaveLength(1);
    expect(result.hosts[0].mgmtIp).toBe("10.0.0.10");
    expect(result.hosts[0].hostTepIps).toEqual(["10.0.3.10", "10.0.3.11"]);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── Edge case: /30 uplink subnet ───────────────────────────────────────────

describe("allocateClusterIps - /30 uplink pool for edge", () => {
  function clusterWith30Uplink() {
    var networks = createClusterNetworks();
    networks.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
    networks.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
    networks.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
    networks.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
    networks.edgeTep = { vlan: 104, subnet: "10.0.4.0/30", gateway: "10.0.4.1", pool: { start: "10.0.4.1", end: "10.0.4.2" }, mtu: 1700 };
    return {
      id: "test-cluster", networks: networks,
      t0Gateways: [{ id: "t0-1", name: "t0-prod", haMode: "active-standby", edgeNodeKeys: ["edge-1"], uplinksPerEdge: [1], stateful: false, bgpEnabled: false, asnLocal: null, bgpPeers: [], featureRequirements: [] }],
      hostOverrides: [],
    };
  }

  it("allocates edge TEP IPs from tiny /30 pool", () => {
    var result = allocateClusterIps(clusterWith30Uplink(), 4);
    expect(result.edgeNodes).toHaveLength(1);
    expect(result.edgeNodes[0].edgeTepIps).toEqual(["10.0.4.1", "10.0.4.2"]);
  });
});
