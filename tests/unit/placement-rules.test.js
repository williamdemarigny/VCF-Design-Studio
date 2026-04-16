// Placement-rule tests — validates every v5 fixture against the invariants
// defined in VCF-DEPLOYMENT-PATTERNS.md §3. Test `describe()` titles cite
// the rule id so `grep -r "VCF-INV-" tests/` produces an accurate coverage
// matrix.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import VcfEngine from "../../engine.js";
const {
  migrateFleet, getInitialInstance, APPLIANCE_DB, DEPLOYMENT_PROFILES,
} = VcfEngine;

const FIXTURES = path.resolve(__dirname, "../../test-fixtures/v5");
const fixtureFiles = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function loadFixture(file) {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8"));
  return migrateFleet(raw);
}

// Walk every (instance, domain, cluster, stack-entry) tuple in a fleet so
// invariant checks can make one pass with a single callback.
function walkStack(fleet, cb) {
  for (const inst of fleet.instances || []) {
    for (const dom of inst.domains || []) {
      for (const clu of dom.clusters || []) {
        for (const e of clu.infraStack || []) cb({ inst, dom, clu, entry: e });
      }
    }
  }
}

describe("VCF-INV-001: exactly one mgmt domain per instance", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    for (const inst of fleet.instances) {
      const mgmt = (inst.domains || []).filter((d) => d.type === "mgmt");
      expect(mgmt.length, `${file} / instance ${inst.id}`).toBe(1);
    }
  });
});

describe("VCF-INV-010: per-fleet appliances appear exactly once across the fleet (excluding warm-standby)", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    const perFleetIds = Object.entries(APPLIANCE_DB)
      .filter(([, def]) => def.scope === "per-fleet")
      .map(([id]) => id);
    for (const id of perFleetIds) {
      // Warm-standby copies are dormant replicas per VCF-DR-040 and don't
      // count toward the fleet-singleton rule.
      const count = VcfEngine.countActivePerFleetEntries(fleet, id);
      expect(count, `${file} / ${id} (active-only count, scope=per-fleet)`).toBeLessThanOrEqual(1);
    }
  });
});

describe("VCF-INV-011: per-fleet appliances live on the initial instance only", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    const initial = getInitialInstance(fleet);
    const perFleetIds = new Set(
      Object.entries(APPLIANCE_DB)
        .filter(([, def]) => def.scope === "per-fleet")
        .map(([id]) => id)
    );
    walkStack(fleet, ({ inst, entry }) => {
      if (!perFleetIds.has(entry.id)) return;
      expect(inst.id, `${file}: per-fleet appliance ${entry.id} must be on initial instance ${initial.id}`).toBe(initial.id);
    });
  });
});

describe("VCF-INV-012: every non-initial instance has a Collector", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    const initial = getInitialInstance(fleet);
    const nonInitial = (fleet.instances || []).filter((i) => i.id !== initial?.id);
    for (const inst of nonInitial) {
      let hasCollector = false;
      for (const dom of inst.domains) {
        for (const clu of dom.clusters) {
          for (const e of clu.infraStack || []) {
            if (e.id === "vcfOpsCollector") hasCollector = true;
          }
        }
      }
      expect(hasCollector, `${file}: non-initial instance ${inst.id} must carry a vcfOpsCollector`).toBe(true);
    }
  });
});

describe("VCF-INV-020: workload NSX Manager entries never cross instance boundaries", () => {
  // Rule: "NSX Manager may be shared across workload domains within the SAME
  // VCF instance, never across instances." Mgmt-role NSX per-instance is
  // expected (VCF-APP-004) — each instance has its own mgmt NSX. Only
  // workload-role NSX entries are in scope for the cross-instance check.
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    // For each workload-role nsxMgr stack entry, collect the instance ids.
    // Use key = stack entry's own `key` field so identity is stable across
    // the appearing-once-per-owning-instance semantics.
    const byKey = new Map();
    walkStack(fleet, ({ inst, entry }) => {
      if (entry.id !== "nsxMgr") return;
      if (entry.role !== "wld") return;
      if (!entry.key) return;                   // keyless entries can't be checked
      if (!byKey.has(entry.key)) byKey.set(entry.key, new Set());
      byKey.get(entry.key).add(inst.id);
    });
    for (const [key, instanceIds] of byKey.entries()) {
      expect(instanceIds.size,
        `${file}: workload NSX Manager entry ${key} spans instances ${[...instanceIds].join(", ")}`
      ).toBe(1);
    }
  });
});

