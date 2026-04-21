import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { emitInstallerJson, migrateFleet, sizeFleet, createClusterNetworks, allocateClusterIps } = VcfEngine;

function makeFilledFleet() {
  var fleet = migrateFleet(null);
  fleet.networkConfig.dns = { servers: ["10.1.1.1", "10.1.1.2"], searchDomains: ["vcf.local"], primaryDomain: "vcf.example.com" };
  fleet.networkConfig.ntp = { servers: ["pool.ntp.org"], timezone: "UTC" };
  var nets = fleet.instances[0].domains[0].clusters[0].networks;
  nets.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
  nets.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
  nets.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
  nets.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
  nets.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
  return fleet;
}

describe("emitInstallerJson - fleet-level fields", () => {
  it("dnsSpec includes primaryDomain and servers", () => {
    var fleet = makeFilledFleet();
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.dnsSpec.primaryDomain).toBe("vcf.example.com");
    expect(result.dnsSpec.dnsServers).toEqual(["10.1.1.1", "10.1.1.2"]);
    expect(result.dnsSpec.searchDomains).toEqual(["vcf.local"]);
  });

  it("ntpServers is array of strings", () => {
    var fleet = makeFilledFleet();
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.ntpServers).toEqual(["pool.ntp.org"]);
  });

  it("syslogSpec has servers array", () => {
    var fleet = makeFilledFleet();
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.syslogSpec).toHaveProperty("servers");
    expect(Array.isArray(result.syslogSpec.servers)).toBe(true);
  });
});

describe("emitInstallerJson - networkSpecs", () => {
  it("emits one networkSpec per VLAN-configured network per cluster", () => {
    var fleet = makeFilledFleet();
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.networkSpecs.length).toBeGreaterThanOrEqual(5);
    expect(result.networkSpecs.some(function(s) { return s.type === "mgmt" && s.vlanId === 100; })).toBe(true);
    expect(result.networkSpecs.some(function(s) { return s.type === "vmotion" && s.vlanId === 101; })).toBe(true);
    expect(result.networkSpecs.some(function(s) { return s.type === "vsan" && s.vlanId === 102; })).toBe(true);
    expect(result.networkSpecs.some(function(s) { return s.type === "hostTep" && s.vlanId === 103; })).toBe(true);
    expect(result.networkSpecs.some(function(s) { return s.type === "edgeTep" && s.vlanId === 104; })).toBe(true);
  });
});

describe("emitInstallerJson - hostSpecs", () => {
  it("emits one hostSpec per finalHost with IP assignments", () => {
    var fleet = makeFilledFleet();
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.hostSpecs.length).toBeGreaterThan(0);
    expect(result.hostSpecs[0].ipAddress.mgmtIp).toBe("10.0.0.10");
    expect(result.hostSpecs[0].ipAddress.vmotionIp).toBe("10.0.1.10");
    expect(result.hostSpecs[0].ipAddress.vsanIp).toBe("10.0.2.10");
  });

  it("hostSpecs have bmcConfig", () => {
    var fleet = makeFilledFleet();
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.hostSpecs[0]).toHaveProperty("bmcConfig");
  });
});

describe("emitInstallerJson - does not mutate fleet", () => {
  it("fleet is unchanged after emitInstallerJson", () => {
    var fleet = makeFilledFleet();
    var before = JSON.stringify(fleet);
    emitInstallerJson(fleet, sizeFleet(fleet));
    expect(JSON.stringify(fleet)).toBe(before);
  });
});

describe("emitInstallerJson - empty fleet", () => {
  it("returns valid structure with empty arrays for fleet with no networks", () => {
    var fleet = migrateFleet(null);
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.dnsSpec).toBeDefined();
    expect(result.ntpServers).toEqual([]);
    expect(result.networkSpecs).toEqual([]);
    expect(result.hostSpecs.length).toBeGreaterThan(0);
  });
});

describe("emitInstallerJson - edge specs", () => {
  it("includes edgeSpecs when T0 gateways have edge nodes", () => {
    var fleet = migrateFleet(null);
    var nets = fleet.instances[0].domains[0].clusters[0].networks;
    nets.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
    fleet.instances[0].domains[0].clusters[0].t0Gateways = [{
      id: "t0-1", name: "t0-prod", haMode: "active-standby",
      edgeNodeKeys: ["edge-1", "edge-2"], uplinksPerEdge: [1, 1],
      stateful: false, bgpEnabled: false, asnLocal: 65000, bgpPeers: [], featureRequirements: [],
    }];
    var result = emitInstallerJson(fleet, sizeFleet(fleet));
    expect(result.edgeSpecs.length).toBe(2);
    expect(result.edgeSpecs[0].edgeNodeKey).toBe("edge-1");
    expect(result.edgeSpecs[0].tepIpConfig).toBeDefined();
  });
});

describe("emitInstallerJson - round-trip", () => {
  it("hostSpecs IPs match allocateClusterIps output", () => {
    var fleet = makeFilledFleet();
    var fleetResult = sizeFleet(fleet);
    var result = emitInstallerJson(fleet, fleetResult);
    var cluster = fleet.instances[0].domains[0].clusters[0];
    var finalHosts = fleetResult.instanceResults[0].domainResults[0].clusterResults[0].finalHosts;
    var ipPlan = VcfEngine.allocateClusterIps(cluster, finalHosts);
    for (var i = 0; i < Math.min(result.hostSpecs.length, ipPlan.hosts.length); i++) {
      expect(result.hostSpecs[i].ipAddress.mgmtIp).toBe(ipPlan.hosts[i].mgmtIp);
      expect(result.hostSpecs[i].ipAddress.vmotionIp).toBe(ipPlan.hosts[i].vmotionIp);
    }
  });
});
