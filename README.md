# VCF Design Studio

A browser-based design and sizing tool for VMware Cloud Foundation 9 fleets.
Model multi-site deployments, configure host hardware, choose vSAN protection
policies, and let the sizing engine compute host counts, storage requirements,
and vSAN licensing. Version 6 adds full network design: physical NIC
profiles, VLAN/subnet/IP pool configuration, per-host IP allocation,
network validation, and export to VCF Installer JSON and Planning
Workbook CSV — all in a single HTML file with no build step.

## Getting Started

### Quick start

1. Download or clone this repository
2. Open `vcf-design-studio-v6.html` in any modern browser (Chrome, Edge, Firefox, Safari)
3. Start designing — no installation, no server, no build step required

The entire application runs in a single HTML file. It loads React 18,
Tailwind CSS, and Babel from CDNs and runs entirely client-side.

### Typical workflow

1. **Configure your fleet** — set sites, VCF instances, deployment profile,
   and cluster hardware in the **Editor** tab
2. **Add networking** — select a NIC profile (2/4/6/8-NIC), fill in VLANs,
   subnets, and IP pools per cluster. Enter fleet DNS and NTP servers in the
   Fleet Summary panel
3. **Review the design** — switch to the **Network** tab to see physical NIC
   diagrams, VLAN/subnet map, T0 topology, and per-host IP assignments
4. **Check topology** — use the **Topology Diagram** tab for logical and
   physical fleet layout, and **Per-Site View** for resource allocation
5. **Export** — click **Export JSON** to save the full design,
   **Export Installer JSON** for VCF cloudBuilder input, or
   **Export Workbook CSV** for the Planning Workbook

### Importing an existing design

Click **Import JSON** to load a previously exported `.json` file. The studio
auto-migrates designs from older versions (v2, v3, v5) — you'll see a
notification when migration occurs. The original file is never modified.

To add an instance to an existing fleet, use **Import as new instance**
(VCF-PATH-002). This strips per-fleet appliances from the imported instance
so the current fleet's initial instance remains the sole host of those
services.

### Offline use

The app requires an internet connection on first load (to fetch React,
Tailwind, and Babel from CDNs). After that, most browsers will cache
these resources. For fully offline use, open the file once while connected,
then it will work offline from cache.

### For developers

```bash
npm install          # install dev dependencies (Vitest, Playwright)
npm test             # run full test suite
npm run build-html   # regenerate HTML from engine.js + JSX
npm run verify-html  # CI guard: check HTML matches source
npm run test:e2e     # Playwright browser tests
npm run coverage     # coverage report
```

## What's New in v6

v6 is a major release that adds **full network design** alongside the existing
compute and storage sizing. Existing v5 JSON exports auto-migrate on import.

- **Network tab** — dedicated fourth tab with Physical NIC diagrams,
  VLAN/Subnet map, NSX Edge/T0 topology visualization, and per-host IP grid
- **NIC profiles** — 4 canned physical layouts (2-NIC / 4-NIC / 6-NIC / 8-NIC)
  with per-cluster vDS, portgroup, and teaming configuration
- **VLAN & subnet design** — per-cluster fields for Management, vMotion, vSAN,
  Host TEP, and Edge TEP networks with VLAN ID, subnet CIDR, gateway, and
  IP pool ranges
- **IP allocator** — deterministic pool-driven allocation of per-host IPs
  (vmk0 mgmt, vmk1 vMotion, vmk2 vSAN, vmk10/11 TEP) with per-host override
  support and DHCP option for host TEP
- **Fleet network config** — DNS servers, NTP servers, primary domain, and
  syslog targets configured at fleet level
- **13 network validation rules** — VLAN uniqueness, pool sizing, subnet
  containment, MTU minimums, BGP peer reachability, and more
- **Export: VCF Installer JSON** — produces `bringup-spec.json`-shaped output
  with `dnsSpec`, `ntpServers`, `networkSpecs`, `hostSpecs`, and `edgeSpecs`
