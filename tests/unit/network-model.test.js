import { describe, it, expect } from 'vitest';
import VcfEngine from '../../engine.js';

const {
  NIC_PROFILES,
  VLAN_ID_MIN,
  VLAN_ID_MAX,
  MTU_MGMT,
  MTU_VMOTION,
  MTU_VSAN,
  MTU_TEP_MIN,
  MTU_TEP_RECOMMENDED,
  DEFAULT_BGP_ASN_AA,
  TEP_POOL_GROWTH_FACTOR,
  createFleetNetworkConfig,
  createClusterNetworks,
  createHostIpOverride,
  migrateFleet,
  migrateV5ToV6,
  newFleet,
  newMgmtCluster,
  newWorkloadCluster,
  newT0Gateway,
} = VcfEngine;

describe('NIC_PROFILES constants', () => {
  it('has keys 2-nic, 4-nic, 6-nic, 8-nic', () => {
    expect(NIC_PROFILES).toHaveProperty('2-nic');
    expect(NIC_PROFILES).toHaveProperty('4-nic');
    expect(NIC_PROFILES).toHaveProperty('6-nic');
    expect(NIC_PROFILES).toHaveProperty('8-nic');
  });

  it('each NIC_PROFILES entry has nicCount, uplinks, vds, portgroups, teaming', () => {
    for (const key of ['2-nic', '4-nic', '6-nic', '8-nic']) {
      const profile = NIC_PROFILES[key];
      expect(profile).toHaveProperty('nicCount');
      expect(profile).toHaveProperty('uplinks');
      expect(profile).toHaveProperty('vds');
      expect(profile).toHaveProperty('portgroups');
      expect(profile).toHaveProperty('teaming');
    }
  });

  it('NIC_PROFILES[id].uplinks.length === NIC_PROFILES[id].nicCount', () => {
    for (const key of ['2-nic', '4-nic', '6-nic', '8-nic']) {
      const profile = NIC_PROFILES[key];
      expect(profile.uplinks.length).toBe(profile.nicCount);
    }
  });
});

describe('MTU constants', () => {
  it('MTU_MGMT === 1500', () => {
    expect(MTU_MGMT).toBe(1500);
  });

  it('MTU_VMOTION === 9000', () => {
    expect(MTU_VMOTION).toBe(9000);
  });

  it('MTU_VSAN === 9000', () => {
    expect(MTU_VSAN).toBe(9000);
  });

  it('MTU_TEP_MIN === 1600', () => {
    expect(MTU_TEP_MIN).toBe(1600);
  });

  it('MTU_TEP_RECOMMENDED === 1700', () => {
    expect(MTU_TEP_RECOMMENDED).toBe(1700);
  });
});

describe('BGP and other constants', () => {
  it('DEFAULT_BGP_ASN_AA === 65000', () => {
    expect(DEFAULT_BGP_ASN_AA).toBe(65000);
  });

  it('TEP_POOL_GROWTH_FACTOR === 1.25', () => {
    expect(TEP_POOL_GROWTH_FACTOR).toBe(1.25);
  });

  it('VLAN_ID_MIN === 1', () => {
    expect(VLAN_ID_MIN).toBe(1);
  });

  it('VLAN_ID_MAX === 4094', () => {
    expect(VLAN_ID_MAX).toBe(4094);
  });
});

describe('createFleetNetworkConfig factory', () => {
  it('returns object with dns, ntp, syslog, rootCaBundle', () => {
    const config = createFleetNetworkConfig();
    expect(config).toHaveProperty('dns');
    expect(config).toHaveProperty('ntp');
    expect(config).toHaveProperty('syslog');
    expect(config).toHaveProperty('rootCaBundle');
  });

  it('dns.servers is empty array', () => {
    expect(createFleetNetworkConfig().dns.servers).toEqual([]);
  });

  it('dns.primaryDomain is empty string', () => {
    expect(createFleetNetworkConfig().dns.primaryDomain).toBe('');
  });

  it('ntp.timezone is UTC', () => {
    expect(createFleetNetworkConfig().ntp.timezone).toBe('UTC');
  });

  it('syslog.servers is empty array', () => {
    expect(createFleetNetworkConfig().syslog.servers).toEqual([]);
  });

  it('rootCaBundle is null', () => {
    expect(createFleetNetworkConfig().rootCaBundle).toBeNull();
  });
});

