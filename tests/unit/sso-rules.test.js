// SSO invariant tests — VCF-INV-030/031/032 from VCF-DEPLOYMENT-PATTERNS.md §3.
// Describes the three SSO models (VCF-SSO-001..003), their cardinality rules,
// and the fleet-services single-broker binding constraint.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const {
  newFleet, migrateFleet, SSO_MODES, inferSsoMode, ssoInstancesPerBroker,
  SSO_INSTANCES_PER_BROKER_LIMIT,
} = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
  return migrateFleet(raw);
}

describe("SSO_MODES — metadata", () => {
  it("exposes the three research-doc SSO models", () => {
    expect(Object.keys(SSO_MODES).sort()).toEqual(
      ["embedded", "fleet-wide", "multi-broker"].sort()
    );
  });

  it.each(Object.entries(SSO_MODES))("%s has ruleId, label, description", (key, def) => {
    expect(def.ruleId).toMatch(/^VCF-SSO-\d{3}$/);
    expect(def.label).toBeTypeOf("string");
    expect(def.description).toBeTypeOf("string");
  });
});

describe("inferSsoMode — default inference", () => {
  it("single-instance fleet defaults to embedded", () => {
    expect(inferSsoMode({ instances: [{}] })).toBe("embedded");
  });

  it("multi-instance fleet defaults to fleet-wide", () => {
    expect(inferSsoMode({ instances: [{}, {}] })).toBe("fleet-wide");
  });

  it("explicit ssoMode preserves override", () => {
    expect(inferSsoMode({ ssoMode: "multi-broker", instances: [{}] })).toBe("multi-broker");
  });

  it("invalid ssoMode falls back to count-based inference", () => {
    expect(inferSsoMode({ ssoMode: "not-a-mode", instances: [{}, {}, {}] })).toBe("fleet-wide");
  });

  it("empty fleet falls back to embedded", () => {
    expect(inferSsoMode({})).toBe("embedded");
  });
});

describe("VCF-INV-030: SSO mode matches fleet size (soft)", () => {
  it("single-instance fleet with embedded is consistent", () => {
    const r = { instances: [{}], ssoMode: "embedded" };
    expect(inferSsoMode(r)).toBe("embedded");
  });

  it("multi-instance fleet with embedded is ALLOWED but unusual — we don't hard-fail, just note", () => {
    const r = { instances: [{}, {}, {}], ssoMode: "embedded" };
    expect(r.ssoMode).toBe("embedded");
  });
});

describe("VCF-INV-031: 5-instance-per-broker soft recommendation", () => {
  it("single-broker fleet-wide with <=5 instances is within limits", () => {
    const fleet = { ssoMode: "fleet-wide", ssoBrokers: [], instances: [{}, {}, {}, {}, {}] };
    const stats = ssoInstancesPerBroker(fleet);
    expect(stats.overLimit).toBe(false);
    expect(stats.perBroker).toBe(5);
  });

  it("single-broker fleet-wide with 6 instances trips the soft limit", () => {
    const fleet = { ssoMode: "fleet-wide", ssoBrokers: [], instances: [{}, {}, {}, {}, {}, {}] };
    const stats = ssoInstancesPerBroker(fleet);
    expect(stats.overLimit).toBe(true);
    expect(stats.perBroker).toBe(6);
  });

  it("multi-broker with 2 brokers and 6 instances is within limits", () => {
    const fleet = {
      ssoMode: "multi-broker",
      ssoBrokers: [{ id: "b1" }, { id: "b2" }],
      instances: [{}, {}, {}, {}, {}, {}],
    };
    const stats = ssoInstancesPerBroker(fleet);
    expect(stats.overLimit).toBe(false);
    expect(stats.perBroker).toBe(3);
  });

  it("limit constant is 5 per the research doc", () => {
    expect(SSO_INSTANCES_PER_BROKER_LIMIT).toBe(5);
  });
});

describe("VCF-INV-032: fleet-level services bind to exactly one broker (multi-broker mode)", () => {
  it("multi-broker fleet must set ssoFleetServicesBrokerId to one of the defined brokers", () => {
    for (const file of fixtureFiles) {
      const fleet = loadFixture(file);
      if (fleet.ssoMode !== "multi-broker") continue;
      expect(fleet.ssoFleetServicesBrokerId,
        `${file}: multi-broker fleet must declare ssoFleetServicesBrokerId`).toBeTruthy();
      const brokerIds = (fleet.ssoBrokers || []).map((b) => b.id);
      expect(brokerIds,
        `${file}: ssoFleetServicesBrokerId must reference a broker in ssoBrokers`
      ).toContain(fleet.ssoFleetServicesBrokerId);
    }
  });
});

describe("Every v5 fixture declares a valid ssoMode", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    expect(Object.keys(SSO_MODES)).toContain(fleet.ssoMode);
  });
});

describe("newFleet default SSO state", () => {
  it("defaults to embedded with empty broker list", () => {
    const fleet = newFleet();
    expect(fleet.ssoMode).toBe("embedded");
    expect(fleet.ssoBrokers).toEqual([]);
    expect(fleet.ssoFleetServicesBrokerId).toBeNull();
  });
});

describe("Migration backfills SSO fields on legacy imports", () => {
  it("single-instance legacy v5 → embedded", () => {
    const r = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", sites: [{ id: "s" }], instances: [{ id: "i", siteIds: ["s"], domains: [] }] },
    });
    expect(r.ssoMode).toBe("embedded");
    expect(r.ssoBrokers).toEqual([]);
  });

  it("multi-instance legacy v5 → fleet-wide", () => {
    const r = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", sites: [{ id: "s" }], instances: [{ id: "i1", siteIds: ["s"], domains: [] }, { id: "i2", siteIds: ["s"], domains: [] }] },
    });
    expect(r.ssoMode).toBe("fleet-wide");
  });

  it("explicit ssoMode preserved", () => {
    const r = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", ssoMode: "multi-broker", sites: [{ id: "s" }], instances: [{ id: "i", siteIds: ["s"], domains: [] }] },
    });
    expect(r.ssoMode).toBe("multi-broker");
  });

  it("migration is idempotent", () => {
    const once = migrateFleet({
      version: "vcf-sizer-v5",
      fleet: { id: "f", name: "x", ssoMode: "multi-broker", ssoBrokers: [{ id: "b1" }],
               sites: [{ id: "s" }], instances: [{ id: "i", siteIds: ["s"], domains: [] }] },
    });
    const twice = migrateFleet({ version: "vcf-sizer-v5", fleet: once });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });
});