- **Export: Workbook CSV** — produces Planning Workbook rows for Fleet Services,
  Network Configuration, IP Address Plan, and BGP Configuration sheets
- **v5 → v6 migration** — `migrateV5ToV6` auto-backfills `networkConfig`,
  `cluster.networks`, `cluster.hostOverrides`, and `t0Gateway.bgpPeers`
- **922 automated tests** across 28 files (was 691 in v5), 98.7% statement coverage

## What It Does

- Design multi-site VCF 9 fleets with configurable hardware per cluster
- Size management and workload domains against CPU, memory, and storage constraints
- Toggle per-cluster hyperthreading/SMT to model logical-thread-based CPU capacity
- Surface a recommendation when a vSAN cluster resolves to the 3-host minimum
- Model stretched clusters spanning two sites with configurable host-split ratios
- Compute per-cluster host counts, raw storage, and licensed cores
- Analyze failover capacity for stretched deployments (green / yellow / red verdicts)
- Select a deployment pathway (greenfield / expand / converge / import) and flag
  pre-existing clusters for the converge workflow
- Promote any VCF instance to be the fleet's initial instance; the per-fleet
  appliances (VCF Operations, Automation, Fleet Manager, Logs, Networks Platform)
  automatically move with the initial flag
- Model SSO topology (embedded / fleet-wide / multi-broker), NSX Federation
  intent, T0 gateway HA modes (Active/Standby vs Active/Active, stateful A/A),
  Edge cluster deployment model (host-FT / rack-FT / AZ-FT edge-HA / AZ-FT
  vSphere-HA), and fleet DR warm-standby pairings
- Export and import fleet designs as JSON (auto-migrates older format versions);
  "Import as new instance" supports the expand-fleet workflow

## Supported Deployment Permutations

The studio can design any VCF 9.0 deployment described in
[VCF-DEPLOYMENT-PATTERNS.md](VCF-DEPLOYMENT-PATTERNS.md). Every rule ID below
(`VCF-APP-*`, `VCF-INV-*`, `VCF-TOPO-*`, `VCF-PATH-*`, `VCF-DR-*`, `VCF-SSO-*`)
is the stable contract between the research doc, the engine, and the test
suite — every test name cites the rule ID it enforces.

### Fleet Topologies (VCF-TOPO-001..004)

| ID | Shape | Example fixture |
|----|-------|-----------------|
| VCF-TOPO-001 | Single instance, single site | [minimal-simple.json](test-fixtures/v5/minimal-simple.json), [minimal-ha.json](test-fixtures/v5/minimal-ha.json) |
| VCF-TOPO-002 | Single instance, stretched across 2 sites (one shared appliance stack) | [stretched-50-50.json](test-fixtures/v5/stretched-50-50.json), [enterprise-full.json](test-fixtures/v5/enterprise-full.json) |
| VCF-TOPO-003 | Multi-instance fleet (per-fleet services on initial instance; Collector on each) | [multi-instance-2.json](test-fixtures/v5/multi-instance-2.json), [multi-instance-federated.json](test-fixtures/v5/multi-instance-federated.json) |
| VCF-TOPO-004 | Multi-region fleet (optional per-site region grouping, warm-standby DR) | [multi-region-dr.json](test-fixtures/v5/multi-region-dr.json), [warm-standby-pair.json](test-fixtures/v5/warm-standby-pair.json) |

### Deployment Pathways (VCF-PATH-001..004)

| ID | Pathway | What it models |
|----|---------|----------------|
| VCF-PATH-001 | Greenfield | New fleet + new instance; Installer deploys full stack |
| VCF-PATH-002 | Expand-fleet | Add an instance; fleet-level services REUSED from initial |
| VCF-PATH-003 | Converge | Convert non-VCF vCenter to VCF mgmt (tag clusters as `preExisting`) |
| VCF-PATH-004 | Import | Import existing vCenter as a workload domain |

### SSO Models (VCF-SSO-001..003)