describe('createClusterNetworks factory', () => {
  it('returns object with nicProfileId, vds, mgmt, vmotion, vsan, hostTep, edgeTep, uplinks', () => {
    const net = createClusterNetworks();
    expect(net).toHaveProperty('nicProfileId');
    expect(net).toHaveProperty('vds');
    expect(net).toHaveProperty('mgmt');
    expect(net).toHaveProperty('vmotion');
    expect(net).toHaveProperty('vsan');
    expect(net).toHaveProperty('hostTep');
    expect(net).toHaveProperty('edgeTep');
    expect(net).toHaveProperty('uplinks');
  });

  it('nicProfileId === "4-nic"', () => {
    expect(createClusterNetworks().nicProfileId).toBe('4-nic');
  });

  it('mgmt.vlan === null (not a placeholder)', () => {
    expect(createClusterNetworks().mgmt.vlan).toBeNull();
  });

  it('vmotion.vlan === null', () => {
    expect(createClusterNetworks().vmotion.vlan).toBeNull();
  });

  it('vsan.vlan === null', () => {
    expect(createClusterNetworks().vsan.vlan).toBeNull();
  });

  it('hostTep.mtu === 1700', () => {
    expect(createClusterNetworks().hostTep.mtu).toBe(1700);
  });

  it('hostTep.useDhcp === false', () => {
    expect(createClusterNetworks().hostTep.useDhcp).toBe(false);
  });

  it('edgeTep.mtu === 1700', () => {
    expect(createClusterNetworks().edgeTep.mtu).toBe(1700);
  });

  it('uplinks is empty array', () => {
    expect(createClusterNetworks().uplinks).toEqual([]);
  });

  it('vds is a copy of NIC_PROFILES["4-nic"].vds', () => {
    const net = createClusterNetworks();
    const expected = NIC_PROFILES['4-nic'].vds.map(v => ({ ...v }));
    expect(net.vds).toEqual(expected);
  });
});

describe('createHostIpOverride factory', () => {
  it('hostIndex 0 returns hostIndex: 0', () => {
    const override = createHostIpOverride(0);
    expect(override.hostIndex).toBe(0);
  });

  it('MGMT IP and other IPs are null', () => {
    const override = createHostIpOverride(5);
    expect(override.hostIndex).toBe(5);
    expect(override.mgmtIp).toBeNull();
    expect(override.vmotionIp).toBeNull();
    expect(override.vsanIp).toBeNull();
    expect(override.hostTepIps).toBeNull();
    expect(override.bmcIp).toBeNull();
  });
});

describe('newFleet includes networkConfig', () => {
  it('newFleet() includes networkConfig field', () => {
    const fleet = newFleet();
    expect(fleet).toHaveProperty('networkConfig');
  });

  it('networkConfig is created by createFleetNetworkConfig', () => {
    const fleet = newFleet();
    expect(fleet.networkConfig).toEqual(createFleetNetworkConfig());
  });
});

describe('newCluster includes networks and hostOverrides', () => {
  it('newMgmtCluster() includes networks field', () => {
    const cluster = newMgmtCluster();
    expect(cluster).toHaveProperty('networks');
  });

  it('newMgmtCluster() includes hostOverrides field', () => {
    const cluster = newMgmtCluster();
    expect(cluster).toHaveProperty('hostOverrides');
    expect(Array.isArray(cluster.hostOverrides)).toBe(true);
  });

  it('newWorkloadCluster() includes networks field', () => {
    const cluster = newWorkloadCluster();
    expect(cluster).toHaveProperty('networks');
  });

  it('newWorkloadCluster() includes hostOverrides field', () => {
    const cluster = newWorkloadCluster();
    expect(cluster).toHaveProperty('hostOverrides');
    expect(Array.isArray(cluster.hostOverrides)).toBe(true);
  });
});

