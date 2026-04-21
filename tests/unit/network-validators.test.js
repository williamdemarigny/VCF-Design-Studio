import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  validateNetworkDesign,
  createFleetNetworkConfig, createClusterNetworks, newFleet, migrateFleet,
} = VcfEngine;

function makeFleet(clusterNetworks, fleetNetworkConfig) {
  var fleet = migrateFleet(null);
  if (fleetNetworkConfig) fleet.networkConfig = fleetNetworkConfig;
  if (clusterNetworks) fleet.instances[0].domains[0].clusters[0].networks = clusterNetworks;
  return fleet;
}

function filledNetworks(overrides) {
  var nets = createClusterNetworks();
  nets.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
  nets.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
  nets.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
  nets.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
  nets.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };

  if (overrides) Object.assign(nets, overrides);
  return nets;
}

// ─── VCF-NET-010 / VCF-NET-011 ───────────────────────────────────────────────

describe("VCF-NET-010: DNS servers required", () => {
  it("error when DNS servers empty", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = [];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-010"; })).toBe(true);
  });

  it("no error when DNS servers set", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-010"; })).toBe(false);
  });
});

describe("VCF-NET-011: NTP servers required", () => {
  it("error when NTP servers empty", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.ntp.servers = [];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-011"; })).toBe(true);
  });

  it("no error when NTP servers set", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-011"; })).toBe(false);
  });
});

// ─── VCF-IP-001 ─────────────────────────────────────────────────────────────

describe("VCF-IP-001: Distinct VLANs within cluster", () => {
  it("error when mgmt and vmotion share VLAN", () => {
    var nets = filledNetworks();
    nets.vmotion.vlan = 100;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(true);
  });

  it("no error when all VLANs distinct", () => {
    var fleet = makeFleet(filledNetworks());
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(false);
  });

  it("error when hostTep and edgeTep share VLAN", () => {
    var nets = filledNetworks();
    nets.edgeTep.vlan = 103;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(true);
  });
});

// ─── VCF-IP-003 / VCF-IP-004 ─────────────────────────────────────────

describe("VCF-IP-003: Pool range within subnet", () => {
  it("error when pool start outside subnet", () => {
    var nets = filledNetworks();
    nets.mgmt.pool.start = "10.1.0.10";
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-003"; })).toBe(true);
  });

  it("no error when pool within subnet", () => {
    var fleet = makeFleet(filledNetworks());
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-003"; })).toBe(false);
  });
});

describe("VCF-IP-004: Pool start <= end", () => {
  it("error when pool start > end", () => {
    var nets = filledNetworks();
    nets.mgmt.pool = { start: "10.0.0.50", end: "10.0.0.10" };
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-004"; })).toBe(true);
  });
});

// ─── VCF-IP-005 ────────────────────────────────────────────────────────────

describe("VCF-IP-005: No subnet overlap within cluster", () => {
  it("error when mgmt and vmotion share subnet", () => {
    var nets = filledNetworks();
    nets.vmotion.subnet = "10.0.0.0/24";
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-005"; })).toBe(true);
  });

  it("no error when all subnets distinct", () => {
    var fleet = makeFleet(filledNetworks());
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-005"; })).toBe(false);
  });
});

// ─── VCF-IP-006 ────────────────────────────────────────────────────────────

describe("VCF-IP-006: Cross-cluster mgmt subnet reuse (warn)", () => {
  it("warn when two clusters share mgmt subnet", () => {
    var fleet = makeFleet(filledNetworks());
    var dom = fleet.instances[0].domains[0];
    var secondCluster = JSON.parse(JSON.stringify(dom.clusters[0]));
    secondCluster.name = "second-cluster";
    dom.clusters.push(secondCluster);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-006" && i.severity === "warn"; })).toBe(true);
  });
});

// ─── VCF-IP-007 ────────────────────────────────────────────────────────────

