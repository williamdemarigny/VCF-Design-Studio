// ─────────────────────────────────────────────────────────────────────────────
// VCF Design Studio — engine.js
//
// Pure sizing engine: constants, factories, sizing math, and JSON migration.
// Zero JSX, zero React, zero DOM. Safe to require() in Node for testing.
//
// Runtime: inlined into vcf-design-studio-v5.html as a plain <script> before
// the JSX module, which destructures symbols off window.VcfEngine.
// Tests: require("./engine.js") gives the same symbol table via module.exports.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// APPLIANCE DATABASE — sourced from P&P Workbook Static Reference Tables sheet
// (rows B8–B266) plus VKS Supervisor from techdocs.broadcom.com.
// ─────────────────────────────────────────────────────────────────────────────
const APPLIANCE_DB = {
  vcenter: {
    ruleId: "VCF-APP-002/003",
    scope: "per-instance-or-per-domain",   // mgmt vcenter: per-instance; workload vcenter: per-domain (runs in mgmt cluster)
    dualRole: true,                         // research splits into vcenter_mgmt / vcenter_wld — discriminator on stack entry
    placement: "per-domain",
    recommendedScope: "mgmt",
    label: "vCenter Server",
    source: "P&P Workbook — vCenter Appliance CPU/RAM/Disk tables",
    sizes: {
      Tiny:   { vcpu: 2,  ram: 14, disk: 579,  note: "≤10 hosts / 100 VMs" },
      Small:  { vcpu: 4,  ram: 21, disk: 694,  note: "≤100 hosts / 1k VMs" },
      Medium: { vcpu: 8,  ram: 30, disk: 908,  note: "≤400 hosts / 4k VMs" },
      Large:  { vcpu: 16, ram: 39, disk: 1358, note: "≤1k hosts / 10k VMs" },
      XLarge: { vcpu: 24, ram: 58, disk: 2283, note: "≤2k hosts / 35k VMs" },
    },
    defaultSize: "Medium",
  },
  nsxMgr: {
    ruleId: "VCF-APP-004/005",
    scope: "per-instance-or-per-domain-shared",  // mgmt NSX: per-instance; workload NSX: per-domain-shared within same instance
    dualRole: true,
    placement: "per-domain",
    recommendedScope: "mgmt",
    label: "NSX Manager",
    source: "P&P Workbook — NSX-T Manager CPU/RAM/Disk tables",
    sizes: {
      ExtraSmall: { vcpu: 2,  ram: 8,  disk: 300, note: "CSM only — not for production" },
      Small:      { vcpu: 4,  ram: 16, disk: 300, note: "Lab/PoC only" },
      Medium:     { vcpu: 6,  ram: 24, disk: 300, note: "Default, ≤128 hosts" },
      Large:      { vcpu: 12, ram: 48, disk: 300, note: "≤1024 hosts" },
      XLarge:     { vcpu: 24, ram: 96, disk: 400, note: "≤2048 hosts" },
    },
    defaultSize: "Medium",
  },
  nsxEdge: {
    ruleId: "VCF-APP-006",
    scope: "per-nsx-manager",
    placement: "per-domain",
    label: "NSX Edge",
    source: "P&P Workbook — NSX-T Edge CPU/RAM/Disk tables",
    sizes: {
      Small:  { vcpu: 2,  ram: 4,  disk: 200, note: "Lab/PoC only" },
      Medium: { vcpu: 4,  ram: 8,  disk: 200, note: "Production w/ LB" },
      Large:  { vcpu: 8,  ram: 32, disk: 200, note: "Production w/ LB" },
      XLarge: { vcpu: 16, ram: 64, disk: 200, note: "Largest production" },
    },
    defaultSize: "Large",
  },
  sddcMgr: {
    ruleId: "VCF-APP-001",
    scope: "per-instance",
    placement: "per-instance",
    label: "SDDC Manager",
    source: "P&P Workbook — SDDC Manager fixed values",
    sizes: { Default: { vcpu: 4, ram: 16, disk: 914, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  fleetMgr: {
    ruleId: "VCF-APP-012",
    scope: "per-fleet",                     // corrected per research — one per fleet, on initial instance
    placement: "per-instance",
    label: "VCF Operations Fleet Manager",
    source: "P&P Workbook — VCF Operations Fleet Manager fixed values",
    sizes: { Default: { vcpu: 4, ram: 12, disk: 194, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  vcls: {
    scope: "cluster-internal",
    placement: "cluster-internal",
    label: "vSphere Cluster Services (vCLS)",
    source: "P&P Workbook — vCLS Virtual Machines fixed values",
    sizes: { Default: { vcpu: 1, ram: 0.125, disk: 2, note: "Per VM (typically 2 per cluster)" } },
    defaultSize: "Default",
    fixed: true,
  },
  vcfOps: {
    ruleId: "VCF-APP-010",
    scope: "per-fleet",                     // corrected per research — initial instance only
    placement: "per-instance",
    label: "VCF Operations",
    source: "P&P Workbook + Broadcom KB 397782",
    sizes: {
      ExtraSmall: { vcpu: 2,  ram: 8,   disk: 274, note: "≤700 objects" },
      Small:      { vcpu: 4,  ram: 16,  disk: 274, note: "≤10k objects" },
      Medium:     { vcpu: 8,  ram: 32,  disk: 274, note: "≤30k objects" },
      Large:      { vcpu: 16, ram: 48,  disk: 274, note: "≤44k objects" },
      ExtraLarge: { vcpu: 24, ram: 128, disk: 274, note: "≤100k objects" },
    },
    defaultSize: "Medium",
  },
  vcfOpsCollector: {
    ruleId: "VCF-APP-011",
    scope: "per-instance",                  // every instance deploys its own Collector
    placement: "per-instance",
    label: "VCF Operations Collector",
    source: "P&P Workbook + KB 397782 — collector inherits node profile",
    sizes: {
      ExtraSmall: { vcpu: 2,  ram: 8,   disk: 274 },
      Small:      { vcpu: 4,  ram: 16,  disk: 274 },
      Medium:     { vcpu: 8,  ram: 32,  disk: 274 },
      Large:      { vcpu: 16, ram: 48,  disk: 274 },
      ExtraLarge: { vcpu: 24, ram: 128, disk: 274 },
    },
    defaultSize: "Medium",
  },
  vcfOpsProxy: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "VCF Operations Unified Cloud Proxy",
    source: "P&P Workbook — VCF Operations Proxy",
    sizes: {
      Small:    { vcpu: 4, ram: 16, disk: 264, note: "≤16k objects" },
      Standard: { vcpu: 8, ram: 48, disk: 264, note: "≤80k objects" },
    },
    defaultSize: "Small",
  },
  vcfAuto: {
    ruleId: "VCF-APP-020",
    scope: "per-fleet",                     // corrected per research — initial instance only
    placement: "per-instance",
    label: "VCF Automation",
    source: "P&P Workbook — VCF Automation CPU/RAM/Disk tables",
    sizes: {
      Small:  { vcpu: 24, ram: 96,  disk: 455 },
      Medium: { vcpu: 24, ram: 96,  disk: 334 },
      Large:  { vcpu: 32, ram: 128, disk: 430 },
    },
    defaultSize: "Small",
  },
  vcfOpsLogs: {
    ruleId: "VCF-APP-013",
    scope: "per-fleet",                     // corrected per research — can be per-instance for compliance isolation, default fleet
    placement: "per-instance",
    label: "VCF Operations for Logs",
    source: "P&P Workbook — vRLI tables",
    sizes: {
      Small:  { vcpu: 4,  ram: 8,  disk: 530, note: "PoC/test only" },
      Medium: { vcpu: 8,  ram: 16, disk: 530, note: "Min for production cluster" },
      Large:  { vcpu: 16, ram: 32, disk: 530, note: "15k EPS / node" },
    },
    defaultSize: "Medium",
  },
  vcfOpsNet: {
    ruleId: "VCF-APP-014",
    scope: "per-fleet",                     // corrected per research — Platform is fleet-wide, one per fleet
    placement: "per-instance",
    label: "VCF Operations for Networks (Platform)",
    source: "P&P Workbook + techdocs VCF 9 system requirements",
    sizes: {
      Small:      { vcpu: 4,  ram: 16,  disk: 1024, note: "Eval only" },
      Medium:     { vcpu: 8,  ram: 32,  disk: 1024, note: "≤4k VMs" },
      Large:      { vcpu: 12, ram: 48,  disk: 1024, note: "≤6k VMs" },
      ExtraLarge: { vcpu: 16, ram: 64,  disk: 1024, note: "≤10k VMs" },
      XXLarge:    { vcpu: 24, ram: 128, disk: 1024, note: "≤15k VMs" },
    },
    defaultSize: "Large",
  },
  vcfOpsNetCollector: {
    ruleId: "VCF-APP-014",
    scope: "per-monitored-scope",           // per workload domain or per VCF instance being monitored
    placement: "per-instance",
    label: "VCF Operations for Networks Collector",
    source: "P&P Workbook — Networks Collector tables",
    sizes: {
      Small:      { vcpu: 2,  ram: 4,  disk: 250 },
      Medium:     { vcpu: 4,  ram: 12, disk: 250 },
      Large:      { vcpu: 8,  ram: 16, disk: 250 },
      ExtraLarge: { vcpu: 8,  ram: 24, disk: 250 },
      XXLarge:    { vcpu: 16, ram: 48, disk: 250 },
    },
    defaultSize: "Large",
  },
  identityBroker: {
    ruleId: "VCF-APP-030",
    scope: "flex",                          // mode-dependent: embedded (per-instance), fleet-wide, or multi-broker per region
    placement: "per-instance",
    label: "VCF Identity Broker (WSA)",
    source: "P&P Workbook — WSA CPU/RAM/Disk tables",
    sizes: {
      ExtraSmall:      { vcpu: 4,  ram: 8,  disk: 100 },
      Small:           { vcpu: 8,  ram: 16, disk: 290 },
      Medium:          { vcpu: 8,  ram: 16, disk: 220 },
      Large:           { vcpu: 10, ram: 16, disk: 100 },
      ExtraLarge:      { vcpu: 12, ram: 32, disk: 100 },
      ExtraExtraLarge: { vcpu: 14, ram: 48, disk: 100 },
    },
    defaultSize: "Medium",
  },
  aviLb: {
    ruleId: "VCF-APP-050",
    scope: "per-instance",                  // typically per-instance, can be per-domain
    placement: "per-domain",
    recommendedScope: "mgmt",
    label: "Avi Load Balancer (NSX ALB)",
    source: "P&P Workbook — AVI Load Balancer tables",
    sizes: {
      Small:  { vcpu: 6,  ram: 32, disk: 512 },
      Large:  { vcpu: 16, ram: 48, disk: 1400 },
      XLarge: { vcpu: 16, ram: 64, disk: 1750 },
    },
    defaultSize: "Small",
  },
  hcxConnector: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "HCX Connector",
    source: "P&P Workbook — Cross-Cloud Mobility HCX",
    sizes: { Default: { vcpu: 4, ram: 12, disk: 65, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // Security Services Platform — values are aggregate across constituent VMs.
  ssp: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "Security Services Platform (SSP)",
    source: "P&P Workbook — SSP CPU/RAM/Disk (aggregate: installer + controllers + workers)",
    sizes: {
      Medium: { vcpu: 112, ram: 414, disk: 4096, note: "1 SSPI + 3 Ctrl + 5 Workers (9 VMs total)" },
      Large:  { vcpu: 160, ram: 606, disk: 5120, note: "1 SSPI + 3 Ctrl + 8 Workers (12 VMs total)" },
      XLarge: { vcpu: 192, ram: 734, disk: 6656, note: "1 SSPI + 3 Ctrl + 10 Workers (14 VMs total)" },
    },
    defaultSize: "Medium",
  },
  // VKS Supervisor Control Plane — sourced from techdocs.broadcom.com (the
  // workbook has no VKS sizing). The "instances" field models the control
  // plane availability model: Simple = 1 VM, HA = 3 VMs. Both deployment
  // flavors (traditional 3-node and Single Management Zone with NSX VPC) use
  // identical per-VM sizes — the difference is just instance count.
  vksSupervisor: {
    ruleId: "VCF-APP-070",
    scope: "per-cluster",                   // enabled per cluster; runs as cluster-internal VMs
    placement: "cluster-internal",
    label: "VKS Supervisor (Control Plane)",
    source: "techdocs.broadcom.com — VCF 9.0 Change the Control Plane Size of a Supervisor",
    sizes: {
      Tiny:   { vcpu: 2,  ram: 8,  disk: 32, note: "Smallest tier" },
      Small:  { vcpu: 4,  ram: 16, disk: 32, note: "Default" },
      Medium: { vcpu: 8,  ram: 16, disk: 32, note: "Note: same RAM as Small" },
      Large:  { vcpu: 16, ram: 32, disk: 32, note: "Largest tier" },
    },
    defaultSize: "Small",
    info: "VKS Supervisor deploys Simple (1 VM) or HA (3 VMs). Set Inst=1 for Single Management Zone / single-VM. Set Inst=3 for HA control plane (required for 3-zone, recommended for production). Per-VM sizing is identical regardless of deployment flavor — the only difference is VM count and zone topology.",
  },
  // NSX Global Manager — uses same sizing table as Local Manager but tracked
  // separately. Required for NSX Federation (active/active cross-instance).
  nsxGlobalMgr: {
    ruleId: "VCF-APP-040",
    scope: "fleet-wide",                    // only when NSX Federation enabled; active/standby across two instances
    placement: "per-instance",
    label: "NSX Global Manager",
    source: "P&P Workbook — NSX-T Manager tables (GM uses same sizing as LM)",
    sizes: {
      Medium:     { vcpu: 6,  ram: 24, disk: 300, note: "≤128 hosts" },
      Large:      { vcpu: 12, ram: 48, disk: 300, note: "≤1024 hosts" },
      XLarge:     { vcpu: 24, ram: 96, disk: 400, note: "≤2048 hosts" },
    },
    defaultSize: "Large",
  },
  // Site Recovery Manager — for Site Protection & DR validated solution
  srm: {
    ruleId: "VCF-APP-060",
    scope: "per-instance",
    placement: "per-instance",
    label: "Site Recovery Manager (SRM)",
    source: "P&P Workbook — SRM CPU/RAM/Disk tables",
    sizes: {
      Light:    { vcpu: 2, ram: 8,  disk: 20,  note: "Small environments" },
      Standard: { vcpu: 8, ram: 24, disk: 800, note: "Production" },
    },
    defaultSize: "Standard",
  },
  // vSphere Replication Manager Server — paired with SRM for DR
  vrms: {
    ruleId: "VCF-APP-061",
    scope: "per-instance",
    placement: "per-instance",
    label: "vSphere Replication (VRMS)",
    source: "P&P Workbook — VRMS CPU/RAM/Disk tables",
    sizes: {
      Light:    { vcpu: 2, ram: 8, disk: 33, note: "Small environments" },
      Standard: { vcpu: 4, ram: 8, disk: 33, note: "Production" },
    },
    defaultSize: "Standard",
  },
  // Health Reporting and Monitoring VM
  hvm: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "Health Reporting & Monitoring (HVM)",
    source: "P&P Workbook — Health Reporting and Monitoring fixed values",
    sizes: { Default: { vcpu: 2, ram: 8, disk: 20, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // Cloud-Based Ransomware Recovery Connector
  cyberRecoveryConnector: {
    ruleId: null,                           // engine-only — no VCF-APP research rule
    scope: "per-instance",
    placement: "per-instance",
    label: "Live Cyber Recovery Connector",
    source: "P&P Workbook — Cloud-Based Ransomware Recovery",
    sizes: { Default: { vcpu: 8, ram: 12, disk: 100, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // vSAN Witness Host Appliance — required at a third fault domain for vSAN
  // stretched clusters only. Not needed when using array-based replication.
  // Deploys as a nested ESXi VM. Sizes per techdocs.broadcom.com.
  vsanWitness: {
    ruleId: "VCF-APP-080",
    scope: "per-stretched-cluster",         // one witness per stretched vSAN cluster at a third fault domain
    placement: "site-level",
    label: "vSAN Witness Host Appliance",
    source: "techdocs.broadcom.com — vSAN Witness Host Appliance sizing",
    sizes: {
      Tiny:   { vcpu: 2, ram: 8,  disk: 15,  note: "≤10 hosts, ≤750 components" },
      Medium: { vcpu: 2, ram: 16, disk: 350,  note: "≤21 hosts, ≤22.5k components" },
      Large:  { vcpu: 2, ram: 32, disk: 730,  note: "≤64 hosts, ≤45k components" },
    },
    defaultSize: "Medium",
    info: "Deploys at the witness site (third fault domain), NOT at either data site. One witness per stretched cluster. Resources are consumed at the witness location only.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOYMENT PROFILES — instance counts derived from the P&P Workbook formulas.
// Each profile defines the management appliance stack that gets auto-applied
// when the user selects a deployment model at the VCF Instance level. Users
// can still customize after applying a profile.
//
// Source: workbook "Management Domain Sizing" sheet, column J formulas:
//   - NSX Mgr: J11 = IF(H32="Mandatory - Single Node",1,3)
//   - VCF Ops: J20 = IF(Deploy HA → 3, Deploy Simple → 1)
//   - VCF Auto: J22 = IF(Small → 1, Medium → 3, Large → 3)
//   - VCF Logs: J23 = IF(Deploy HA → 3, 1)
//   - VCF Net:  J24 = IF(Deploy HA → 3, 1)
//   - Identity: J26 = IF(Deploy HA → 3, Deploy → 1, Embedded → 0)
//   - Avi LB:   J13 = IF(deployed → 3)
//   - NSX Edge: J12 = IF(deployed → 2)
//   - NSX GM:   J11 += IF(GM deployed → 3)
// ─────────────────────────────────────────────────────────────────────────────
const DEPLOYMENT_PROFILES = {
  simple: {
    label: "Simple (Lab / PoC)",
    description: "Single-node appliances, no redundancy. Per workbook 'Deploy Simple' model. Not for production.",
    stack: [
      { id: "vcenter",         size: "Small",   instances: 1 },
      { id: "nsxMgr",          size: "Medium",  instances: 1 },
      { id: "sddcMgr",         size: "Default", instances: 1 },
      { id: "fleetMgr",        size: "Default", instances: 1 },
      { id: "vcls",            size: "Default", instances: 2 },
      { id: "vcfOps",          size: "Medium",  instances: 1 },
      { id: "vcfOpsCollector", size: "Medium",  instances: 1 },
    ],
  },
  ha: {
    label: "HA Production",
    description: "Clustered appliances with full redundancy. Per workbook 'Deploy HA' model with NSX HA Cluster, recommended for all production deployments.",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviLb",              size: "Small",   instances: 3 },
    ],
  },
  haFederation: {
    label: "HA + NSX Federation",
    description: "HA production plus NSX Global Manager (3-node HA cluster) for cross-instance networking. Required when federating NSX across multiple VCF instances (active/active datacenters).",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxGlobalMgr",       size: "Large",   instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviLb",              size: "Small",   instances: 3 },
    ],
  },
  haSiteProtection: {
    label: "HA + Site Protection (DR)",
    description: "HA production plus VMware Live Recovery (SRM + vSphere Replication) for disaster recovery to a secondary site. Deploy matching profile on recovery site.",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviLb",              size: "Small",   instances: 3 },
      { id: "srm",                size: "Standard", instances: 1 },
      { id: "vrms",               size: "Standard", instances: 1 },
    ],
  },
  haFederationSiteProtection: {
    label: "HA + Federation + Site Protection",
    description: "Full enterprise: HA appliances, NSX Federation for active/active networking across instances, plus VMware Live Recovery for DR. Maximum resilience deployment.",
    stack: [
      { id: "vcenter",            size: "Medium",  instances: 1 },
      { id: "nsxMgr",             size: "Medium",  instances: 3 },
      { id: "nsxGlobalMgr",       size: "Large",   instances: 3 },
      { id: "nsxEdge",            size: "Large",   instances: 2 },
      { id: "sddcMgr",            size: "Default", instances: 1 },
      { id: "fleetMgr",           size: "Default", instances: 1 },
      { id: "vcls",               size: "Default", instances: 2 },
      { id: "vcfOps",             size: "Medium",  instances: 3 },
      { id: "vcfOpsCollector",    size: "Medium",  instances: 1 },
      { id: "vcfAuto",            size: "Small",   instances: 1 },
      { id: "vcfOpsLogs",         size: "Medium",  instances: 3 },
      { id: "vcfOpsNet",          size: "Large",   instances: 3 },
      { id: "vcfOpsNetCollector", size: "Large",   instances: 1 },
      { id: "identityBroker",     size: "Medium",  instances: 3 },
      { id: "aviLb",              size: "Small",   instances: 3 },
      { id: "srm",                size: "Standard", instances: 1 },
      { id: "vrms",               size: "Standard", instances: 1 },
    ],
  },
};

// Default uses HA profile
const DEFAULT_MGMT_STACK_TEMPLATE = DEPLOYMENT_PROFILES.ha.stack;

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL-INSTANCE HELPERS — per VCF-DEPLOYMENT-PATTERNS.md §3 (VCF-INV-011),
// fleet.instances[0] is the "initial" instance that carries per-fleet
// appliances (VCF Operations, VCF Automation, Fleet Mgr, Logs, Networks
// Platform). Other instances in a multi-instance fleet carry only their
// per-instance appliances plus a Collector.
// ─────────────────────────────────────────────────────────────────────────────
function getInitialInstance(fleet) {
  return (fleet?.instances && fleet.instances[0]) || null;
}

function isInitialInstance(fleet, instance) {
  const initial = getInitialInstance(fleet);
  return !!initial && instance && initial.id === instance.id;
}

// Read `.hostSplitPct` from a stretched-domain-like object, defaulting to 50
// (even split) when unset or non-numeric. Pre-v5 data sometimes omits this
// field on local domains that were later promoted to stretched.
function getHostSplitPct(x) {
  return typeof x?.hostSplitPct === "number" ? x.hostSplitPct : 50;
}

// Return the mgmt-stack entries appropriate for `instance` given its profile.
// Initial instance gets the full profile stack; subsequent instances drop any
// appliance whose APPLIANCE_DB entry has scope === "per-fleet".
function stackForInstance(profileKey, isInitial) {
  const profile = DEPLOYMENT_PROFILES[profileKey];
  if (!profile) return [];
  if (isInitial) return profile.stack.slice();
  return profile.stack.filter((e) => APPLIANCE_DB[e.id]?.scope !== "per-fleet");
}

// Reorder instances so the given id becomes fleet.instances[0] (the new
// initial). Also re-stacks the mgmt domain's initial cluster on BOTH the
// new initial and the demoted old-initial per VCF-INV-011 so per-fleet
// appliances (vcfOps, vcfAuto, fleetMgr, vcfOpsLogs, vcfOpsNet) move with
// the initial flag. Preserves user customization that doesn't conflict with
// per-fleet scope rules.
// Returns a new fleet object (immutable contract).
function promoteToInitial(fleet, instanceId) {
  if (!fleet?.instances?.length) return fleet;
  const idx = fleet.instances.findIndex((i) => i.id === instanceId);
  if (idx <= 0) return fleet;  // already initial, or not found

  const next = fleet.instances.slice();
  const [promoted] = next.splice(idx, 1);
  next.unshift(promoted);

  // Re-stack the old initial (now at index idx) and the new initial (index 0).
  // Only rewrites the mgmt domain's first cluster's infraStack; other
  // clusters and domains are untouched.
  const rewriteMgmtStack = (inst, isInitial) => {
    const profileKey = inst.deploymentProfile;
    if (!profileKey || !DEPLOYMENT_PROFILES[profileKey]) return inst;
    const nextStack = stackForInstance(profileKey, isInitial).map((e) => ({
      ...e,
      key: "key-" + cryptoKey(),
    }));
    return {
      ...inst,
      domains: (inst.domains || []).map((d, di) => {
        if (d.type !== "mgmt") return d;
        return {
          ...d,
          clusters: (d.clusters || []).map((c, ci) => (
            di === inst.domains.findIndex((x) => x.type === "mgmt") && ci === 0
              ? { ...c, infraStack: nextStack }
              : c
          )),
        };
      }),
    };
  };

  return {
    ...fleet,
    instances: next.map((inst, i) => {
      if (i === 0) return rewriteMgmtStack(inst, true);
      if (i === idx) return rewriteMgmtStack(inst, false);
      return inst;
    }),
  };
}

// Infer deployment pathway for a legacy fleet (v5 export that predates the
// pathway field). Single-instance fleets are always greenfield; multi-
// instance fleets are inferred as expand-fleet. Users can override in the UI.
function inferDeploymentPathway(fleet) {
  if (fleet?.deploymentPathway) return fleet.deploymentPathway;
  const n = fleet?.instances?.length || 0;
  return n > 1 ? "expand" : "greenfield";
}

// Infer federation intent from legacy fleets that predate the explicit
// federationEnabled flag. Any instance using an "haFederation*" profile
// signals federation. Callers in the UI / tests should prefer
// fleet.federationEnabled when present; this helper is only the migration
// default.
function inferFederationEnabled(fleet) {
  if (typeof fleet?.federationEnabled === "boolean") return fleet.federationEnabled;
  const anyFederationProfile = (fleet?.instances || []).some((i) =>
    (i?.deploymentProfile || "").toLowerCase().includes("federation")
  );
  return anyFederationProfile;
}

// Edge cluster deployment models per VCF-APP-006 research doc §2. These are
// NSX Edge cluster topology options independent of T0 HA mode. Purely
// informational at the design studio level — sizing doesn't change — but
// the model drives DC layout and survivability expectations.
const EDGE_DEPLOYMENT_MODELS = {
  host_fault_tolerant: {
    ruleId: "VCF-APP-006-EDGE-HFT",
    label: "Host Fault-Tolerant",
    description: "Single AZ. Edge VMs survive a host failure via vSphere HA.",
  },
  rack_fault_tolerant: {
    ruleId: "VCF-APP-006-EDGE-RFT",
    label: "Rack Fault-Tolerant",
    description: "Multi-rack within a single AZ. Higher N-S throughput; tolerates rack-level failures.",
  },
  az_fault_tolerant_edge_ha: {
    ruleId: "VCF-APP-006-EDGE-AZ-EHA",
    label: "AZ FT — Edge HA",
    description: "Dual-AZ with NSX Edge Node HA (fast failover). Requires paired Edge nodes across AZs.",
  },
  az_fault_tolerant_vsphere_ha: {
    ruleId: "VCF-APP-006-EDGE-AZ-VHA",
    label: "AZ FT — vSphere HA",
    description: "Dual-AZ with vSphere HA. Requires VIRTUAL Edge form factor; bare-metal is NOT supported.",
  },
};

// T0 gateway constants per VCF-APP-006 and VCF-INV-060..065.
const T0_HA_MODES = {
  "active-standby": {
    ruleId: "VCF-APP-006-T0-AS",
    label: "Active/Standby",
    maxEdgeNodes: 2,               // VCF-INV-060
    bgpDefault: false,
    description: "Elected active + standby Edge nodes. Required for VCF Automation All Apps and vSphere Supervisor (VKS).",
    requiredFor: ["vcfAutomationAllApps", "vks"],
  },
  "active-active": {
    ruleId: "VCF-APP-006-T0-AA",
    label: "Active/Active",
    maxEdgeNodes: 8,               // VCF-INV-060
    bgpDefault: true,
    description: "Up to 8 Edge transport nodes. Stateless N-S by default; stateful services require even node count forming sub-cluster pairs (Day-2 NSX Manager UI).",
    requiredFor: [],
  },
};
const T0_MAX_T0S_PER_EDGE_NODE = 1;  // VCF-INV-061
const T0_MAX_UPLINKS_PER_EDGE_AA = 2; // VCF-INV-065 — per research §2 VCF-APP-006

function newT0Gateway(name = "t0-prod") {
  return {
    id: "t0-" + cryptoKey(),
    name,
    haMode: "active-standby",       // safest default, unlocks VKS + Auto All-Apps
    // Stack-entry keys (not appliance ids) of the nsxEdge entries that host
    // this T0's Edge nodes. Kept as keys so moving an Edge entry around in
    // the stack doesn't break the binding.
    edgeNodeKeys: [],
    // Uplinks per edge node for this T0. Array is parallel to edgeNodeKeys;
    // entry i is the uplink count on edgeNodeKeys[i]. Capped at
    // T0_MAX_UPLINKS_PER_EDGE_AA (2) for A/A per VCF-INV-065. Default 1
    // uplink each when not specified.
    uplinksPerEdge: [],
    stateful: false,                // Only meaningful when haMode === "active-active"
    bgpEnabled: false,              // Users toggle; default differs by haMode
    asnLocal: null,
    bgpPeers: [],
    featureRequirements: [],        // e.g. ["vks", "vcfAutomationAllApps"]
  };
}

function createFleetNetworkConfig() {
  return {
    dns: { servers: [], searchDomains: [], primaryDomain: "" },
    ntp: { servers: [], timezone: "UTC" },
    syslog: { servers: [] },
    rootCaBundle: null,
  };
}

function createClusterNetworks() {
  return {
    nicProfileId: "4-nic",
    vds: NIC_PROFILES["4-nic"].vds.map(function(v) { return { name: v.name, uplinks: v.uplinks.slice(), mtu: v.mtu }; }),
    mgmt:    { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null } },
    vmotion: { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_VMOTION },
    vsan:    { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_VSAN },
    hostTep: { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_TEP_RECOMMENDED, useDhcp: false },
    edgeTep: { vlan: null, subnet: null, gateway: null, pool: { start: null, end: null }, mtu: MTU_TEP_RECOMMENDED },
    uplinks: [],
  };
}

function createHostIpOverride(hostIndex) {
  return {
    hostIndex: hostIndex,
    mgmtIp: null,
    vmotionIp: null,
    vsanIp: null,
    hostTepIps: null,
    bmcIp: null,
  };
}

function ipToInt(ip) {
  var parts = ip.split(".");
  return ((parseInt(parts[0], 10) << 24) | (parseInt(parts[1], 10) << 16) | (parseInt(parts[2], 10) << 8) | parseInt(parts[3], 10)) >>> 0;
}

function intToIp(num) {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join(".");
}

function ipPoolSize(start, end) {
  if (!start || !end) return 0;
  return ipToInt(end) - ipToInt(start) + 1;
}

function subnetContainsIp(subnet, ip) {
  if (!subnet || !ip) return false;
  var parts = subnet.split("/");
  var netIp = ipToInt(parts[0]);
  var bits = parseInt(parts[1], 10);
  var mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (netIp & mask);
}

function allocateClusterIps(cluster, finalHosts) {
  var nets = cluster.networks;
  if (!nets) return { hosts: [], edgeNodes: [], warnings: [] };

  var warnings = [];
  var overrideMap = {};
  (cluster.hostOverrides || []).forEach(function(o) { overrideMap[o.hostIndex] = o; });

  var overrideIps = {};
  (cluster.hostOverrides || []).forEach(function(o) {
    if (o.mgmtIp) overrideIps[o.mgmtIp] = true;
    if (o.vmotionIp) overrideIps[o.vmotionIp] = true;
    if (o.vsanIp) overrideIps[o.vsanIp] = true;
    if (o.bmcIp) overrideIps[o.bmcIp] = true;
    if (o.hostTepIps) o.hostTepIps.forEach(function(ip) { overrideIps[ip] = true; });
  });

  function nextFromPool(pool, count, networkName) {
    if (!pool || !pool.start || !pool.end) {
      if (count > 0) warnings.push({ severity: "error", ruleId: "VCF-IP-002", message: networkName + " pool not defined but " + count + " IPs needed" });
      return [];
    }
    var start = ipToInt(pool.start);
    var end = ipToInt(pool.end);
    var allocated = [];
    var cursor = start;
    while (allocated.length < count && cursor <= end) {
      var candidate = intToIp(cursor);
      if (!overrideIps[candidate]) {
        allocated.push(candidate);
      }
      cursor++;
    }
    if (allocated.length < count) {
      warnings.push({ severity: "error", ruleId: "VCF-IP-002", message: networkName + " pool exhausted: needed " + count + ", got " + allocated.length });
    }
    return allocated;
  }

  var mgmtPool = nextFromPool(nets.mgmt && nets.mgmt.pool, finalHosts, "mgmt");
  var vmotionPool = nextFromPool(nets.vmotion && nets.vmotion.pool, finalHosts, "vmotion");
  var vsanPool = nextFromPool(nets.vsan && nets.vsan.pool, finalHosts, "vsan");

  var tepCount = finalHosts * 2;
  var tepPool = [];
  if (nets.hostTep && nets.hostTep.useDhcp) {
    warnings.push({ severity: "info", ruleId: "VCF-IP-019", message: "Host TEP uses DHCP — skipping static allocation" });
  } else {
    tepPool = nextFromPool(nets.hostTep && nets.hostTep.pool, tepCount, "hostTep");
  }

  var poolHostIdx = 0;
  var hosts = [];
  for (var i = 0; i < finalHosts; i++) {
    var ov = overrideMap[i];
    var tepPair = nets.hostTep && nets.hostTep.useDhcp ? null : [tepPool[i * 2] || null, tepPool[i * 2 + 1] || null];
    hosts.push({
      index: i,
      mgmtIp: (ov && ov.mgmtIp) || mgmtPool[poolHostIdx] || null,
      vmotionIp: (ov && ov.vmotionIp) || vmotionPool[poolHostIdx] || null,
      vsanIp: (ov && ov.vsanIp) || vsanPool[poolHostIdx] || null,
      hostTepIps: (ov && ov.hostTepIps) || tepPair,
      bmcIp: (ov && ov.bmcIp) || null,
      source: ov ? "override" : "pool",
    });
    if (!ov) poolHostIdx++;
  }

  var edgeNodes = [];
  var edgeTepPool = nextFromPool(nets.edgeTep && nets.edgeTep.pool, (cluster.t0Gateways || []).reduce(function(n, t0) { return n + (t0.edgeNodeKeys || []).length; }, 0) * 2, "edgeTep");
  var edgeTepIdx = 0;
  (cluster.t0Gateways || []).forEach(function(t0) {
    (t0.edgeNodeKeys || []).forEach(function(key, ei) {
      edgeNodes.push({
        t0Id: t0.id,
        edgeNodeKey: key,
        edgeTepIps: [edgeTepPool[edgeTepIdx] || null, edgeTepPool[edgeTepIdx + 1] || null],
      });
      edgeTepIdx += 2;
    });
  });

  return { hosts: hosts, edgeNodes: edgeNodes, warnings: warnings };
}

function validateNetworkDesign(fleet) {
  var issues = [];

  // ─── Fleet-level checks ───────────────────────────────────────────────────
  var nc = fleet.networkConfig;
  if (!nc || !nc.dns || !nc.dns.servers || nc.dns.servers.length === 0) {
    issues.push({ ruleId: "VCF-NET-010", severity: "error", message: "Fleet DNS servers not configured" });
  }
  if (!nc || !nc.ntp || !nc.ntp.servers || nc.ntp.servers.length === 0) {
    issues.push({ ruleId: "VCF-NET-011", severity: "error", message: "Fleet NTP servers not configured" });
  }

  // ─── Collect all cluster mgmt subnets for cross-cluster check ───────
  var allMgmtSubnets = [];

  (fleet.instances || []).forEach(function(inst) {
    (inst.domains || []).forEach(function(dom) {
      (dom.clusters || []).forEach(function(cl) {
        var nets = cl.networks;
        if (!nets) return;
        var clusterPath = inst.name + " / " + dom.name + " / " + cl.name;

        // VCF-IP-001 — distinct VLANs within cluster
        var vlans = {};
        var vlanFields = [
          { key: "mgmt", net: nets.mgmt },
          { key: "vmotion", net: nets.vmotion },
          { key: "vsan", net: nets.vsan },
          { key: "hostTep", net: nets.hostTep },
          { key: "edgeTep", net: nets.edgeTep },
        ];
        vlanFields.forEach(function(f) {
          if (f.net && f.net.vlan != null) {
            if (vlans[f.net.vlan]) {
              issues.push({ ruleId: "VCF-IP-001", severity: "error", message: clusterPath + ": " + f.key + " VLAN " + f.net.vlan + " duplicates " + vlans[f.net.vlan] });
            } else {
              vlans[f.net.vlan] = f.key;
            }
          }
        });

        // VCF-IP-003 — pool range within subnet
        // VCF-IP-004 — pool start ≤ pool end
        var poolNetworks = [
          { key: "mgmt", net: nets.mgmt },
          { key: "vmotion", net: nets.vmotion },
          { key: "vsan", net: nets.vsan },
          { key: "hostTep", net: nets.hostTep },
          { key: "edgeTep", net: nets.edgeTep },
        ];
        poolNetworks.forEach(function(f) {
          if (f.net && f.net.pool && f.net.pool.start && f.net.pool.end) {
            if (ipToInt(f.net.pool.start) > ipToInt(f.net.pool.end)) {
              issues.push({ ruleId: "VCF-IP-004", severity: "error", message: clusterPath + ": " + f.key + " pool start > end" });
            }
            if (f.net.subnet) {
              if (!subnetContainsIp(f.net.subnet, f.net.pool.start)) {
                issues.push({ ruleId: "VCF-IP-003", severity: "error", message: clusterPath + ": " + f.key + " pool start outside subnet " + f.net.subnet });
              }
              if (!subnetContainsIp(f.net.subnet, f.net.pool.end)) {
                issues.push({ ruleId: "VCF-IP-003", severity: "error", message: clusterPath + ": " + f.key + " pool end outside subnet " + f.net.subnet });
              }
            }
          }
        });

        // VCF-IP-005 — subnets within same cluster must not overlap
        var subnets = [];
        poolNetworks.forEach(function(f) {
          if (f.net && f.net.subnet) subnets.push({ key: f.key, subnet: f.net.subnet });
        });
        for (var si = 0; si < subnets.length; si++) {
          for (var sj = si + 1; sj < subnets.length; sj++) {
            var a = subnets[si], b = subnets[sj];
            if (a.subnet === b.subnet) {
              issues.push({ ruleId: "VCF-IP-005", severity: "error", message: clusterPath + ": " + a.key + " and " + b.key + " share subnet " + a.subnet });
            }
          }
        }

        // VCF-IP-007 — host overrides must be in subnet
        (cl.hostOverrides || []).forEach(function(ov) {
          if (ov.mgmtIp && nets.mgmt && nets.mgmt.subnet && !subnetContainsIp(nets.mgmt.subnet, ov.mgmtIp)) {
            issues.push({ ruleId: "VCF-IP-007", severity: "error", message: clusterPath + ": host " + ov.hostIndex + " mgmt override " + ov.mgmtIp + " outside subnet " + nets.mgmt.subnet });
          }
          if (ov.vmotionIp && nets.vmotion && nets.vmotion.subnet && !subnetContainsIp(nets.vmotion.subnet, ov.vmotionIp)) {
            issues.push({ ruleId: "VCF-IP-007", severity: "error", message: clusterPath + ": host " + ov.hostIndex + " vmotion override " + ov.vmotionIp + " outside subnet " + nets.vmotion.subnet });
          }
          if (ov.vsanIp && nets.vsan && nets.vsan.subnet && !subnetContainsIp(nets.vsan.subnet, ov.vsanIp)) {
            issues.push({ ruleId: "VCF-IP-007", severity: "error", message: clusterPath + ": host " + ov.hostIndex + " vsan override " + ov.vsanIp + " outside subnet " + nets.vsan.subnet });
          }
        });

        // VCF-HW-NET-020 — MTU checks
        if (nets.hostTep && nets.hostTep.mtu != null && nets.hostTep.mtu < MTU_TEP_MIN) {
          issues.push({ ruleId: "VCF-HW-NET-020", severity: "error", message: clusterPath + ": host TEP MTU " + nets.hostTep.mtu + " below minimum " + MTU_TEP_MIN });
        }
        if (nets.vmotion && nets.vmotion.mtu != null && nets.vmotion.mtu < MTU_VMOTION) {
          issues.push({ ruleId: "VCF-HW-NET-020", severity: "warn", message: clusterPath + ": vMotion MTU " + nets.vmotion.mtu + " below recommended " + MTU_VMOTION });
        }
        if (nets.vsan && nets.vsan.mtu != null && nets.vsan.mtu < MTU_VSAN) {
          issues.push({ ruleId: "VCF-HW-NET-020", severity: "warn", message: clusterPath + ": vSAN MTU " + nets.vsan.mtu + " below recommended " + MTU_VSAN });
        }

        // VCF-HW-NET-022 — T0 edge uplink VLAN must match cluster uplinks
        var uplinkVlans = {};
        (nets.uplinks || []).forEach(function(u) { if (u.vlan != null) uplinkVlans[u.vlan] = true; });
        (cl.t0Gateways || []).forEach(function(t0) {
          (t0.bgpPeers || []).forEach(function(peer) {
            if (peer.ip && nets.uplinks && nets.uplinks.length > 0) {
              var inAny = nets.uplinks.some(function(u) { return u.subnet && subnetContainsIp(u.subnet, peer.ip); });
              if (!inAny) {
                issues.push({ ruleId: "VCF-NET-030", severity: "error", message: clusterPath + ": BGP peer " + peer.ip + " not in any uplink subnet" });
              }
            }
            if (peer.asn != null && t0.asnLocal != null && peer.asn === t0.asnLocal) {
              issues.push({ ruleId: "VCF-NET-031", severity: "warn", message: clusterPath + ": BGP peer ASN " + peer.asn + " equals local ASN (iBGP?) on T0 " + t0.name });
            }
          });
        });

        // Collect mgmt subnets for cross-cluster check
        if (nets.mgmt && nets.mgmt.subnet) {
          allMgmtSubnets.push({ subnet: nets.mgmt.subnet, path: clusterPath });
        }
      });
    });
  });

  // VCF-IP-006 — cross-cluster mgmt subnet reuse (warn)
  for (var mi = 0; mi < allMgmtSubnets.length; mi++) {
    for (var mj = mi + 1; mj < allMgmtSubnets.length; mj++) {
      if (allMgmtSubnets[mi].subnet === allMgmtSubnets[mj].subnet) {
        issues.push({ ruleId: "VCF-IP-006", severity: "warn", message: "Mgmt subnet " + allMgmtSubnets[mi].subnet + " reused: " + allMgmtSubnets[mi].path + " and " + allMgmtSubnets[mj].path });
      }
    }
  }

  return issues;
}

function emitInstallerJson(fleet, fleetResult) {
  var nc = fleet.networkConfig || {};
  var dns = nc.dns || {};
  var ntp = nc.ntp || {};

  var networkSpecs = [];
  var hostSpecs = [];
  var edgeSpecs = [];

  (fleet.instances || []).forEach(function(inst, instIdx) {
    (inst.domains || []).forEach(function(dom, domIdx) {
      (dom.clusters || []).forEach(function(cl, clIdx) {
        var nets = cl.networks;
        if (!nets) return;

        var instResult = fleetResult.instanceResults[instIdx];
        var domResult = instResult && instResult.domainResults[domIdx];
        var clResult = domResult && domResult.clusterResults[clIdx];
        var finalHosts = clResult ? clResult.finalHosts : 0;

        if (nets.mgmt && nets.mgmt.vlan != null) {
          networkSpecs.push({ type: "mgmt", vlanId: nets.mgmt.vlan, subnet: nets.mgmt.subnet, defaultGateway: nets.mgmt.gateway, mtu: nets.mgmt.mtu || 1500, cluster: cl.name });
        }
        if (nets.vmotion && nets.vmotion.vlan != null) {
          networkSpecs.push({ type: "vmotion", vlanId: nets.vmotion.vlan, subnet: nets.vmotion.subnet, mtu: nets.vmotion.mtu || 9000, cluster: cl.name });
        }
        if (nets.vsan && nets.vsan.vlan != null) {
          networkSpecs.push({ type: "vsan", vlanId: nets.vsan.vlan, subnet: nets.vsan.subnet, mtu: nets.vsan.mtu || 9000, cluster: cl.name });
        }
        if (nets.hostTep && nets.hostTep.vlan != null) {
          networkSpecs.push({
            type: "hostTep", vlanId: nets.hostTep.vlan, subnet: nets.hostTep.subnet,
            gateway: nets.hostTep.gateway, mtu: nets.hostTep.mtu || 1700,
            ipPool: nets.hostTep.pool, useDhcp: !!nets.hostTep.useDhcp, cluster: cl.name,
          });
        }
        if (nets.edgeTep && nets.edgeTep.vlan != null) {
          networkSpecs.push({ type: "edgeTep", vlanId: nets.edgeTep.vlan, subnet: nets.edgeTep.subnet, mtu: nets.edgeTep.mtu || 1700, ipPool: nets.edgeTep.pool, cluster: cl.name });
        }

        var ipPlan = allocateClusterIps(cl, finalHosts);
        ipPlan.hosts.forEach(function(h) {
          hostSpecs.push({
            cluster: cl.name,
            hostIndex: h.index,
            ipAddress: { mgmtIp: h.mgmtIp, vmotionIp: h.vmotionIp, vsanIp: h.vsanIp, hostTepIps: h.hostTepIps },
            bmcConfig: { ipAddress: h.bmcIp },
          });
        });

        ipPlan.edgeNodes.forEach(function(en) {
          edgeSpecs.push({ cluster: cl.name, edgeNodeKey: en.edgeNodeKey, t0Id: en.t0Id, tepIpConfig: en.edgeTepIps });
        });
      });
    });
  });

  return {
    dnsSpec: { primaryDomain: dns.primaryDomain || "", dnsServers: dns.servers || [], searchDomains: dns.searchDomains || [] },
    ntpServers: ntp.servers || [],
    syslogSpec: { servers: (nc.syslog && nc.syslog.servers) || [] },
    networkSpecs: networkSpecs,
    hostSpecs: hostSpecs,
    edgeSpecs: edgeSpecs,
  };
}

function emitWorkbookRows(fleet, fleetResult) {
  var nc = fleet.networkConfig || {};
  var dns = nc.dns || {};
  var ntp = nc.ntp || {};

  var fleetSheet = {
    sheet: "Fleet Services",
    rows: [
      ["DNS Servers", (dns.servers || []).join(", ")],
      ["DNS Primary Domain", dns.primaryDomain || ""],
      ["DNS Search Domains", (dns.searchDomains || []).join(", ")],
      ["NTP Servers", (ntp.servers || []).join(", ")],
      ["NTP Timezone", ntp.timezone || "UTC"],
      ["Syslog Servers", ((nc.syslog && nc.syslog.servers) || []).join(", ")],
    ],
  };

  var networkRows = [["Cluster", "Network", "VLAN", "Subnet", "Gateway", "MTU", "Pool Start", "Pool End"]];
  var hostRows = [["Cluster", "Host #", "Mgmt IP", "vMotion IP", "vSAN IP", "TEP IPs", "BMC IP", "Source"]];
  var bgpRows = [["Cluster", "T0 Name", "Local ASN", "Peer Name", "Peer IP", "Peer ASN", "Hold Time", "Keepalive"]];

  (fleet.instances || []).forEach(function(inst, instIdx) {
    (inst.domains || []).forEach(function(dom, domIdx) {
      (dom.clusters || []).forEach(function(cl, clIdx) {
        var nets = cl.networks;
        if (!nets) return;

        var instResult = fleetResult.instanceResults[instIdx];
        var domResult = instResult && instResult.domainResults[domIdx];
        var clResult = domResult && domResult.clusterResults[clIdx];
        var finalHosts = clResult ? clResult.finalHosts : 0;

        var netFields = [
          { key: "mgmt", label: "Management" },
          { key: "vmotion", label: "vMotion" },
          { key: "vsan", label: "vSAN" },
          { key: "hostTep", label: "Host TEP" },
          { key: "edgeTep", label: "Edge TEP" },
        ];
        netFields.forEach(function(f) {
          var n = nets[f.key];
          if (n && n.vlan != null) {
            networkRows.push([cl.name, f.label, String(n.vlan), n.subnet || "", n.gateway || "", String(n.mtu || ""), (n.pool && n.pool.start) || "", (n.pool && n.pool.end) || ""]);
          }
        });

        var ipPlan = allocateClusterIps(cl, finalHosts);
        ipPlan.hosts.forEach(function(h) {
          hostRows.push([cl.name, String(h.index), h.mgmtIp || "", h.vmotionIp || "", h.vsanIp || "", h.hostTepIps ? h.hostTepIps.join("; ") : "DHCP", h.bmcIp || "", h.source]);
        });

        (cl.t0Gateways || []).forEach(function(t0) {
          (t0.bgpPeers || []).forEach(function(peer) {
            bgpRows.push([cl.name, t0.name, String(t0.asnLocal || ""), peer.name || "", peer.ip || "", String(peer.asn || ""), String(peer.holdTime || 180), String(peer.keepAlive || 60)]);
          });
        });
      });
    });
  });

  return [
    fleetSheet,
    { sheet: "Network Configuration", rows: networkRows },
    { sheet: "IP Address Plan", rows: hostRows },
    { sheet: "BGP Configuration", rows: bgpRows },
  ];
}

// Given a cluster, return all issues against VCF-INV-060..065. Each entry has
// { ruleId, severity: "critical"|"warn", message }. Empty array = clean.
function validateT0Gateways(cluster) {
  const issues = [];
  const t0s = cluster?.t0Gateways || [];

  // VCF-INV-061 — count how many T0s reference each edge key
  const edgeT0Map = new Map();
  for (const t0 of t0s) {
    for (const k of t0.edgeNodeKeys || []) {
      edgeT0Map.set(k, (edgeT0Map.get(k) || 0) + 1);
    }
  }
  for (const [k, count] of edgeT0Map.entries()) {
    if (count > T0_MAX_T0S_PER_EDGE_NODE) {
      issues.push({
        ruleId: "VCF-INV-061",
        severity: "critical",
        message: `Edge node ${k} hosts ${count} T0 gateways (max ${T0_MAX_T0S_PER_EDGE_NODE})`,
      });
    }
  }

  for (const t0 of t0s) {
    const mode = T0_HA_MODES[t0.haMode];
    if (!mode) {
      issues.push({
        ruleId: "VCF-INV-060",
        severity: "critical",
        message: `T0 ${t0.name}: unknown haMode "${t0.haMode}"`,
      });
      continue;
    }
    const nodeCount = (t0.edgeNodeKeys || []).length;

    // VCF-INV-060 — edge-node count limit per HA mode
    if (nodeCount > mode.maxEdgeNodes) {
      issues.push({
        ruleId: "VCF-INV-060",
        severity: "critical",
        message: `T0 ${t0.name} in ${t0.haMode} mode has ${nodeCount} Edge nodes (max ${mode.maxEdgeNodes})`,
      });
    }

    // VCF-INV-062 — stateful A/A requires even count ≥ 2
    if (t0.haMode === "active-active" && t0.stateful) {
      if (nodeCount < 2 || nodeCount % 2 !== 0) {
        issues.push({
          ruleId: "VCF-INV-062",
          severity: "critical",
          message: `T0 ${t0.name}: stateful A/A requires an EVEN number of Edge nodes (2, 4, 6, or 8); have ${nodeCount}`,
        });
      }
      // VCF-INV-064 — stateful A/A not producible via Installer/wizard
      issues.push({
        ruleId: "VCF-INV-064",
        severity: "warn",
        message: `T0 ${t0.name}: stateful A/A requires Day-2 NSX Manager UI configuration (interface groups + sub-cluster pairs). Not producible via VCF Installer or vCenter guided Edge wizard.`,
      });
    }

    // VCF-INV-063 — A/A cannot satisfy VKS/Automation All-Apps requirement
    if (t0.haMode === "active-active"
        && (t0.featureRequirements || []).some((f) => ["vks", "vcfAutomationAllApps"].includes(f))) {
      issues.push({
        ruleId: "VCF-INV-063",
        severity: "critical",
        message: `T0 ${t0.name}: VKS / VCF Automation All-Apps require an Active/Standby T0`,
      });
    }

    // VCF-INV-065 — A/A uplink accounting: each Edge node may have up to
    // T0_MAX_UPLINKS_PER_EDGE_AA (2) uplinks; total per T0 capped at
    // 8 edges × 2 = 16 uplinks. Only evaluated for A/A; A/S is capped
    // earlier by VCF-INV-060 at 2 edge nodes.
    if (t0.haMode === "active-active") {
      const uplinks = t0.uplinksPerEdge || [];
      // Any explicitly-set value above the per-node cap
      for (let i = 0; i < uplinks.length; i++) {
        const n = uplinks[i];
        if (typeof n === "number" && n > T0_MAX_UPLINKS_PER_EDGE_AA) {
          issues.push({
            ruleId: "VCF-INV-065",
            severity: "critical",
            message: `T0 ${t0.name}: Edge node index ${i} configured with ${n} uplinks (max ${T0_MAX_UPLINKS_PER_EDGE_AA} per Edge node in A/A)`,
          });
        }
      }
      // Total uplinks across the T0 capped at maxEdgeNodes × 2 = 16
      const totalUplinks = uplinks.reduce((s, n) => s + (typeof n === "number" ? n : 0), 0);
      const maxTotal = mode.maxEdgeNodes * T0_MAX_UPLINKS_PER_EDGE_AA;
      if (totalUplinks > maxTotal) {
        issues.push({
          ruleId: "VCF-INV-065",
          severity: "critical",
          message: `T0 ${t0.name}: total A/A uplinks = ${totalUplinks} (max ${maxTotal} = ${mode.maxEdgeNodes} edge nodes × ${T0_MAX_UPLINKS_PER_EDGE_AA})`,
        });
      }
      // Informational: uplinksPerEdge array longer than edgeNodeKeys
      if (uplinks.length > (t0.edgeNodeKeys || []).length) {
        issues.push({
          ruleId: "VCF-INV-065",
          severity: "info",
          message: `T0 ${t0.name}: uplinksPerEdge has ${uplinks.length} entries but only ${(t0.edgeNodeKeys || []).length} edge nodes are bound`,
        });
      }
    }
  }

  return issues;
}

const DR_POSTURES = {
  active: {
    ruleId: null,
    label: "Active",
    description: "Instance runs its full appliance stack in steady-state.",
  },
  "warm-standby": {
    ruleId: "VCF-DR-001",
    label: "Warm Standby",
    description: "Instance is a VLR/SRM replication target. Fleet-level services remain dormant until failover is triggered (VCF-DR-040).",
  },
};

// Components that VLR/vSphere Replication protects per VCF-DR-010.
const DR_REPLICATED_COMPONENTS = ["vcfOps", "fleetMgr", "vcfOpsLogs", "vcfOpsNet"];
// Components that use backup/restore instead of active replication per VCF-DR-020.
const DR_BACKUP_COMPONENTS = ["vcfAuto", "identityBroker"];

function isWarmStandby(instance) {
  return instance?.drPosture === "warm-standby";
}

// Count per-fleet appliance entries on ACTIVE instances only — warm-standby
// placeholders don't count toward VCF-INV-010. Used by the invariant test.
function countActivePerFleetEntries(fleet, applianceId) {
  let n = 0;
  for (const inst of fleet?.instances || []) {
    if (isWarmStandby(inst)) continue;
    for (const dom of inst.domains || []) {
      for (const clu of dom.clusters || []) {
        for (const e of clu.infraStack || []) {
          if (e.id === applianceId) n += 1;
        }
      }
    }
  }
  return n;
}

const SSO_MODES = {
  embedded: {
    ruleId: "VCF-SSO-001",
    label: "Embedded (per-instance)",
    description: "Each instance runs an embedded broker inside its own vCenter. Smallest blast radius; recommended for single-instance fleets.",
  },
  "fleet-wide": {
    ruleId: "VCF-SSO-002",
    label: "Fleet-Wide (single broker)",
    description: "One 3-node broker cluster serves the whole fleet, deployed on the initial instance. Recommended for up to 5 instances.",
  },
  "multi-broker": {
    ruleId: "VCF-SSO-003",
    label: "Cross-Instance (multi-broker)",
    description: "Multiple broker clusters, each serving a subset of instances. For >5 instances or per-region identity isolation.",
  },
};

// Infer the right SSO mode for a legacy fleet: single-instance → embedded,
// multi-instance → fleet-wide (users can upgrade to multi-broker explicitly).
function inferSsoMode(fleet) {
  if (fleet?.ssoMode && SSO_MODES[fleet.ssoMode]) return fleet.ssoMode;
  const n = fleet?.instances?.length || 0;
  return n > 1 ? "fleet-wide" : "embedded";
}

// VCF-INV-031 instance-per-broker threshold. Returns { overBrokerCount }:
// if true, the fleet exceeds the recommended 5 instances per broker and
// should consider multi-broker segmentation. Informational (not a hard fail).
const SSO_INSTANCES_PER_BROKER_LIMIT = 5;
function ssoInstancesPerBroker(fleet) {
  const mode = inferSsoMode(fleet);
  const instances = fleet?.instances?.length || 0;
  const brokers = mode === "multi-broker"
    ? (fleet?.ssoBrokers?.length || 0)
    : 1;
  const perBroker = brokers > 0 ? instances / brokers : Infinity;
  return {
    mode,
    instances,
    brokers,
    perBroker,
    overLimit: perBroker > SSO_INSTANCES_PER_BROKER_LIMIT,
  };
}

const DEPLOYMENT_PATHWAYS = {
  greenfield: {
    ruleId: "VCF-PATH-001",
    label: "Greenfield",
    description: "New fleet + new instance. VCF Installer deploys everything into a freshly-built mgmt cluster.",
  },
  expand: {
    ruleId: "VCF-PATH-002",
    label: "Expand Fleet",
    description: "Add an instance to an existing fleet. Fleet-level services are REUSED from the initial instance.",
  },
  converge: {
    ruleId: "VCF-PATH-003",
    label: "Converge",
    description: "Convert a non-VCF vCenter into a VCF mgmt cluster. Preserves existing vCenter + storage.",
  },
  import: {
    ruleId: "VCF-PATH-004",
    label: "Import Workload Domain",
    description: "Import an existing vCenter as a WORKLOAD DOMAIN into an existing VCF instance. No new mgmt appliances.",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SCALE LIMITS & RECOMMENDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const SIZING_LIMITS = {
  vcenter: {
    Tiny:   { hosts: 10,   vms: 100,   label: "10 hosts / 100 VMs" },
    Small:  { hosts: 100,  vms: 1000,  label: "100 hosts / 1k VMs" },
    Medium: { hosts: 400,  vms: 4000,  label: "400 hosts / 4k VMs" },
    Large:  { hosts: 1000, vms: 10000, label: "1k hosts / 10k VMs" },
    XLarge: { hosts: 2000, vms: 35000, label: "2k hosts / 35k VMs" },
  },
  nsxMgr: {
    ExtraSmall: { hosts: 0,    clusters: 0,   label: "CSM only", production: false },
    Small:      { hosts: 0,    clusters: 0,   label: "PoC only", production: false },
    Medium:     { hosts: 128,  clusters: 5,   label: "128 hosts / 5 clusters", production: true },
    Large:      { hosts: 1024, clusters: 256, label: "1024 hosts / 256 clusters", production: true },
    XLarge:     { hosts: 2048, clusters: 512, label: "2048 hosts / 512 clusters", production: true },
  },
};

function recommendVcenterSize(hosts, vms) {
  for (const k of ["Tiny", "Small", "Medium", "Large", "XLarge"]) {
    const lim = SIZING_LIMITS.vcenter[k];
    if (hosts <= lim.hosts && vms <= lim.vms) return k;
  }
  return "XLarge";
}
function recommendNsxSize(hosts, clusters) {
  for (const k of ["Medium", "Large", "XLarge"]) {
    const lim = SIZING_LIMITS.nsxMgr[k];
    if (hosts <= lim.hosts && clusters <= lim.clusters) return k;
  }
  return "XLarge";
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTION POLICIES & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const POLICIES = {
  raid5_2p1:   { label: "RAID-5 (2+1) FTT=1", pf: 1.50, minHosts: 3, ftt: 1 },
  raid5_4p1:   { label: "RAID-5 (4+1) FTT=1", pf: 1.25, minHosts: 6, ftt: 1 },
  raid6_4p2:   { label: "RAID-6 (4+2) FTT=2", pf: 1.50, minHosts: 6, ftt: 2 },
  mirror_ftt1: { label: "Mirror FTT=1",       pf: 2.00, minHosts: 3, ftt: 1 },
  mirror_ftt2: { label: "Mirror FTT=2",       pf: 3.00, minHosts: 5, ftt: 2 },
  mirror_ftt3: { label: "Mirror FTT=3",       pf: 4.00, minHosts: 7, ftt: 3 },
};

const TB_TO_TIB = 0.9095;
const TIB_PER_CORE = 1;
const NVME_TIER_PARTITION_CAP_GB = 4096;

// ─── NETWORK CONSTANTS ─────────────────────────────────────────────────────
const VLAN_ID_MIN = 1;
const VLAN_ID_MAX = 4094;
const MTU_MGMT = 1500;
const MTU_VMOTION = 9000;
const MTU_VSAN = 9000;
const MTU_TEP_MIN = 1600;
const MTU_TEP_RECOMMENDED = 1700;
const DEFAULT_BGP_ASN_AA = 65000;
const TEP_POOL_GROWTH_FACTOR = 1.25;

const NIC_PROFILES = {
  "2-nic": {
    nicCount: 2,
    uplinks: ["vmnic0", "vmnic1"],
    vds: [{ name: "vds-converged", uplinks: ["vmnic0", "vmnic1"], mtu: 9000 }],
    portgroups: { mgmt: "vds-converged", vmotion: "vds-converged", vsan: "vds-converged", hostTep: "vds-converged" },
    teaming: "loadBalanceSrcId",
  },
  "4-nic": {
    nicCount: 4,
    uplinks: ["vmnic0", "vmnic1", "vmnic2", "vmnic3"],
    vds: [
      { name: "vds-mgmt-vmotion", uplinks: ["vmnic0", "vmnic1"], mtu: 9000 },
      { name: "vds-sdn", uplinks: ["vmnic2", "vmnic3"], mtu: 9000 },
    ],
    portgroups: { mgmt: "vds-mgmt-vmotion", vmotion: "vds-mgmt-vmotion", vsan: "vds-sdn", hostTep: "vds-sdn" },
    teaming: "loadBalanceSrcId",
  },
  "6-nic": {
    nicCount: 6,
    uplinks: ["vmnic0", "vmnic1", "vmnic2", "vmnic3", "vmnic4", "vmnic5"],
    vds: [
      { name: "vds-mgmt", uplinks: ["vmnic0", "vmnic1"], mtu: 1500 },
      { name: "vds-vmotion-vsan", uplinks: ["vmnic2", "vmnic3"], mtu: 9000 },
      { name: "vds-overlay", uplinks: ["vmnic4", "vmnic5"], mtu: 9000 },
    ],
    portgroups: { mgmt: "vds-mgmt", vmotion: "vds-vmotion-vsan", vsan: "vds-vmotion-vsan", hostTep: "vds-overlay" },
    teaming: "loadBalanceSrcId",
  },
  "8-nic": {
    nicCount: 8,
    uplinks: ["vmnic0", "vmnic1", "vmnic2", "vmnic3", "vmnic4", "vmnic5", "vmnic6", "vmnic7"],
    vds: [
      { name: "vds-mgmt", uplinks: ["vmnic0", "vmnic1"], mtu: 1500 },
      { name: "vds-vmotion", uplinks: ["vmnic2", "vmnic3"], mtu: 9000 },
      { name: "vds-vsan", uplinks: ["vmnic4", "vmnic5"], mtu: 9000 },
      { name: "vds-overlay", uplinks: ["vmnic6", "vmnic7"], mtu: 9000 },
    ],
    portgroups: { mgmt: "vds-mgmt", vmotion: "vds-vmotion", vsan: "vds-vsan", hostTep: "vds-overlay" },
    teaming: "loadBalanceSrcId",
  },
};

// Lightweight number formatter used inside engine reason strings.
// Mirrors the UI fmt() helper but intentionally lives here so engine.js stays
// self-contained for Node tests.
function fmtNum(n, d = 0) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORIES — create new entities at each level of the hierarchy
// ─────────────────────────────────────────────────────────────────────────────
function cryptoKey() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const baseHostSpec = () => ({
  cpuQty: 2,
  coresPerCpu: 16,
  hyperthreadingEnabled: false,
  ramGb: 1024,
  nvmeQty: 6,
  nvmeSizeTb: 7.68,
  cpuOversub: 2,
  ramOversub: 1,
  reservePct: 30,
});

const baseStorageSettings = () => ({
  policy: "raid5_2p1",
  dedup: 1.0,
  compression: 1.0,
  swapPct: 100,
  freePct: 25,
  growthPct: 15,
  externalStorage: false,
  externalArrayTib: 0,
});

const baseTiering = () => ({
  enabled: false,
  nvmePct: 100,
  eligibilityPct: 70,
  tierDriveSizeTb: 7.68,
});

// A cluster is the leaf-level unit where the sizing math runs. It has its own
// host hardware, its own workload demand, and its own infrastructure stack.
function newCluster(name = "cluster-01", isDefault = true) {
  return {
    id: `clu-${cryptoKey()}`,
    name,
    isDefault,
    host: baseHostSpec(),
    // Workload VMs that run in this cluster
    workload: {
      vmCount: 0,
      vcpuPerVm: 4,
      ramPerVm: 16,
      diskPerVm: 100,
    },
    // Infrastructure appliances that run in this cluster
    infraStack: [],
    storage: baseStorageSettings(),
    tiering: baseTiering(),
    // Manual host-count floor: when > 0 the sizing engine treats this as
    // another `candidates` entry alongside CPU/RAM/storage/policy floors.
    // Lets the user force a stretched cluster to have enough hosts per
    // side to survive a site failure without changing host specs. Cannot
    // drop finalHosts below the architectural minimum; only raise it.
    hostOverride: 0,
    // T0 gateway topology per VCF-APP-006 / VCF-INV-060..065. Each entry
    // represents one Tier-0 gateway served by a subset of this cluster's
    // nsxEdge stack entries.
    t0Gateways: [],
    // VCF-PATH-003 converge pathway marker: when true, this cluster
    // pre-existed and is being converged into the VCF fleet rather than
    // deployed fresh. Purely informational — used by the UI to render a
    // muted "existing" badge and by reports to separate capex.
    preExisting: false,
    // VCF-APP-006 Edge deployment model. Informational — sizing doesn't
    // change, but the chosen model drives DC layout expectations and
    // survivability. Null when not declared.
    edgeDeploymentModel: null,
    networks: createClusterNetworks(),
    hostOverrides: [],
  };
}

// Build the default mgmt cluster — same as a regular cluster but with the
// standard management appliance stack pre-populated.
function newMgmtCluster(name = "mgmt-cluster-01") {
  const c = newCluster(name, true);
  c.infraStack = DEFAULT_MGMT_STACK_TEMPLATE.map((s) => ({ ...s, key: cryptoKey() }));
  return c;
}

// A workload cluster pre-populated with vCLS (since every cluster needs it)
function newWorkloadCluster(name = "wld-cluster-01") {
  const c = newCluster(name, true);
  c.infraStack = [{ id: "vcls", size: "Default", instances: 2, key: cryptoKey() }];
  c.workload = { vmCount: 200, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 };
  return c;
}

// A domain is a thin container that holds clusters. The domain's vCenter and
// other management overhead live in its parent instance's mgmt domain (the
// workbook convention) — domains themselves don't carry sizing data.
function newMgmtDomain(name = "Management Domain") {
  return {
    id: `dom-${cryptoKey()}`,
    type: "mgmt",
    name,
    placement: "stretched", // mgmt domain defaults to stretched when instance is stretched
    hostSplitPct: 50,       // % of hosts at stretchSiteIds[0] (rest at stretchSiteIds[1]) when stretched
    localSiteId: null,      // when placement === "local", which site id the domain runs at
    // When placement === "stretched", the exact pair of site ids this domain
    // stretches across. Must be a 2-element subset of instance.siteIds. Null
    // for local placement. Introduced to support VCF instances that touch
    // 3+ sites where only some domains stretch across a specific pair.
    stretchSiteIds: null,
    clusters: [newMgmtCluster()],
  };
}

function newWorkloadDomain(name = "Workload Domain 01") {
  return {
    id: `dom-${cryptoKey()}`,
    type: "workload",
    name,
    placement: "local",  // "local" = pinned to one site, "stretched" = spans a pair
    hostSplitPct: 50,    // % of hosts at stretchSiteIds[0] when stretched
    localSiteId: null,   // set by the parent InstanceCard to a concrete site id
    stretchSiteIds: null, // pair of site ids; set when placement === "stretched"
    // VCF domain services (dedicated vCenter, NSX Manager cluster, edges, Avi,
    // VCF Automation, etc.) for this workload domain. Does NOT include vCLS —
    // that is per-cluster baseline and lives in cluster.infraStack.
    wldStack: [],
    // Id of the specific cluster that hosts wldStack VMs. Can point at any
    // cluster in the instance's mgmt domain (VCF 9 default — any of the
    // mgmt domain's 1+ clusters) or any cluster in THIS workload domain.
    // Set by the parent InstanceCard when the domain is added; null means
    // "fall back to the mgmt domain's first cluster at sizing time".
    componentsClusterId: null,
    clusters: [newWorkloadCluster()],
  };
}

// A VCF instance has exactly one mgmt domain plus zero or more workload domains.
// When stretched: the instance spans a primary site (where it lives in the hierarchy)
// and a secondary site. Individual domains can be local or stretched.
// Stretched clusters require synchronous storage replication (vSAN stretched
// cluster or array-based replication) and L2 network stretch via NSX.
function newInstance(name = "vcf-instance-01", siteIds = []) {
  // Shape the default mgmt domain to match the siteIds passed in. The
  // factory can't rely on the mgmt domain's own defaults (which assume a
  // stretched pair) when the caller asks for a single-site or multi-site
  // instance.
  const mgmt = newMgmtDomain();
  if (siteIds.length >= 2) {
    mgmt.placement = "stretched";
    mgmt.localSiteId = null;
    mgmt.stretchSiteIds = [siteIds[0], siteIds[1]];
  } else {
    mgmt.placement = "local";
    mgmt.localSiteId = siteIds[0] || null;
    mgmt.stretchSiteIds = null;
  }
  return {
    id: "inst-" + cryptoKey(),
    name,
    deploymentProfile: "ha",
    siteIds: [...siteIds],
    witnessEnabled: false,
    witnessSize: "Medium",
    witnessSite: { name: "Witness Site", location: "" },
    // VCF-APP-080: optional reference to a fleet.sites[] entry with
    // siteRole === "witness". When non-null, takes precedence over the
    // free-form witnessSite object for rendering and reporting. Lets one
    // physical witness location be shared across multiple stretched
    // instances.
    witnessSiteId: null,
    // VCF-DR-001..050 posture. "active" runs the full stack; "warm-standby"
    // is paired with another instance via VLR/SRM replication and does NOT
    // actively run fleet-level appliances even if they appear in its stack.
    drPosture: "active",
    drPairedInstanceId: null,
    domains: [mgmt],
  };
}

function newSite(name = "Primary Site", location = "") {
  return {
    id: "site-" + cryptoKey(),
    name,
    location,
    // Optional region grouping per VCF-TOPO-004 (multi-region fleet). Purely
    // informational — used to group sites in Per-Site view and reports.
    region: "",
    // Optional site role. "primary" | "dr" | "witness" per VCF-DR rules.
    // Empty string means unspecified (default).
    siteRole: "",
  };
}

function newFleet() {
  const primary = newSite("Primary Site", "");
  const inst = newInstance("vcf-instance-01", [primary.id]);
  return {
    id: "fleet-" + cryptoKey(),
    name: "Production Fleet",
    // Deployment pathway per VCF-PATH-001..004. Drives per-fleet appliance
    // placement decisions: "greenfield" deploys the full initial stack,
    // "expand" reuses an existing initial instance (never duplicates
    // per-fleet appliances), "converge" preserves an existing non-VCF
    // cluster, "import" pulls in a running workload-domain vCenter.
    deploymentPathway: "greenfield",
    // NSX Federation intent per VCF-INV-021. When true, nsxGlobalMgr is
    // expected on the initial instance (active cluster) and a second
    // instance (standby cluster). Defaults to false; UI toggles this and
    // legacy imports infer it from profile names.
    federationEnabled: false,
    // SSO deployment model per VCF-APP-030 / VCF-SSO-001/002/003.
    //   "embedded"     — each instance runs an embedded broker in its own
    //                    vCenter (VCF-SSO-001). Smallest blast radius.
    //   "fleet-wide"   — one shared 3-node broker cluster for the entire
    //                    fleet, on the initial instance (VCF-SSO-002).
    //                    Recommended up to 5 instances (VCF-INV-031).
    //   "multi-broker" — multiple broker clusters, each serving a subset
    //                    of instances (VCF-SSO-003). Scales past 5.
    ssoMode: "embedded",
    // Active brokers when ssoMode === "multi-broker". Each entry lists the
    // instance ids it serves. Validated by VCF-INV-031.
    ssoBrokers: [],
    // Fleet-level services (vcfOps, vcfAuto) bind to exactly ONE broker
    // regardless of how many exist (VCF-INV-032). When null, defaults to
    // the single broker in embedded / fleet-wide modes.
    ssoFleetServicesBrokerId: null,
    networkConfig: createFleetNetworkConfig(),
    sites: [primary],
    instances: [inst],
  };
}

// Resolve the set of site ids a single domain physically lives at. Stretched
// domains return their explicit stretchSiteIds pair; local domains return
// their localSiteId (falling back to the instance's first site for legacy
// data that pre-dates explicit per-domain pinning).
function domainSites(dom, instance) {
  const instSiteIds = instance.siteIds || [];
  if (dom.placement === "stretched"
      && Array.isArray(dom.stretchSiteIds)
      && dom.stretchSiteIds.length === 2) {
    return dom.stretchSiteIds;
  }
  const localId =
    dom.localSiteId && instSiteIds.includes(dom.localSiteId)
      ? dom.localSiteId
      : instSiteIds[0] || null;
  return localId ? [localId] : [];
}

// Build default appliance-to-site assignments. For each appliance entry
// we distribute its VM instances round-robin across the home sites of the
// domain that owns the cluster the entry belongs to — the stretch pair for
// a stretched domain, or the pinned site for a local domain. Returns a map:
// { [applianceKey]: [siteId, ...] }.
function buildDefaultPlacement(instance) {
  const siteIds = instance.siteIds || [];
  if (siteIds.length < 2) return {};
  const placement = {};
  for (const dom of instance.domains || []) {
    const targets = domainSites(dom, instance);
    if (!targets || targets.length === 0) continue;
    for (const clu of dom.clusters || []) {
      for (const entry of clu.infraStack || []) {
        const count = entry.instances || 1;
        const assigned = [];
        for (let i = 0; i < count; i++) {
          assigned.push(targets[i % targets.length]);
        }
        placement[entry.key] = assigned;
      }
    }
    if (dom.type === "workload") {
      for (const entry of dom.wldStack || []) {
        const count = entry.instances || 1;
        const assigned = [];
        for (let i = 0; i < count; i++) {
          assigned.push(targets[i % targets.length]);
        }
        placement[entry.key] = assigned;
      }
    }
  }
  return placement;
}

// Ensure instance.appliancePlacement exists and covers all current stack
// entries. Adds missing keys with default alternating assignments, and
// replaces entries whose site ids no longer sit inside the instance's
// siteIds (e.g. a site was removed).
function ensurePlacement(instance) {
  if ((instance.siteIds || []).length < 2) return {};
  const existing = instance.appliancePlacement || {};
  const defaults = buildDefaultPlacement(instance);
  const merged = {};
  for (const [key, defaultAssign] of Object.entries(defaults)) {
    const prev = existing[key];
    if (prev && prev.length === defaultAssign.length) {
      // Validate all site IDs still exist on this instance
      const valid = prev.every((sid) => instance.siteIds.includes(sid));
      merged[key] = valid ? prev : defaultAssign;
    } else {
      merged[key] = defaultAssign;
    }
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION — convert old v2 flat format into new v3 hierarchical structure.
// Old format: { version: "vcf-sizer-v2", mgmt: {...}, wlds: [{...}] }
// New format: { version: "vcf-sizer-v3", fleet: { sites: [{ instances: [{ domains: [...] }] }] } }
// ─────────────────────────────────────────────────────────────────────────────
function migrateV2ToV3(oldConfig) {
  const oldMgmt = oldConfig.mgmt;
  const oldWlds = oldConfig.wlds || [];

  // Old mgmt domain → new mgmt domain with one cluster containing the old data
  const mgmtCluster = {
    id: `clu-${cryptoKey()}`,
    name: "mgmt-cluster-01",
    isDefault: true,
    host: oldMgmt.host || baseHostSpec(),
    workload: { vmCount: 0, vcpuPerVm: 4, ramPerVm: 16, diskPerVm: 100 },
    infraStack: (oldMgmt.stack || []).map((s) => ({ ...s, key: cryptoKey() })),
    storage: oldMgmt.storage || baseStorageSettings(),
    tiering: oldMgmt.tiering || baseTiering(),
  };
  const mgmtDomain = {
    id: `dom-${cryptoKey()}`,
    type: "mgmt",
    name: oldMgmt.name || "Management Domain",
    clusters: [mgmtCluster],
  };

  // Old workload domains → new workload domains with one cluster each
  const wldDomains = oldWlds.map((w, i) => {
    const cluster = {
      id: `clu-${cryptoKey()}`,
      name: `wld-cluster-01`,
      isDefault: true,
      host: w.host || baseHostSpec(),
      workload: {
        vmCount: w.vmCount || 0,
        vcpuPerVm: w.vcpuPerVm || 4,
        ramPerVm: w.ramPerVm || 16,
        diskPerVm: w.diskPerVm || 100,
      },
      infraStack: (w.infraStack || []).map((s) => ({ ...s, key: cryptoKey() })),
      storage: w.storage || baseStorageSettings(),
      tiering: w.tiering || baseTiering(),
    };
    return {
      id: `dom-${cryptoKey()}`,
      type: "workload",
      name: w.name || `Workload Domain ${i + 1}`,
      clusters: [cluster],
    };
  });

  return {
    id: `fleet-${cryptoKey()}`,
    name: "Migrated Fleet (from v2)",
    sites: [{
      id: `site-${cryptoKey()}`,
      name: "Primary Site",
      location: "",
      instances: [{
        id: `inst-${cryptoKey()}`,
        name: "vcf-instance-01",
        domains: [mgmtDomain, ...wldDomains],
      }],
    }],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v3 → v5 MIGRATION — lift instances out of sites, consolidate stretched dupes
// ─────────────────────────────────────────────────────────────────────────────
function domainStructureMatches(a, b) {
  if (!a?.domains || !b?.domains) return false;
  if (a.domains.length !== b.domains.length) return false;
  for (let i = 0; i < a.domains.length; i++) {
    const da = a.domains[i], db = b.domains[i];
    if (da.type !== db.type) return false;
    if ((da.clusters || []).length !== (db.clusters || []).length) return false;
    for (let j = 0; j < da.clusters.length; j++) {
      if (!!da.clusters[j].isDefault !== !!db.clusters[j].isDefault) return false;
    }
  }
  return true;
}

function stackSignature(domains) {
  const parts = [];
  for (const d of domains || []) {
    for (const c of d.clusters || []) {
      for (const e of c.infraStack || []) parts.push(`${e.id}:${e.size}:${e.instances}`);
    }
  }
  return parts.sort().join("|");
}

function liftV3Instance(v3Inst, siteIds) {
  // Pre-resolve the mgmt domain's first cluster id so we can default every
  // workload domain's wldStack placement to "any cluster in the mgmt domain"
  // without each per-domain map callback having to re-walk the domain list.
  const mgmtFirstCluId =
    (v3Inst.domains || []).find((d) => d.type === "mgmt")?.clusters?.[0]?.id || null;
  return {
    id: v3Inst.id,
    name: v3Inst.name,
    deploymentProfile: v3Inst.deploymentProfile || "ha",
    siteIds: [...siteIds],
    witnessEnabled: !!v3Inst.witnessSize && v3Inst.witnessSize !== "None",
    witnessSize: v3Inst.witnessSize || "Medium",
    witnessSite: v3Inst.witnessSite || { name: "Witness Site", location: "" },
    domains: (v3Inst.domains || []).map((d) => {
      const placement = d.placement || (siteIds.length === 2 ? "stretched" : "local");
      // v3 had no per-domain site pinning — local domains always lived at the
      // instance's primary (first) site. Preserve that semantic on migration.
      const localSiteId =
        placement === "local"
          ? (d.localSiteId && siteIds.includes(d.localSiteId) ? d.localSiteId : siteIds[0] || null)
          : null;
      // v3 has no wldStack or components placement. Default workload domains
      // to empty wldStack + "host appliances in mgmt domain's first cluster"
      // (VCF 9's default behavior). Every wldStack entry is tagged with
      // ownerDomainId for downstream visibility/attribution.
      const wldStack =
        d.type === "workload"
          ? (d.wldStack || []).map((e) => ({
              ...e,
              key: e.key || cryptoKey(),
              ownerDomainId: e.ownerDomainId || d.id,
            }))
          : [];
      const componentsClusterId =
        d.type === "workload" ? (d.componentsClusterId || mgmtFirstCluId) : null;
      // Drop the legacy componentsLocation enum — it existed briefly in v5.1
      // but is now superseded by componentsClusterId.
      const { componentsLocation: _legacy, ...rest } = d;
      const stretchSiteIds =
        placement === "stretched" && siteIds.length >= 2
          ? [siteIds[0], siteIds[1]]
          : null;
      return {
        ...rest,
        placement,
        hostSplitPct: getHostSplitPct(d),
        localSiteId,
        stretchSiteIds,
        wldStack,
        componentsClusterId,
      };
    }),
  };
}

function migrateV3ToV5(v3Fleet) {
  const sites = (v3Fleet.sites || []).map((s) => ({ id: s.id, name: s.name, location: s.location || "" }));
  const flat = [];
  for (const s of v3Fleet.sites || []) {
    for (const inst of s.instances || []) flat.push({ parentSiteId: s.id, inst });
  }
  const consumed = new Set();
  const instances = [];
  for (let i = 0; i < flat.length; i++) {
    if (consumed.has(i)) continue;
    const { parentSiteId: aSite, inst: A } = flat[i];
    if (!A.stretched || !A.secondarySiteId) {
      instances.push(liftV3Instance(A, [aSite])); continue;
    }
    let pairIdx = -1;
    for (let j = i + 1; j < flat.length; j++) {
      if (consumed.has(j)) continue;
      const { parentSiteId: bSite, inst: B } = flat[j];
      if (B.stretched && B.secondarySiteId === aSite && A.secondarySiteId === bSite &&
          B.name === A.name && domainStructureMatches(A, B)) { pairIdx = j; break; }
    }
    if (pairIdx === -1) {
      console.warn(`[vcf-migrate] ${A.id} marked stretched but no partner found`);
      instances.push(liftV3Instance(A, [aSite])); continue;
    }
    const { parentSiteId: bSite, inst: B } = flat[pairIdx];
    consumed.add(pairIdx);
    if (stackSignature(A.domains) !== stackSignature(B.domains)) {
      console.warn(`[vcf-migrate] stack drift between ${A.id} and ${B.id}; keeping ${A.id} as authoritative`);
    }
    instances.push(liftV3Instance(A, [aSite, bSite]));
  }
  return { id: v3Fleet.id, name: v3Fleet.name, sites, instances };
}

function migrateV5ToV6(fleet) {
  if (!fleet.networkConfig) {
    fleet = { ...fleet, networkConfig: createFleetNetworkConfig() };
  }
  return {
    ...fleet,
    version: "vcf-sizer-v6",
    instances: (fleet.instances || []).map(function(inst) {
      var instSiteIds = inst.siteIds || [];
      return {
        ...inst,
        domains: (inst.domains || []).map(function(dom) {
          // Backfill stretchSiteIds for stretched domains that pre-date the
          // multi-site schema. Existing fleets only had 2-site stretched
          // instances, so default to the first two site ids if the domain
          // is stretched and the field is missing. Idempotent: leaves
          // already-populated values alone.
          var stretchSiteIds = dom.stretchSiteIds;
          if (dom.placement === "stretched" && !stretchSiteIds && instSiteIds.length >= 2) {
            stretchSiteIds = [instSiteIds[0], instSiteIds[1]];
          } else if (dom.placement !== "stretched" && stretchSiteIds) {
            stretchSiteIds = null;
          }
          return {
            ...dom,
            stretchSiteIds: stretchSiteIds != null ? stretchSiteIds : null,
            clusters: (dom.clusters || []).map(function(cl) {
              var updated = {
                ...cl,
                networks: cl.networks || createClusterNetworks(),
                hostOverrides: cl.hostOverrides || [],
              };
              updated.t0Gateways = (updated.t0Gateways || []).map(function(t0) {
                return {
                  ...t0,
                  asnLocal: t0.asnLocal != null ? t0.asnLocal : (t0.asn != null ? t0.asn : null),
                  bgpPeers: t0.bgpPeers || [],
                };
              });
              return updated;
            }),
          };
        }),
      };
    }),
  };
}

function migrateFleet(raw) {
  if (!raw) return migrateV5ToV6(newFleet());
  const version = raw.version || "vcf-sizer-v3";
  let fleet = raw.fleet || raw;
  // Run older versions through their upgrade paths first, then fall through
  // to the v5 normalization pass so that newly-added host fields
  // (e.g. hyperthreadingEnabled) are populated regardless of source version.
  if (version === "vcf-sizer-v2") {
    const v3 = migrateV2ToV3(fleet);
    fleet = migrateV3ToV5(v3.fleet || v3);
  } else if (version !== "vcf-sizer-v5" && version !== "vcf-sizer-v6") {
    fleet = migrateV3ToV5(fleet);
  }
  fleet = migrateV5ToV6(fleet);
  {
    return {
      ...fleet,
      version: fleet.version || "vcf-sizer-v6",
      networkConfig: fleet.networkConfig,
      id: fleet.id || "fleet-" + cryptoKey(),
      name: fleet.name || "Fleet",
      // Backfill VCF-PATH-* deploymentPathway on legacy imports based on
      // instance count (single=greenfield, multi=expand). Users can override.
      deploymentPathway: fleet.deploymentPathway || inferDeploymentPathway(fleet),
      // Backfill VCF-INV-021 federationEnabled flag from profile names
      // ("haFederation*") on legacy imports. Explicit field wins when set.
      federationEnabled: typeof fleet.federationEnabled === "boolean"
        ? fleet.federationEnabled
        : inferFederationEnabled(fleet),
      // Backfill VCF-SSO-001..003 SSO model on legacy imports based on
      // instance count. Explicit ssoMode wins when set.
      ssoMode: (fleet.ssoMode && SSO_MODES[fleet.ssoMode])
        ? fleet.ssoMode
        : inferSsoMode(fleet),
      ssoBrokers: Array.isArray(fleet.ssoBrokers) ? fleet.ssoBrokers : [],
      ssoFleetServicesBrokerId: fleet.ssoFleetServicesBrokerId ?? null,
      sites: (fleet.sites || []).map((s) => ({
        ...s,
        region: s.region ?? "",
        siteRole: s.siteRole ?? "",
      })),
      instances: (fleet.instances || []).map((inst) => {
        const siteIds = inst.siteIds || [];
        // Resolve the mgmt domain's first cluster id once per instance so we
        // can fall back to it for any workload domain that doesn't already
        // have a valid componentsClusterId pin.
        const mgmtDom = (inst.domains || []).find((d) => d.type === "mgmt");
        const mgmtFirstCluId = mgmtDom?.clusters?.[0]?.id || null;
        const firstWldCluByDomId = {};
        for (const dom of inst.domains || []) {
          if (dom.type === "workload") firstWldCluByDomId[dom.id] = dom.clusters?.[0]?.id || null;
        }
        return {
          ...inst,
          siteIds,
          // Backfill VCF-DR-* posture on legacy imports. Default to "active".
          drPosture: inst.drPosture || "active",
          drPairedInstanceId: inst.drPairedInstanceId ?? null,
          // VCF-APP-080 witnessSiteId — default null; set via UI when users
          // choose to promote witness metadata to a first-class site.
          witnessSiteId: inst.witnessSiteId ?? null,
          domains: (inst.domains || []).map((d) => {
            const localSiteId =
              d.placement === "local"
                ? (d.localSiteId && siteIds.includes(d.localSiteId) ? d.localSiteId : siteIds[0] || null)
                : null;
            const wldStack =
              d.type === "workload"
                ? (d.wldStack || []).map((e) => ({
                    ...e,
                    key: e.key || cryptoKey(),
                    ownerDomainId: e.ownerDomainId || d.id,
                  }))
                : [];
            // componentsClusterId resolution order:
            //   1. Keep an existing valid id (v5.2+ round-trip)
            //   2. Map the legacy v5.1 componentsLocation enum:
            //        "wld"  → this domain's first cluster
            //        "mgmt" → mgmt domain's first cluster
            //   3. Fall back to the mgmt domain's first cluster (v5.0 and
            //      legacy-free defaults)
            let componentsClusterId = null;
            if (d.type === "workload") {
              if (d.componentsClusterId) {
                componentsClusterId = d.componentsClusterId;
              } else if (d.componentsLocation === "wld") {
                componentsClusterId = firstWldCluByDomId[d.id] || null;
              } else {
                componentsClusterId = mgmtFirstCluId;
              }
            }
            // Normalize each cluster's host spec to guarantee fields added in
            // later v5 revisions (e.g. hyperthreadingEnabled) are present on
            // imports that predate them. Defaults preserve legacy math.
            // Also backfill `role` on stack entries whose appliance is
            // dual-role per APPLIANCE_DB (vcenter, nsxMgr) based on the
            // domain type — see VCF-DEPLOYMENT-PATTERNS.md §2 (VCF-APP-002/003
            // and VCF-APP-004/005).
            const defaultRole = d.type === "mgmt" ? "mgmt" : "wld";
            const backfillRole = (entries) => (entries || []).map((e) => {
              const def = APPLIANCE_DB[e.id];
              if (!def?.dualRole) return e;
              return { ...e, role: e.role || defaultRole };
            });
            const clusters = (d.clusters || []).map((c) => ({
              ...c,
              host: {
                ...(c.host || {}),
                hyperthreadingEnabled: c.host?.hyperthreadingEnabled ?? false,
              },
              infraStack: backfillRole(c.infraStack),
              // Backfill VCF-APP-006 T0 array on legacy imports. Empty by
              // default; users populate via the ClusterCard T0 editor.
              t0Gateways: Array.isArray(c.t0Gateways) ? c.t0Gateways : [],
              // VCF-PATH-003 preExisting marker — default false for legacy.
              preExisting: !!c.preExisting,
              // VCF-APP-006 Edge deployment model — default null for legacy.
              edgeDeploymentModel: c.edgeDeploymentModel || null,
            }));
            // Drop the legacy componentsLocation field on its way out.
            const { componentsLocation: _legacy, ...rest } = d;
            return { ...rest, localSiteId, wldStack, componentsClusterId, clusters };
          }),
        };
      }),
    };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// SIZING ENGINE — pure functions, runs at cluster level then aggregates upward
// ─────────────────────────────────────────────────────────────────────────────
function stackTotals(stack) {
  let vcpu = 0, ram = 0, disk = 0;
  for (const item of stack || []) {
    if (!item.instances) continue;
    const def = APPLIANCE_DB[item.id];
    if (!def) continue;
    const sz = def.sizes[item.size];
    if (!sz) continue;
    vcpu += sz.vcpu * item.instances;
    ram  += sz.ram  * item.instances;
    disk += sz.disk * item.instances;
  }
  return { vcpu, ram, disk };
}

function sizeHost(host) {
  const cores = host.cpuQty * host.coresPerCpu;
  const threads = host.hyperthreadingEnabled ? cores * 2 : cores;
  const rawGb = host.nvmeQty * host.nvmeSizeTb * 1000;
  const usableVcpu = threads * host.cpuOversub * (1 - host.reservePct / 100);
  const usableRam = host.ramGb * host.ramOversub * (1 - host.reservePct / 100);
  return { cores, threads, rawGb, usableVcpu, usableRam };
}

function applyTiering(host, hostBase, demandRamGb, tiering) {
  if (!tiering.enabled) {
    return {
      effectiveRamPerHost: hostBase.usableRam,
      tieredDemandRamGb: demandRamGb,
      tierPartitionGb: 0,
      activeRatio: 0,
    };
  }
  const requestedTierGb = host.ramGb * (tiering.nvmePct / 100);
  const driveCapGb = tiering.tierDriveSizeTb * 1000;
  const tierPartitionGb = Math.min(requestedTierGb, driveCapGb, NVME_TIER_PARTITION_CAP_GB);
  const activeRatio = tierPartitionGb / host.ramGb;
  const effectiveRamPerHost = host.ramGb * (1 + activeRatio) * host.ramOversub *
    (1 - host.reservePct / 100);
  const eligible = demandRamGb * (tiering.eligibilityPct / 100);
  const ineligible = demandRamGb - eligible;
  const tieredEligible = eligible / (1 + activeRatio);
  const tieredDemandRamGb = tieredEligible + ineligible;
  return { effectiveRamPerHost, tieredDemandRamGb, tierPartitionGb, activeRatio };
}

function sizeStoragePipeline(demandDiskGb, demandRamGb, s) {
  const drr = s.dedup * s.compression;
  const vmCapGb = demandDiskGb / drr;
  const swapGb = demandRamGb * (s.swapPct / 100);
  const interimGb = vmCapGb + swapGb;
  const pf = POLICIES[s.policy].pf;
  const protectedGb = interimGb * pf;
  const withFreeGb = protectedGb * (1 + s.freePct / 100);
  const totalReqGb = withFreeGb * (1 + s.growthPct / 100);
  return { drr, vmCapGb, swapGb, interimGb, pf, protectedGb, withFreeGb, totalReqGb };
}

// Size a single cluster — this is the leaf-level computation. Demand comes
// from workload VMs, the cluster's own infraStack (vCLS etc.), and any
// "injected" appliances from wldStacks that have been relocated here (e.g.
// a workload domain whose componentsLocation is "mgmt" charges its wldStack
// to the mgmt cluster via extraStack).
function sizeCluster(cluster, extraStack = []) {
  const h = sizeHost(cluster.host);
  const infra = stackTotals([...(cluster.infraStack || []), ...(extraStack || [])]);
  const workloadVcpu = (cluster.workload?.vmCount || 0) * (cluster.workload?.vcpuPerVm || 0);
  const workloadRam = (cluster.workload?.vmCount || 0) * (cluster.workload?.ramPerVm || 0);
  const workloadDisk = (cluster.workload?.vmCount || 0) * (cluster.workload?.diskPerVm || 0);

  const demandVcpu = workloadVcpu + infra.vcpu;
  const demandRam = workloadRam + infra.ram;
  const demandDisk = workloadDisk + infra.disk;

  const tier = applyTiering(cluster.host, h, demandRam, cluster.tiering);

  const cpuHosts = Math.ceil(demandVcpu / h.usableVcpu);
  const ramHosts = Math.ceil(tier.tieredDemandRamGb / tier.effectiveRamPerHost);

  const policy = POLICIES[cluster.storage.policy];
  let storageHosts = 0;
  let pipeline = null;
  if (!cluster.storage.externalStorage) {
    pipeline = sizeStoragePipeline(demandDisk, demandRam, cluster.storage);
    storageHosts = Math.ceil(pipeline.totalReqGb / h.rawGb) + policy.ftt;
  }

  const manualOverride = Math.max(0, cluster.hostOverride || 0);
  const candidates = [
    { name: "Compute", val: cpuHosts },
    { name: "Memory", val: ramHosts },
    { name: "Policy", val: policy.minHosts },
    { name: "Manual", val: manualOverride },
  ];
  if (!cluster.storage.externalStorage) {
    candidates.push({ name: "Storage", val: storageHosts });
  }

  const finalHosts = Math.max(...candidates.map((c) => c.val));
  const limiter = candidates.find((c) => c.val === finalHosts).name;

  const vsanMinWarning =
    !cluster.storage.externalStorage &&
    finalHosts === 3 &&
    policy.minHosts <= 3;

  return {
    host: h,
    demand: { vcpu: demandVcpu, ram: demandRam, disk: demandDisk },
    tier,
    floors: { cpuHosts, ramHosts, storageHosts, policyMin: policy.minHosts, manualOverride },
    pipeline,
    finalHosts,
    limiter,
    licensedCores: finalHosts * h.cores,
    rawTib: cluster.storage.externalStorage
      ? 0
      : finalHosts * cluster.host.nvmeQty * cluster.host.nvmeSizeTb * TB_TO_TIB,
    externalStorage: cluster.storage.externalStorage,
    vsanMinWarning,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRETCHED-CLUSTER FAILOVER ANALYSIS — pure function
//
// Given a cluster result from sizeCluster and the cluster's current
// hostSplitPct, determine whether each site on its own could absorb the
// FULL cluster demand after the other site is lost.
//
// The full-cluster demand (vCPU / RAM / disk / raw storage) is already the
// sum across both sites — sizeCluster doesn't split it. What changes on
// failover is the number of surviving hosts: if hostSplitPct is 60, site A
// has ceil(finalHosts * 0.60) hosts and site B has finalHosts - that. The
// survivor's capacity is its-host-count × per-host-capacity.
//
// Three verdicts:
//   green  : survivor has enough SAFE capacity (respecting reservePct /
//            oversub / policy minHosts / storage policy FTT on full demand).
//            Design is truly HA.
//   yellow : survivor has enough RAW oversubscribed capacity but only by
//            eating into the configured reserve slack. Everything runs but
//            there is no headroom — the failover burns the reserve.
//   red    : even at zero reserve the survivor cannot host the demand, OR
//            the survivor falls below the storage policy's minHosts floor,
//            OR the storage pipeline requires more raw capacity than the
//            survivor can provide. Components cannot all run at one site.
//
// Storage verdict: on failover, the storage policy still applies (vSAN still
// needs FTT hosts of capacity), so we rerun the same sizeStoragePipeline
// call against the survivor's per-host raw capacity and compare required
// host counts.
//
// Returns one verdict PER stretched cluster, so a stretched mgmt cluster
// that comfortably survives with 60/40 but a stretched WLD cluster that
// can't survive 50/50 produces two different rollups.
// ─────────────────────────────────────────────────────────────────────────────
function analyzeStretchedFailover(cluster, result, hostSplitPct) {
  const pct = getHostSplitPct({ hostSplitPct });
  const full = result.finalHosts;
  const hostsA = Math.max(0, Math.ceil(full * (pct / 100)));
  const hostsB = Math.max(0, full - hostsA);
  const h = result.host;
  const tier = result.tier;
  const policy = POLICIES[cluster.storage.policy];

  // Per-host "safe" capacity (what sizeCluster used to pick finalHosts).
  const safeVcpuPerHost = h.usableVcpu;
  const safeRamPerHost  = tier.effectiveRamPerHost;
  // Per-host "raw-oversubscribed" capacity: cores × oversub (no reserve
  // removed). This is the true compute ceiling a host can sustain briefly.
  const rawVcpuPerHost = h.cores * cluster.host.cpuOversub;
  const rawRamPerHost  = (tier.effectiveRamPerHost /
                          Math.max(1e-9, 1 - cluster.host.reservePct / 100));

  // Run the storage pipeline once for the full (unchanged) demand so we can
  // compare against each survivor's raw capacity.
  const storagePerHost = cluster.host.nvmeQty * cluster.host.nvmeSizeTb * 1000;
  let storageHostsNeeded = 0;
  if (!cluster.storage.externalStorage && result.pipeline) {
    storageHostsNeeded = Math.ceil(result.pipeline.totalReqGb / Math.max(1, storagePerHost)) + policy.ftt;
  }

  function verdictFor(survHosts) {
    if (survHosts <= 0) {
      return { verdict: "red", reason: "Survivor has 0 hosts", hosts: 0 };
    }
    if (survHosts < policy.minHosts) {
      return {
        verdict: "red",
        reason: `Survivor has ${survHosts} host${survHosts === 1 ? "" : "s"}, below storage policy minimum (${policy.minHosts})`,
        hosts: survHosts,
      };
    }
    if (!cluster.storage.externalStorage && survHosts < storageHostsNeeded) {
      return {
        verdict: "red",
        reason: `Survivor needs ${storageHostsNeeded} hosts of vSAN capacity, has ${survHosts}`,
        hosts: survHosts,
      };
    }
    const safeVcpu = survHosts * safeVcpuPerHost;
    const safeRam  = survHosts * safeRamPerHost;
    const rawVcpu  = survHosts * rawVcpuPerHost;
    const rawRam   = survHosts * rawRamPerHost;
    const demand = result.demand;
    const demandRamTiered = tier.tieredDemandRamGb;

    const safeOk = demand.vcpu <= safeVcpu && demandRamTiered <= safeRam;
    if (safeOk) {
      return {
        verdict: "green",
        reason: "Survivor absorbs full demand within safe reserves",
        hosts: survHosts,
        vcpuUsedPct: Math.round((demand.vcpu / Math.max(1, safeVcpu)) * 100),
        ramUsedPct:  Math.round((demandRamTiered / Math.max(1, safeRam)) * 100),
      };
    }
    const rawOk = demand.vcpu <= rawVcpu && demandRamTiered <= rawRam;
    if (rawOk) {
      const vcpuPctRaw = Math.round((demand.vcpu / Math.max(1, rawVcpu)) * 100);
      const ramPctRaw  = Math.round((demandRamTiered / Math.max(1, rawRam)) * 100);
      return {
        verdict: "yellow",
        reason: "Survivor runs everything but only by consuming the configured reserve slack",
        hosts: survHosts,
        vcpuUsedPct: vcpuPctRaw,
        ramUsedPct: ramPctRaw,
      };
    }
    const overVcpu = demand.vcpu > rawVcpu;
    const overRam  = demandRamTiered > rawRam;
    const parts = [];
    if (overVcpu) parts.push(`vCPU short (${fmtNum(demand.vcpu)} need / ${fmtNum(rawVcpu)} avail)`);
    if (overRam)  parts.push(`RAM short (${fmtNum(demandRamTiered)} GB need / ${fmtNum(rawRam)} GB avail)`);
    return {
      verdict: "red",
      reason: parts.join(", ") || "Survivor cannot absorb demand",
      hosts: survHosts,
    };
  }

  return {
    hostsA,
    hostsB,
    siteA: verdictFor(hostsA),
    siteB: verdictFor(hostsB),
  };
}

// Find the smallest total host count at which BOTH sites achieve at least
// the target verdict. Used by the ClusterCard failover target toggles so
// users can click "Survive failover" and have the host-count floor jump
// to a number that flips both sides green without them having to hunt.
//
// Iterates from the architectural minimum upward (monotonic — adding hosts
// only ever improves the verdict). Returns null if no reasonable host
// count satisfies the target (shouldn't happen for sensible configs, but
// the caller treats null as "impossible" and disables the button).
function minHostsForVerdict(cluster, result, hostSplitPct, targetVerdict) {
  const order = { green: 0, yellow: 1, red: 2 };
  const targetMax = order[targetVerdict];
  const archMin = Math.max(
    result.floors.cpuHosts || 0,
    result.floors.ramHosts || 0,
    result.floors.storageHosts || 0,
    result.floors.policyMin || 0,
    1
  );
  const cap = Math.max(archMin * 20, 200);
  for (let n = archMin; n <= cap; n++) {
    // Synthesize a result with the candidate host count. analyzeStretchedFailover
    // only reads finalHosts / host / tier / demand / pipeline from the result,
    // and none of those change with the override — so we can safely substitute
    // finalHosts without re-running sizeCluster.
    const simulated = { ...result, finalHosts: n };
    const fo = analyzeStretchedFailover(cluster, simulated, hostSplitPct);
    if (order[fo.siteA.verdict] <= targetMax && order[fo.siteB.verdict] <= targetMax) {
      return n;
    }
  }
  return null;
}

// Aggregate cluster results up to domain level. `extraByClusterId` optionally
// injects additional appliance demand onto specific clusters (built by
// sizeInstance from wldStack componentsLocation decisions).
//
// The domain's own `placement` + a valid stretchSiteIds pair decide whether
// we compute a per-cluster failover analysis. Local domains and stretched
// domains without an explicit pair get `failover: null`.
function sizeDomain(domain, extraByClusterId = {}, _unusedInstanceIsStretched = false) {
  const domainIsStretched =
    domain.placement === "stretched"
    && Array.isArray(domain.stretchSiteIds)
    && domain.stretchSiteIds.length === 2;
  const clusterResults = domain.clusters.map((c) => {
    const r = sizeCluster(c, extraByClusterId[c.id] || []);
    if (domainIsStretched) {
      r.failover = analyzeStretchedFailover(c, r, domain.hostSplitPct);
    } else {
      r.failover = null;
    }
    return r;
  });
  const totalHosts = clusterResults.reduce((s, r) => s + r.finalHosts, 0);
  const totalCores = clusterResults.reduce((s, r) => s + r.licensedCores, 0);
  const totalRawTib = clusterResults.reduce((s, r) => s + r.rawTib, 0);
  return { clusterResults, totalHosts, totalCores, totalRawTib };
}

// ─────────────────────────────────────────────────────────────────────────────
// v5 SIZING — instance-first, site-projected
// ─────────────────────────────────────────────────────────────────────────────
function sizeInstance(instance) {
  // Step 1: build a per-cluster-id map of "extra" appliance demand that
  // should be injected into specific clusters based on each workload
  // domain's componentsClusterId pin.
  //
  // componentsClusterId can point at ANY cluster in the instance — any of
  // the mgmt domain's 1+ clusters, or any of this workload domain's own
  // clusters. If the pin is missing or references a cluster that no longer
  // exists (e.g. it was deleted after being selected), we fall back to the
  // mgmt domain's first cluster, matching VCF 9's default placement.
  //
  // Either way the wldStack entries are listed ONCE in sharedStack so the
  // Shared Appliances panel still shows the full appliance inventory.
  const domains = instance.domains || [];
  const clusterById = {};
  for (const dom of domains) {
    for (const c of dom.clusters || []) clusterById[c.id] = c;
  }
  const mgmtDomain = domains.find((d) => d.type === "mgmt");
  const mgmtFirstCluster = mgmtDomain?.clusters?.[0];

  const extraByClusterId = {};
  for (const d of domains) {
    if (d.type !== "workload") continue;
    const wldStack = d.wldStack || [];
    if (wldStack.length === 0) continue;
    const targetCluster = clusterById[d.componentsClusterId] || mgmtFirstCluster;
    if (!targetCluster) continue;
    extraByClusterId[targetCluster.id] = [
      ...(extraByClusterId[targetCluster.id] || []),
      ...wldStack,
    ];
  }

  // A domain is "effectively stretched" when it carries a placement of
  // "stretched" AND an explicit 2-site pair via stretchSiteIds. With per-
  // domain pairs, the instance itself may touch 3+ sites but only some
  // domains may actually stretch.
  const anyStretchedDomain = domains.some(
    (d) =>
      d.placement === "stretched"
      && Array.isArray(d.stretchSiteIds)
      && d.stretchSiteIds.length === 2
  );
  const domainResults = domains.map((d) =>
    sizeDomain(d, extraByClusterId, anyStretchedDomain)
  );
  const sharedStack = [];
  for (const d of domains) {
    for (const c of d.clusters || []) {
      for (const e of c.infraStack || []) sharedStack.push(e);
    }
    if (d.type === "workload") {
      for (const e of d.wldStack || []) sharedStack.push(e);
    }
  }
  const sharedTotals = stackTotals(sharedStack);
  let witness = null;
  if (instance.witnessEnabled && anyStretchedDomain) {
    const wDef = APPLIANCE_DB.vsanWitness;
    const wSz = wDef?.sizes?.[instance.witnessSize] || wDef?.sizes?.Medium;
    // Count clusters that belong to an effectively-stretched domain (placement
    // + valid 2-site pair). Stretched-without-pair domains don't trigger
    // witness sizing.
    const stretchedClusters = domains.reduce(
      (acc, d) =>
        acc + (
          d.placement === "stretched"
          && Array.isArray(d.stretchSiteIds)
          && d.stretchSiteIds.length === 2
            ? (d.clusters || []).length
            : 0
        ),
      0
    );
    if (wSz && stretchedClusters > 0) {
      witness = {
        id: "vsanWitness",
        size: instance.witnessSize,
        instances: stretchedClusters,
        vcpu: wSz.vcpu * stretchedClusters,
        ram: wSz.ram * stretchedClusters,
        disk: wSz.disk * stretchedClusters,
      };
    }
  }
  const totalHosts = domainResults.reduce((s, r) => s + r.totalHosts, 0);
  const totalCores = domainResults.reduce((s, r) => s + r.totalCores, 0);
  const totalRawTib = domainResults.reduce((s, r) => s + r.totalRawTib, 0);
  return { instance, domainResults, sharedStack, sharedTotals, witness, totalHosts, totalCores, totalRawTib };
}

function projectInstanceOntoSite(instanceResult, siteId) {
  const { instance, domainResults } = instanceResult;
  const instSiteIds = instance.siteIds || [];
  if (!instSiteIds.includes(siteId)) return null;

  const projectedDomains = [];
  let anyPrimaryHere = false;
  let anySecondaryHere = false;
  let firstPartnerSiteId = null;

  for (let i = 0; i < domainResults.length; i++) {
    const dr = domainResults[i];
    const domain = instance.domains[i];
    const pair = Array.isArray(domain.stretchSiteIds) ? domain.stretchSiteIds : null;
    const stretched =
      domain.placement === "stretched" && pair && pair.length === 2;

    if (!stretched) {
      // Local domain — pinned to one specific site via localSiteId. Fall back
      // to instSiteIds[0] for backward compatibility with pre-v5.1 data (where
      // local always meant "primary site only").
      const localSite =
        domain.localSiteId && instSiteIds.includes(domain.localSiteId)
          ? domain.localSiteId
          : instSiteIds[0];
      if (localSite !== siteId) continue;
      projectedDomains.push({
        domain, domainResult: dr, sharePct: 100,
        projectedClusters: dr.clusterResults.map((cr, idx) => ({
          cluster: domain.clusters[idx], result: cr,
          hostsHere: cr.finalHosts, rawTibHere: cr.rawTib,
        })),
      });
      continue;
    }

    // Stretched domain — each domain carries its own 2-site pair, so the
    // primary/secondary role is resolved per-domain against stretchSiteIds,
    // not against the instance-wide siteIds.
    const isPrimary = pair[0] === siteId;
    const isSecondary = pair[1] === siteId;
    if (!isPrimary && !isSecondary) continue; // this site isn't part of this domain's pair
    if (isPrimary) anyPrimaryHere = true;
    else anySecondaryHere = true;
    if (firstPartnerSiteId === null) {
      firstPartnerSiteId = isPrimary ? pair[1] : pair[0];
    }

    const pct = getHostSplitPct(domain);
    const sharePct = isPrimary ? pct : 100 - pct;
    const frac = sharePct / 100;
    projectedDomains.push({
      domain, domainResult: dr, sharePct,
      projectedClusters: dr.clusterResults.map((cr, idx) => {
        // Host count split: the primary site gets ceil(full * pct/100) and
        // the secondary site gets `full - primary` so the two sites always
        // sum EXACTLY to finalHosts. The previous version independently
        // ceil'd both fractions, which for odd host counts produced
        // primary+secondary === finalHosts+1 — the extra phantom host
        // surfaced in fleet totalHosts rollups and masked single-host
        // increments from the manual override control.
        const full = cr.finalHosts || 0;
        const primaryHosts = Math.ceil(full * (pct / 100));
        const secondaryHosts = full - primaryHosts;
        const hostsHere = isPrimary ? primaryHosts : secondaryHosts;
        return {
          cluster: domain.clusters[idx], result: cr,
          hostsHere,
          rawTibHere: (cr.rawTib || 0) * frac,
        };
      }),
    });
  }

  // Role captures how this site sits within the instance's stretched domains.
  // "primary" when it's the primary of at least one pair; "secondary" when
  // it only acts as a secondary. When no stretched domain touches this site
  // (local-only projections, or single-site instances) we fall back to the
  // instance's siteIds index so legacy 2-site fleets keep returning
  // "primary"/"secondary" unchanged.
  let role;
  if (anyPrimaryHere) {
    role = "primary";
  } else if (anySecondaryHere) {
    role = "secondary";
  } else {
    const idx = instSiteIds.indexOf(siteId);
    role = idx === 0 ? "primary" : idx === 1 ? "secondary" : null;
  }
  return {
    siteId, instance,
    role,
    otherSiteId: firstPartnerSiteId,
    projectedDomains,
  };
}

function sizeFleet(fleet) {
  const instanceResults = (fleet.instances || []).map(sizeInstance);
  const siteResults = (fleet.sites || []).map((site) => ({
    site,
    projections: instanceResults
      .filter((ir) => ir.instance.siteIds.includes(site.id))
      .map((ir) => projectInstanceOntoSite(ir, site.id))
      .filter(Boolean),
  }));
  let totalVcpu = 0, totalRamGb = 0, totalDiskGb = 0;
  let fleetRawTib = 0, totalCores = 0;
  for (const ir of instanceResults) {
    totalVcpu += ir.sharedTotals.vcpu;
    totalRamGb += ir.sharedTotals.ram;
    totalDiskGb += ir.sharedTotals.disk;
    if (ir.witness) {
      totalVcpu += ir.witness.vcpu || 0;
      totalRamGb += ir.witness.ram || 0;
      totalDiskGb += ir.witness.disk || 0;
    }
    fleetRawTib += ir.totalRawTib || 0;
    totalCores  += ir.totalCores  || 0;
  }
  let totalHosts = 0;
  for (const sr of siteResults) {
    for (const p of sr.projections) {
      for (const pd of p.projectedDomains) {
        for (const pc of pd.projectedClusters) totalHosts += pc.hostsHere;
      }
    }
  }
  const entitlementTib = totalCores * TIB_PER_CORE;
  const addonTib = Math.max(0, fleetRawTib - entitlementTib);
  return {
    fleet, instanceResults, siteResults,
    totalHosts, totalCores, fleetRawTib, entitlementTib, addonTib,
    totals: { vcpu: totalVcpu, ramGb: totalRamGb, diskGb: totalDiskGb, hosts: totalHosts },
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// UMD-style export — attach to window (browser) and module.exports (Node).
// ─────────────────────────────────────────────────────────────────────────────
const VcfEngine = { APPLIANCE_DB, DEPLOYMENT_PROFILES, DEPLOYMENT_PATHWAYS, DEFAULT_MGMT_STACK_TEMPLATE, SIZING_LIMITS, POLICIES, TB_TO_TIB, TIB_PER_CORE, NVME_TIER_PARTITION_CAP_GB, VLAN_ID_MIN, VLAN_ID_MAX, MTU_MGMT, MTU_VMOTION, MTU_VSAN, MTU_TEP_MIN, MTU_TEP_RECOMMENDED, DEFAULT_BGP_ASN_AA, TEP_POOL_GROWTH_FACTOR, NIC_PROFILES, createFleetNetworkConfig, createClusterNetworks, createHostIpOverride, ipToInt, intToIp, ipPoolSize, subnetContainsIp, allocateClusterIps, validateNetworkDesign, emitInstallerJson, emitWorkbookRows, recommendVcenterSize, recommendNsxSize, cryptoKey, baseHostSpec, baseStorageSettings, baseTiering, newCluster, newMgmtCluster, newWorkloadCluster, newMgmtDomain, newWorkloadDomain, newInstance, newSite, newFleet, domainSites, buildDefaultPlacement, ensurePlacement, getInitialInstance, isInitialInstance, getHostSplitPct, stackForInstance, promoteToInitial, inferDeploymentPathway, inferFederationEnabled, SSO_MODES, inferSsoMode, ssoInstancesPerBroker, SSO_INSTANCES_PER_BROKER_LIMIT, DR_POSTURES, DR_REPLICATED_COMPONENTS, DR_BACKUP_COMPONENTS, isWarmStandby, countActivePerFleetEntries, T0_HA_MODES, T0_MAX_T0S_PER_EDGE_NODE, T0_MAX_UPLINKS_PER_EDGE_AA, newT0Gateway, validateT0Gateways, EDGE_DEPLOYMENT_MODELS, migrateV2ToV3, domainStructureMatches, stackSignature, liftV3Instance, migrateV3ToV5, migrateV5ToV6, migrateFleet, stackTotals, sizeHost, applyTiering, sizeStoragePipeline, sizeCluster, analyzeStretchedFailover, minHostsForVerdict, sizeDomain, sizeInstance, projectInstanceOntoSite, sizeFleet };
if (typeof window !== "undefined") { window.VcfEngine = VcfEngine; }
if (typeof module !== "undefined" && module.exports) { module.exports = VcfEngine; }
