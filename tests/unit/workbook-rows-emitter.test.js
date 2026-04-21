import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const { emitWorkbookRows, migrateFleet, sizeFleet, allocateClusterIps } = VcfEngine;

function makeFilledFleet() {
  var fleet = migrateFleet(null);
  fleet.networkConfig.dns = { servers: ["10.1.1.1"], searchDomains: ["vcf.local"], primaryDomain: "vcf.example.com" };
  fleet.networkConfig.ntp = { servers: ["pool.ntp.org"], timezone: "UTC" };
  var nets = fleet.instances[0].domains[0].clusters[0].networks;
  nets.mgmt = { vlan: 100, subnet: "10.0.0.0/24", gateway: "10.0.0.1", pool: { start: "10.0.0.10", end: "10.0.0.50" } };
  nets.vmotion = { vlan: 101, subnet: "10.0.1.0/24", gateway: "10.0.1.1", pool: { start: "10.0.1.10", end: "10.0.1.50" }, mtu: 9000 };
  nets.vsan = { vlan: 102, subnet: "10.0.2.0/24", gateway: "10.0.2.1", pool: { start: "10.0.2.10", end: "10.0.2.50" }, mtu: 9000 };
  nets.hostTep = { vlan: 103, subnet: "10.0.3.0/24", gateway: "10.0.3.1", pool: { start: "10.0.3.10", end: "10.0.3.50" }, mtu: 1700, useDhcp: false };
  nets.edgeTep = { vlan: 104, subnet: "10.0.4.0/24", gateway: "10.0.4.1", pool: { start: "10.0.4.10", end: "10.0.4.30" }, mtu: 1700 };
  return fleet;
}

describe("emitWorkbookRows - returns 4 sheets", () => {
  it("returns array of 4 sheet objects", () => {
    var fleet = makeFilledFleet();
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    expect(sheets).toHaveLength(4);
    expect(sheets[0].sheet).toBe("Fleet Services");
    expect(sheets[1].sheet).toBe("Network Configuration");
    expect(sheets[2].sheet).toBe("IP Address Plan");
    expect(sheets[3].sheet).toBe("BGP Configuration");
  });
});

describe("emitWorkbookRows - Fleet Services sheet", () => {
  it("has DNS and NTP rows", () => {
    var fleet = makeFilledFleet();
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    var fleetRows = sheets[0].rows;
    expect(fleetRows.some(function(r) { return r[0] === "DNS Servers" && r[1].includes("10.1.1.1"); })).toBe(true);
    expect(fleetRows.some(function(r) { return r[0] === "NTP Servers" && r[1].includes("pool.ntp.org"); })).toBe(true);
    expect(fleetRows.some(function(r) { return r[0] === "DNS Primary Domain" && r[1] === "vcf.example.com"; })).toBe(true);
  });
});

describe("emitWorkbookRows - Network Configuration sheet", () => {
  it("has header row + data rows for VLANs", () => {
    var fleet = makeFilledFleet();
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    var netRows = sheets[1].rows;
    expect(netRows[0]).toEqual(["Cluster", "Network", "VLAN", "Subnet", "Gateway", "MTU", "Pool Start", "Pool End"]);
    expect(netRows.length).toBeGreaterThan(1);
    expect(netRows.some(function(r) { return r[1] === "Management" && r[2] === "100"; })).toBe(true);
  });
});

describe("emitWorkbookRows - IP Address Plan sheet", () => {
  it("has header row + per-host data rows", () => {
    var fleet = makeFilledFleet();
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    var hostRows = sheets[2].rows;
    expect(hostRows[0]).toEqual(["Cluster", "Host #", "Mgmt IP", "vMotion IP", "vSAN IP", "TEP IPs", "BMC IP", "Source"]);
    expect(hostRows.length).toBeGreaterThan(1);
    expect(hostRows[1][2]).toBe("10.0.0.10");
  });
});

describe("emitWorkbookRows - does not mutate fleet", () => {
  it("fleet is unchanged after emitWorkbookRows", () => {
    var fleet = makeFilledFleet();
    var before = JSON.stringify(fleet);
    emitWorkbookRows(fleet, sizeFleet(fleet));
    expect(JSON.stringify(fleet)).toBe(before);
  });
});

describe("emitWorkbookRows - empty fleet", () => {
  it("returns 4 sheets even with no network config", () => {
    var fleet = migrateFleet(null);
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    expect(sheets).toHaveLength(4);
    expect(sheets[1].rows.length).toBe(1);
  });
});

describe("emitWorkbookRows - BGP rows", () => {
  it("includes BGP peer rows when T0 has peers", () => {
    var fleet = makeFilledFleet();
    fleet.instances[0].domains[0].clusters[0].t0Gateways = [{
      id: "t0-1", name: "t0-prod", haMode: "active-standby",
      edgeNodeKeys: [], uplinksPerEdge: [], stateful: false,
      bgpEnabled: true, asnLocal: 65000,
      bgpPeers: [{ name: "tor-a", ip: "203.0.113.1", asn: 65100, holdTime: 180, keepAlive: 60 }],
      featureRequirements: [],
    }];
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    var bgpSheet = sheets[3];
    expect(bgpSheet.sheet).toBe("BGP Configuration");
    expect(bgpSheet.rows.length).toBeGreaterThan(1);
    expect(bgpSheet.rows[1][1]).toBe("t0-prod");
    expect(bgpSheet.rows[1][2]).toBe("65000");
    expect(bgpSheet.rows[1][4]).toBe("203.0.113.1");
  });
});

describe("emitWorkbookRows - all values are strings", () => {
  it("every cell in every row is a string", () => {
    var fleet = makeFilledFleet();
    var sheets = emitWorkbookRows(fleet, sizeFleet(fleet));
    sheets.forEach(function(sheet) {
      sheet.rows.forEach(function(row, ri) {
        row.forEach(function(cell, ci) {
          expect(typeof cell).toBe("string");
        });
      });
    });
  });
});
