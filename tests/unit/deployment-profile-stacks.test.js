// VCF-INV-050 — deployment profile stack composition must match
// DEPLOYMENT_PROFILES exactly. Each profile's stack references appliances
// that exist in APPLIANCE_DB at sizes that exist in their sizes table, with
// sane instance counts.
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { APPLIANCE_DB, DEPLOYMENT_PROFILES, stackForInstance } = VcfEngine;

const EXPECTED_PROFILES = ["simple", "ha", "haFederation", "haSiteProtection", "haFederationSiteProtection"];

describe("VCF-INV-050: profile stack matches DEPLOYMENT_PROFILES exactly", () => {
  it("exposes the five canonical profiles (no more, no less)", () => {
    expect(Object.keys(DEPLOYMENT_PROFILES).sort()).toEqual([...EXPECTED_PROFILES].sort());
  });

  it.each(EXPECTED_PROFILES)("%s profile: every stack entry references a known appliance", (profileKey) => {
    const profile = DEPLOYMENT_PROFILES[profileKey];
    for (const entry of profile.stack) {
      expect(APPLIANCE_DB[entry.id], `${profileKey}/${entry.id} not in APPLIANCE_DB`).toBeDefined();
    }
  });

  it.each(EXPECTED_PROFILES)("%s profile: every stack entry uses a valid size", (profileKey) => {
    const profile = DEPLOYMENT_PROFILES[profileKey];
    for (const entry of profile.stack) {
      const def = APPLIANCE_DB[entry.id];
      expect(def.sizes[entry.size], `${profileKey}/${entry.id}/${entry.size} not in sizes table`).toBeDefined();
    }
  });

  it.each(EXPECTED_PROFILES)("%s profile: instance counts are positive integers", (profileKey) => {
    const profile = DEPLOYMENT_PROFILES[profileKey];
    for (const entry of profile.stack) {
      expect(Number.isInteger(entry.instances), `${profileKey}/${entry.id} instances not int`).toBe(true);
      expect(entry.instances).toBeGreaterThan(0);
    }
  });

  it("'simple' profile uses non-clustered appliances (no 3-node HA)", () => {
    // Note: vCLS legitimately runs 2 instances per cluster regardless of
    // profile — it's not HA clustering, it's required co-location.
    for (const entry of DEPLOYMENT_PROFILES.simple.stack) {
      if (entry.id === "vcls") continue;
      expect(entry.instances,
        `simple/${entry.id} should not be HA-clustered (3+) under simple profile`
      ).toBeLessThan(3);
    }
  });

  it("'ha' profile scales stateful appliances to 3-node clusters", () => {
    const ha = DEPLOYMENT_PROFILES.ha.stack;
    const triples = ha.filter((e) => e.instances === 3).map((e) => e.id);
    // Known HA-clustered appliances per research §2 (VCF-APP-004, 010, 013, 020, 030)
    for (const required of ["nsxMgr", "vcfOps", "vcfOpsLogs"]) {
      expect(triples, `ha profile should cluster ${required} to 3 nodes`).toContain(required);
    }
  });

  it("'haFederation' profile includes a 3-node nsxGlobalMgr", () => {
    const fed = DEPLOYMENT_PROFILES.haFederation.stack;
    const gm = fed.find((e) => e.id === "nsxGlobalMgr");
    expect(gm, "haFederation must include nsxGlobalMgr").toBeDefined();
    expect(gm.instances, "nsxGlobalMgr in haFederation must be 3 nodes").toBe(3);
  });

  it("'haSiteProtection' profile includes SRM + VRMS", () => {
    const ids = DEPLOYMENT_PROFILES.haSiteProtection.stack.map((e) => e.id);
    expect(ids).toContain("srm");
    expect(ids).toContain("vrms");
  });

  it("'haFederationSiteProtection' combines federation + site protection appliances", () => {
    const ids = DEPLOYMENT_PROFILES.haFederationSiteProtection.stack.map((e) => e.id);
    expect(ids).toContain("nsxGlobalMgr");
    expect(ids).toContain("srm");
    expect(ids).toContain("vrms");
  });
});

describe("VCF-INV-050 helper: stackForInstance filters per-fleet appliances on non-initial instances", () => {
  it("initial instance gets the full ha profile", () => {
    const initial = stackForInstance("ha", true);
    const full = DEPLOYMENT_PROFILES.ha.stack;
    expect(initial.length).toBe(full.length);
  });

  it("non-initial instance drops per-fleet appliances from ha profile", () => {
    const full = DEPLOYMENT_PROFILES.ha.stack;
    const filtered = stackForInstance("ha", false);
    const perFleetIds = Object.entries(APPLIANCE_DB)
      .filter(([, def]) => def.scope === "per-fleet")
      .map(([id]) => id);
    for (const e of filtered) {
      expect(perFleetIds, `${e.id} should not be in non-initial stack`).not.toContain(e.id);
    }
    // Filtered stack is strictly smaller than full stack (something was dropped)
    expect(filtered.length).toBeLessThan(full.length);
  });

  it("returns [] for an unknown profile key", () => {
    expect(stackForInstance("not-a-profile", true)).toEqual([]);
  });
});