describe("VCF-IP-007: Host override in subnet", () => {
  it("error when override IP outside mgmt subnet", () => {
    var nets = filledNetworks();
    var fleet = makeFleet(nets);
    fleet.instances[0].domains[0].clusters[0].hostOverrides = [
      { hostIndex: 0, mgmtIp: "192.168.1.1", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null },
    ];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-007"; })).toBe(true);
  });

  it("no error when override IP inside subnet", () => {
    var nets = filledNetworks();
    var fleet = makeFleet(nets);
    fleet.instances[0].domains[0].clusters[0].hostOverrides = [
      { hostIndex: 0, mgmtIp: "10.0.0.99", vmotionIp: null, vsanIp: null, hostTepIps: null, bmcIp: null },
    ];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-007"; })).toBe(false);
  });
});

// ─── VCF-HW-NET-020 ────────────────────────────────────────────────────────

describe("VCF-HW-NET-020: MTU checks", () => {
  it("error when host TEP MTU below 1600", () => {
    var nets = filledNetworks();
    nets.hostTep.mtu = 1500;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "error"; })).toBe(true);
  });

  it("warn when vMotion MTU below 9000", () => {
    var nets = filledNetworks();
    nets.vmotion.mtu = 1500;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "warn"; })).toBe(true);
  });

  it("warn when vSAN MTU below 9000", () => {
    var nets = filledNetworks();
    nets.vsan.mtu = 1500;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "warn"; })).toBe(true);
  });

  it("no issues when all MTUs correct", () => {
    var fleet = makeFleet(filledNetworks());
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020"; })).toBe(false);
  });
});

// ─── VCF-NET-030 / VCF-NET-031 ─────────────────────────────────────────

describe("VCF-NET-030: BGP peer IP in uplink subnet", () => {
  it("error when BGP peer IP not in uplink subnet", () => {
    var nets = filledNetworks();
    nets.uplinks = [{ vlan: 200, subnet: "203.0.113.0/30", gateway: "203.0.113.1", edgeNodeIp: "203.0.113.2" }];
    var fleet = makeFleet(nets);
    fleet.instances[0].domains[0].clusters[0].t0Gateways = [{
      id: "t0-1", name: "t0-prod", haMode: "active-standby",
      edgeNodeKeys: [], uplinksPerEdge: [], stateful: false,
      bgpEnabled: true, asnLocal: 65000, bgpPeers: [{ ip: "10.99.99.1", asn: 65100 }],
      featureRequirements: [],
    }];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-030"; })).toBe(true);
  });

  it("no error when BGP peer IP in uplink subnet", () => {
    var nets = filledNetworks();
    nets.uplinks = [{ vlan: 200, subnet: "203.0.113.0/30", gateway: "203.0.113.1", edgeNodeIp: "203.0.113.2" }];
    var fleet = makeFleet(nets);
    fleet.instances[0].domains[0].clusters[0].t0Gateways = [{
      id: "t0-1", name: "t0-prod", haMode: "active-standby",
      edgeNodeKeys: [], uplinksPerEdge: [], stateful: false,
      bgpEnabled: true, asnLocal: 65000, bgpPeers: [{ ip: "203.0.113.1", asn: 65100 }],
      featureRequirements: [],
    }];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-030"; })).toBe(false);
  });
});

describe("VCF-NET-031: Local ASN != peer ASN", () => {
  it("warn when local ASN equals peer ASN", () => {
    var nets = filledNetworks();
    nets.uplinks = [{ vlan: 200, subnet: "203.0.113.0/30", gateway: "203.0.113.1", edgeNodeIp: "203.0.113.2" }];
    var fleet = makeFleet(nets);
    fleet.instances[0].domains[0].clusters[0].t0Gateways = [{
      id: "t0-1", name: "t0-prod", haMode: "active-standby",
      edgeNodeKeys: [], uplinksPerEdge: [], stateful: false,
      bgpEnabled: true, asnLocal: 65000, bgpPeers: [{ ip: "203.0.113.1", asn: 65000 }],
      featureRequirements: [],
    }];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-NET-031"; })).toBe(true);
  });
});

// ─── Clean fleet baseline ──────────────────────────────────────────────