| ID | Mode | VMs | Scope |
|----|------|-----|-------|
| VCF-SSO-001 | Embedded (in mgmt vCenter) | 0 extra | per-instance |
| VCF-SSO-002 | Fleet-Wide appliance | 3-node cluster | per-fleet (recommended ≤ 5 instances) |
| VCF-SSO-003 | Cross-Instance multi-broker | 3 per broker | N brokers per fleet; fleet services bind to exactly ONE (VCF-INV-032) |

The fleet header has an SSO Model selector; multi-broker mode exposes a
broker list and a fleet-services broker pointer. A soft-warn pill flashes
when instances-per-broker exceeds 5 (VCF-INV-031).

### Fleet DR Posture (VCF-DR-001..050)

| ID | Concept | Modeled as |
|----|---------|------------|
| VCF-DR-001 | Warm-standby posture | `instance.drPosture: "warm-standby"` + badge on InstanceCard |
| VCF-DR-010 | VLR/vSphere-Replication components | Operations, Fleet Mgmt, Ops Logs, Ops Networks |
| VCF-DR-020 | Backup/restore components | Automation, Identity Broker |
| VCF-DR-030 | Per-instance appliances stay | SDDC Mgr, mgmt vCenter, mgmt NSX do NOT fail over |
| VCF-DR-040 | Fleet services dormant on standby | Warm-standby copies excluded from VCF-INV-010 active count |

### T0 Gateway Topology (VCF-APP-006, VCF-INV-060..065)

| HA Mode | Max Edge Nodes | Stateful services | Typical use |
|---------|:---:|---|---|
| Active/Standby | 2 | YES (default path) | VKS (Supervisor), VCF Automation All-Apps — both REQUIRE A/S |
| Active/Active stateless | 8 | no | N-S throughput scaling |
| Active/Active stateful | 2, 4, 6, or 8 (even) | Day-2 NSX Manager UI (VCF-INV-064) | NAT / LB / VPN under A/A with sub-cluster pairs |

Each T0 also carries:
- Up to 2 uplinks per Edge node in A/A (VCF-INV-065, total ≤ 16)
- Each Edge node hosts at most 1 T0 (VCF-INV-061)
- BGP default: A/A enabled with ASN 65000, A/S disabled with no default ASN
- Feature requirements chips (`vks`, `vcfAutomationAllApps`) that validate HA-mode compatibility

### Edge Cluster Deployment Models (VCF-APP-006)

| Model | Topology |
|-------|----------|
| Host Fault-Tolerant | Single AZ; survives host failure via vSphere HA |
| Rack Fault-Tolerant | Multi-rack within single AZ; higher N-S throughput |
| AZ FT — Edge HA | Dual-AZ with NSX Edge Node HA (fast failover) |
| AZ FT — vSphere HA | Dual-AZ with vSphere HA (requires VIRTUAL form factor — bare-metal NOT supported) |

Selectable per cluster via the T0 section of the ClusterCard. Informational
at design time; does not change sizing math.

## Appliance Catalog

`APPLIANCE_DB` in [engine.js](engine.js) contains 24 VCF management appliances.
Each entry carries cross-reference metadata:

- `ruleId` — points into [VCF-DEPLOYMENT-PATTERNS.md](VCF-DEPLOYMENT-PATTERNS.md) (e.g. `VCF-APP-010`).
- `scope` — one of `per-fleet`, `per-instance`, `per-domain-shared`, `per-cluster`, `per-stretched-cluster`, `cluster-internal`, `per-nsx-manager`, `per-monitored-scope`, `fleet-wide`, or `flex`.
- `dualRole: true` — for `vcenter` and `nsxMgr` which serve both mgmt and wld scopes; stack entries carry `role: "mgmt" | "wld"` to disambiguate.

Every value traces to the official Broadcom **VCF 9.0 Planning and
Preparation Workbook** (rows B8–B266) or `techdocs.broadcom.com` (VKS
Supervisor sizing). No blog sources.

### Per-fleet appliances (live ONCE per fleet, on the initial instance)

