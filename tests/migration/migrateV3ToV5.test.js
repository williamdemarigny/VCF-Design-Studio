import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const {
  migrateV3ToV5, liftV3Instance, domainStructureMatches, stackSignature,
  baseHostSpec, baseStorageSettings, baseTiering,
} = VcfEngine;

const v3Cluster = (id = "clu-1") => ({
  id, name: "c", isDefault: true, host: baseHostSpec(),
  workload: { vmCount: 0, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
  infraStack: [], storage: baseStorageSettings(), tiering: baseTiering(),
});

const v3Domain = (id, type, clusters) => ({ id, name: type, type, clusters });

describe("liftV3Instance", () => {
  it("converts a single-site v3 instance to v5 shape", () => {
    const inst = {
      id: "inst-1", name: "test", deploymentProfile: "ha",
      domains: [v3Domain("dom-1", "mgmt", [v3Cluster("clu-1")])],
    };
    const r = liftV3Instance(inst, ["site-a"]);
    expect(r.siteIds).toEqual(["site-a"]);
    expect(r.witnessEnabled).toBe(false);
    expect(r.domains[0].placement).toBe("local");
    expect(r.domains[0].localSiteId).toBe("site-a");
  });

  it("auto-sets stretched placement when given two siteIds", () => {
    const inst = {
      id: "inst-1", name: "test", deploymentProfile: "ha",
      domains: [v3Domain("dom-1", "mgmt", [v3Cluster()])],
    };
    const r = liftV3Instance(inst, ["site-a", "site-b"]);
    expect(r.siteIds).toEqual(["site-a", "site-b"]);
    expect(r.domains[0].placement).toBe("stretched");
    expect(r.domains[0].localSiteId).toBeNull();
  });

  it("witnessEnabled true iff witnessSize is non-falsy and not 'None'", () => {
    const base = { id: "i", name: "n", domains: [] };
    expect(liftV3Instance({ ...base }, ["s"]).witnessEnabled).toBe(false);
    expect(liftV3Instance({ ...base, witnessSize: "None" }, ["s"]).witnessEnabled).toBe(false);
    expect(liftV3Instance({ ...base, witnessSize: "Medium" }, ["s"]).witnessEnabled).toBe(true);
  });

  it("workload domain gets componentsClusterId pointing at mgmt's first cluster", () => {
    const inst = {
      id: "inst-1", name: "test",
      domains: [
        v3Domain("dom-mgmt", "mgmt", [v3Cluster("clu-mgmt-01")]),
        v3Domain("dom-wld",  "workload", [v3Cluster("clu-wld-01")]),
      ],
    };
    const r = liftV3Instance(inst, ["site-a"]);
    const wld = r.domains.find((d) => d.type === "workload");
    expect(wld.componentsClusterId).toBe("clu-mgmt-01");
  });

  it("strips the legacy componentsLocation field", () => {
    const inst = {
      id: "inst-1", name: "test",
      domains: [
        v3Domain("dom-mgmt", "mgmt", [v3Cluster("clu-mgmt-01")]),
        { ...v3Domain("dom-wld", "workload", [v3Cluster()]), componentsLocation: "wld" },
      ],
    };
    const r = liftV3Instance(inst, ["site-a"]);
    const wld = r.domains.find((d) => d.type === "workload");
    expect(wld.componentsLocation).toBeUndefined();
  });
});

describe("domainStructureMatches", () => {
  it("returns true for identical structures", () => {
    const a = { domains: [v3Domain("d1", "mgmt", [v3Cluster()])] };
    const b = { domains: [v3Domain("d2", "mgmt", [v3Cluster()])] };
    expect(domainStructureMatches(a, b)).toBe(true);
  });

  it("returns false when domain types differ", () => {
    const a = { domains: [v3Domain("d1", "mgmt", [v3Cluster()])] };
    const b = { domains: [v3Domain("d2", "workload", [v3Cluster()])] };
    expect(domainStructureMatches(a, b)).toBe(false);
  });

  it("returns false when cluster counts differ", () => {
    const a = { domains: [v3Domain("d1", "mgmt", [v3Cluster()])] };
    const b = { domains: [v3Domain("d2", "mgmt", [v3Cluster(), v3Cluster("c2")])] };
    expect(domainStructureMatches(a, b)).toBe(false);
  });

  it("returns false for null/undefined inputs", () => {
    expect(domainStructureMatches(null, { domains: [] })).toBe(false);
    expect(domainStructureMatches({ domains: [] }, undefined)).toBe(false);
  });
});

describe("stackSignature", () => {
  it("returns empty string for empty stacks", () => {
    expect(stackSignature([])).toBe("");
    expect(stackSignature(undefined)).toBe("");
  });

  it("produces a stable sorted signature", () => {
    const dA = [{ clusters: [{ infraStack: [
      { id: "vcenter", size: "Medium", instances: 1 },
      { id: "nsxMgr",  size: "Medium", instances: 3 },
    ]}]}];
    const dB = [{ clusters: [{ infraStack: [
      { id: "nsxMgr",  size: "Medium", instances: 3 },
      { id: "vcenter", size: "Medium", instances: 1 },
    ]}]}];
    expect(stackSignature(dA)).toBe(stackSignature(dB));
  });

  it("differs when sizes or counts differ", () => {
    const dA = [{ clusters: [{ infraStack: [{ id: "vcenter", size: "Medium", instances: 1 }] }] }];
    const dB = [{ clusters: [{ infraStack: [{ id: "vcenter", size: "Large",  instances: 1 }] }] }];
    expect(stackSignature(dA)).not.toBe(stackSignature(dB));
  });
});

describe("migrateV3ToV5 — pairing logic", () => {
  it("merges a matched stretched pair into one v5 instance", () => {
    const cluster = v3Cluster();
    const inst = {
      id: "inst-paired", name: "paired", stretched: true,
      domains: [v3Domain("dom-1", "mgmt", [cluster])],
    };
    const v3Fleet = {
      id: "fleet-1", name: "f",
      sites: [
        { id: "site-a", name: "A", instances: [{ ...inst, secondarySiteId: "site-b" }] },
        { id: "site-b", name: "B", instances: [{ ...inst, secondarySiteId: "site-a" }] },
      ],
    };
    const r = migrateV3ToV5(v3Fleet);
    expect(r.instances.length).toBe(1);
    expect(r.instances[0].siteIds.sort()).toEqual(["site-a", "site-b"]);
  });

  it("falls back to single-site when stretched flag has no partner", () => {
    const v3Fleet = {
      id: "fleet-1", name: "f",
      sites: [
        { id: "site-a", name: "A", instances: [{
          id: "inst-orphan", name: "orphan", stretched: true, secondarySiteId: "site-missing",
          domains: [v3Domain("dom-1", "mgmt", [v3Cluster()])],
        }] },
      ],
    };
    const r = migrateV3ToV5(v3Fleet);
    expect(r.instances.length).toBe(1);
    expect(r.instances[0].siteIds).toEqual(["site-a"]);
  });
});