describe("Clean fleet produces no network issues (except DNS/NTP)", () => {
  it("fully configured fleet has only DNS/NTP warnings", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues).toEqual([]);
  });
});

// ─── VCF-IP-002: Pool sizing warning ─────────────────────────────────

describe("VCF-IP-002: Pool sizing warning via validateNetworkDesign", () => {
  it("no VCF-IP-002 when pools are large enough", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-002"; })).toBe(false);
  });
});

// ─── Multi-cluster fleet scenarios ──────────────────────────────────

describe("Validator: multi-cluster fleet with distinct VLANs", () => {
  it("no VCF-IP-001 when clusters have different VLANs", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var dom = fleet.instances[0].domains[0];
    var secondNets = filledNetworks();
    secondNets.mgmt.vlan = 200;
    secondNets.vmotion.vlan = 201;
    secondNets.vsan.vlan = 202;
    secondNets.hostTep.vlan = 203;
    secondNets.edgeTep.vlan = 204;
    secondNets.mgmt.subnet = "10.1.0.0/24";
    secondNets.vmotion.subnet = "10.1.1.0/24";
    secondNets.vsan.subnet = "10.1.2.0/24";
    secondNets.hostTep.subnet = "10.1.3.0/24";
    secondNets.edgeTep.subnet = "10.1.4.0/24";
    var secondCluster = JSON.parse(JSON.stringify(dom.clusters[0]));
    secondCluster.name = "wld-cluster-01";
    secondCluster.networks = secondNets;
    dom.clusters.push(secondCluster);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(false);
  });

  it("VCF-IP-001 fires within a single cluster, not cross-cluster", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var dom = fleet.instances[0].domains[0];
    var secondNets = filledNetworks();
    secondNets.mgmt.vlan = 100;
    secondNets.vmotion.vlan = 100;
    secondNets.mgmt.subnet = "10.1.0.0/24";
    secondNets.vmotion.subnet = "10.1.1.0/24";
    secondNets.vsan.subnet = "10.1.2.0/24";
    secondNets.hostTep.subnet = "10.1.3.0/24";
    secondNets.edgeTep.subnet = "10.1.4.0/24";
    var secondCluster = JSON.parse(JSON.stringify(dom.clusters[0]));
    secondCluster.name = "wld-cluster-01";
    secondCluster.networks = secondNets;
    dom.clusters.push(secondCluster);
    var issues = validateNetworkDesign(fleet);
    var ip001 = issues.filter(function(i) { return i.ruleId === "VCF-IP-001"; });
    expect(ip001.length).toBe(1);
    expect(ip001[0].message).toContain("wld-cluster-01");
  });
});

// ─── Null/empty network edge cases ─────────────────────────────────

describe("Validator: clusters with null/empty networks", () => {
  it("no crash when cluster.networks is null", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.instances[0].domains[0].clusters[0].networks = null;
    expect(() => validateNetworkDesign(fleet)).not.toThrow();
  });

  it("no crash when cluster.networks has null VLANs", () => {
    var fleet = makeFleet(createClusterNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(false);
  });
});

// ─── VCF-HW-NET-020: MTU boundary tests ─────────────────────────────

describe("VCF-HW-NET-020: MTU boundary values", () => {
  it("host TEP MTU exactly 1600 does NOT fire error", () => {
    var nets = filledNetworks();
    nets.hostTep.mtu = 1600;
    var fleet = makeFleet(nets);
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "error"; })).toBe(false);
  });

  it("host TEP MTU 1599 fires error", () => {
    var nets = filledNetworks();
    nets.hostTep.mtu = 1599;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "error"; })).toBe(true);
  });

  it("vMotion MTU exactly 9000 does NOT fire warn", () => {
    var nets = filledNetworks();
    nets.vmotion.mtu = 9000;
    var fleet = makeFleet(nets);
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.message.includes("vMotion"); })).toBe(false);
  });
});

// ─── VCF-IP-002: Pool sizing warning ─────────────────────────────────