| ID | Appliance | Research rule |
|----|-----------|---------------|
| `vcfOps` | VCF Operations (analytics) | VCF-APP-010 |
| `fleetMgr` | VCF Operations Fleet Manager | VCF-APP-012 |
| `vcfOpsLogs` | VCF Operations for Logs | VCF-APP-013 |
| `vcfOpsNet` | VCF Operations for Networks (Platform) | VCF-APP-014 |
| `vcfAuto` | VCF Automation | VCF-APP-020 |

**How the studio enforces this:** each profile's stack composition lists
all appliances, but the `stackForInstance(profileKey, isInitial)` helper
filters per-fleet entries out of non-initial instances' stacks. The
"Apply Profile" button on an InstanceCard uses this filter automatically —
a non-initial instance shows the per-fleet appliances *struck through* in
the profile preview so the user can see they were correctly excluded.

When `promoteToInitial()` moves the initial flag to another instance, both
instances' mgmt-cluster stacks are re-derived so per-fleet appliances
follow the flag.

### Per-instance appliances (live on every instance's mgmt domain)

| ID | Appliance | Research rule |
|----|-----------|---------------|
| `sddcMgr` | SDDC Manager | VCF-APP-001 |
| `vcenter` (role: mgmt) | Management vCenter | VCF-APP-002 |
| `nsxMgr` (role: mgmt) | Management NSX Manager | VCF-APP-004 |
| `vcfOpsCollector` | VCF Operations Collector | VCF-APP-011 (required on every non-initial instance) |
| `identityBroker` | VCF Identity Broker (WSA) | VCF-APP-030 (in embedded / fleet-wide / multi-broker modes) |
| `aviLb` | Avi Load Balancer | VCF-APP-050 |
| `srm` | Site Recovery Manager | VCF-APP-060 |
| `vrms` | vSphere Replication (VRMS) | VCF-APP-061 |

### Per-domain / per-cluster / per-nsx-manager

| ID | Appliance | Scope | Research rule |
|----|-----------|-------|---------------|
| `vcenter` (role: wld) | Workload vCenter | per-domain (placed in mgmt cluster) | VCF-APP-003 |
| `nsxMgr` (role: wld) | Workload NSX Manager | per-domain-shared (one NSX can serve multiple wld domains in same instance) | VCF-APP-005 |
| `nsxEdge` | NSX Edge | per-nsx-manager | VCF-APP-006 |
| `nsxGlobalMgr` | NSX Global Manager | fleet-wide (only when `fleet.federationEnabled`) | VCF-APP-040 |
| `vksSupervisor` | VKS Supervisor | per-cluster (cluster-internal) | VCF-APP-070 |
| `vsanWitness` | vSAN Witness Host Appliance | per-stretched-cluster | VCF-APP-080 |

## Data Model

```
Fleet
├── deploymentPathway       — greenfield | expand | converge | import (VCF-PATH-*)
├── federationEnabled       — boolean; controls nsxGlobalMgr placement (VCF-INV-021)
├── ssoMode                 — embedded | fleet-wide | multi-broker (VCF-SSO-*)
├── ssoBrokers[]            — only when ssoMode === "multi-broker"
├── ssoFleetServicesBrokerId — VCF-INV-032: fleet services bind to ONE broker
├── sites[]                 — physical locations
│   ├── name, location
│   ├── region              — optional; drives Per-Site view grouping (VCF-TOPO-004)
│   └── siteRole            — optional: "primary" | "dr" | "witness"
└── instances[]             — VCF deployments (sibling to sites, not nested)
    ├── siteIds[]           — 1 = single-site, 2 = stretched
    ├── deploymentProfile   — simple | ha | haFederation | haSiteProtection | haFederationSiteProtection
    ├── drPosture           — "active" (default) | "warm-standby" (VCF-DR-001)
    ├── drPairedInstanceId  — paired primary instance id when warm-standby
    ├── witnessSiteId       — references fleet.sites[] with siteRole="witness"
    └── domains[]           — exactly 1 mgmt + 0..N workload
        ├── placement       — local (pinned to one site) or stretched
        ├── hostSplitPct    — % of hosts at siteIds[0] when stretched
        ├── componentsClusterId — cluster hosting this workload domain's appliances
        └── clusters[]
            ├── host spec         — CPUs, cores, hyperthreading, RAM, NVMe
            ├── workload          — VM count, vCPU/RAM/disk per VM
            ├── infraStack[]      — appliances hosted in this cluster (per-stack-entry role for dualRole appliances)
            ├── storage policy    — RAID/Mirror, dedup, compression, reserves
            ├── tiering           — NVMe memory tiering settings
            ├── t0Gateways[]      — T0 HA mode, edge bindings, stateful, BGP, feature reqs
            ├── edgeDeploymentModel — host-FT | rack-FT | AZ-FT edge-HA | AZ-FT vSphere-HA
            ├── preExisting       — VCF-PATH-003 converge marker
            └── hostOverride      — manual host-count floor
```

