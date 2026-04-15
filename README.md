# VCF Design Studio

A browser-based design and sizing tool for VMware Cloud Foundation 9 fleets.
Model multi-site deployments, configure host hardware, choose vSAN protection
policies, and let the sizing engine compute host counts, storage requirements,
and vSAN licensing — all in a single HTML file with no build step.

## How to Run

Open `vcf-design-studio-v5.html` in any modern browser. That's it.

The app loads React 18, Tailwind CSS, and Babel from CDNs and runs entirely
client-side. No server, no `npm install`, no build toolchain.

## What It Does

- Design multi-site VCF 9 fleets with configurable hardware per cluster
- Size management and workload domains against CPU, memory, and storage constraints
- Toggle per-cluster hyperthreading/SMT to model logical-thread-based CPU capacity
- Surface a recommendation when a vSAN cluster resolves to the 3-host minimum
- Model stretched clusters spanning two sites with configurable host-split ratios
- Compute per-cluster host counts, raw storage, and licensed cores
- Analyze failover capacity for stretched deployments (green / yellow / red verdicts)
- Export and import fleet designs as JSON (auto-migrates older format versions)

## Data Model

```
Fleet
├── sites[]          — physical locations (name, location label)
└── instances[]      — VCF deployments (sibling to sites, not nested)
    ├── siteIds[]    — 1 entry = single-site, 2 = stretched across two sites
    ├── deploymentProfile
    ├── witness      — vSAN witness config (size, target site)
    └── domains[]    — management (exactly 1) + workload (0+)
        ├── placement   — "local" (pinned to one site) or "stretched"
        ├── hostSplitPct — % of hosts at siteIds[0] when stretched
        └── clusters[]
            ├── host spec      — CPUs, cores, hyperthreading, RAM, NVMe drives
            ├── workload       — VM count, vCPU/RAM/disk per VM
            ├── infraStack[]   — appliances hosted on this cluster
            ├── storage policy — RAID/Mirror, dedup, compression, reserves
            └── tiering        — NVMe memory tiering settings
```

**Stretched clusters:** A stretched VCF instance is ONE instance with two
`siteIds` and ONE appliance stack (one SDDC Manager, one 3-node NSX Manager
cluster, etc.). This matches how VCF actually deploys — appliances are not
duplicated per site.

## Appliance Database

The `APPLIANCE_DB` constant contains 27+ VCF management appliances, each with
multiple sizing tiers. Every value traces to the official Broadcom
**VCF 9.0 Planning and Preparation Workbook** (rows B8–B266) or
`techdocs.broadcom.com` (VKS Supervisor sizing).

Key appliances include:

| Appliance | Tiers | Notes |
|-----------|-------|-------|
| vCenter Server | Tiny–XLarge | Scaled by host/VM count |
| NSX Manager | ExtraSmall–XLarge | 1 or 3 nodes depending on profile |
| NSX Edge | Small–XLarge | Transport nodes |
| SDDC Manager | Fixed | One per instance |
| VCF Operations | ExtraSmall–ExtraLarge | Monitoring/analytics |
| VCF Ops for Logs | Small–Large | Centralized logging |
| VCF Ops for Networks | Small–XXLarge | Network analytics |
| NSX Global Manager | Medium–XLarge | Cross-instance federation |
| Avi Load Balancer (NSX ALB) | Small–XLarge | Application load balancing |
| Security Services Platform | Medium–XLarge | Aggregate of 9–14 VMs |
| VCF Automation | Small–Large | Infrastructure automation |
| Site Recovery Manager | Light–Standard | Disaster recovery |
| vSphere Replication (VRMS) | Light–Standard | Site replication |
| VKS Supervisor | Tiny–Large | Kubernetes control plane (1 or 3 VMs) |
| vSAN Witness | Tiny–Large | Stretched cluster witness host |

## Deployment Profiles

Each VCF instance selects a deployment profile that determines which
management appliances are deployed and how many nodes each gets:

| Profile | Description | Typical Stack Size |
|---------|-------------|--------------------|
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
Witness sizing tiers:

| Size | vCPU | RAM | Disk | Limits |
|------|:----:|:---:|:----:|--------|
| Tiny | 2 | 8 GB | 15 GB | ≤10 hosts, ≤750 components |
| Medium | 2 | 16 GB | 350 GB | ≤21 hosts, ≤22.5k components |
| Large | 2 | 32 GB | 730 GB | ≤64 hosts, ≤45k components |

## Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TB_TO_TIB` | 0.9095 | TB → TiB conversion factor |
| `TIB_PER_CORE` | 1 | vSAN raw TiB entitlement per licensed CPU core |
| `NVME_TIER_PARTITION_CAP_GB` | 4096 | Max NVMe memory tier partition (4 TB) |

## Views

- **Editor** — configure sites, instances, domains, and clusters with
  per-cluster hardware specs, workload sizing, and storage policies
- **Topology** — auto-generated SVG diagram showing fleet layout; solid lines
  connect instances to their primary site, dashed blue lines to secondary
  sites (stretched)
- **Per-Site** — resource projections broken down by site; shared appliances
  (stretched instance management stacks) render in their own section rather
  than being split per site

## File Structure

```
vcf-design-studio-v5.html   — standalone runnable app (open in browser)
vcf-design-studio-v5.jsx    — source JSX (same code, module-style imports)
test-fixtures/               — sample fleet JSON for import testing
```

## Provenance

Every appliance value in `APPLIANCE_DB` traces to the official Broadcom
**VCF 9.0 Planning and Preparation Workbook** or `techdocs.broadcom.com`.
No blog sources. Validate against current VMware documentation before
procurement.