describe('newT0Gateway has asnLocal and bgpPeers', () => {
  it('t0Gateway has asnLocal field', () => {
    const t0 = newT0Gateway();
    expect(t0).toHaveProperty('asnLocal');
  });

  it('t0Gateway does NOT have old asn field', () => {
    const t0 = newT0Gateway();
    expect(t0).not.toHaveProperty('asn');
  });

  it('t0Gateway has bgpPeers array', () => {
    const t0 = newT0Gateway();
    expect(t0).toHaveProperty('bgpPeers');
    expect(Array.isArray(t0.bgpPeers)).toBe(true);
  });
});

describe('migrateV5ToV6 - basic migration', () => {
  it('adds networkConfig to fleet missing it', () => {
    const fleet = migrateFleet({ version: 'vcf-sizer-v5', instances: [] });
    delete fleet.networkConfig;
    const result = migrateV5ToV6(fleet);
    expect(result.networkConfig).toEqual(createFleetNetworkConfig());
  });

  it('adds networks to cluster missing it', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{ type: 'mgmt', clusters: [{ id: 'test' }].map(c => ({ ...c, networks: null })) }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].networks).toBeDefined();
  });

  it('adds hostOverrides to cluster missing it', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{ type: 'mgmt', clusters: [{ id: 'test' }].map(c => ({ ...c, hostOverrides: null })) }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].hostOverrides).toEqual([]);
  });

  it('sets version to "vcf-sizer-v6"', () => {
    const input = { version: 'vcf-sizer-v5', instances: [] };
    const result = migrateV5ToV6(input);
    expect(result.version).toBe('vcf-sizer-v6');
  });
});

describe('migrateV5ToV6 - t0Gateway field migration', () => {
  it('renames t0Gateway.asn → t0Gateway.asnLocal preserving value', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{
            t0Gateways: [{ asn: 65001 }],
          }],
        }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].t0Gateways[0].asnLocal).toBe(65001);
  });

  it('adds bgpPeers to t0Gateway missing it', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{
            t0Gateways: [{ id: 't0-test' }],
          }],
        }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].t0Gateways[0].bgpPeers).toEqual([]);
  });

  it('does NOT overwrite existing bgpPeers if already populated', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{
            t0Gateways: [{
              id: 't0-test',
              bgpPeers: [{ peerIp: '10.0.0.1', peerAsn: 65002 }],
            }],
          }],
        }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].t0Gateways[0].bgpPeers).toEqual([
      { peerIp: '10.0.0.1', peerAsn: 65002 },
    ]);
  });

  it('asnLocal takes precedence over old asn field', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{
            t0Gateways: [{
              asnLocal: 65003,
              asn: 65001,
            }],
          }],
        }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].t0Gateways[0].asnLocal).toBe(65003);
  });
});

describe('migrateV5ToV6 - does NOT overwrite existing fields', () => {
  it('does NOT overwrite existing networks if cluster already migrated to v6', () => {
    const input = {
      version: 'vcf-sizer-v6',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{
            id: 'test',
            networks: {
              nicProfileId: 'custom-profile',
              customField: 'keep-me',
            },
          }],
        }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].networks).toEqual({
      nicProfileId: 'custom-profile',
      customField: 'keep-me',
    });
  });

  it('does NOT overwrite existing hostOverrides', () => {
    const input = {
      version: 'vcf-sizer-v6',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{
            id: 'test',
            hostOverrides: [
              { hostIndex: 0, mgmtIp: '10.0.0.10' },
            ],
          }],
        }],
      }],
    };
    const result = migrateV5ToV6(input);
    expect(result.instances[0].domains[0].clusters[0].hostOverrides).toEqual([
      { hostIndex: 0, mgmtIp: '10.0.0.10' },
    ]);
  });
});