**Stretched clusters:** A stretched VCF instance is ONE instance with two
`siteIds` and ONE appliance stack (one SDDC Manager, one 3-node NSX Manager
cluster, etc.). This matches how VCF actually deploys — appliances are not
duplicated per site.

**Initial-instance convention:** `fleet.instances[0]` IS the initial
instance by convention. Per-fleet appliances (see table above) live only on
this instance's mgmt domain initial cluster. The UI shows a "★ INITIAL"
badge on instance[0] and a "↑ Promote to initial" button on each other
instance that automatically re-derives both instances' mgmt stacks.

## Deployment Profiles

Each VCF instance selects a deployment profile that determines which
management appliances are deployed and how many nodes each gets. The
initial instance gets the full stack; non-initial instances drop
`scope === "per-fleet"` entries automatically.

| Profile | Description | Typical Stack Size (initial) |
|---------|-------------|:----------------------------:|
| `simple` | Lab/PoC — single-node appliances, no redundancy | ~8 VMs |
| `ha` | Production — clustered with full HA | ~14 VMs |
| `haFederation` | HA + 3-node NSX Global Manager | ~17 VMs |
| `haSiteProtection` | HA + SRM + vSphere Replication | ~16 VMs |
| `haFederationSiteProtection` | Full enterprise — HA + Federation + DR | ~19 VMs |

## Sizing Engine

### Host Capacity

Each cluster defines its own host hardware spec:

```
cores       = cpuQty × coresPerCpu                         // physical
threads     = hyperthreadingEnabled ? cores × 2 : cores    // logical
rawGb       = nvmeQty × nvmeSizeTb × 1000
usableVcpu  = threads × cpuOversub × (1 - reservePct / 100)
usableRam   = ramGb   × ramOversub × (1 - reservePct / 100)
```

Hyperthreading (Intel HT / AMD SMT) affects **vCPU sizing capacity only**.
`licensedCores` stays based on physical cores to match VCF per-core
licensing. A dual-socket 16-core host reports 32 cores / 64 threads with
HT enabled; licensing is still computed against the 32 physical cores.

Default host: 2 × 16-core CPUs, 1024 GB RAM, 6 × 7.68 TB NVMe,
2:1 CPU overcommit, 1:1 RAM overcommit, 30% reserve, hyperthreading
disabled (preserves math for configs imported from earlier versions).

### Storage Pipeline

Raw workload demand flows through a multi-stage pipeline:

```
drr          = dedup × compression                         // data reduction ratio
vmCapGb      = demandDiskGb / drr                          // after reduction
swapGb       = demandRamGb × (swapPct / 100)               // swap allocation
protectedGb  = (vmCapGb + swapGb) × protectionFactor       // after RAID/Mirror
withFreeGb   = protectedGb × (1 + freePct / 100)           // free space buffer
totalReqGb   = withFreeGb × (1 + growthPct / 100)          // growth headroom
```

Default storage: RAID-5 (2+1), no dedup/compression, 100% swap,
25% free space buffer, 15% growth allowance.

### NVMe Memory Tiering

