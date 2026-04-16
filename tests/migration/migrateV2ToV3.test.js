import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";
const { migrateV2ToV3 } = VcfEngine;

const minimalV2 = () => ({
  version: "vcf-sizer-v2",
  mgmt: {
    name: "Management Domain",
    host: { cpuQty: 2, coresPerCpu: 16, ramGb: 512, nvmeQty: 4, nvmeSizeTb: 3.84,
            cpuOversub: 2, ramOversub: 1, reservePct: 30 },
    stack: [{ id: "vcenter", size: "Medium", instances: 1 }],
    storage: { policy: "raid5_2p1", dedup: 1, compression: 1, swapPct: 100,
               freePct: 25, growthPct: 15, externalStorage: false, externalArrayTib: 0 },
  },
  wlds: [
    {
      name: "Workload Domain 01",
      host: { cpuQty: 2, coresPerCpu: 16, ramGb: 768, nvmeQty: 6, nvmeSizeTb: 7.68,
              cpuOversub: 4, ramOversub: 1, reservePct: 25 },
      vmCount: 100, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100,
      storage: { policy: "raid6_4p2", dedup: 1.2, compression: 1, swapPct: 100,
                 freePct: 25, growthPct: 20, externalStorage: false, externalArrayTib: 0 },
    },
  ],
});

describe("migrateV2ToV3 — shape", () => {
  it("produces a fleet with one site, one instance, and 1 + N domains", () => {
    const r = migrateV2ToV3(minimalV2());
    expect(r.id).toMatch(/^fleet-/);
    expect(r.sites.length).toBe(1);
    const site = r.sites[0];
    expect(site.instances.length).toBe(1);
    expect(site.instances[0].domains.length).toBe(2);  // 1 mgmt + 1 wld
  });

  it("preserves mgmt host spec verbatim", () => {
    const v2 = minimalV2();
    const r = migrateV2ToV3(v2);
    const mgmtCluster = r.sites[0].instances[0].domains[0].clusters[0];
    expect(mgmtCluster.host).toEqual(v2.mgmt.host);
  });

  it("preserves mgmt infra stack", () => {
    const v2 = minimalV2();
    const r = migrateV2ToV3(v2);
    const mgmtCluster = r.sites[0].instances[0].domains[0].clusters[0];
    expect(mgmtCluster.infraStack.length).toBe(1);
    expect(mgmtCluster.infraStack[0].id).toBe("vcenter");
    expect(mgmtCluster.infraStack[0].key).toBeDefined();
  });

  it("converts each v2 wld into a workload domain", () => {
    const v2 = minimalV2();
    const r = migrateV2ToV3(v2);
    const wld = r.sites[0].instances[0].domains[1];
    expect(wld.type).toBe("workload");
    expect(wld.clusters.length).toBe(1);
    expect(wld.clusters[0].workload.vmCount).toBe(100);
    expect(wld.clusters[0].host.cpuOversub).toBe(4);
  });

  it("uses defaults for missing wld fields", () => {
    const v2 = { version: "vcf-sizer-v2", mgmt: { host: { cpuQty: 1, coresPerCpu: 4, ramGb: 32, nvmeQty: 1, nvmeSizeTb: 1, cpuOversub: 1, ramOversub: 1, reservePct: 0 }}, wlds: [{}] };
    const r = migrateV2ToV3(v2);
    const wldCluster = r.sites[0].instances[0].domains[1].clusters[0];
    expect(wldCluster.workload.vcpuPerVm).toBe(4);
    expect(wldCluster.workload.ramPerVm).toBe(16);
    expect(wldCluster.workload.diskPerVm).toBe(100);
    expect(wldCluster.workload.vmCount).toBe(0);
  });

  it("produces unique IDs for fleet/site/instance/domain/cluster", () => {
    const r = migrateV2ToV3(minimalV2());
    const ids = new Set();
    ids.add(r.id);
    for (const s of r.sites) {
      ids.add(s.id);
      for (const i of s.instances) {
        ids.add(i.id);
        for (const d of i.domains) {
          ids.add(d.id);
          for (const c of d.clusters) ids.add(c.id);
        }
      }
    }
    // 1 fleet + 1 site + 1 instance + 2 domains + 2 clusters = 7
    expect(ids.size).toBe(7);
  });
});