describe('migrateV5ToV6 idempotency', () => {
  it('migrateV5ToV6(migrateV5ToV6(fleet)) deep-equals migrateV5ToV6(fleet)', () => {
    const fleet = migrateFleet({ version: 'vcf-sizer-v5', instances: [] });
    const once = migrateV5ToV6(fleet);
    const twice = migrateV5ToV6(once);
    expect(twice).toEqual(once);
  });

  it('t0Gateway asnLocal migration is idempotent', () => {
    const input = {
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{ type: 'mgmt', clusters: [{ t0Gateways: [{ asn: 65001 }] }] }],
      }],
    };
    const once = migrateV5ToV6(input);
    const twice = migrateV5ToV6(once);
    expect(once.instances[0].domains[0].clusters[0].t0Gateways[0].asnLocal).toBe(65001);
    expect(twice.instances[0].domains[0].clusters[0].t0Gateways[0].asnLocal).toBe(65001);
    expect(once).toEqual(twice);
  });
});

describe('migrateFleet v5 → v6 integration', () => {
  it('v5 fixture imports get networkConfig backfilled', () => {
    const fleet = migrateFleet({ version: 'vcf-sizer-v5', instances: [] });
    expect(fleet.networkConfig).toBeDefined();
    expect(fleet.networkConfig).toEqual(createFleetNetworkConfig());
  });

  it('v5 fixture t0Gateways get bgpPeers and asnLocal', () => {
    const fleet = migrateFleet({
      version: 'vcf-sizer-v5',
      instances: [{
        domains: [{
          type: 'mgmt',
          clusters: [{ t0Gateways: [{ asn: 65001 }] }],
        }],
      }],
    });
    const t0 = fleet.instances[0].domains[0].clusters[0].t0Gateways[0];
    expect(t0.asnLocal).toBe(65001);
    expect(t0.bgpPeers).toEqual([]);
  });

  it('v3 fixture imports still work end-to-end (v3 → v5 → v6)', () => {
    const fs = require('fs');
    const raw = JSON.parse(fs.readFileSync('test-fixtures/v3/vcf-fleet-2026-04-10.json', 'utf8'));
    const result = migrateFleet(raw);
    expect(result.version).toBe('vcf-sizer-v6');
    expect(result.networkConfig).toBeDefined();
    expect(result.instances[0].domains[0].clusters[0].networks).toBeDefined();
    expect(result.instances[0].domains[0].clusters[0].hostOverrides).toEqual([]);
  });

  it('v2 fixture imports still work end-to-end (v2 → v3 → v5 → v6)', () => {
    const fs = require('fs');
    const raw = JSON.parse(fs.readFileSync('test-fixtures/v2/minimal-v2.json', 'utf8'));
    const result = migrateFleet(raw);
    expect(result.version).toBe('vcf-sizer-v6');
    expect(result.networkConfig).toBeDefined();
    expect(result.instances[0].domains[0].clusters[0].networks).toBeDefined();
  });

  it('null/empty input returns newFleet() with networkConfig', () => {
    const result = migrateFleet(null);
    expect(result.version).toBe('vcf-sizer-v6');
    expect(result.networkConfig).toBeDefined();
    expect(result.instances[0].domains[0].clusters[0].networks).toBeDefined();
    expect(result.instances[0].domains[0].clusters[0].hostOverrides).toEqual([]);
  });

  it('empty object input returns newFleet() with networkConfig', () => {
    const result = migrateFleet({});
    expect(result.version).toBe('vcf-sizer-v6');
    expect(result.networkConfig).toBeDefined();
  });
});

describe('migrateFleet v6 input is handled correctly', () => {
  it('v6 input does not re-run migrateV3ToV5', () => {
    const fleet = {
      version: 'vcf-sizer-v6',
      instances: [],
      someV6Field: 'keep-me',
    };
    const result = migrateFleet(fleet);
    expect(result.version).toBe('vcf-sizer-v6');
    // Check that someV6Field is preserved (not overwritten by v3 migration)
    expect(result.someV6Field).toBe('keep-me');
  });
});