When enabled, a partition of each NVMe drive extends effective RAM:

```
tierPartitionGb   = min(ramGb × nvmePct/100, tierDriveSizeTb × 1000, 4096)
activeRatio       = tierPartitionGb / ramGb
effectiveRam      = ramGb × (1 + activeRatio) × ramOversub × (1 - reservePct/100)
```

Only a configurable percentage of workload is eligible for tiered memory.
Ineligible workload uses standard RAM demand. The partition cap is 4 TB
per drive (`NVME_TIER_PARTITION_CAP_GB = 4096`).

### Cluster Host Count

The final host count is the maximum of five constraint floors:

```
cpuHosts      = ceil(totalVcpuDemand / usableVcpu)
ramHosts      = ceil(tieredRamDemand / effectiveRamPerHost)
storageHosts  = ceil(totalReqGb / rawGbPerHost) + ftt
policyMin     = minHosts from protection policy (3, 5, 6, or 7)
manualFloor   = user-specified host override (0 = disabled)

finalHosts    = max(cpuHosts, ramHosts, storageHosts, policyMin, manualFloor)
```

The **limiter** label shown in the UI indicates which floor determined the
host count (CPU, Memory, Storage, Policy, or Manual). When a vSAN cluster
resolves to exactly 3 hosts, the UI renders an informational warning
recommending 4 nodes for auto-healing (see **vSAN Protection Policies**
below).

### vSAN Protection Policies

| Policy | Protection Factor | Min Hosts | FTT |
|--------|:-----------------:|:---------:|:---:|
| RAID-5 (2+1) FTT=1 | 1.50 | 3 | 1 |
| RAID-5 (4+1) FTT=1 | 1.25 | 6 | 1 |
| RAID-6 (4+2) FTT=2 | 1.50 | 6 | 2 |
| Mirror FTT=1 | 2.00 | 3 | 1 |
| Mirror FTT=2 | 3.00 | 5 | 2 |
| Mirror FTT=3 | 4.00 | 7 | 3 |

When external storage is enabled on a cluster, vSAN storage math is skipped
and `rawTib = 0` for that cluster.

**3-node vSAN caution.** Policies with a 3-host minimum (RAID-5 2+1,
Mirror FTT=1) meet the architectural minimum but cannot auto-heal after a
host failure — rebuild requires replacement hardware before redundancy is
restored. 4 hosts provide a spare fault domain and enable automatic
re-protection of data after failures or during maintenance. The UI
surfaces a warning on any vSAN cluster that resolves to exactly 3 hosts.
To lift the floor without changing the policy, set a Host Override of 4
on the cluster.

### vSAN Licensing

```
licensedCores  = finalHosts × coresPerHost        // per cluster
totalCores     = sum across all clusters in fleet
entitlementTib = totalCores × TIB_PER_CORE         // 1 TiB per core
fleetRawTib    = sum of rawTib across all clusters
addonTib       = max(0, fleetRawTib - entitlementTib)
```

If raw capacity exceeds entitlement, the fleet summary shows the additional
vSAN capacity TiB required (`addonTib`).

### Stretched Cluster Failover Analysis

For stretched domains, the engine evaluates whether each site can survive
loss of the other:

- **Green** — survivor has headroom within reserves (CPU, RAM, and storage
  demands fit in usable capacity)
- **Yellow** — survivor can run everything but consumes reserve capacity
  (fits raw capacity with overcommit, but exceeds usable after reserve)
- **Red** — survivor cannot absorb demand, or surviving host count is below
  the protection policy minimum

Host distribution is controlled by `hostSplitPct` (default 50/50):

```
primaryHosts   = ceil(finalHosts × hostSplitPct / 100)
secondaryHosts = finalHosts - primaryHosts
```

### vSAN Witness

When an instance is stretched and has stretched clusters, a vSAN witness
host is deployed at a third fault domain. One witness per stretched cluster.
Witness can either live in `instance.witnessSite` (free-form) or be shared
across instances by referencing a `fleet.sites[]` entry with
`siteRole: "witness"` via `instance.witnessSiteId`.