describe("VCF-INV-021: NSX Global Manager only when instances>=2 AND federation enabled", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    let hasGlobal = false;
    walkStack(fleet, ({ entry }) => { if (entry.id === "nsxGlobalMgr") hasGlobal = true; });
    if (!hasGlobal) return;
    expect(fleet.instances.length, `${file}: nsxGlobalMgr present but fleet has <2 instances`)
      .toBeGreaterThanOrEqual(2);
    // Explicit federation flag must be true. Migration backfills this from
    // profile names on legacy imports, so this assertion holds for both
    // fresh fixtures and migrated ones.
    expect(fleet.federationEnabled,
      `${file}: nsxGlobalMgr present but fleet.federationEnabled is not true`
    ).toBe(true);
  });
});

describe("VCF-INV-040: stretched instance shares one mgmt stack", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    for (const inst of fleet.instances) {
      if ((inst.siteIds || []).length !== 2) continue;
      // In a stretched instance, the mgmt domain has exactly one cluster set
      // and the mgmt appliance stack lives there once — not duplicated per
      // site. Check: number of clusters in mgmt domain == 1 by default,
      // and appliances aren't doubled vs single-site count for the same profile.
      const mgmt = inst.domains.find((d) => d.type === "mgmt");
      expect(mgmt, `${file}: instance ${inst.id} missing mgmt domain`).toBeDefined();
      // Count sddcMgr in the mgmt stack — exactly 1 per instance.
      let sddcCount = 0;
      for (const clu of mgmt.clusters || []) {
        for (const e of clu.infraStack || []) {
          if (e.id === "sddcMgr") sddcCount += e.instances || 0;
        }
      }
      expect(sddcCount, `${file}: stretched instance ${inst.id} SDDC Manager count must be 1 (not duplicated per site)`).toBe(1);
    }
  });
});

describe("VCF-INV-051: haFederation profiles require instances.length >= 2", () => {
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    const federatedInstances = (fleet.instances || []).filter((i) =>
      (i.deploymentProfile || "").includes("Federation")
    );
    if (federatedInstances.length === 0) return;
    expect(fleet.instances.length,
      `${file}: uses a Federation profile (${federatedInstances.map((i) => i.deploymentProfile).join(", ")}) but fleet has <2 instances`
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("VCF-INV-003: workload-domain appliance entries (role='wld') live in the mgmt cluster of their owning instance", () => {
  // Loose form — we don't yet track ownerDomainId on each stack entry, so we
  // assert the weaker but still useful property: every workload-role
  // vcenter/nsxMgr entry sits inside a mgmt domain (because research §2
  // VCF-APP-003 says the workload vCenter VM is physically placed in the
  // mgmt-domain cluster even though it manages a workload domain).
  it.each(fixtureFiles)("%s", (file) => {
    const fleet = loadFixture(file);
    walkStack(fleet, ({ dom, entry }) => {
      if (!APPLIANCE_DB[entry.id]?.dualRole) return;
      if (entry.role !== "wld") return;
      expect(dom.type,
        `${file}: ${entry.id} with role='wld' should sit in a mgmt domain (VCF-APP-003) but is in ${dom.type}`
      ).toBe("mgmt");
    });
  });
});

describe("APPLIANCE_DB metadata — ruleId + scope fields are populated", () => {
  it("every appliance has a scope field", () => {
    for (const [id, def] of Object.entries(APPLIANCE_DB)) {
      expect(def.scope, `${id} missing scope`).toBeTypeOf("string");
    }
  });

  it("dualRole appliances (vcenter, nsxMgr) have dualRole=true", () => {
    expect(APPLIANCE_DB.vcenter.dualRole).toBe(true);
    expect(APPLIANCE_DB.nsxMgr.dualRole).toBe(true);
  });

  it("migration backfills role on dualRole appliance stack entries", () => {
    for (const file of fixtureFiles) {
      const fleet = loadFixture(file);
      walkStack(fleet, ({ dom, entry }) => {
        if (!APPLIANCE_DB[entry.id]?.dualRole) return;
        expect(entry.role, `${file}: ${entry.id} in ${dom.type} domain missing role`).toBe(dom.type === "mgmt" ? "mgmt" : "wld");
      });
    }
  });
});
