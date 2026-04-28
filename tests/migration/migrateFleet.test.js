import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const { migrateFleet, newFleet } = VcfEngine;

const FIXTURES_V5 = path.resolve(__dirname, "../../test-fixtures/v5");
const FIXTURES_V3 = path.resolve(__dirname, "../../test-fixtures/v3");
const FIXTURES_V2 = path.resolve(__dirname, "../../test-fixtures/v2");

const v5Files = fs.readdirSync(FIXTURES_V5).filter((f) => f.endsWith(".json"));
const v3Files = fs.readdirSync(FIXTURES_V3).filter((f) => f.endsWith(".json"));
const v2Files = fs.readdirSync(FIXTURES_V2).filter((f) => f.endsWith(".json"));

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function assertV5Shape(fleet) {
  expect(fleet, "fleet exists").toBeDefined();
  expect(fleet.id, "fleet has id").toBeTypeOf("string");
  expect(Array.isArray(fleet.sites), "fleet has sites array").toBe(true);
  expect(Array.isArray(fleet.instances), "fleet has instances array").toBe(true);

  for (const inst of fleet.instances) {
    expect(inst.id).toBeTypeOf("string");
    expect(Array.isArray(inst.siteIds), `${inst.id} has siteIds array`).toBe(true);
    expect(inst.siteIds.length).toBeGreaterThan(0);
    for (const dom of inst.domains) {
      for (const clu of dom.clusters) {
        expect(clu.host, `${clu.id} has host`).toBeDefined();
        expect(typeof clu.host.hyperthreadingEnabled).toBe("boolean");
        expect(clu.host.cpuQty).toBeGreaterThan(0);
        expect(clu.host.coresPerCpu).toBeGreaterThan(0);
      }
    }
  }
}

describe("migrateFleet — edge cases", () => {
  it("returns a valid default fleet for null input", () => {
    const r = migrateFleet(null);
    assertV5Shape(r);
  });

  it("returns a valid default fleet for undefined input", () => {
    const r = migrateFleet(undefined);
    assertV5Shape(r);
  });

  it("treats {} as v3 (default version)", () => {
    const r = migrateFleet({});
    expect(r).toBeDefined();
    expect(Array.isArray(r.sites)).toBe(true);
    expect(Array.isArray(r.instances)).toBe(true);
  });

  it("handles an unknown version by routing through v3 path", () => {
    const r = migrateFleet({ version: "vcf-sizer-vfuture", fleet: {} });
    expect(r).toBeDefined();
    expect(Array.isArray(r.sites)).toBe(true);
  });
});

describe("migrateFleet — idempotency on v5 fixtures", () => {
  it.each(v5Files)("%s migrates idempotently", (file) => {
    const raw = loadJson(path.join(FIXTURES_V5, file));
    const once = migrateFleet(raw);
    const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("migrateFleet — v5→v6 backfills dom.stretchSiteIds", () => {
  it("backfills stretchSiteIds on stretched domains missing the field", () => {
    const fleet = newFleet();
    fleet.sites.push({ id: "site-2", name: "B", location: "", region: "", siteRole: "" });
    fleet.instances[0].siteIds = [fleet.sites[0].id, "site-2"];
    for (const dom of fleet.instances[0].domains) {
      dom.placement = "stretched";
      delete dom.stretchSiteIds;
    }
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    for (const dom of r.instances[0].domains) {
      expect(dom.stretchSiteIds).toEqual([fleet.sites[0].id, "site-2"]);
    }
  });

  it("keeps stretchSiteIds null on local domains", () => {
    const fleet = newFleet();
    for (const dom of fleet.instances[0].domains) {
      dom.placement = "local";
      dom.localSiteId = fleet.sites[0].id;
      dom.stretchSiteIds = ["garbage-a", "garbage-b"];
    }
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    for (const dom of r.instances[0].domains) {
      expect(dom.stretchSiteIds).toBeNull();
    }
  });

  it("preserves an already-populated stretchSiteIds pair (idempotent)", () => {
    const fleet = newFleet();
    fleet.sites.push({ id: "site-2", name: "B", location: "", region: "", siteRole: "" });
    fleet.sites.push({ id: "site-3", name: "C", location: "", region: "", siteRole: "" });
    fleet.instances[0].siteIds = [fleet.sites[0].id, "site-2", "site-3"];
    for (const dom of fleet.instances[0].domains) {
      dom.placement = "stretched";
      dom.stretchSiteIds = [fleet.sites[0].id, "site-3"];
    }
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    for (const dom of r.instances[0].domains) {
      expect(dom.stretchSiteIds).toEqual([fleet.sites[0].id, "site-3"]);
    }
  });
});

describe("migrateFleet — v5 normalization adds missing hyperthreadingEnabled", () => {
  it("inserts hyperthreadingEnabled=false on every cluster missing the field", () => {
    const fleet = newFleet();
    // Strip the field
    for (const inst of fleet.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          delete clu.host.hyperthreadingEnabled;
        }
      }
    }
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    for (const inst of r.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          expect(clu.host.hyperthreadingEnabled).toBe(false);
        }
      }
    }
  });

  it("preserves hyperthreadingEnabled=true when explicitly set", () => {
    const fleet = newFleet();
    for (const inst of fleet.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          clu.host.hyperthreadingEnabled = true;
        }
      }
    }
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    for (const inst of r.instances) {
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          expect(clu.host.hyperthreadingEnabled).toBe(true);
        }
      }
    }
  });
});