Witness sizing tiers:

| Size | vCPU | RAM | Disk | Limits |
|------|:----:|:---:|:----:|--------|
| Tiny | 2 | 8 GB | 15 GB | ≤10 hosts, ≤750 components |
| Medium | 2 | 16 GB | 350 GB | ≤21 hosts, ≤22.5k components |
| Large | 2 | 32 GB | 730 GB | ≤64 hosts, ≤45k components |

## Views

- **Editor** — configure sites, instances, domains, and clusters with
  per-cluster hardware specs, workload sizing, storage policies, T0
  gateways, and Edge deployment model
- **Topology** — auto-generated SVG diagram showing fleet layout (solid
  lines to primary site, dashed blue lines to secondary sites for
  stretched instances). Overlay panels below the SVG summarize T0
  Gateways, SSO Topology, DR Pairs, and NSX Federation links
- **Physical** — rack/host-level view with the same overlay panels; legend
  includes Warm-Standby and T0 Gateway color keys
- **Per-Site** — resource projections broken down by site, optionally
  grouped by `site.region` (VCF-TOPO-004). Shared appliances (stretched
  instance management stacks) render in their own section rather than
  being split per site

## Import / Export

- **Import JSON** — replaces the current fleet. Auto-migrates v2 / v3 / v5 / v6
  exports; migration alert fires when the version bumps.
- **Import as new instance** — appends the imported fleet's first instance
  to the current fleet as an expand-fleet addition (VCF-PATH-002). Strips
  per-fleet appliances from the imported instance so the current fleet's
  initial instance remains the sole host of those services.
- **Export JSON** — serializes the full fleet with `version: "vcf-sizer-v6"`
  and a timestamp. Includes network configuration per cluster.
- **Export Installer JSON** — produces VCF Installer `bringup-spec.json`-shaped
  output with DNS, NTP, network specs, per-host IPs, and edge specs.
- **Export Workbook CSV** — produces Planning Workbook rows for fleet services,
  network config, IP plan, and BGP configuration.

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TB_TO_TIB` | 0.9095 | TB → TiB conversion factor |
| `TIB_PER_CORE` | 1 | vSAN raw TiB entitlement per licensed CPU core |
| `NVME_TIER_PARTITION_CAP_GB` | 4096 | Max NVMe memory tier partition (4 TB) |
| `T0_MAX_T0S_PER_EDGE_NODE` | 1 | One T0 per Edge node (VCF-INV-061) |
| `T0_MAX_UPLINKS_PER_EDGE_AA` | 2 | Max uplinks per Edge node in A/A T0 (VCF-INV-065) |
| `SSO_INSTANCES_PER_BROKER_LIMIT` | 5 | Soft warn threshold (VCF-INV-031) |
| `VLAN_ID_MIN` / `MAX` | 1 / 4094 | Valid VLAN range |
| `MTU_MGMT` | 1500 | Management network MTU |
| `MTU_VMOTION` / `MTU_VSAN` | 9000 | Jumbo frame MTU for vMotion / vSAN |
| `MTU_TEP_MIN` / `RECOMMENDED` | 1600 / 1700 | Geneve overlay TEP MTU bounds |
| `DEFAULT_BGP_ASN_AA` | 65000 | Default BGP ASN for A/A T0 (VCF-APP-006) |
| `NIC_PROFILES` | 4 profiles | 2-NIC / 4-NIC / 6-NIC / 8-NIC layouts |

## File Structure

```
vcf-design-studio-v6.html         standalone runnable app (open in browser)
vcf-design-studio-v6.jsx          source JSX (React components)
engine.js                          pure sizing engine (shared between HTML + tests)

scripts/
├── build-html.mjs                 stitches engine.js + .jsx into the HTML
├── verify-html-sync.mjs           CI guard: blocks drift between source + HTML
└── generate-fixtures.mjs          deterministic fixture generator

