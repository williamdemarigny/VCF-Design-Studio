import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { APPLIANCE_DB, DEPLOYMENT_PROFILES } = VcfEngine;

describe("APPLIANCE_DB — schema", () => {
  it("has at least 20 appliances", () => {
    expect(Object.keys(APPLIANCE_DB).length).toBeGreaterThanOrEqual(20);
  });

  it.each(Object.entries(APPLIANCE_DB))("appliance %s has placement, label, and at least one size", (id, def) => {
    expect(def.placement, `${id} missing placement`).toBeTypeOf("string");
    expect(def.label, `${id} missing label`).toBeTypeOf("string");
    expect(def.sizes, `${id} missing sizes`).toBeTypeOf("object");
    expect(Object.keys(def.sizes).length).toBeGreaterThan(0);
  });

  it.each(Object.entries(APPLIANCE_DB))("every size in %s has numeric vcpu/ram/disk", (id, def) => {
    for (const [sizeName, size] of Object.entries(def.sizes)) {
      expect(size.vcpu, `${id}/${sizeName} vcpu`).toBeTypeOf("number");
      expect(size.ram,  `${id}/${sizeName} ram`).toBeTypeOf("number");
      expect(size.disk, `${id}/${sizeName} disk`).toBeTypeOf("number");
      expect(size.vcpu).toBeGreaterThan(0);
      expect(size.ram).toBeGreaterThan(0);
      expect(size.disk).toBeGreaterThan(0);
    }
  });

  it("has known load-bearing appliances (vcenter, nsxMgr, sddcMgr)", () => {
    expect(APPLIANCE_DB.vcenter).toBeDefined();
    expect(APPLIANCE_DB.nsxMgr).toBeDefined();
    expect(APPLIANCE_DB.sddcMgr).toBeDefined();
    expect(APPLIANCE_DB.vsanWitness).toBeDefined();
  });

  it("vsanWitness has Tiny/Medium/Large with the documented limits", () => {
    expect(APPLIANCE_DB.vsanWitness.sizes.Tiny.vcpu).toBe(2);
    expect(APPLIANCE_DB.vsanWitness.sizes.Medium.vcpu).toBe(2);
    expect(APPLIANCE_DB.vsanWitness.sizes.Large.vcpu).toBe(2);
  });
});

describe("DEPLOYMENT_PROFILES — schema", () => {
  it("has the five known profiles", () => {
    expect(Object.keys(DEPLOYMENT_PROFILES).sort()).toEqual([
      "ha", "haFederation", "haFederationSiteProtection", "haSiteProtection", "simple",
    ].sort());
  });

  it.each(Object.entries(DEPLOYMENT_PROFILES))("%s has a non-empty stack", (name, profile) => {
    expect(Array.isArray(profile.stack), `${name} stack should be array`).toBe(true);
    expect(profile.stack.length).toBeGreaterThan(0);
    for (const entry of profile.stack) {
      expect(APPLIANCE_DB[entry.id], `${name} references unknown appliance ${entry.id}`).toBeDefined();
      expect(APPLIANCE_DB[entry.id].sizes[entry.size],
        `${name} references unknown size ${entry.id}/${entry.size}`).toBeDefined();
    }
  });
});