describe("migrateFleet — v3 fixtures migrate to v5 shape", () => {
  it.each(v3Files)("v3 fixture %s migrates to v5 shape", (file) => {
    const raw = loadJson(path.join(FIXTURES_V3, file));
    const r = migrateFleet(raw);
    assertV5Shape(r);
  });

  it.each(v3Files)("v3 fixture %s migration is idempotent", (file) => {
    const raw = loadJson(path.join(FIXTURES_V3, file));
    const once = migrateFleet(raw);
    const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("migrateFleet — v2 fixtures migrate to v5 shape", () => {
  it.each(v2Files)("v2 fixture %s migrates to v5 shape", (file) => {
    const raw = loadJson(path.join(FIXTURES_V2, file));
    const r = migrateFleet(raw);
    assertV5Shape(r);
  });

  it.each(v2Files)("v2 fixture %s migration is idempotent", (file) => {
    const raw = loadJson(path.join(FIXTURES_V2, file));
    const once = migrateFleet(raw);
    const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});

describe("migrateFleet — legacy componentsLocation enum", () => {
  it("v5.1 'wld' enum resolves to the workload domain's first cluster", () => {
    const fleet = newFleet();
    // Inject a workload domain with the legacy enum
    const inst = fleet.instances[0];
    const wldClu = {
      id: "clu-wld-01", name: "wld-cluster-01", isDefault: true,
      host: { ...VcfEngine.baseHostSpec() },
      workload: { vmCount: 0, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
      infraStack: [],
      storage: VcfEngine.baseStorageSettings(),
      tiering: VcfEngine.baseTiering(),
    };
    inst.domains.push({
      id: "dom-wld-01", type: "workload", name: "WLD",
      placement: "local", localSiteId: fleet.sites[0].id,
      clusters: [wldClu],
      componentsLocation: "wld",  // legacy v5.1 enum
    });
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    const wldDom = r.instances[0].domains.find((d) => d.type === "workload");
    expect(wldDom.componentsLocation).toBeUndefined();
    expect(wldDom.componentsClusterId).toBe("clu-wld-01");
  });

  it("v5.1 'mgmt' enum (default) resolves to the mgmt domain's first cluster", () => {
    const fleet = newFleet();
    const inst = fleet.instances[0];
    const mgmtCluId = inst.domains[0].clusters[0].id;
    inst.domains.push({
      id: "dom-wld-01", type: "workload", name: "WLD",
      placement: "local", localSiteId: fleet.sites[0].id,
      clusters: [{
        id: "clu-wld-01", name: "wld-cluster-01", isDefault: true,
        host: { ...VcfEngine.baseHostSpec() },
        workload: { vmCount: 0, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
        infraStack: [],
        storage: VcfEngine.baseStorageSettings(),
        tiering: VcfEngine.baseTiering(),
      }],
      componentsLocation: "mgmt",
    });
    const r = migrateFleet({ version: "vcf-sizer-v5", fleet });
    const wldDom = r.instances[0].domains.find((d) => d.type === "workload");
    expect(wldDom.componentsClusterId).toBe(mgmtCluId);
  });
});