describe("VCF-IP-002: Pool sizing warning via validateNetworkDesign", () => {
  it("no VCF-IP-002 when pools are large enough", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-002"; })).toBe(false);
  });
});

// ─── Multi-cluster fleet scenarios ──────────────────────────────────

describe("Validator: multi-cluster fleet with distinct VLANs", () => {
  it("no VCF-IP-001 when clusters have different VLANs", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var dom = fleet.instances[0].domains[0];
    var secondNets = filledNetworks();
    secondNets.mgmt.vlan = 200;
    secondNets.vmotion.vlan = 201;
    secondNets.vsan.vlan = 202;
    secondNets.hostTep.vlan = 203;
    secondNets.edgeTep.vlan = 204;
    secondNets.mgmt.subnet = "10.1.0.0/24";
    secondNets.vmotion.subnet = "10.1.1.0/24";
    secondNets.vsan.subnet = "10.1.2.0/24";
    secondNets.hostTep.subnet = "10.1.3.0/24";
    secondNets.edgeTep.subnet = "10.1.4.0/24";
    var secondCluster = JSON.parse(JSON.stringify(dom.clusters[0]));
    secondCluster.name = "wld-cluster-01";
    secondCluster.networks = secondNets;
    dom.clusters.push(secondCluster);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(false);
  });

  it("VCF-IP-001 fires within a single cluster, not cross-cluster", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var dom = fleet.instances[0].domains[0];
    var secondNets = filledNetworks();
    secondNets.mgmt.vlan = 100;
    secondNets.vmotion.vlan = 100;
    secondNets.mgmt.subnet = "10.1.0.0/24";
    secondNets.vmotion.subnet = "10.1.1.0/24";
    secondNets.vsan.subnet = "10.1.2.0/24";
    secondNets.hostTep.subnet = "10.1.3.0/24";
    secondNets.edgeTep.subnet = "10.1.4.0/24";
    var secondCluster = JSON.parse(JSON.stringify(dom.clusters[0]));
    secondCluster.name = "wld-cluster-01";
    secondCluster.networks = secondNets;
    dom.clusters.push(secondCluster);
    var issues = validateNetworkDesign(fleet);
    var ip001 = issues.filter(function(i) { return i.ruleId === "VCF-IP-001"; });
    expect(ip001.length).toBe(1);
    expect(ip001[0].message).toContain("wld-cluster-01");
  });
});

// ─── Null/empty network edge cases ─────────────────────────────────

describe("Validator: clusters with null/empty networks", () => {
  it("no crash when cluster.networks is null", () => {
    var fleet = makeFleet(filledNetworks());
    fleet.instances[0].domains[0].clusters[0].networks = null;
    expect(() => validateNetworkDesign(fleet)).not.toThrow();
  });

  it("no crash when cluster.networks has null VLANs", () => {
    var fleet = makeFleet(createClusterNetworks());
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-IP-001"; })).toBe(false);
  });
});

// ─── VCF-HW-NET-020: MTU boundary tests ─────────────────────────────

describe("VCF-HW-NET-020: MTU boundary values", () => {
  it("host TEP MTU exactly 1600 does NOT fire error", () => {
    var nets = filledNetworks();
    nets.hostTep.mtu = 1600;
    var fleet = makeFleet(nets);
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "error"; })).toBe(false);
  });

  it("host TEP MTU 1599 fires error", () => {
    var nets = filledNetworks();
    nets.hostTep.mtu = 1599;
    var fleet = makeFleet(nets);
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.severity === "error"; })).toBe(true);
  });

  it("vMotion MTU exactly 9000 does NOT fire warn", () => {
    var nets = filledNetworks();
    nets.vmotion.mtu = 9000;
    var fleet = makeFleet(nets);
    fleet.networkConfig.dns.servers = ["10.1.1.1"];
    fleet.networkConfig.ntp.servers = ["pool.ntp.org"];
    var issues = validateNetworkDesign(fleet);
    expect(issues.some(function(i) { return i.ruleId === "VCF-HW-NET-020" && i.message.includes("vMotion"); })).toBe(false);
  });
});