test-fixtures/
├── v5/                             18 canonical fleet scenarios (see table above)
├── v6/                             6 network-populated fixtures
├── v3/, v2/                        legacy imports used by migration tests
└── snapshots/                      committed sizing snapshots per fixture

tests/
├── unit/                           Vitest unit tests (pure engine functions)
├── migration/                      v2→v3→v5→v6 migration suites
├── snapshot/                       sizing snapshot regression guard
├── invariants/                     fast-check property-based tests
└── e2e/                            Playwright browser tests

.github/workflows/
├── test.yml                        push/PR — unit + coverage → playwright
└── nightly.yml                     06:00 UTC daily against main + artifacts
```

## Test Suite

Run `npm test` for the full Vitest suite (unit + migration + snapshot +
invariants), `npm run test:e2e` for Playwright. Current counts:

- **922 automated checks** across 28 test files
- Engine coverage: 98.4% stmts / 75.5% branches / 98.4% funcs
- 18 v5 fixtures + 6 v6 network fixtures + 1 v3 fixture + 1 v2 fixture
  covering every `VCF-TOPO-*`, `VCF-PATH-*`, `VCF-DR-*`, `VCF-SSO-*`,
  `VCF-NET-*`, `VCF-IP-*`, `VCF-HW-NET-*` and major policy permutation
- 6 Playwright smoke tests exercising UI shell, tab switching, overlay
  panels, and full-fixture round-trip import

Rule IDs (`VCF-INV-*`, `VCF-APP-*`, etc.) appear in test `describe()` titles
so `grep -r "VCF-INV-" tests/` produces a complete coverage matrix.

## Networking Design (v6)

The studio models the full VCF networking stack alongside compute sizing:

- **NIC Profiles** — 4 canned layouts (2-NIC / 4-NIC / 6-NIC / 8-NIC) defining
  physical vmnic → vDS → portgroup mappings. Selectable per cluster.
- **VLAN / Subnet / IP Pool** — per-cluster configuration for Management, vMotion,
  vSAN, Host TEP, and Edge TEP networks with gateway and IP pool ranges.
- **IP Allocator** — deterministic pool-driven allocation of per-host IPs (vmk0
  mgmt, vmk1 vMotion, vmk2 vSAN, vmk10/11 TEP). Per-host overrides supported.
  DHCP path for host TEP.
- **Network Validation** — 13 rules (VCF-IP-001..007, VCF-NET-010/011/030/031,
  VCF-HW-NET-020/022) checking VLAN uniqueness, pool sizing, subnet containment,
  MTU minimums, and BGP peer reachability.
- **Export: VCF Installer JSON** — produces `bringup-spec.json`-shaped output with
  `dnsSpec`, `ntpServers`, `networkSpecs`, `hostSpecs`, and `edgeSpecs`.
- **Export: Workbook CSV** — produces Planning Workbook rows for Fleet Services,
  Network Configuration, IP Address Plan, and BGP Configuration sheets.
- **Network View tab** — dedicated visualization with Physical NIC diagrams,
  VLAN/Subnet map, NSX Edge/T0 topology, and per-host IP grid.

Network rules are documented in [VCF-NETWORKING-PATTERNS.md](VCF-NETWORKING-PATTERNS.md).


## Related Documents

- [VCF-DEPLOYMENT-PATTERNS.md](VCF-DEPLOYMENT-PATTERNS.md) — authoritative
  catalog of VCF 9.0 placement rules, fleet topologies, and invariants.
  Engine `APPLIANCE_DB` ids and scopes are the stable contract against
  this doc.
- [VCF-NETWORKING-PATTERNS.md](VCF-NETWORKING-PATTERNS.md) — Phase 0 research
  deliverable: VCF 9.0 networking design rules. Rule IDs `VCF-NET-*`,
  `VCF-IP-*`, `VCF-HW-NET-*` are the validation contract.

## Provenance

Every appliance value in `APPLIANCE_DB` traces to the official Broadcom
**VCF 9.0 Planning and Preparation Workbook** or `techdocs.broadcom.com`.
No blog sources. Validate against current VMware documentation before
procurement.
