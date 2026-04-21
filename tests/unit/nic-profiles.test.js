// nic-profiles.test.js — NIC profile catalog tests.
// Validates NIC_PROFILES schema (the createNicProfile factory is NOT implemented;
// that is a Phase 1 item that was deferred — only NIC_PROFILES constants exist).
import { describe, it, expect } from "vitest";
import VcfEngine from "../../engine.js";

const {
  NIC_PROFILES,
} = VcfEngine;

describe("NIC_PROFILES catalog schema", () => {
  it("has exactly 4 profiles: 2-nic, 4-nic, 6-nic, 8-nic", () => {
    expect(Object.keys(NIC_PROFILES)).toEqual(["2-nic", "4-nic", "6-nic", "8-nic"]);
  });

  it("every profile has nicCount matching its key numeric suffix", () => {
    for (const [key, profile] of Object.entries(NIC_PROFILES)) {
      const expected = parseInt(key, 10);
      expect(profile.nicCount).toBe(expected);
    }
  });

  it("every profile has uplinks array with nicCount entries", () => {
    for (const [key, profile] of Object.entries(NIC_PROFILES)) {
      expect(profile.uplinks).toHaveLength(profile.nicCount);
    }
  });

  it("every profile has vds array", () => {
    for (const profile of Object.values(NIC_PROFILES)) {
      expect(Array.isArray(profile.vds)).toBe(true);
    }
  });

  it("every profile has portgroups object with mgmt, vmotion, vsan, hostTep (no edgeTep)", () => {
    for (const profile of Object.values(NIC_PROFILES)) {
      for (const key of ["mgmt", "vmotion", "vsan", "hostTep"]) {
        expect(profile.portgroups).toHaveProperty(key);
      }
      expect(profile.portgroups).not.toHaveProperty("edgeTep");
    }
  });

  it("every profile has teaming string", () => {
    for (const profile of Object.values(NIC_PROFILES)) {
      expect(typeof profile.teaming).toBe("string");
    }
  });
});

describe("NIC_PROFILES default values match plan", () => {
  it('2-nic uses loadBalanceSrcId teaming', () => {
    expect(NIC_PROFILES["2-nic"].teaming).toBe("loadBalanceSrcId");
  });

  it("2-nic profile has all traffic classes on one vds", () => {
    const pg = NIC_PROFILES["2-nic"].portgroups;
    expect(pg.mgmt).toBe(pg.vmotion);
    expect(pg.vmotion).toBe(pg.vsan);
    expect(pg.vsan).toBe(pg.hostTep);
  });

  it("4-nic profile separates mgmt/vmotion from vsan/tep", () => {
    const pg = NIC_PROFILES["4-nic"].portgroups;
    expect(pg.mgmt).not.toBe(pg.vsan);
  });
});

describe("NIC_PROFILES vds count matches nicCount", () => {
  it("2-nic has 1 vds", () => {
    expect(NIC_PROFILES["2-nic"].vds.length).toBe(1);
  });

  it("4-nic has 2 vds", () => {
    expect(NIC_PROFILES["4-nic"].vds.length).toBe(2);
  });

  it("6-nic has 3 vds", () => {
    expect(NIC_PROFILES["6-nic"].vds.length).toBe(3);
  });

  it("8-nic has 4 vds", () => {
    expect(NIC_PROFILES["8-nic"].vds.length).toBe(4);
  });
});

describe("NIC_PROFILES MTU defaults", () => {
  it("2-nic has all vds at MTU 9000", () => {
    for (const vds of NIC_PROFILES["2-nic"].vds) {
      expect(vds.mtu).toBe(9000);
    }
  });

  it("6-nic has vds-mgmt at MTU 1500", () => {
    expect(NIC_PROFILES["6-nic"].vds[0].mtu).toBe(1500);
  });

  it("6-nic has vds-vmotion-vsan at MTU 9000", () => {
    expect(NIC_PROFILES["6-nic"].vds[1].mtu).toBe(9000);
  });

  it("8-nic has 4 vds with MTU 1500, 9000, 9000, 9000", () => {
    const expected = [1500, 9000, 9000, 9000];
    for (let i = 0; i < 4; i++) {
      expect(NIC_PROFILES["8-nic"].vds[i].mtu).toBe(expected[i]);
    }
  });
});

describe("NIC_PROFILES uplink naming", () => {
  it("uses vmnic naming convention", () => {
    for (const profile of Object.values(NIC_PROFILES)) {
      for (const uplink of profile.uplinks) {
        expect(uplink).toMatch(/^vmnic\d+$/);
      }
    }
  });

  it("uplinks are sequential vmnic0, vmnic1, ...", () => {
    for (const [key, profile] of Object.entries(NIC_PROFILES)) {
      for (let i = 0; i < profile.nicCount; i++) {
        expect(profile.uplinks[i]).toBe(`vmnic${i}`);
      }
    }
  });
});
