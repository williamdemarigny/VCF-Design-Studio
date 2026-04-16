#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// generate-fixtures.mjs — one-shot generator for the v5 fixture library.
//
// Builds fleet JSON files using engine.js factories, then walks the structure
// and replaces every random `id`/`key` field with deterministic counters so
// the committed fixtures and snapshots are stable across re-runs.
//
// Re-run any time the canonical scenarios need to be regenerated. Snapshots
// are NOT regenerated here — that's `npm run test:snapshot -- -u`.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const eng = require(path.join(ROOT, "engine.js"));

const OUT_V5 = path.join(ROOT, "test-fixtures", "v5");
const OUT_V2 = path.join(ROOT, "test-fixtures", "v2");

// Walk a fleet and replace every id/key with a deterministic counter so
// fixtures stay byte-stable across runs (cryptoKey() uses Math.random()).
function makeDeterministic(fleet) {
  const counters = { fleet: 0, site: 0, inst: 0, dom: 0, clu: 0, key: 0 };
  const next = (prefix) => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}-${String(counters[prefix]).padStart(4, "0")}`;
  };
  fleet.id = next("fleet");
  for (const site of fleet.sites || []) site.id = next("site");
  for (const inst of fleet.instances || []) {
    inst.id = next("inst");
    for (const dom of inst.domains || []) {
      dom.id = next("dom");
      for (const clu of dom.clusters || []) {
        clu.id = next("clu");
        for (const e of clu.infraStack || []) e.key = next("key");
      }
      for (const e of dom.wldStack || []) e.key = next("key");
    }
  }
  return fleet;
}

// Re-point siteIds / componentsClusterId / localSiteId after id rewrite.
// Easier to rebuild from scratch using the new ordering than to carry a map.
function rewireReferences(fleet) {
  const siteIdsByOrder = fleet.sites.map((s) => s.id);
  for (const inst of fleet.instances) {
    inst.siteIds = inst.siteIds.map((_, i) => siteIdsByOrder[i] || siteIdsByOrder[0]);
    for (const dom of inst.domains) {
      if (dom.placement === "local" && dom.localSiteId) {
        dom.localSiteId = inst.siteIds[0];
      }
      if (dom.componentsClusterId) {
        const mgmt = inst.domains.find((d) => d.type === "mgmt");
        dom.componentsClusterId = mgmt?.clusters?.[0]?.id ?? null;
      }
    }
  }
  // drPairedInstanceId values were captured pre-determinism rewrite; re-point
  // warm-standby instances at the initial (index 0) instance by convention.
  for (const inst of fleet.instances) {
    if (inst.drPosture === "warm-standby" && inst.drPairedInstanceId) {
      inst.drPairedInstanceId = fleet.instances[0].id;
    }
  }
  // Wire SSO broker → instance mappings by position. Broker 0 serves the
  // first half of instances, broker 1 the second half (simple split for
  // the demo fixture). Skipped if brokers/instances aren't set.
  if (Array.isArray(fleet.ssoBrokers) && fleet.ssoBrokers.length > 0 && fleet.instances.length > 0) {
    const n = fleet.instances.length;
    const b = fleet.ssoBrokers.length;
    for (let i = 0; i < b; i++) {
      const start = Math.floor((i * n) / b);
      const end = Math.floor(((i + 1) * n) / b);
      fleet.ssoBrokers[i].servesInstanceIds = fleet.instances
        .slice(start, end).map((inst) => inst.id);
    }
  }
  return fleet;
}

function wrap(fleet) {
  return {
    version: "vcf-sizer-v5",
    exportedAt: "2026-04-15T12:00:00.000Z",
    fleet: rewireReferences(makeDeterministic(fleet)),
  };
}

function writeJson(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`wrote ${path.relative(ROOT, p)}`);
}

// ─── minimal-simple ─────────────────────────────────────────────────────────
// Single site, "simple" deployment profile, mgmt-only, smallest possible fleet.
function makeMinimalSimple() {
  const fleet = eng.newFleet();
  fleet.name = "Minimal Simple Fleet";
  fleet.sites[0].name = "Lab Site";
  const inst = fleet.instances[0];
  inst.name = "lab-instance";
  inst.deploymentProfile = "simple";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  // Stack appropriate to the profile
  inst.domains[0].clusters[0].infraStack =
    eng.DEPLOYMENT_PROFILES.simple.stack.map((e) => ({ ...e, key: eng.cryptoKey() }));
  return fleet;
}

// ─── minimal-ha ─────────────────────────────────────────────────────────────
// Single site, "ha" profile, mgmt + 1 workload domain with a small VM count.
function makeMinimalHa() {
  const fleet = eng.newFleet();
  fleet.name = "Minimal HA Fleet";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.DEPLOYMENT_PROFILES.ha.stack.map((e) => ({ ...e, key: eng.cryptoKey() }));

  const wld = eng.newWorkloadDomain("Workload Domain 01");
  wld.placement = "local";
  wld.localSiteId = fleet.sites[0].id;
  wld.componentsClusterId = inst.domains[0].clusters[0].id;
  wld.clusters[0].workload = { vmCount: 50, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
  inst.domains.push(wld);
  return fleet;
}

// ─── stretched-50-50 ────────────────────────────────────────────────────────
// Two sites, stretched mgmt + workload, 50/50 host split, witness enabled.
function makeStretched5050() {
  const fleet = eng.newFleet();
  fleet.name = "Stretched 50/50 Fleet";
  fleet.sites[0].name = "Site A";
  fleet.sites.push(eng.newSite("Site B", "DR"));
  const inst = fleet.instances[0];
  inst.name = "stretched-instance";
  inst.deploymentProfile = "ha";
  inst.siteIds = fleet.sites.map((s) => s.id);
  inst.witnessEnabled = true;
  inst.witnessSize = "Medium";
  inst.domains[0].placement = "stretched";
  inst.domains[0].hostSplitPct = 50;
  inst.domains[0].clusters[0].infraStack =
    eng.DEPLOYMENT_PROFILES.ha.stack.map((e) => ({ ...e, key: eng.cryptoKey() }));

  const wld = eng.newWorkloadDomain("Stretched Workload");
  wld.placement = "stretched";
  wld.hostSplitPct = 50;
  wld.componentsClusterId = inst.domains[0].clusters[0].id;
  wld.clusters[0].workload = { vmCount: 200, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
  inst.domains.push(wld);

  inst.appliancePlacement = eng.buildDefaultPlacement(inst);
  return fleet;
}

// ─── enterprise-full ────────────────────────────────────────────────────────
// Two sites, full federation+site-protection profile, stretched, witness,
// multiple workload domains, tiering enabled, multiple clusters per domain.
function makeEnterpriseFull() {
  const fleet = eng.newFleet();
  fleet.name = "Enterprise Full Fleet";
  fleet.sites[0].name = "DC East";
  fleet.sites.push(eng.newSite("DC West", "WEST"));
  const inst = fleet.instances[0];
  inst.name = "enterprise-instance";
  // Single stretched instance — use haSiteProtection (NOT haFederation*,
  // since VCF-INV-051 requires Federation profiles to have >= 2 instances).
  // Federation coverage lives in multi-instance-federated.json.
  inst.deploymentProfile = "haSiteProtection";
  inst.siteIds = fleet.sites.map((s) => s.id);
  inst.witnessEnabled = true;
  inst.witnessSize = "Large";

  const mgmtDom = inst.domains[0];
  mgmtDom.placement = "stretched";
  mgmtDom.hostSplitPct = 50;
  mgmtDom.clusters[0].infraStack =
    eng.DEPLOYMENT_PROFILES.haSiteProtection.stack.map((e) => ({ ...e, key: eng.cryptoKey() }));
  // Beefier mgmt host spec
  mgmtDom.clusters[0].host = {
    ...mgmtDom.clusters[0].host,
    cpuQty: 2, coresPerCpu: 24, ramGb: 1536,
    nvmeQty: 8, nvmeSizeTb: 7.68,
    hyperthreadingEnabled: true,
  };

  // Workload domain with TWO clusters and tiering on the second
  const wldA = eng.newWorkloadDomain("Production Workload");
  wldA.placement = "stretched";
  wldA.hostSplitPct = 50;
  wldA.componentsClusterId = mgmtDom.clusters[0].id;
  wldA.clusters[0].name = "prod-cluster-01";
  wldA.clusters[0].workload = { vmCount: 400, vcpuPerVm: 4, ramPerVm: 32, diskPerVm: 200 };
  wldA.clusters[0].host = {
    ...wldA.clusters[0].host,
    cpuQty: 2, coresPerCpu: 32, ramGb: 2048,
    nvmeQty: 10, nvmeSizeTb: 7.68,
    hyperthreadingEnabled: true,
  };
  wldA.clusters[0].storage = { ...wldA.clusters[0].storage, policy: "raid6_4p2", dedup: 1.3, compression: 1.2 };

  const tierClu = eng.newCluster("prod-cluster-02-tiered", false);
  tierClu.workload = { vmCount: 200, vcpuPerVm: 8, ramPerVm: 64, diskPerVm: 400 };
  tierClu.host = {
    ...tierClu.host,
    cpuQty: 2, coresPerCpu: 32, ramGb: 1024,
    nvmeQty: 10, nvmeSizeTb: 7.68,
    hyperthreadingEnabled: true,
  };
  tierClu.tiering = { enabled: true, nvmePct: 50, eligibilityPct: 70, tierDriveSizeTb: 7.68 };
  wldA.clusters.push(tierClu);

  // External-storage workload
  const wldB = eng.newWorkloadDomain("External Storage Workload");
  wldB.placement = "stretched";
  wldB.hostSplitPct = 50;
  wldB.componentsClusterId = mgmtDom.clusters[0].id;
  wldB.clusters[0].name = "ext-cluster-01";
  wldB.clusters[0].workload = { vmCount: 100, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
  wldB.clusters[0].storage = { ...wldB.clusters[0].storage, externalStorage: true, externalArrayTib: 100 };

  inst.domains.push(wldA, wldB);
  inst.appliancePlacement = eng.buildDefaultPlacement(inst);
  return fleet;
}

// ─── v2 minimal — hand-built JSON in the legacy v2 shape ────────────────────
function makeMinimalV2() {
  // The v2 schema is flat: mgmt + wlds[]. No sites, no instances.
  return {
    version: "vcf-sizer-v2",
    exportedAt: "2024-01-15T08:00:00.000Z",
    mgmt: {
      name: "Management Domain",
      host: {
        cpuQty: 2, coresPerCpu: 16, ramGb: 512,
        nvmeQty: 4, nvmeSizeTb: 3.84,
        cpuOversub: 2, ramOversub: 1, reservePct: 30,
      },
      stack: [
        { id: "vcenter", size: "Medium", instances: 1 },
        { id: "nsxMgr",  size: "Medium", instances: 3 },
      ],
      storage: {
        policy: "raid5_2p1", dedup: 1.0, compression: 1.0,
        swapPct: 100, freePct: 25, growthPct: 15,
        externalStorage: false, externalArrayTib: 0,
      },
    },
    wlds: [
      {
        name: "Workload Domain 01",
        host: {
          cpuQty: 2, coresPerCpu: 16, ramGb: 768,
          nvmeQty: 6, nvmeSizeTb: 7.68,
          cpuOversub: 4, ramOversub: 1, reservePct: 25,
        },
        vmCount: 100, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100,
        infraStack: [],
        storage: {
          policy: "raid6_4p2", dedup: 1.2, compression: 1.0,
          swapPct: 100, freePct: 25, growthPct: 20,
          externalStorage: false, externalArrayTib: 0,
        },
      },
    ],
  };
}

// ─── greenfield-single-instance ─────────────────────────────────────────────
// VCF-PATH-001: explicit greenfield pathway on a single-instance fleet.
function makeGreenfieldSingleInstance() {
  const fleet = eng.newFleet();
  fleet.name = "Greenfield Single-Instance Fleet";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  return fleet;
}

// ─── expand-fleet-2 ─────────────────────────────────────────────────────────
// VCF-PATH-002: two-instance fleet that explicitly declares the expand
// pathway. Initial instance carries the full HA stack; instance[1] (the
// expand-fleet addition) has only per-instance appliances + Collector.
function makeExpandFleet2() {
  const fleet = eng.newFleet();
  fleet.name = "Expand-Fleet Demo";
  fleet.deploymentPathway = "expand";
  fleet.sites[0].name = "Region East";
  fleet.sites.push(eng.newSite("Region West", "WEST"));

  const inst0 = fleet.instances[0];
  inst0.name = "vcf-east-initial";
  inst0.deploymentProfile = "ha";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const inst1 = eng.newInstance("vcf-west-expanded", [fleet.sites[1].id]);
  inst1.deploymentProfile = "ha";
  inst1.domains[0].placement = "local";
  inst1.domains[0].localSiteId = fleet.sites[1].id;
  inst1.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  fleet.instances.push(inst1);

  return fleet;
}

// ─── multi-instance-2 ───────────────────────────────────────────────────────
// VCF-TOPO-003: 2 instances, single-site each. instance[0] carries the full
// HA stack (per-fleet appliances live here). instance[1] carries only
// per-instance appliances + a Collector (VCF-INV-011, VCF-INV-012).
function makeMultiInstance2() {
  const fleet = eng.newFleet();
  fleet.name = "Multi-Instance Fleet (2 regions)";
  fleet.deploymentPathway = "expand";
  fleet.sites[0].name = "Region East";
  fleet.sites.push(eng.newSite("Region West", "WEST"));

  // Instance 0 — initial, carries per-fleet appliances
  const inst0 = fleet.instances[0];
  inst0.name = "vcf-east";
  inst0.deploymentProfile = "ha";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  // Instance 1 — non-initial, gets filtered stack (no per-fleet appliances)
  const inst1 = eng.newInstance("vcf-west", [fleet.sites[1].id]);
  inst1.deploymentProfile = "ha";
  inst1.domains[0].placement = "local";
  inst1.domains[0].localSiteId = fleet.sites[1].id;
  inst1.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  fleet.instances.push(inst1);

  return fleet;
}

// ─── multi-instance-federated ───────────────────────────────────────────────
// VCF-TOPO-003 + NSX Federation: both instances use haFederation, initial
// carries the active GM (3 nodes), non-initial carries standby GM (3 nodes).
// Unlocks VCF-INV-021, VCF-INV-051, VCF-APP-040.
function makeMultiInstanceFederated() {
  const fleet = eng.newFleet();
  fleet.name = "Multi-Instance Federated Fleet";
  fleet.deploymentPathway = "expand";
  fleet.federationEnabled = true;
  fleet.sites[0].name = "DC Primary";
  fleet.sites.push(eng.newSite("DC Secondary", "SEC"));

  // Instance 0 — initial, carries per-fleet appliances + active GM
  const inst0 = fleet.instances[0];
  inst0.name = "vcf-primary";
  inst0.deploymentProfile = "haFederation";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  // Full federation stack on initial (active GM cluster is part of the profile)
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haFederation", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  // Instance 1 — non-initial, carries filtered stack + standby GM cluster
  const inst1 = eng.newInstance("vcf-secondary", [fleet.sites[1].id]);
  inst1.deploymentProfile = "haFederation";
  inst1.domains[0].placement = "local";
  inst1.domains[0].localSiteId = fleet.sites[1].id;
  const nonInitial = eng.stackForInstance("haFederation", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  // The filter above already included nsxGlobalMgr (scope: fleet-wide, not per-fleet).
  // Keep it — this represents the standby GM cluster at the secondary site.
  inst1.domains[0].clusters[0].infraStack = nonInitial;
  fleet.instances.push(inst1);

  return fleet;
}

// ─── sso-embedded-single ────────────────────────────────────────────────────
// VCF-SSO-001: single-instance fleet using embedded SSO (broker inside
// vCenter). Smallest configuration; no separate broker appliance.
function makeSsoEmbeddedSingle() {
  const fleet = eng.newFleet();
  fleet.name = "SSO Embedded (single-instance)";
  fleet.deploymentPathway = "greenfield";
  fleet.ssoMode = "embedded";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  return fleet;
}

// ─── sso-multi-broker-segmented ─────────────────────────────────────────────
// VCF-SSO-003: 6-instance fleet with 2 brokers (each serving 3 instances).
// Exercises VCF-INV-031 (warn threshold) and VCF-INV-032 (fleet-level
// services bind to exactly one broker).
function makeSsoMultiBrokerSegmented() {
  const fleet = eng.newFleet();
  fleet.name = "SSO Multi-Broker Segmented Fleet";
  fleet.deploymentPathway = "expand";
  fleet.ssoMode = "multi-broker";
  fleet.sites[0].name = "Region East";

  // Grow to 6 instances across 2 regions
  const regions = ["East", "East-2", "East-3", "West", "West-2", "West-3"];
  for (let i = 1; i < regions.length; i++) {
    fleet.sites.push(eng.newSite(`Region ${regions[i]}`, regions[i]));
  }
  // Set each instance to single-site
  const inst0 = fleet.instances[0];
  inst0.name = "vcf-east";
  inst0.deploymentProfile = "ha";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  for (let i = 1; i < regions.length; i++) {
    const inst = eng.newInstance(`vcf-${regions[i].toLowerCase()}`, [fleet.sites[i].id]);
    inst.deploymentProfile = "ha";
    inst.domains[0].placement = "local";
    inst.domains[0].localSiteId = fleet.sites[i].id;
    inst.domains[0].clusters[0].infraStack =
      eng.stackForInstance("ha", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
    fleet.instances.push(inst);
  }

  // Two brokers: broker-east serves instances[0..2], broker-west serves instances[3..5]
  fleet.ssoBrokers = [
    { id: "broker-east", name: "Broker East", servesInstanceIds: [] },
    { id: "broker-west", name: "Broker West", servesInstanceIds: [] },
  ];
  // Defer instance-id wiring to post-determinism pass — IDs are rewritten by wrap().
  // VCF-INV-032: fleet-level services bind to exactly one broker
  fleet.ssoFleetServicesBrokerId = "broker-east";

  return fleet;
}

// ─── warm-standby-pair ──────────────────────────────────────────────────────
// VCF-DR-001/040: 2-instance fleet with the second instance marked
// warm-standby and paired to the initial. Fleet-level appliance counting
// must exclude the standby (VCF-INV-010 w/ DR exclusion).
function makeWarmStandbyPair() {
  const fleet = eng.newFleet();
  fleet.name = "Warm-Standby Pair";
  fleet.deploymentPathway = "expand";
  fleet.sites[0].name = "Primary Region";
  fleet.sites.push(eng.newSite("DR Region", "DR"));

  const inst0 = fleet.instances[0];
  inst0.name = "vcf-primary";
  inst0.deploymentProfile = "haSiteProtection";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haSiteProtection", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const inst1 = eng.newInstance("vcf-dr-standby", [fleet.sites[1].id]);
  inst1.deploymentProfile = "haSiteProtection";
  inst1.drPosture = "warm-standby";
  inst1.drPairedInstanceId = inst0.id;
  inst1.domains[0].placement = "local";
  inst1.domains[0].localSiteId = fleet.sites[1].id;
  // Warm standby carries per-instance appliances only — fleet-level
  // appliances exist on the primary and are replicated, not duplicated.
  inst1.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haSiteProtection", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  fleet.instances.push(inst1);

  // rewireReferences will fix drPairedInstanceId to point at the new inst0.id
  // after deterministic ID rewriting — handle explicitly below.
  return fleet;
}

// ─── multi-region-dr ────────────────────────────────────────────────────────
// VCF-TOPO-004 + DR: 3 instances, two primary (active) + one warm-standby.
function makeMultiRegionDr() {
  const fleet = eng.newFleet();
  fleet.name = "Multi-Region DR Fleet";
  fleet.deploymentPathway = "expand";
  fleet.sites[0].name = "Region A";
  fleet.sites.push(eng.newSite("Region B", "B"));
  fleet.sites.push(eng.newSite("Region C (DR)", "C"));

  const inst0 = fleet.instances[0];
  inst0.name = "vcf-region-a";
  inst0.deploymentProfile = "haSiteProtection";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haSiteProtection", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const inst1 = eng.newInstance("vcf-region-b", [fleet.sites[1].id]);
  inst1.deploymentProfile = "haSiteProtection";
  inst1.domains[0].placement = "local";
  inst1.domains[0].localSiteId = fleet.sites[1].id;
  inst1.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haSiteProtection", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  fleet.instances.push(inst1);

  const inst2 = eng.newInstance("vcf-region-c-dr", [fleet.sites[2].id]);
  inst2.deploymentProfile = "haSiteProtection";
  inst2.drPosture = "warm-standby";
  inst2.drPairedInstanceId = inst0.id;
  inst2.domains[0].placement = "local";
  inst2.domains[0].localSiteId = fleet.sites[2].id;
  inst2.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haSiteProtection", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  fleet.instances.push(inst2);

  return fleet;
}

// ─── additional fixture library entries ────────────────────────────────────

// federation.json — 2-instance federated fleet using haFederation profile.
// Distinct from multi-instance-federated in that it's the canonical "small
// federation" example with matching per-instance appliance layout.
function makeFederation() {
  const fleet = eng.newFleet();
  fleet.name = "Federation (canonical)";
  fleet.deploymentPathway = "expand";
  fleet.federationEnabled = true;
  fleet.sites[0].name = "Region Alpha";
  fleet.sites.push(eng.newSite("Region Beta", "BETA"));

  const inst0 = fleet.instances[0];
  inst0.name = "vcf-alpha";
  inst0.deploymentProfile = "haFederation";
  inst0.siteIds = [fleet.sites[0].id];
  inst0.domains[0].placement = "local";
  inst0.domains[0].localSiteId = fleet.sites[0].id;
  inst0.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haFederation", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const inst1 = eng.newInstance("vcf-beta", [fleet.sites[1].id]);
  inst1.deploymentProfile = "haFederation";
  inst1.domains[0].placement = "local";
  inst1.domains[0].localSiteId = fleet.sites[1].id;
  inst1.domains[0].clusters[0].infraStack =
    eng.stackForInstance("haFederation", false).map((e) => ({ ...e, key: eng.cryptoKey() }));
  fleet.instances.push(inst1);
  return fleet;
}

// all-policies.json — single instance touching every vSAN policy across clusters.
function makeAllPolicies() {
  const fleet = eng.newFleet();
  fleet.name = "All vSAN Policies";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const wld = eng.newWorkloadDomain("Workload Domain — policy matrix");
  wld.placement = "local";
  wld.localSiteId = fleet.sites[0].id;
  wld.componentsClusterId = inst.domains[0].clusters[0].id;
  // Replace the default single cluster with six, one per policy.
  wld.clusters = Object.keys(eng.POLICIES).map((policy, i) => {
    const c = eng.newCluster(`pool-${policy}`, i === 0);
    c.workload = { vmCount: 50, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
    c.storage = { ...c.storage, policy };
    return c;
  });
  inst.domains.push(wld);
  return fleet;
}

// large-workload.json — 1000 VM cluster that stresses every sizing floor.
function makeLargeWorkload() {
  const fleet = eng.newFleet();
  fleet.name = "Large Workload (1000 VMs)";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const wld = eng.newWorkloadDomain("High-density Workload");
  wld.placement = "local";
  wld.localSiteId = fleet.sites[0].id;
  wld.componentsClusterId = inst.domains[0].clusters[0].id;
  wld.clusters[0].workload = { vmCount: 1000, vcpuPerVm: 8, ramPerVm: 64, diskPerVm: 500 };
  wld.clusters[0].host = {
    ...wld.clusters[0].host,
    cpuQty: 2, coresPerCpu: 48, ramGb: 2048,
    nvmeQty: 10, nvmeSizeTb: 7.68,
    hyperthreadingEnabled: true,
  };
  inst.domains.push(wld);
  return fleet;
}

// 3-node-vsan-warning.json — tuned to resolve to exactly 3 hosts under raid5_2p1.
function make3NodeVsanWarning() {
  const fleet = eng.newFleet();
  fleet.name = "3-Node vSAN Warning (minimal demand)";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "simple";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  // Only one appliance: a tiny SDDC Manager. Workload empty. This resolves
  // to the architectural minimum (3 hosts under raid5_2p1 / mirror_ftt1),
  // triggering vsanMinWarning.
  inst.domains[0].clusters[0].infraStack = [
    { id: "sddcMgr", size: "Default", instances: 1, key: "sddc-1" },
  ];
  inst.domains[0].clusters[0].storage = {
    ...inst.domains[0].clusters[0].storage,
    policy: "raid5_2p1",
  };
  return fleet;
}

// ht-enabled.json — all clusters with hyperthreading on.
function makeHtEnabled() {
  const fleet = eng.newFleet();
  fleet.name = "Hyperthreading Enabled";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  inst.domains[0].clusters[0].host.hyperthreadingEnabled = true;

  const wld = eng.newWorkloadDomain("HT Workload");
  wld.placement = "local";
  wld.localSiteId = fleet.sites[0].id;
  wld.componentsClusterId = inst.domains[0].clusters[0].id;
  wld.clusters[0].workload = { vmCount: 300, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
  wld.clusters[0].host.hyperthreadingEnabled = true;
  inst.domains.push(wld);
  return fleet;
}

// mixed-ht.json — half HT on, half off across workload clusters.
function makeMixedHt() {
  const fleet = eng.newFleet();
  fleet.name = "Mixed Hyperthreading";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  // Two workload domains — one with HT, one without.
  for (const [name, ht] of [["HT On", true], ["HT Off", false]]) {
    const wld = eng.newWorkloadDomain(name);
    wld.placement = "local";
    wld.localSiteId = fleet.sites[0].id;
    wld.componentsClusterId = inst.domains[0].clusters[0].id;
    wld.clusters[0].workload = { vmCount: 200, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
    wld.clusters[0].host.hyperthreadingEnabled = ht;
    inst.domains.push(wld);
  }
  return fleet;
}

// override-raises-floor.json — hostOverride > architectural minimum wins.
function makeOverrideRaisesFloor() {
  const fleet = eng.newFleet();
  fleet.name = "Host Override — raises floor";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "simple";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack = [
    { id: "sddcMgr", size: "Default", instances: 1, key: "sddc-1" },
  ];
  inst.domains[0].clusters[0].hostOverride = 8;  // well above architectural min of 3
  return fleet;
}

// override-below-floor.json — hostOverride < architectural minimum → warning fires.
function makeOverrideBelowFloor() {
  const fleet = eng.newFleet();
  fleet.name = "Host Override — below floor (warning)";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));

  const wld = eng.newWorkloadDomain("Demanding Workload");
  wld.placement = "local";
  wld.localSiteId = fleet.sites[0].id;
  wld.componentsClusterId = inst.domains[0].clusters[0].id;
  wld.clusters[0].workload = { vmCount: 500, vcpuPerVm: 8, ramPerVm: 32, diskPerVm: 200 };
  wld.clusters[0].hostOverride = 2;  // deliberately below the CPU/Memory floors
  inst.domains.push(wld);
  return fleet;
}

// ─── T0 fixtures ────────────────────────────────────────────────────────────
// Small helper: ensure the mgmt cluster has an nsxEdge stack entry with a
// known `key` so T0 bindings can reference it deterministically.
function withEdgeEntry(fleet, size = "Large", instances = 2, key = "edge-1") {
  const mgmt = fleet.instances[0].domains.find((d) => d.type === "mgmt");
  const c = mgmt.clusters[0];
  c.infraStack = [...(c.infraStack || []).filter((e) => e.id !== "nsxEdge"),
    { id: "nsxEdge", size, instances, key }];
  return fleet;
}

// VCF-APP-006-T0-AS: Active/Standby T0 supporting VKS / Automation All-Apps.
function makeT0ActiveStandbyBasic() {
  const fleet = eng.newFleet();
  fleet.name = "T0 Active/Standby (basic)";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  withEdgeEntry(fleet, "Large", 2, "edge-1");
  inst.domains[0].clusters[0].t0Gateways = [{
    ...eng.newT0Gateway("t0-prod"),
    haMode: "active-standby",
    edgeNodeKeys: ["edge-1"],
    featureRequirements: ["vks"],
  }];
  return fleet;
}

// VCF-APP-006-T0-AA: Active/Active T0 stateless across 4 Edge entries.
function makeT0ActiveActiveStateless() {
  const fleet = eng.newFleet();
  fleet.name = "T0 Active/Active (stateless)";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  withEdgeEntry(fleet, "Large", 4, "edge-aa-1");
  inst.domains[0].clusters[0].t0Gateways = [{
    ...eng.newT0Gateway("t0-north"),
    haMode: "active-active",
    edgeNodeKeys: ["edge-aa-1"],
    stateful: false,
    bgpEnabled: true,
    asn: 65000,
  }];
  return fleet;
}

// Stateful A/A demo — flags Day-2 requirement via VCF-INV-064.
function makeT0StatefulAADayTwo() {
  const fleet = eng.newFleet();
  fleet.name = "T0 Stateful A/A (Day-2 config required)";
  fleet.deploymentPathway = "greenfield";
  fleet.sites[0].name = "Primary Site";
  const inst = fleet.instances[0];
  inst.deploymentProfile = "ha";
  inst.domains[0].placement = "local";
  inst.domains[0].localSiteId = fleet.sites[0].id;
  inst.domains[0].clusters[0].infraStack =
    eng.stackForInstance("ha", true).map((e) => ({ ...e, key: eng.cryptoKey() }));
  // Stateful A/A needs an EVEN node count — use 4 (two sub-cluster pairs).
  withEdgeEntry(fleet, "Large", 4, "edge-saa-1");
  inst.domains[0].clusters[0].t0Gateways = [{
    ...eng.newT0Gateway("t0-stateful"),
    haMode: "active-active",
    edgeNodeKeys: ["edge-saa-1"],
    stateful: true,
    bgpEnabled: true,
    asn: 65000,
  }];
  return fleet;
}

// ─── Run ────────────────────────────────────────────────────────────────────
writeJson(OUT_V5, "minimal-simple.json",             wrap(makeMinimalSimple()));
writeJson(OUT_V5, "minimal-ha.json",                 wrap(makeMinimalHa()));
writeJson(OUT_V5, "stretched-50-50.json",            wrap(makeStretched5050()));
writeJson(OUT_V5, "enterprise-full.json",            wrap(makeEnterpriseFull()));
writeJson(OUT_V5, "multi-instance-2.json",           wrap(makeMultiInstance2()));
writeJson(OUT_V5, "multi-instance-federated.json",   wrap(makeMultiInstanceFederated()));
writeJson(OUT_V5, "greenfield-single-instance.json", wrap(makeGreenfieldSingleInstance()));
writeJson(OUT_V5, "expand-fleet-2.json",             wrap(makeExpandFleet2()));
writeJson(OUT_V5, "sso-embedded-single.json",        wrap(makeSsoEmbeddedSingle()));
writeJson(OUT_V5, "sso-multi-broker-segmented.json", wrap(makeSsoMultiBrokerSegmented()));
writeJson(OUT_V5, "warm-standby-pair.json",          wrap(makeWarmStandbyPair()));
writeJson(OUT_V5, "multi-region-dr.json",            wrap(makeMultiRegionDr()));
writeJson(OUT_V5, "t0-active-standby-basic.json",    wrap(makeT0ActiveStandbyBasic()));
writeJson(OUT_V5, "t0-active-active-stateless.json", wrap(makeT0ActiveActiveStateless()));
writeJson(OUT_V5, "t0-stateful-aa-daytwo.json",      wrap(makeT0StatefulAADayTwo()));
writeJson(OUT_V5, "federation.json",                 wrap(makeFederation()));
writeJson(OUT_V5, "all-policies.json",               wrap(makeAllPolicies()));
writeJson(OUT_V5, "large-workload.json",             wrap(makeLargeWorkload()));
writeJson(OUT_V5, "3-node-vsan-warning.json",        wrap(make3NodeVsanWarning()));
writeJson(OUT_V5, "ht-enabled.json",                 wrap(makeHtEnabled()));
writeJson(OUT_V5, "mixed-ht.json",                   wrap(makeMixedHt()));
writeJson(OUT_V5, "override-raises-floor.json",      wrap(makeOverrideRaisesFloor()));
writeJson(OUT_V5, "override-below-floor.json",       wrap(makeOverrideBelowFloor()));
writeJson(OUT_V2, "minimal-v2.json",                 makeMinimalV2());
