// ─────────────────────────────────────────────────────────────────────────────
// VCF Design Studio — v5
// Hierarchical design system: Fleet → Sites → VCF Instances → Domains → Clusters
// 
// What's new in v3:
//   • Five-level hierarchy (was: flat mgmt + wlds list)
//   • Per-cluster host specs (each cluster has its own hardware profile)
//   • Topology diagram view (auto-generated SVG, second tab)
//   • Backward-compatible JSON import (v2 flat format auto-migrates)
//
// Sizing math is unchanged in shape — it now runs at the cluster level and 
// rolls up through domain → instance → site → fleet via simple aggregation.
//
// Provenance: every appliance number traces to the official Broadcom 
// "VMware Cloud Foundation 9.0 Planning and Preparation Workbook", except VKS
// Supervisor sizing which traces to techdocs.broadcom.com (the workbook does
// not include VKS sizing tables).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// APPLIANCE DATABASE — sourced from P&P Workbook Static Reference Tables sheet
// (rows B8–B266) plus VKS Supervisor from techdocs.broadcom.com.
// ─────────────────────────────────────────────────────────────────────────────
const APPLIANCE_DB = {
  vcenter: {
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
    placement: "per-instance",
    label: "SDDC Manager",
    source: "P&P Workbook — SDDC Manager fixed values",
    sizes: { Default: { vcpu: 4, ram: 16, disk: 914, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  fleetMgr: {
    placement: "per-instance",
    label: "VCF Operations Fleet Manager",
    source: "P&P Workbook — VCF Operations Fleet Manager fixed values",
    sizes: { Default: { vcpu: 4, ram: 12, disk: 194, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  vcls: {
    placement: "cluster-internal",
    label: "vSphere Cluster Services (vCLS)",
    source: "P&P Workbook — vCLS Virtual Machines fixed values",
    sizes: { Default: { vcpu: 1, ram: 0.125, disk: 2, note: "Per VM (typically 2 per cluster)" } },
    defaultSize: "Default",
    fixed: true,
  },
  vcfOps: {
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
    placement: "per-instance",
    label: "HCX Connector",
    source: "P&P Workbook — Cross-Cloud Mobility HCX",
    sizes: { Default: { vcpu: 4, ram: 12, disk: 65, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // Security Services Platform — values are aggregate across constituent VMs.
  ssp: {
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
    placement: "per-instance",
    label: "Health Reporting & Monitoring (HVM)",
    source: "P&P Workbook — Health Reporting and Monitoring fixed values",
    sizes: { Default: { vcpu: 2, ram: 8, disk: 20, note: "Single fixed size" } },
    defaultSize: "Default",
    fixed: true,
  },
  // Cloud-Based Ransomware Recovery Connector
  cyberRecoveryConnector: {
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
    hostSplitPct: 50,       // % of hosts at siteIds[0] (rest at siteIds[1]) when stretched
    localSiteId: null,      // when placement === "local", which site id the domain runs at
    clusters: [newMgmtCluster()],
  };
}

function newWorkloadDomain(name = "Workload Domain 01") {
  return {
    id: `dom-${cryptoKey()}`,
    type: "workload",
    name,
    placement: "local",  // "local" = pinned to one site, "stretched" = spans both
    hostSplitPct: 50,    // % of hosts at siteIds[0] when stretched
    localSiteId: null,   // set by the parent InstanceCard to a concrete site id
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
  return {
    id: "inst-" + cryptoKey(),
    name,
    deploymentProfile: "ha",
    siteIds: [...siteIds],
    witnessEnabled: false,
    witnessSize: "Medium",
    witnessSite: { name: "Witness Site", location: "" },
    domains: [newMgmtDomain()],
  };
}

function newSite(name = "Primary Site", location = "") {
  return { id: "site-" + cryptoKey(), name, location };
}

function newFleet() {
  const primary = newSite("Primary Site", "");
  const inst = newInstance("vcf-instance-01", [primary.id]);
  return {
    id: "fleet-" + cryptoKey(),
    name: "Production Fleet",
    sites: [primary],
    instances: [inst],
  };
}

// Build default appliance-to-site assignments for a stretched instance.
// Each appliance VM is assigned to a site in alternating fashion so the VMs
// are roughly evenly distributed. Returns a map: { [applianceKey]: [siteId, ...] }
// where the array length equals the appliance's `instances` count.
function buildDefaultPlacement(instance) {
  const siteIds = instance.siteIds || [];
  if (siteIds.length < 2) return {};
  const placement = {};
  for (const dom of instance.domains || []) {
    for (const clu of dom.clusters || []) {
      for (const entry of clu.infraStack || []) {
        const count = entry.instances || 1;
        const assigned = [];
        for (let i = 0; i < count; i++) {
          assigned.push(siteIds[i % siteIds.length]);
        }
        placement[entry.key] = assigned;
      }
    }
    if (dom.type === "workload") {
      for (const entry of dom.wldStack || []) {
        const count = entry.instances || 1;
        const assigned = [];
        for (let i = 0; i < count; i++) {
          assigned.push(siteIds[i % siteIds.length]);
        }
        placement[entry.key] = assigned;
      }
    }
  }
  return placement;
}

// Ensure instance.appliancePlacement exists and covers all current stack entries.
// Adds missing keys with default alternating assignments, removes stale keys.
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
      return {
        ...rest,
        placement,
        hostSplitPct: typeof d.hostSplitPct === "number" ? d.hostSplitPct : 50,
        localSiteId,
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

function migrateFleet(raw) {
  if (!raw) return newFleet();
  const version = raw.version || "vcf-sizer-v3";
  let fleet = raw.fleet || raw;
  // Run older versions through their upgrade paths first, then fall through
  // to the v5 normalization pass so that newly-added host fields
  // (e.g. hyperthreadingEnabled) are populated regardless of source version.
  if (version === "vcf-sizer-v2") {
    const v3 = migrateV2ToV3(fleet);
    fleet = migrateV3ToV5(v3.fleet || v3);
  } else if (version !== "vcf-sizer-v5") {
    fleet = migrateV3ToV5(fleet);
  }
  {
    return {
      id: fleet.id || "fleet-" + cryptoKey(),
      name: fleet.name || "Fleet",
      sites: fleet.sites || [],
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
            const clusters = (d.clusters || []).map((c) => ({
              ...c,
              host: {
                ...(c.host || {}),
                hyperthreadingEnabled: c.host?.hyperthreadingEnabled ?? false,
              },
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
  for (const item of stack) {
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
  const pct = typeof hostSplitPct === "number" ? hostSplitPct : 50;
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
    if (overVcpu) parts.push(`vCPU short (${fmt(demand.vcpu)} need / ${fmt(rawVcpu)} avail)`);
    if (overRam)  parts.push(`RAM short (${fmt(demandRamTiered)} GB need / ${fmt(rawRam)} GB avail)`);
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
// `instanceIsStretched` + the domain's own `placement` decide whether we
// compute a per-cluster failover analysis. Local domains and single-site
// instances get `failover: null`.
function sizeDomain(domain, extraByClusterId = {}, instanceIsStretched = false) {
  const domainIsStretched = instanceIsStretched && domain.placement === "stretched";
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
  const clusterById = {};
  for (const dom of instance.domains || []) {
    for (const c of dom.clusters || []) clusterById[c.id] = c;
  }
  const mgmtDomain = (instance.domains || []).find((d) => d.type === "mgmt");
  const mgmtFirstCluster = mgmtDomain?.clusters?.[0];

  const extraByClusterId = {};
  for (const d of instance.domains || []) {
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

  const instanceIsStretched = (instance.siteIds || []).length === 2;
  const domainResults = (instance.domains || []).map((d) =>
    sizeDomain(d, extraByClusterId, instanceIsStretched)
  );
  const sharedStack = [];
  for (const d of instance.domains || []) {
    for (const c of d.clusters || []) {
      for (const e of c.infraStack || []) sharedStack.push(e);
    }
    if (d.type === "workload") {
      for (const e of d.wldStack || []) sharedStack.push(e);
    }
  }
  const sharedTotals = stackTotals(sharedStack);
  let witness = null;
  if (instance.witnessEnabled && (instance.siteIds || []).length === 2) {
    const wDef = APPLIANCE_DB.vsanWitness;
    const wSz = wDef?.sizes?.[instance.witnessSize] || wDef?.sizes?.Medium;
    const stretchedClusters = (instance.domains || []).reduce(
      (acc, d) => acc + (d.placement === "stretched" ? (d.clusters || []).length : 0),
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
  const isPrimary = instance.siteIds[0] === siteId;
  const isSecondary = instance.siteIds[1] === siteId;
  if (!isPrimary && !isSecondary) return null;
  const projectedDomains = [];
  for (let i = 0; i < domainResults.length; i++) {
    const dr = domainResults[i];
    const domain = instance.domains[i];
    const stretched = domain.placement === "stretched" && instance.siteIds.length === 2;
    if (!stretched) {
      // Local domain — pinned to one specific site via localSiteId. Fall back
      // to siteIds[0] for backward compatibility with pre-v5.1 data (where
      // local always meant "primary site only").
      const localSite =
        domain.localSiteId && instance.siteIds.includes(domain.localSiteId)
          ? domain.localSiteId
          : instance.siteIds[0];
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
    const pct = typeof domain.hostSplitPct === "number" ? domain.hostSplitPct : 50;
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
  return {
    siteId, instance,
    role: isPrimary ? "primary" : "secondary",
    otherSiteId: instance.siteIds.length === 2 ? instance.siteIds[isPrimary ? 1 : 0] : null,
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
  for (const ir of instanceResults) {
    totalVcpu += ir.sharedTotals.vcpu;
    totalRamGb += ir.sharedTotals.ram;
    totalDiskGb += ir.sharedTotals.disk;
    if (ir.witness) {
      totalVcpu += ir.witness.vcpu || 0;
      totalRamGb += ir.witness.ram || 0;
      totalDiskGb += ir.witness.disk || 0;
    }
  }
  let totalHosts = 0, fleetRawTib = 0, totalCores = 0;
  for (const ir of instanceResults) {
    fleetRawTib += ir.totalRawTib || 0;
    totalCores  += ir.totalCores  || 0;
  }
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

function PerSiteView({ fleet, fleetResult }) {
  // Shared Appliances rows — each instance's sharedStack listed once,
  // NOT attributed to either site. A 3-node NSX Manager cluster across two
  // sites is not "1.5 managers per site." Locked decision in the v5 brief.
  const sharedRows = useMemo(() => {
    return (fleetResult.instanceResults || []).map((ir) => {
      // Build a lookup of domain id → domain name so rows carry a friendly
      // owner label. Entries without ownerDomainId are instance-level
      // (mgmt deployment profile, pre-v5.2 exports, etc.) and render as
      // "(instance)".
      const domNameById = {};
      for (const d of ir.instance.domains || []) domNameById[d.id] = d.name;

      const rawItems = (ir.sharedStack || [])
        .filter((entry) => entry.instances > 0)
        .map((entry) => {
          const def = APPLIANCE_DB[entry.id];
          const sz = def?.sizes?.[entry.size];
          const ownerLabel = entry.ownerDomainId
            ? (domNameById[entry.ownerDomainId] || "(unknown)")
            : "(instance)";
          const ownerKind = entry.ownerDomainId ? "wld" : "instance";
          return {
            key: entry.key || `${entry.id}-${entry.size}-${entry.ownerDomainId || "inst"}`,
            label: def?.label || entry.id,
            size: entry.size,
            instances: entry.instances,
            vcpu: (sz?.vcpu || 0) * entry.instances,
            ram: (sz?.ram || 0) * entry.instances,
            disk: (sz?.disk || 0) * entry.instances,
            ownerLabel,
            ownerKind,
          };
        });
      // Sort instance-level rows first, then per-WLD rows grouped by owner.
      const items = rawItems.sort((a, b) => {
        if (a.ownerKind !== b.ownerKind) return a.ownerKind === "instance" ? -1 : 1;
        if (a.ownerLabel !== b.ownerLabel) return a.ownerLabel.localeCompare(b.ownerLabel);
        return a.label.localeCompare(b.label);
      });
      return { instance: ir.instance, items, witness: ir.witness, totals: ir.sharedTotals };
    });
  }, [fleetResult]);

  return (
    <div className="space-y-5">
      {/* Shared Appliances — stretched stacks NOT split per site */}
      <div className="border border-amber-200 bg-white rounded-lg p-5">
        <div className="flex items-baseline justify-between border-b border-amber-200 pb-2 mb-4">
          <h2 className="font-serif text-2xl text-slate-900">Shared Appliances</h2>
          <span className="text-[10px] uppercase tracking-[0.2em] text-amber-700 font-mono">
            One stack per VCF instance · not attributed to either site
          </span>
        </div>
        <p className="text-[11px] text-slate-500 font-mono mb-4 leading-relaxed">
          A stretched VCF instance has ONE management plane (SDDC Manager, NSX Manager
          cluster, VCF Operations cluster, etc.) — not one per site. These appliances are
          listed here once per instance, not split by host-split percentage.
        </p>
        {sharedRows.length === 0 && (
          <p className="text-[11px] text-slate-400 font-mono">No instances yet.</p>
        )}
        {sharedRows.map(({ instance, items, witness, totals }) => (
          <div key={instance.id} className="border border-slate-200 rounded p-3 mb-3 last:mb-0">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-serif text-slate-800 font-semibold">{instance.name}</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {fmt(totals.vcpu)} vCPU · {fmt(totals.ram)} GB RAM · {fmt(totals.disk)} GB disk
              </span>
            </div>
            {items.length === 0 && !witness ? (
              <p className="text-[10px] text-slate-400 font-mono">No appliances configured.</p>
            ) : (
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                    <th className="text-left font-normal pb-1.5 pl-1">Appliance</th>
                    <th className="text-left font-normal pb-1.5">Size</th>
                    <th className="text-right font-normal pb-1.5 px-3">Count</th>
                    <th className="text-right font-normal pb-1.5 px-3">vCPU</th>
                    <th className="text-right font-normal pb-1.5 px-3">RAM (GB)</th>
                    <th className="text-right font-normal pb-1.5 px-3">Disk (GB)</th>
                    <th className="text-left font-normal pb-1.5 pl-3">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.key} className="border-t border-slate-100">
                      <td className="py-1.5 pl-1 text-slate-700">{row.label}</td>
                      <td className="py-1.5 text-slate-500">{row.size}</td>
                      <td className="py-1.5 px-3 text-right text-slate-800 tabular-nums">×{row.instances}</td>
                      <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">{fmt(row.vcpu)}</td>
                      <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">{fmt(row.ram)}</td>
                      <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">{fmt(row.disk)}</td>
                      <td className={`py-1.5 pl-3 ${row.ownerKind === "wld" ? "text-sky-700" : "text-slate-400"}`}>
                        {row.ownerKind === "wld" ? `@ ${row.ownerLabel}` : row.ownerLabel}
                      </td>
                    </tr>
                  ))}
                  {witness && (
                    <tr className="border-t border-slate-100 bg-yellow-50">
                      <td className="py-1.5 pl-1 text-yellow-800">
                        vSAN Witness Host
                        <span className="text-[9px] text-yellow-700 ml-2">
                          @ {instance.witnessSite?.name || "Witness Site"}
                        </span>
                      </td>
                      <td className="py-1.5 text-yellow-700">{witness.size}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-800 tabular-nums">×{witness.instances}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-700 tabular-nums">{fmt(witness.vcpu)}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-700 tabular-nums">{fmt(witness.ram)}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-700 tabular-nums">{fmt(witness.disk)}</td>
                      <td className="py-1.5 pl-3 text-yellow-700">(witness)</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {/* Per-Site Resource Allocation */}
      <div className="border border-blue-200 bg-white rounded-lg p-5">
        <div className="flex items-baseline justify-between border-b border-blue-200 pb-2 mb-4">
          <h2 className="font-serif text-2xl text-slate-900">Per-Site Resource Allocation</h2>
          <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600 font-mono">
            Physical host placement · Accounts for stretched cluster splits
          </span>
        </div>
        <p className="text-[11px] text-slate-500 font-mono mb-5 leading-relaxed">
          Shows how many ESXi hosts are physically located at each site. Stretched domains
          split their host count across sites based on each domain's host-split percentage.
          Local domains contribute all their hosts to their home site. Shared appliances
          (SDDC Manager, NSX Manager, VCF Ops) appear in the panel above, not here.
        </p>

        {(fleetResult.siteResults || []).length === 0 && (
          <p className="text-[11px] text-slate-400 font-mono">
            No sites yet. Add sites and instances on the Editor tab to populate this view.
          </p>
        )}

        {(fleetResult.siteResults || []).map((sr) => {
          // Skip projections that contributed no domains at this site (e.g.
          // an instance touching the site but with every domain pinned to
          // the other site via localSiteId).
          const visibleProjections = sr.projections.filter(
            (p) => p.projectedDomains.length > 0
          );
          let siteHosts = 0;
          let siteRawTib = 0;
          for (const p of visibleProjections) {
            for (const pd of p.projectedDomains) {
              for (const pc of pd.projectedClusters) {
                siteHosts += pc.hostsHere || 0;
                siteRawTib += pc.rawTibHere || 0;
              }
            }
          }

          // Failover rollup for THIS site: walk every stretched cluster this
          // site participates in and bucket each by verdict. "This site"
          // here means "the survivor if the other site fails". A stretched
          // instance with siteIds[0] === sr.site.id reads its siteA verdict;
          // siteIds[1] === sr.site.id reads siteB. Each row records the
          // owning domain/cluster so the panel can list red ones explicitly.
          const foRollup = { green: 0, yellow: 0, red: 0, reds: [], yellows: [], total: 0, otherSites: new Set() };
          for (const ir of fleetResult.instanceResults || []) {
            const inst = ir.instance;
            if (!inst.siteIds || inst.siteIds.length !== 2) continue;
            const idxHere = inst.siteIds.indexOf(sr.site.id);
            if (idxHere < 0) continue;
            const otherId = inst.siteIds[1 - idxHere];
            const otherName = fleet.sites.find((s) => s.id === otherId)?.name || "other site";
            foRollup.otherSites.add(otherName);
            inst.domains.forEach((dom, dIdx) => {
              if (dom.placement !== "stretched") return;
              const dr = ir.domainResults[dIdx];
              if (!dr) return;
              dom.clusters.forEach((clu, cIdx) => {
                const cr = dr.clusterResults[cIdx];
                if (!cr || !cr.failover) return;
                const side = idxHere === 0 ? cr.failover.siteA : cr.failover.siteB;
                foRollup.total++;
                foRollup[side.verdict]++;
                if (side.verdict === "red") foRollup.reds.push({ dom, clu, side });
                if (side.verdict === "yellow") foRollup.yellows.push({ dom, clu, side });
              });
            });
          }
          const worstVerdict =
            foRollup.total === 0 ? null
            : foRollup.red > 0 ? "red"
            : foRollup.yellow > 0 ? "yellow"
            : "green";
          const otherNames = [...foRollup.otherSites].join(" / ");
          const foColor =
            worstVerdict === "green"  ? "border-emerald-300 bg-emerald-50 text-emerald-800"
            : worstVerdict === "yellow" ? "border-amber-300 bg-amber-50 text-amber-800"
            : worstVerdict === "red"    ? "border-rose-300 bg-rose-50 text-rose-800"
            : "";
          const foSymbol =
            worstVerdict === "green" ? "✓"
            : worstVerdict === "yellow" ? "⚠"
            : worstVerdict === "red" ? "✕" : "";

          return (
            <div key={sr.site.id} className="border border-slate-200 rounded-lg p-4 mb-4 bg-white">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-lg font-serif text-slate-900">{sr.site.name}</h3>
                  {sr.site.location && (
                    <span className="text-sm text-slate-500">{sr.site.location}</span>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-mono text-slate-900 font-semibold">
                    {siteHosts} <span className="text-sm text-slate-400">hosts</span>
                  </div>
                  <div className="text-sm font-mono text-slate-500">
                    {fmt(siteRawTib, 1)} TiB raw vSAN
                  </div>
                </div>
              </div>

              {foRollup.total > 0 && (
                <div className={`border rounded p-2.5 mb-3 ${foColor}`}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-[11px] uppercase tracking-wider font-mono font-semibold">
                      {foSymbol} If {otherNames} fails, {sr.site.name} alone can run:
                    </span>
                    <span className="text-[10px] font-mono">
                      {foRollup.green}/{foRollup.total} fully · {foRollup.yellow} degraded · {foRollup.red} unable
                    </span>
                  </div>
                  {foRollup.red > 0 && (
                    <ul className="text-[10px] font-mono mt-1 space-y-0.5">
                      {foRollup.reds.map(({ dom, clu, side }, i) => (
                        <li key={`r-${i}`}>
                          ✕ <strong>{dom.name} / {clu.name}</strong>: {side.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {foRollup.red === 0 && foRollup.yellow > 0 && (
                    <ul className="text-[10px] font-mono mt-1 space-y-0.5">
                      {foRollup.yellows.map(({ dom, clu, side }, i) => (
                        <li key={`y-${i}`}>
                          ⚠ <strong>{dom.name} / {clu.name}</strong>: {side.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {visibleProjections.length === 0 ? (
                <p className="text-[11px] text-slate-400 font-mono py-2">
                  No instances assigned to this site.
                </p>
              ) : (
                visibleProjections.map((p) => {
                  const otherSite = p.otherSiteId ? fleet.sites.find((s) => s.id === p.otherSiteId) : null;
                  return (
                    <div key={p.instance.id} className="border-l-2 border-sky-300 pl-3 mb-3 last:mb-0">
                      <div className="flex items-baseline justify-between mb-2">
                        <span className="text-sm font-serif text-slate-800 font-semibold">{p.instance.name}</span>
                        {otherSite && (
                          <span className="text-[10px] text-blue-600 font-mono">
                            ↔ Stretched with {otherSite.name}
                          </span>
                        )}
                      </div>
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                            <th className="text-left font-normal pb-1.5 pl-1">Domain · Cluster</th>
                            <th className="text-center font-normal pb-1.5">Placement</th>
                            <th className="text-right font-normal pb-1.5 px-3">Hosts Here</th>
                            <th className="text-right font-normal pb-1.5 px-3">Raw TiB Here</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.projectedDomains.flatMap((pd) =>
                            pd.projectedClusters.map((pc) => {
                              const isStretchedDom =
                                pd.domain.placement === "stretched" && p.instance.siteIds.length === 2;
                              return (
                                <tr key={pc.cluster.id} className="border-t border-slate-100">
                                  <td className="py-1.5 pl-1 text-slate-700">
                                    {pd.domain.name} <span className="text-slate-400">·</span> {pc.cluster.name}
                                  </td>
                                  <td className="py-1.5 text-center">
                                    {isStretchedDom ? (
                                      <span className="text-[9px] uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                                        ↔ Stretched · {pd.sharePct}% here
                                      </span>
                                    ) : (
                                      <span className="text-[9px] uppercase tracking-wider text-slate-400 bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
                                        Local
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-slate-800 font-semibold tabular-nums">
                                    {pc.hostsHere}
                                  </td>
                                  <td className="py-1.5 px-3 text-right text-slate-600 tabular-nums">
                                    {fmt(pc.rawTibHere, 1)}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (n, d = 0) =>
  n === undefined || n === null || Number.isNaN(n)
    ? "—"
    : Number(n).toLocaleString(undefined, {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      });

function NumField({ label, value, onChange, step = 1, min = 0, suffix }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-medium">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          value={value}
          step={step}
          min={min}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`w-full bg-white border border-slate-200 rounded py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500 focus:bg-white ${suffix ? "pl-2.5 pr-12" : "px-2.5"}`}
        />
        {suffix && (
          <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-medium">
        {label}
      </span>
      <input
        type="text"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1 font-medium">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded px-2.5 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-blue-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Section({ title, children, right }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-1.5 mb-3">
        <h4 className="text-[11px] uppercase tracking-[0.18em] text-blue-700 font-semibold">
          {title}
        </h4>
        {right}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between border-b border-dotted border-slate-200 py-0.5">
      <span className="text-slate-400">{k}</span>
      <span className="text-slate-700">{v}</span>
    </div>
  );
}

function FloorRow({ label, value, active }) {
  return (
    <div
      className={`flex justify-between px-2 py-1 rounded border ${
        active
          ? "border-blue-400 bg-blue-50 text-blue-800"
          : "border-slate-200 text-slate-500"
      }`}
    >
      <span className="uppercase tracking-wider text-[10px]">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Stat({ label, value, mono }) {
  return (
    <div className="border border-slate-200 bg-white rounded p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 mb-1 font-mono">
        {label}
      </div>
      <div className={`text-xl text-slate-900 ${mono ? "font-mono" : "font-serif"}`}>
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STACK PICKER — table of appliance entries with size/instance controls
// ─────────────────────────────────────────────────────────────────────────────
function StackPicker({ stack, onChange, isMgmtCluster, defaultInstancesById, allowedPlacements }) {
  const updateItem = (idx, patch) => {
    onChange(stack.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const removeItem = (idx) => onChange(stack.filter((_, i) => i !== idx));
  const addItem = (componentId) => {
    const def = APPLIANCE_DB[componentId];
    if (!def) return;
    // HA-aware default: if the parent passed a per-appliance instance-count
    // map (derived from the instance's deployment profile), honor it.
    // Otherwise fall back to 1.
    const defaultInstances = defaultInstancesById?.[componentId] ?? 1;
    onChange([
      ...stack,
      { id: componentId, size: def.defaultSize, instances: defaultInstances, key: cryptoKey() },
    ]);
  };

  const usedIds = new Set(stack.map((s) => s.id));
  const availableToAdd = Object.entries(APPLIANCE_DB).filter(([id, def]) => {
    if (usedIds.has(id)) return false;
    // When a parent scope restricts what can be added (e.g., WLD Components
    // only allows per-domain appliances), filter the menu accordingly.
    if (allowedPlacements && !allowedPlacements.includes(def.placement)) return false;
    return true;
  });
  const totals = stackTotals(stack);

  // VKS Supervisor info block — shown when supervisor is in the stack
  const hasVks = stack.some((s) => s.id === "vksSupervisor");
  const vksItem = stack.find((s) => s.id === "vksSupervisor");

  return (
    <div>
      {hasVks && vksItem && (
        <div className="mb-3 border border-sky-300 bg-sky-50 rounded p-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-sky-700 font-mono font-semibold">
              VKS Deployment Mode
            </span>
            <span className="text-[10px] text-sky-600 font-mono">
              {vksItem.instances === 1 ? "Simple (1 VM) — Single Mgmt Zone or non-HA" :
               vksItem.instances === 3 ? "High Availability (3 VMs) — Required for 3-zone, recommended for production" :
               `Custom: ${vksItem.instances} VMs`}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
            {APPLIANCE_DB.vksSupervisor.info}
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono" style={{ minWidth: "640px" }}>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400">
              <th className="text-left font-normal pb-1.5 pl-1" style={{ width: "22%" }}>Component</th>
              <th className="text-left font-normal pb-1.5" style={{ width: "28%" }}>Size</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "8%" }}>Inst</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "10%" }}>vCPU</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "12%" }}>RAM (GB)</th>
              <th className="text-right font-normal pb-1.5 px-3" style={{ width: "14%" }}>Disk (GB)</th>
              <th className="pb-1.5" style={{ width: "6%" }}></th>
            </tr>
          </thead>
          <tbody>
            {stack.map((item, idx) => {
              const def = APPLIANCE_DB[item.id];
              if (!def) return null;
              const sz = def.sizes[item.size] || def.sizes[def.defaultSize];
              return (
                <tr key={item.key || idx} className="border-t border-slate-200">
                  <td className="py-2 pl-1 text-slate-700">
                    <div title={def.source} className="flex items-center gap-1.5 flex-wrap">
                      <span>{def.label}</span>
                      {def.recommendedScope === "wld" && (
                        <span
                          className="text-[9px] uppercase tracking-wider text-amber-700 font-mono bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5"
                          title="VCF architectural convention: this appliance is typically deployed in the workload domain it serves, not the management cluster. Still movable."
                        >
                          ⚑ typ-in-WLD
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {def.fixed ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <select
                        value={item.size}
                        onChange={(e) => updateItem(idx, { size: e.target.value })}
                        className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 text-[11px] w-full max-w-[220px]"
                      >
                        {Object.keys(def.sizes).map((k) => {
                          const lim = SIZING_LIMITS[item.id]?.[k];
                          return (
                            <option key={k} value={k}>
                              {lim ? `${k} — ${lim.label}` : k}
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      min={0}
                      value={item.instances}
                      onChange={(e) => updateItem(idx, { instances: parseInt(e.target.value) || 0 })}
                      className="w-14 bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 text-[11px] text-right"
                    />
                  </td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{fmt(sz.vcpu * item.instances)}</td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{fmt(sz.ram * item.instances, sz.ram < 1 ? 2 : 0)}</td>
                  <td className="py-2 px-3 text-right text-slate-600 tabular-nums">{fmt(sz.disk * item.instances)}</td>
                  <td className="py-2 text-right pr-2">
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-slate-400 hover:text-rose-600 text-sm px-1"
                      aria-label="Remove"
                    >×</button>
                  </td>
                </tr>
              );
            })}
            {stack.length > 0 && (
              <tr className="border-t-2 border-slate-300 font-semibold">
                <td colSpan={3} className="py-2 pl-1 text-[10px] uppercase tracking-wider text-blue-700">Stack Total</td>
                <td className="py-2 px-3 text-right text-blue-800 tabular-nums">{fmt(totals.vcpu)}</td>
                <td className="py-2 px-3 text-right text-blue-800 tabular-nums">{fmt(totals.ram, 0)}</td>
                <td className="py-2 px-3 text-right text-blue-800 tabular-nums">{fmt(totals.disk)}</td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {availableToAdd.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 self-center mr-1">Add:</span>
          {availableToAdd.map(([id, def]) => (
            <button
              key={id}
              onClick={() => addItem(id)}
              className="text-[10px] font-mono uppercase tracking-wider text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-400 rounded px-2 py-0.5 transition-colors"
            >
              + {def.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIZE RECOMMENDER — auto-selects vCenter and NSX Manager from target scale
// ─────────────────────────────────────────────────────────────────────────────
function SizeRecommender({ stack, onChange }) {
  const [hosts, setHosts] = useState(100);
  const [vms, setVms] = useState(1000);
  const [clusters, setClusters] = useState(5);

  const suggestedVcenter = recommendVcenterSize(hosts, vms);
  const suggestedNsx = recommendNsxSize(hosts, clusters);

  const apply = () => {
    onChange(stack.map((item) => {
      if (item.id === "vcenter") return { ...item, size: suggestedVcenter };
      if (item.id === "nsxMgr") return { ...item, size: suggestedNsx };
      return item;
    }));
  };

  return (
    <div className="border border-slate-200 bg-slate-50 rounded p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-mono">
          Auto-size from target scale
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono">
          Derived from P&P Workbook scale tables
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2 items-end">
        <NumField label="Target Hosts"  value={hosts}    onChange={setHosts} />
        <NumField label="Target VMs"    value={vms}      onChange={setVms} />
        <NumField label="NSX Clusters"  value={clusters} onChange={setClusters} />
        <button
          onClick={apply}
          className="h-[34px] text-[10px] uppercase tracking-wider font-mono text-blue-600 border border-blue-300 hover:bg-blue-50 rounded px-3"
        >
          Apply → {suggestedVcenter} / {suggestedNsx}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER CARD — leaf-level editor where the sizing math actually happens
// ─────────────────────────────────────────────────────────────────────────────
function ClusterCard({ cluster, onChange, onRemove, canRemove, result, isMgmtCluster, injectedEntries, failoverSiteNames, domainHostSplitPct }) {
  const update = (patch) => onChange({ ...cluster, ...patch });
  const updateHost = (patch) => onChange({ ...cluster, host: { ...cluster.host, ...patch } });
  const updateWorkload = (patch) => onChange({ ...cluster, workload: { ...cluster.workload, ...patch } });
  const updateStorage = (patch) => onChange({ ...cluster, storage: { ...cluster.storage, ...patch } });
  const updateTiering = (patch) => onChange({ ...cluster, tiering: { ...cluster.tiering, ...patch } });

  const limiterColor = {
    Compute: "text-sky-700",
    Memory: "text-violet-600",
    Storage: "text-blue-600",
    Policy: "text-rose-600",
    Manual: "text-emerald-700",
  }[result.limiter];

  return (
    <div className="border border-emerald-300 bg-white rounded-md p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.18em] text-emerald-700 font-mono">
            ◆ Cluster
          </span>
          <input
            value={cluster.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-transparent text-base text-slate-800 font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1"
          />
          {cluster.isDefault && (
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono border border-slate-200 rounded px-1.5 py-0.5">
              Default
            </span>
          )}
          {result.failover && (() => {
            // Compact header badge summarizing the stretched-cluster
            // failover verdict. Full detail is rendered lower in the card
            // and in PerSiteView. This exists so the user can see the
            // rollup while editing a cluster.
            const fo = result.failover;
            const aName = failoverSiteNames?.[0] || "Site A";
            const bName = failoverSiteNames?.[1] || "Site B";
            // Worst verdict wins for the badge color.
            const order = { green: 0, yellow: 1, red: 2 };
            const worst = order[fo.siteA.verdict] >= order[fo.siteB.verdict] ? fo.siteA : fo.siteB;
            const colorClass =
              worst.verdict === "green"  ? "text-emerald-700 bg-emerald-50 border-emerald-300"
              : worst.verdict === "yellow" ? "text-amber-700 bg-amber-50 border-amber-300"
              : "text-rose-700 bg-rose-50 border-rose-300";
            const symbol = worst.verdict === "green" ? "✓" : worst.verdict === "yellow" ? "⚠" : "✕";
            const label = worst.verdict === "green"
              ? "Site failover OK"
              : worst.verdict === "yellow"
                ? "Site failover degraded"
                : "Site failover unsafe";
            const tooltip =
              `${aName} alone: ${fo.siteA.verdict.toUpperCase()} — ${fo.siteA.reason}\n` +
              `${bName} alone: ${fo.siteB.verdict.toUpperCase()} — ${fo.siteB.reason}`;
            return (
              <span
                className={`text-[9px] uppercase tracking-wider font-mono border rounded px-1.5 py-0.5 ${colorClass}`}
                title={tooltip}
              >
                {symbol} {label}
              </span>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cluster.storage.externalStorage}
              onChange={(e) => updateStorage({ externalStorage: e.target.checked })}
              className="accent-blue-600"
            />
            EXT STORAGE
          </label>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-slate-400 hover:text-rose-600 text-xs px-2 py-0.5 border border-slate-200 rounded"
            >
              REMOVE
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* LEFT: inputs */}
        <div>
          <Section title="Host Specification">
            <div className="grid grid-cols-2 gap-2">
              <NumField label="CPU Qty" value={cluster.host.cpuQty} onChange={(v) => updateHost({ cpuQty: v })} />
              <NumField label="Cores / CPU" value={cluster.host.coresPerCpu} onChange={(v) => updateHost({ coresPerCpu: v })} />
              <NumField label="Host RAM" suffix="GB" value={cluster.host.ramGb} onChange={(v) => updateHost({ ramGb: v })} />
              {!cluster.storage.externalStorage && (
                <>
                  <NumField label="NVMe Qty" value={cluster.host.nvmeQty} onChange={(v) => updateHost({ nvmeQty: v })} />
                  <NumField label="NVMe Size" suffix="TB" step={0.01} value={cluster.host.nvmeSizeTb} onChange={(v) => updateHost({ nvmeSizeTb: v })} />
                </>
              )}
              <NumField label="CPU Oversub" suffix="×" step={0.1} value={cluster.host.cpuOversub} onChange={(v) => updateHost({ cpuOversub: v })} />
              <NumField label="RAM Oversub" suffix="×" step={0.1} value={cluster.host.ramOversub} onChange={(v) => updateHost({ ramOversub: v })} />
              <NumField label="Reserve" suffix="%" value={cluster.host.reservePct} onChange={(v) => updateHost({ reservePct: v })} />
            </div>
            <label
              className="mt-2 flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer select-none"
              title="When enabled, each physical core provides 2 logical threads (Intel Hyper-Threading / AMD SMT). Increases vCPU sizing capacity only — licensed cores stay based on physical cores to match VCF per-core licensing."
            >
              <input
                type="checkbox"
                checked={!!cluster.host.hyperthreadingEnabled}
                onChange={(e) => updateHost({ hyperthreadingEnabled: e.target.checked })}
                className="mt-0.5 accent-blue-600"
              />
              <span>
                <span className="font-semibold">Hyperthreading (SMT)</span> — model 2 logical threads per
                physical core for vCPU sizing. Licensed cores are unaffected.
              </span>
            </label>
          </Section>

          {!isMgmtCluster && (
            <Section title="Workload VMs">
              <div className="grid grid-cols-2 gap-2">
                <NumField label="VM Count" value={cluster.workload.vmCount} onChange={(v) => updateWorkload({ vmCount: v })} />
                <NumField label="vCPU / VM" value={cluster.workload.vcpuPerVm} onChange={(v) => updateWorkload({ vcpuPerVm: v })} />
                <NumField label="RAM / VM" suffix="GB" value={cluster.workload.ramPerVm} onChange={(v) => updateWorkload({ ramPerVm: v })} />
                <NumField label="Disk / VM" suffix="GB" value={cluster.workload.diskPerVm} onChange={(v) => updateWorkload({ diskPerVm: v })} />
              </div>
            </Section>
          )}

          <Section title={isMgmtCluster ? "Management Appliance Stack" : "Infrastructure Appliances"}>
            {isMgmtCluster && (
              <SizeRecommender stack={cluster.infraStack} onChange={(infraStack) => update({ infraStack })} />
            )}
            <StackPicker
              stack={cluster.infraStack}
              onChange={(infraStack) => update({ infraStack })}
              isMgmtCluster={isMgmtCluster}
            />
            {result.failover && (() => {
              const fo = result.failover;
              const aName = failoverSiteNames?.[0] || "Site A";
              const bName = failoverSiteNames?.[1] || "Site B";
              const colorFor = (v) =>
                v === "green"  ? "text-emerald-700 bg-emerald-50 border-emerald-300"
                : v === "yellow" ? "text-amber-700 bg-amber-50 border-amber-300"
                : "text-rose-700 bg-rose-50 border-rose-300";
              const labelFor = (v) =>
                v === "green"  ? "✓ Fully up"
                : v === "yellow" ? "⚠ Degraded (no reserve)"
                : "✕ Cannot absorb";
              const row = (side, name, hostCount) => (
                <div className={`border rounded px-3 py-2 ${colorFor(side.verdict)}`}>
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="text-[10px] uppercase tracking-wider font-mono font-semibold">
                      If {name === aName ? bName : aName} fails →
                    </span>
                    <span className="text-[10px] font-mono font-semibold">{labelFor(side.verdict)}</span>
                  </div>
                  <div className="text-[10px] font-mono opacity-80">
                    {name}: {hostCount} host{hostCount === 1 ? "" : "s"}
                    {typeof side.vcpuUsedPct === "number" &&
                      ` · vCPU ${side.vcpuUsedPct}% · RAM ${side.ramUsedPct}%`}
                  </div>
                  {side.verdict !== "green" && (
                    <div className="text-[10px] font-mono mt-0.5 opacity-70">{side.reason}</div>
                  )}
                </div>
              );
              // One-click targets: find the smallest host count that flips
              // both sites to the requested verdict, and preview the delta
              // from the current cluster total. Clicking applies the number
              // to cluster.hostOverride, which the sizing engine picks up on
              // the next render. null means "already there" — button shows
              // as disabled / "current".
              const hostsNeededGreen  = minHostsForVerdict(cluster, result, domainHostSplitPct, "green");
              const hostsNeededYellow = minHostsForVerdict(cluster, result, domainHostSplitPct, "yellow");
              const currentTotal = result.finalHosts;
              const currentOverride = cluster.hostOverride || 0;
              const applyTarget = (targetHosts) => {
                if (targetHosts == null) return;
                update({ hostOverride: targetHosts });
              };
              const bothGreen = fo.siteA.verdict === "green" && fo.siteB.verdict === "green";
              const bothAtLeastYellow =
                fo.siteA.verdict !== "red" && fo.siteB.verdict !== "red";
              const targetButton = (label, description, need, tone, alreadyMet) => {
                const delta = need != null ? need - currentTotal : null;
                const disabled = need == null || alreadyMet;
                const color =
                  tone === "green"  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
                  : tone === "yellow" ? "border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400"
                  : "border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400";
                const disabledColor = "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed";
                return (
                  <button
                    onClick={() => !disabled && applyTarget(need)}
                    disabled={disabled}
                    className={`text-left border rounded p-2 transition-colors ${disabled ? disabledColor : color}`}
                    title={disabled
                      ? (alreadyMet ? "Cluster is already at this target" : "No override can satisfy this target")
                      : `Set Manual override to ${need} hosts`}
                  >
                    <div className="text-[10px] uppercase tracking-wider font-mono font-semibold mb-0.5">{label}</div>
                    <div className="text-[10px] font-mono leading-snug opacity-80">{description}</div>
                    {!disabled && delta != null && (
                      <div className="text-[10px] font-mono font-semibold mt-1">
                        → Set to {need} host{need === 1 ? "" : "s"}
                        {delta > 0
                          ? <span className="opacity-70"> (+{delta} from current {currentTotal})</span>
                          : delta < 0
                            ? <span className="opacity-70"> ({delta} from current {currentTotal})</span>
                            : <span className="opacity-70"> (no change)</span>}
                      </div>
                    )}
                    {alreadyMet && (
                      <div className="text-[10px] font-mono font-semibold mt-1">✓ Already at this target</div>
                    )}
                  </button>
                );
              };
              return (
                <div className="mt-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono font-semibold mb-2">
                    ⬢ Stretched-cluster site failover analysis
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {row(fo.siteA, aName, fo.hostsA)}
                    {row(fo.siteB, bName, fo.hostsB)}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-2 mb-2">
                    ℹ Analysis assumes full cluster demand must run on the survivor. Demand includes any WLD appliances pinned to this cluster. Degraded means the survivor has enough raw capacity only by consuming the configured reserve slack.
                  </p>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono font-semibold mb-1.5">
                    Apply a target
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {targetButton(
                      "✓ Survive failover",
                      "Raise Manual override until both sites absorb full demand within safe reserves.",
                      hostsNeededGreen,
                      "green",
                      bothGreen && currentOverride === hostsNeededGreen,
                    )}
                    {targetButton(
                      "⚠ Degraded but running",
                      "Minimum hosts for both sites to run everything — consuming the configured reserve slack on failover.",
                      hostsNeededYellow,
                      "yellow",
                      bothAtLeastYellow && !bothGreen && currentOverride === hostsNeededYellow,
                    )}
                    {targetButton(
                      "✕ Accept downtime",
                      "No override — current auto sizing only. Site failure means loss of services on the survivor.",
                      0,
                      "gray",
                      currentOverride === 0,
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono mt-1.5">
                    ℹ Targets set the Manual host-count override above. Architectural floors (CPU, RAM, storage, vSAN policy) still win if they're higher.
                  </p>
                </div>
              );
            })()}

            {injectedEntries && injectedEntries.length > 0 && (() => {
              // Pre-aggregate so we can render per-row totals AND a footer row.
              // Using stackTotals would re-read APPLIANCE_DB once per call; doing
              // the math inline keeps it local and avoids paying for a second
              // lookup for fields (label, size) we need anyway.
              let totalVcpu = 0, totalRam = 0, totalDisk = 0;
              const rows = injectedEntries.map((e) => {
                const def = APPLIANCE_DB[e.id];
                const sz = def?.sizes?.[e.size];
                const inst = e.instances || 0;
                const vcpu = (sz?.vcpu || 0) * inst;
                const ram  = (sz?.ram  || 0) * inst;
                const disk = (sz?.disk || 0) * inst;
                totalVcpu += vcpu;
                totalRam  += ram;
                totalDisk += disk;
                return { key: e.key, label: def?.label || e.id, size: e.size, inst, vcpu, ram, disk, ownerDomainName: e.ownerDomainName };
              });
              return (
                <div className="mt-4 border-l-2 border-sky-400 pl-3">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-[10px] uppercase tracking-wider text-sky-700 font-mono font-semibold">
                      ⬢ Hosted for workload domains
                    </span>
                    <span className="text-[9px] text-sky-600 font-mono">
                      read-only — edit from the owning WLD card
                    </span>
                  </div>
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-200">
                        <th className="text-left font-normal pb-1.5 pl-1">Component</th>
                        <th className="text-left font-normal pb-1.5">Size</th>
                        <th className="text-right font-normal pb-1.5 px-2">Inst</th>
                        <th className="text-right font-normal pb-1.5 px-2">vCPU</th>
                        <th className="text-right font-normal pb-1.5 px-2">RAM (GB)</th>
                        <th className="text-right font-normal pb-1.5 px-2">Disk (GB)</th>
                        <th className="text-left font-normal pb-1.5 pl-3">Owner WLD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.key} className="border-t border-slate-100">
                          <td className="py-1.5 pl-1 text-slate-700">{row.label}</td>
                          <td className="py-1.5 text-slate-500">{row.size}</td>
                          <td className="py-1.5 px-2 text-right text-slate-800 tabular-nums">×{row.inst}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 tabular-nums">{fmt(row.vcpu)}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 tabular-nums">{fmt(row.ram)}</td>
                          <td className="py-1.5 px-2 text-right text-slate-600 tabular-nums">{fmt(row.disk)}</td>
                          <td className="py-1.5 pl-3 text-sky-700">{row.ownerDomainName}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-sky-300 bg-sky-50">
                        <td className="py-1.5 pl-1 text-sky-800 font-semibold uppercase tracking-wider text-[10px]">Total injected</td>
                        <td className="py-1.5"></td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{rows.length} {rows.length === 1 ? "row" : "rows"}</td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{fmt(totalVcpu)}</td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{fmt(totalRam)}</td>
                        <td className="py-1.5 px-2 text-right text-sky-800 tabular-nums font-semibold">{fmt(totalDisk)}</td>
                        <td className="py-1.5 pl-3"></td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="text-[10px] text-slate-400 font-mono mt-1">
                    ℹ These appliances are charged to this cluster's demand (already counted in the host total above). To edit or move them, open the owning workload domain's card.
                  </p>
                </div>
              );
            })()}
          </Section>

          {!cluster.storage.externalStorage ? (
            <Section title="vSAN ESA Storage">
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  label="Protection Policy"
                  value={cluster.storage.policy}
                  onChange={(v) => updateStorage({ policy: v })}
                  options={Object.entries(POLICIES).map(([k, v]) => ({
                    value: k,
                    label: `${v.label} · PF ${v.pf}× · min ${v.minHosts}`,
                  }))}
                />
                <NumField label="Dedup Ratio" step={0.1} value={cluster.storage.dedup} onChange={(v) => updateStorage({ dedup: v })} />
                <NumField label="Compression" step={0.1} value={cluster.storage.compression} onChange={(v) => updateStorage({ compression: v })} />
                <NumField label="VM Swap" suffix="%" value={cluster.storage.swapPct} onChange={(v) => updateStorage({ swapPct: v })} />
                <NumField label="vSAN Free" suffix="%" value={cluster.storage.freePct} onChange={(v) => updateStorage({ freePct: v })} />
                <NumField label="Growth" suffix="%" value={cluster.storage.growthPct} onChange={(v) => updateStorage({ growthPct: v })} />
              </div>
            </Section>
          ) : (
            <Section title="External Array">
              <NumField
                label="Estimated Array Capacity"
                suffix="TiB"
                value={cluster.storage.externalArrayTib}
                onChange={(v) => updateStorage({ externalArrayTib: v })}
              />
            </Section>
          )}

          {!cluster.storage.externalStorage && (
            <Section title="NVMe Memory Tiering" right={
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500 cursor-pointer">
              <input
                type="checkbox"
                checked={cluster.tiering.enabled}
                onChange={(e) => updateTiering({ enabled: e.target.checked })}
                className="accent-blue-600"
              />
              Enabled
            </label>
          }>
            {cluster.tiering.enabled ? (
              <div className="grid grid-cols-3 gap-2">
                <NumField label="Mem.TierNvmePct" suffix="%" step={5} value={cluster.tiering.nvmePct} onChange={(v) => updateTiering({ nvmePct: v })} />
                <NumField label="Eligible Workload" suffix="%" value={cluster.tiering.eligibilityPct} onChange={(v) => updateTiering({ eligibilityPct: v })} />
                <NumField label="Tier Drive" suffix="TB" step={0.01} value={cluster.tiering.tierDriveSizeTb} onChange={(v) => updateTiering({ tierDriveSizeTb: v })} />
              </div>
            ) : (
              <p className="text-[10px] text-slate-400 font-mono">
                Tiering disabled. Effective RAM = physical DRAM only.
              </p>
            )}
          </Section>
          )}
        </div>

        {/* RIGHT: results */}
        <div>
          <Section title="Result">
            <div className="bg-white border border-slate-200 rounded p-3 mb-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400 mb-1">Hosts Required</div>
              <div className="flex items-baseline gap-4">
                <span className="text-4xl font-serif text-slate-900 tabular-nums">{result.finalHosts}</span>
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Limiter</span>
                  <span className={`text-sm font-mono uppercase ${limiterColor}`}>{result.limiter}</span>
                </div>
              </div>
            </div>

            {result.vsanMinWarning && (
              <div className="bg-amber-50 border border-amber-300 rounded p-3 mb-3">
                <div className="flex items-start gap-2">
                  <span className="text-amber-700 font-mono text-sm leading-none mt-0.5">⚠</span>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-amber-800 font-mono font-semibold mb-1">
                      Recommended: 4-node minimum for vSAN
                    </div>
                    <p className="text-[11px] text-amber-800 font-mono leading-snug">
                      A 3-node vSAN cluster meets the architectural minimum but cannot auto-heal after a
                      host failure — rebuild requires a replacement host before redundancy is restored. A
                      4th node provides a spare fault domain, enabling automatic re-protection after
                      failures or during maintenance. Consider setting a Host Override of 4 below, or
                      choosing a storage policy with a higher minimum.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Manual host-count override — adds a "Manual" floor that the
                sizing engine compares against the computed architectural
                minimum. Lets the user raise finalHosts (e.g. to survive
                stretched-cluster site failover) without touching host
                specs. Can only increase hosts; architectural floors still
                win if they're higher. */}
            <div className="bg-emerald-50 border border-emerald-200 rounded p-3 mb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-800 font-mono font-semibold">
                    Manual host-count override
                  </div>
                  <p className="text-[10px] text-emerald-700 font-mono mt-0.5 leading-snug">
                    Force at least N hosts regardless of demand math. Use to raise the survivor count on a stretched cluster.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={cluster.hostOverride || 0}
                    onChange={(e) => update({ hostOverride: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-16 bg-white border border-emerald-300 rounded px-2 py-1 text-slate-800 font-mono text-sm text-right focus:outline-none focus:border-emerald-500"
                    title="0 = auto (use architectural minimum)"
                  />
                  {(cluster.hostOverride || 0) > 0 && (
                    <button
                      onClick={() => update({ hostOverride: 0 })}
                      className="text-[10px] uppercase tracking-wider text-emerald-700 hover:text-rose-600 border border-emerald-300 hover:border-rose-400 rounded px-2 py-1 font-mono"
                      title="Reset to automatic"
                    >
                      Auto
                    </button>
                  )}
                </div>
              </div>
              {(cluster.hostOverride || 0) > 0 && result.limiter !== "Manual" && (
                <p className="text-[10px] text-amber-700 font-mono mt-2">
                  ⚠ Override ({cluster.hostOverride}) is below an architectural floor — the {result.limiter.toLowerCase()} minimum ({result.finalHosts}) wins.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <FloorRow label="CPU floor"     value={result.floors.cpuHosts}    active={result.limiter === "Compute"} />
              <FloorRow label="RAM floor"     value={result.floors.ramHosts}    active={result.limiter === "Memory"} />
              {!cluster.storage.externalStorage && (
                <FloorRow label="Storage floor" value={result.floors.storageHosts} active={result.limiter === "Storage"} />
              )}
              <FloorRow label="Policy min"    value={result.floors.policyMin}   active={result.limiter === "Policy"} />
              {(cluster.hostOverride || 0) > 0 && (
                <FloorRow label="Manual floor" value={result.floors.manualOverride} active={result.limiter === "Manual"} />
              )}
            </div>
          </Section>

          <Section title="Per-Host Capacity">
            <div className="text-xs font-mono text-slate-600 space-y-1">
              <Row
                k="Cores"
                v={
                  cluster.host.hyperthreadingEnabled
                    ? `${fmt(result.host.cores)} / ${fmt(result.host.threads)} threads`
                    : fmt(result.host.cores)
                }
              />
              <Row k="Usable vCPU"  v={fmt(result.host.usableVcpu, 1)} />
              <Row k="Usable RAM"   v={`${fmt(result.host.usableRam, 0)} GB`} />
              {cluster.tiering.enabled && (
                <>
                  <Row k="Tier partition"  v={`${fmt(result.tier.tierPartitionGb)} GB`} />
                  <Row k="Effective RAM"   v={`${fmt(result.tier.effectiveRamPerHost, 0)} GB`} />
                </>
              )}
              {!cluster.storage.externalStorage && (
                <Row k="Raw NVMe"     v={`${fmt((result.host.rawGb / 1000) * TB_TO_TIB, 1)} TiB`} />
              )}
            </div>
          </Section>

          <Section title="Demand">
            <div className="text-xs font-mono text-slate-600 space-y-1">
              <Row k="vCPU"  v={fmt(result.demand.vcpu)} />
              <Row k="RAM"   v={`${fmt(result.demand.ram)} GB`} />
              <Row k="Disk"  v={`${fmt(result.demand.disk)} GB`} />
              {cluster.tiering.enabled && (
                <Row k="Tiered RAM demand" v={`${fmt(result.tier.tieredDemandRamGb, 0)} GB`} />
              )}
            </div>
          </Section>

          {result.pipeline && (
            <Section title="Storage Pipeline">
              <div className="text-xs font-mono text-slate-600 space-y-1">
                <Row k="DRR"             v={`${fmt(result.pipeline.drr, 2)}×`} />
                <Row k="VM Capacity"     v={`${fmt(result.pipeline.vmCapGb)} GB`} />
                <Row k="+ Swap"          v={`${fmt(result.pipeline.swapGb)} GB`} />
                <Row k="× PF"            v={`${fmt(result.pipeline.pf, 2)}× → ${fmt(result.pipeline.protectedGb)} GB`} />
                <Row k="× Free"          v={`${fmt(result.pipeline.withFreeGb)} GB`} />
                <Row k="× Growth"        v={`${fmt(result.pipeline.totalReqGb)} GB`} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN CARD — thin container that holds clusters
// ─────────────────────────────────────────────────────────────────────────────
function DomainCard({ domain, isStretched, instanceSiteIds, allSites, eligibleClusters, defaultInstancesById, injectedByClusterId, onChange, onRemove, canRemove, result }) {
  const update = (patch) => onChange({ ...domain, ...patch });

  const updateCluster = (idx, next) => {
    onChange({ ...domain, clusters: domain.clusters.map((c, i) => (i === idx ? next : c)) });
  };
  const addCluster = () => {
    const next = domain.type === "mgmt"
      ? newMgmtCluster(`mgmt-cluster-${domain.clusters.length + 1}`)
      : newWorkloadCluster(`wld-cluster-${domain.clusters.length + 1}`);
    next.isDefault = false;
    onChange({ ...domain, clusters: [...domain.clusters, next] });
  };
  const removeCluster = (idx) => {
    if (domain.clusters.length <= 1) return;
    onChange({ ...domain, clusters: domain.clusters.filter((_, i) => i !== idx) });
  };

  const isMgmt = domain.type === "mgmt";
  const isStretchedDomain = isStretched && domain.placement === "stretched";
  const borderColor = isMgmt ? "border-violet-300" : "border-rose-300";
  const tagColor = isMgmt ? "text-violet-700" : "text-rose-700";
  const tagLabel = isMgmt ? "MGMT DOMAIN" : "WORKLOAD DOMAIN";

  // Which site this local domain is pinned to. Falls back to siteIds[0] if
  // the stored value is missing or no longer valid (site was removed).
  const siteIds = instanceSiteIds || [];
  const effectiveLocalSiteId =
    domain.localSiteId && siteIds.includes(domain.localSiteId)
      ? domain.localSiteId
      : siteIds[0] || null;
  const effectiveLocalSite = (allSites || []).find((s) => s.id === effectiveLocalSiteId);

  // Toggle stretched ↔ local from the header checkbox. When going back to
  // local we must set a concrete localSiteId so the domain doesn't become
  // unprojectable; we keep any existing pin that's still valid.
  const handleStretchedToggle = (checked) => {
    if (checked) {
      update({ placement: "stretched", localSiteId: null });
    } else {
      update({ placement: "local", localSiteId: effectiveLocalSiteId });
    }
  };

  return (
    <div className={`border-l-2 ${borderColor} pl-4 mb-4`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-[9px] uppercase tracking-[0.18em] ${tagColor} font-mono font-semibold`}>
            ▸ {tagLabel}
          </span>
          <input
            value={domain.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-transparent text-lg text-slate-800 font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1"
          />
          {isStretchedDomain && (
            <span className="text-[9px] uppercase tracking-wider text-blue-600 font-mono font-semibold bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
              ↔ Stretched
            </span>
          )}
          {!isStretchedDomain && effectiveLocalSite && (
            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
              @ {effectiveLocalSite.name}
            </span>
          )}
          {!isStretchedDomain && !effectiveLocalSite && (
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-mono bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
              Local · no site
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Local domain → per-site pinner (only meaningful when the instance touches 2 sites) */}
          {isStretched && !isStretchedDomain && siteIds.length === 2 && (
            <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-200 rounded p-0.5">
              {siteIds.map((sid) => {
                const site = (allSites || []).find((s) => s.id === sid);
                const active = effectiveLocalSiteId === sid;
                return (
                  <button
                    key={sid}
                    onClick={() => update({ localSiteId: sid })}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded transition-colors ${
                      active
                        ? "bg-white text-slate-800 border border-slate-300 shadow-sm"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                    title={`Pin this domain to ${site?.name || "site"}`}
                  >
                    @ {site?.name || "?"}
                  </button>
                );
              })}
            </div>
          )}
          {isStretched && (
            <label className="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono cursor-pointer select-none">
              <input
                type="checkbox"
                checked={domain.placement === "stretched"}
                onChange={(e) => handleStretchedToggle(e.target.checked)}
                className="accent-blue-600"
              />
              Stretch across sites
            </label>
          )}
          <span className="text-[10px] text-slate-400 font-mono">
            {result.totalHosts} hosts · {fmt(result.totalCores)} cores
          </span>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-slate-400 hover:text-rose-600 text-[10px] uppercase tracking-wider px-2 py-0.5 border border-slate-200 rounded"
            >
              Remove Domain
            </button>
          )}
        </div>
      </div>

      {isStretchedDomain && (
        <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-blue-800 font-mono font-semibold uppercase tracking-wider">
              ↔ Stretched Cluster — Host Distribution
            </span>
            <span className="text-[10px] text-blue-600 font-mono">
              {result.totalHosts} total hosts across both sites
            </span>
          </div>
          <div className="flex items-center gap-4 mb-2">
            <span className="text-[11px] text-blue-700 font-mono w-32">Primary Site</span>
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={domain.hostSplitPct ?? 50}
              onChange={(e) => update({ hostSplitPct: parseInt(e.target.value) })}
              className="flex-1 accent-blue-600"
            />
            <span className="text-[11px] text-blue-700 font-mono w-32 text-right">Secondary Site</span>
          </div>
          <div className="flex justify-between text-[11px] font-mono text-blue-800 font-semibold">
            <span>{Math.ceil(result.totalHosts * ((domain.hostSplitPct ?? 50) / 100))} hosts ({domain.hostSplitPct ?? 50}%)</span>
            <span>{result.totalHosts - Math.ceil(result.totalHosts * ((domain.hostSplitPct ?? 50) / 100))} hosts ({100 - (domain.hostSplitPct ?? 50)}%)</span>
          </div>
          <p className="text-[10px] text-blue-600 font-mono mt-2">
            Adjust the ratio to reflect your actual host placement. vSAN stretched clusters require a witness at a third fault domain; array-based replication does not.
          </p>
        </div>
      )}

      {!isMgmt && (() => {
        const options = eligibleClusters || [];
        const mgmtOptions = options.filter((o) => o.scope === "mgmt");
        const wldOptions = options.filter((o) => o.scope === "wld");
        const selectedId =
          options.some((o) => o.id === domain.componentsClusterId)
            ? domain.componentsClusterId
            : (mgmtOptions[0]?.id || wldOptions[0]?.id || "");
        return (
          <div className="bg-slate-50 border border-slate-200 rounded px-4 py-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-[0.16em] text-slate-700 font-mono font-semibold">
                ⬢ WLD Components
              </span>
              <label className="flex items-center gap-2 text-[10px] font-mono text-slate-600">
                <span className="uppercase tracking-wider text-slate-400">Host appliances on</span>
                <select
                  value={selectedId}
                  onChange={(e) => update({ componentsClusterId: e.target.value })}
                  className="bg-white border border-slate-200 rounded px-2 py-1 text-slate-800 font-mono text-[11px] focus:outline-none focus:border-blue-500"
                  disabled={options.length === 0}
                >
                  {options.length === 0 && <option value="">(no clusters)</option>}
                  {mgmtOptions.length > 0 && (
                    <optgroup label="Mgmt Domain">
                      {mgmtOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {wldOptions.length > 0 && (
                    <optgroup label="This Workload Domain">
                      {wldOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            </div>
            <p className="text-[10px] text-slate-500 font-mono leading-relaxed mb-3">
              Each VCF workload domain owns dedicated services — vCenter Server, NSX Manager
              cluster, edge services, Avi Load Balancer, VCF Automation runtime, etc. Pick
              the specific cluster that hosts these VMs. The VCF 9 default is a cluster in
              the management domain (minimizing this WLD's appliance footprint); hosting
              them on one of this WLD's own clusters gives dedicated isolation at the cost
              of adding appliance demand to that cluster's host count. vCLS agents stay
              per-cluster and are unaffected.
            </p>
            <StackPicker
              stack={domain.wldStack || []}
              onChange={(next) => {
                // Tag newly-added entries with ownerDomainId so downstream
                // visibility (injected-appliances panel, PerSiteView Owner
                // column) can identify which WLD owns each appliance. Existing
                // entries keep their tag.
                const tagged = next.map((e) =>
                  e.ownerDomainId ? e : { ...e, ownerDomainId: domain.id }
                );
                update({ wldStack: tagged });
              }}
              isMgmtCluster={false}
              defaultInstancesById={defaultInstancesById}
              allowedPlacements={["per-domain"]}
            />
          </div>
        );
      })()}

      {domain.clusters.map((c, i) => {
        // Resolve friendly site names for the failover badge so it reads
        // "Site WH200" / "Site ARS" instead of raw ids. Only meaningful when
        // the instance actually spans two sites and this domain is stretched.
        const failoverSiteNames =
          (instanceSiteIds || []).length === 2 && domain.placement === "stretched"
            ? instanceSiteIds.map((id) => (allSites || []).find((s) => s.id === id)?.name || id)
            : null;
        return (
          <ClusterCard
            key={c.id}
            cluster={c}
            onChange={(next) => updateCluster(i, next)}
            onRemove={() => removeCluster(i)}
            canRemove={domain.clusters.length > 1}
            result={result.clusterResults[i]}
            isMgmtCluster={isMgmt}
            injectedEntries={(injectedByClusterId && injectedByClusterId[c.id]) || []}
            failoverSiteNames={failoverSiteNames}
            domainHostSplitPct={domain.hostSplitPct}
          />
        );
      })}

      <button
        onClick={addCluster}
        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-emerald-600 border border-dashed border-slate-200 hover:border-emerald-400 rounded px-3 py-1.5 transition-colors"
      >
        + Add Cluster
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE CARD — VCF instance, contains 1 mgmt + N workload domains
// ─────────────────────────────────────────────────────────────────────────────
function InstanceCard({ instance, allSites, onChange, onRemove, canRemove, result }) {
  const isStretchedInstance = (instance.siteIds || []).length === 2;
  const siteById = (id) => (allSites || []).find((s) => s.id === id);
  const update = (patch) => onChange({ ...instance, ...patch });

  const updateDomain = (idx, next) => {
    onChange({ ...instance, domains: instance.domains.map((d, i) => (i === idx ? next : d)) });
  };
  const addWorkloadDomain = () => {
    const wldCount = instance.domains.filter((d) => d.type === "workload").length;
    const next = newWorkloadDomain(`Workload Domain ${wldCount + 1}`);
    // New workload domains default to being pinned at the instance's first site.
    next.localSiteId = instance.siteIds[0] || null;
    // And their wldStack defaults to being hosted on the mgmt domain's first
    // cluster (VCF 9 default). The user can re-pin via the WLD Components
    // dropdown in the DomainCard.
    const mgmtDom = instance.domains.find((d) => d.type === "mgmt");
    next.componentsClusterId = mgmtDom?.clusters?.[0]?.id || null;
    onChange({ ...instance, domains: [...instance.domains, next] });
  };
  const removeDomain = (idx) => {
    const target = instance.domains[idx];
    if (target.type === "mgmt") return; // mgmt is mandatory
    onChange({ ...instance, domains: instance.domains.filter((_, i) => i !== idx) });
  };

  // Apply a deployment profile — rebuilds the mgmt domain's first cluster stack
  const applyProfile = (profileKey) => {
    const profile = DEPLOYMENT_PROFILES[profileKey];
    if (!profile) return;
    const newStack = profile.stack.map((s) => ({ ...s, key: cryptoKey() }));
    const newDomains = instance.domains.map((d) => {
      if (d.type !== "mgmt") return d;
      const newClusters = d.clusters.map((c, idx) => {
        if (idx !== 0) return c; // only update the default mgmt cluster
        return { ...c, infraStack: newStack };
      });
      return { ...d, clusters: newClusters };
    });
    onChange({ ...instance, deploymentProfile: profileKey, domains: newDomains });
  };

  // Toggle a site's membership in this instance. Caps at 2 sites. Handles
  // placement transitions and re-pins local-domain localSiteIds so they
  // always point at one of the instance's current sites (invariant).
  const toggleSite = (siteId) => {
    const current = instance.siteIds || [];
    let nextIds;
    if (current.includes(siteId)) {
      nextIds = current.filter((id) => id !== siteId);
    } else {
      if (current.length >= 2) return;
      nextIds = [...current, siteId];
    }
    const becameStretched = current.length < 2 && nextIds.length === 2;

    const nextDomains = instance.domains.map((d) => {
      if (nextIds.length < 2) {
        // No longer (or never) stretched — force every domain local and
        // pin to the first remaining site (or null if the instance is now
        // orphaned from all sites).
        return {
          ...d,
          placement: "local",
          localSiteId: nextIds[0] || null,
        };
      }
      // nextIds.length === 2 from here on.
      if (becameStretched && d.type === "mgmt") {
        // 1→2 transition: mgmt domain auto-stretches. localSiteId becomes
        // irrelevant (ignored for stretched placement).
        return {
          ...d,
          placement: "stretched",
          hostSplitPct: typeof d.hostSplitPct === "number" ? d.hostSplitPct : 50,
          localSiteId: null,
        };
      }
      if (d.placement === "local") {
        // Keep the pin if it still points at a valid site; otherwise fall
        // back to the first remaining site. This is the 2→2 case when one
        // site was swapped for another, or the 1→2 case for workload domains.
        const keep =
          d.localSiteId && nextIds.includes(d.localSiteId) ? d.localSiteId : nextIds[0];
        return { ...d, localSiteId: keep };
      }
      return d;
    });

    onChange({ ...instance, siteIds: nextIds, domains: nextDomains });
  };

  // Swap site order — flips siteIds[0]↔siteIds[1] AND complements every
  // stretched domain's hostSplitPct so the actual physical host distribution
  // is preserved (the swap is a relabeling, not a rebalance).
  const swapSites = () => {
    const ids = instance.siteIds || [];
    if (ids.length !== 2) return;
    const nextDomains = instance.domains.map((d) => {
      if (d.placement !== "stretched") return d;
      const pct = typeof d.hostSplitPct === "number" ? d.hostSplitPct : 50;
      return { ...d, hostSplitPct: 100 - pct };
    });
    onChange({ ...instance, siteIds: [ids[1], ids[0]], domains: nextDomains });
  };

  const updateWitnessSite = (patch) => {
    update({ witnessSite: { ...(instance.witnessSite || {}), ...patch } });
  };

  const currentProfile = DEPLOYMENT_PROFILES[instance.deploymentProfile] || DEPLOYMENT_PROFILES.ha;

  return (
    <div className="border-l-2 border-sky-300 pl-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-sky-700 font-mono font-semibold">
            ▾ VCF INSTANCE
          </span>
          <input
            value={instance.name}
            onChange={(e) => update({ name: e.target.value })}
            className="bg-transparent text-xl text-slate-800 font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-400 font-mono">
            {result.totalHosts} hosts · {fmt(result.totalCores)} cores · {instance.domains.length} domains
          </span>
          {canRemove && (
            <button
              onClick={onRemove}
              className="text-slate-400 hover:text-rose-600 text-[10px] uppercase tracking-wider px-2 py-0.5 border border-slate-200 rounded"
            >
              Remove Instance
            </button>
          )}
        </div>
      </div>

      {/* Deployment Profile Selector */}
      <div className="border border-sky-200 bg-sky-50 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-sky-800 font-mono font-semibold">
            Deployment Model
          </span>
          <span className="text-[9px] uppercase tracking-wider text-sky-600 font-mono">
            Per P&P Workbook deployment models
          </span>
        </div>
        <div className="flex gap-2 flex-wrap mb-3">
          {Object.entries(DEPLOYMENT_PROFILES).map(([key, profile]) => (
            <button
              key={key}
              onClick={() => applyProfile(key)}
              className={`text-[11px] font-mono px-3 py-1.5 rounded border transition-colors ${
                instance.deploymentProfile === key
                  ? "bg-sky-600 text-white border-sky-600"
                  : "bg-white text-slate-600 border-slate-200 hover:border-sky-400 hover:text-sky-700"
              }`}
            >
              {profile.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 font-mono leading-relaxed">
          {currentProfile.description}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-400">
          {currentProfile.stack.map((item) => {
            const def = APPLIANCE_DB[item.id];
            return def ? (
              <span key={item.id}>
                {def.label} <span className="text-slate-600">×{item.instances}</span>
              </span>
            ) : null;
          })}
        </div>
      </div>

      {/* Site Membership */}
      <div className="border border-slate-200 bg-white rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-slate-700 font-mono font-semibold">
            Sites this instance touches
          </span>
          {isStretchedInstance && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono">
                {siteById(instance.siteIds[0])?.name || "Site A"} ↔ {siteById(instance.siteIds[1])?.name || "Site B"}
              </span>
              <button
                onClick={swapSites}
                title="Swap site order — flips host-split direction without moving hosts"
                className="text-[9px] uppercase tracking-wider text-slate-400 hover:text-blue-600 border border-slate-200 hover:border-blue-400 rounded px-2 py-0.5 transition-colors font-mono"
              >
                ⇄ Swap
              </button>
            </div>
          )}
        </div>
        <p className="text-[10px] text-slate-500 font-mono mb-3 leading-relaxed">
          Select up to two sites. One site = single-site deployment. Two sites = stretched VCF
          instance with ONE shared appliance stack referenced by both sites.
        </p>
        {(allSites || []).length === 0 ? (
          <p className="text-[10px] text-rose-600 font-mono mb-3">
            Add a site to the fleet first.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 mb-3">
            {(allSites || []).map((s) => {
              const checked = (instance.siteIds || []).includes(s.id);
              const disabled = !checked && (instance.siteIds || []).length >= 2;
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded border text-[11px] font-mono ${
                    checked
                      ? "bg-blue-50 border-blue-300 text-slate-800"
                      : disabled
                        ? "bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed"
                        : "bg-white border-slate-200 text-slate-600 hover:border-blue-300 cursor-pointer"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleSite(s.id)}
                    className="accent-blue-600"
                  />
                  <span className="truncate">
                    {s.name}{s.location ? <span className="text-slate-400"> · {s.location}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {isStretchedInstance && (
          <>
            <p className="text-[10px] text-slate-500 font-mono leading-relaxed mb-3">
              Stretched VCF instances span two physical sites with synchronous storage replication.
              This can be achieved via vSAN stretched cluster (requires a witness host at a third
              fault domain) or array-based synchronous replication (FC/iSCSI with vendor-specific
              replication such as Dell SRDF, Pure ActiveCluster, or NetApp MetroCluster). Both
              methods require L2 network stretch via NSX. The instance has ONE shared appliance
              stack — not two.
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <TextField
                label="Witness Site Name"
                value={instance.witnessSite?.name || ""}
                onChange={(v) => updateWitnessSite({ name: v })}
                placeholder="e.g. Cloud Witness"
              />
              <TextField
                label="Witness Location"
                value={instance.witnessSite?.location || ""}
                onChange={(v) => updateWitnessSite({ location: v })}
                placeholder="e.g. Azure East US"
              />
            </div>

            {/* Witness Appliance Sizing */}
            {(() => {
              const stretchedDomains = instance.domains.filter((d) => d.placement === "stretched");
              const stretchedClusterCount = stretchedDomains.reduce((s, d) => s + d.clusters.length, 0);
              if (stretchedClusterCount === 0) return null;
              const wDef = APPLIANCE_DB.vsanWitness;
              const wSz = wDef?.sizes[instance.witnessSize || "Medium"] || wDef?.sizes.Medium;
              const totalWitnesses = stretchedClusterCount;
              const witnessEnabled = instance.witnessEnabled !== false; // default true

              return (
                <div className={`border rounded-lg mb-3 transition-colors ${witnessEnabled ? "border-yellow-300 bg-yellow-50" : "border-slate-200 bg-slate-50"}`}>
                  {/* Header with storage method toggle — always visible */}
                  <div className="flex items-center justify-between p-3 border-b border-current border-opacity-20">
                    <div className="flex items-center gap-3">
                      <span className={`text-[11px] uppercase tracking-[0.14em] font-mono font-semibold ${witnessEnabled ? "text-yellow-800" : "text-slate-600"}`}>
                        ⬦ Storage Replication Method
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => update({ witnessEnabled: true })}
                        className={`text-[10px] font-mono px-3 py-1 rounded border transition-colors ${witnessEnabled ? "bg-yellow-600 text-white border-yellow-600" : "bg-white text-slate-500 border-slate-300 hover:border-yellow-400"}`}
                      >
                        vSAN Stretched (witness req'd)
                      </button>
                      <button
                        onClick={() => update({ witnessEnabled: false })}
                        className={`text-[10px] font-mono px-3 py-1 rounded border transition-colors ${!witnessEnabled ? "bg-slate-600 text-white border-slate-600" : "bg-white text-slate-500 border-slate-300 hover:border-slate-400"}`}
                      >
                        Array-based (no witness)
                      </button>
                    </div>
                  </div>

                  {witnessEnabled && wSz ? (
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] uppercase tracking-[0.14em] text-yellow-800 font-mono font-semibold">
                          vSAN Witness Host Requirements
                        </span>
                        <span className="text-[10px] text-yellow-700 font-mono">
                          {totalWitnesses} witness{totalWitnesses !== 1 ? "es" : ""} needed · Deployed at {instance.witnessSite?.name || "witness site"}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-3 items-end mb-2">
                        <div>
                          <span className="block text-[10px] uppercase tracking-[0.14em] text-yellow-700 mb-1 font-medium font-mono">
                            Appliance Size
                          </span>
                          <select
                            value={instance.witnessSize || "Medium"}
                            onChange={(e) => update({ witnessSize: e.target.value })}
                            className="w-full bg-white border border-yellow-300 rounded px-2 py-1.5 text-slate-800 font-mono text-sm focus:outline-none focus:border-yellow-500"
                          >
                            {Object.entries(wDef.sizes).map(([k, v]) => (
                              <option key={k} value={k}>{k} — {v.note}</option>
                            ))}
                          </select>
                        </div>
                        <div className="text-center">
                          <span className="block text-[10px] text-yellow-700 font-mono mb-1">Per Witness</span>
                          <span className="text-sm font-mono text-yellow-900">{wSz.vcpu} vCPU · {wSz.ram} GB · {wSz.disk} GB</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[10px] text-yellow-700 font-mono mb-1">Count</span>
                          <span className="text-sm font-mono text-yellow-900">×{totalWitnesses}</span>
                        </div>
                        <div className="text-center">
                          <span className="block text-[10px] text-yellow-700 font-mono mb-1">Total at Witness Site</span>
                          <span className="text-sm font-mono text-yellow-900 font-semibold">
                            {wSz.vcpu * totalWitnesses} vCPU · {wSz.ram * totalWitnesses} GB · {wSz.disk * totalWitnesses} GB
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] text-yellow-700 font-mono">
                        {wDef.info}
                      </p>
                    </div>
                  ) : (
                    <div className="p-3">
                      <p className="text-[11px] text-slate-600 font-mono leading-relaxed">
                        <strong>Array-based synchronous replication selected.</strong> No vSAN witness host required —
                        quorum and failover are handled by the storage array (e.g. Dell PowerMax SRDF/Metro, Pure
                        ActiveCluster, NetApp MetroCluster, HPE Peer Persistence). Ensure your storage vendor's
                        active/active configuration is certified with VCF 9 and that VMFS datastores are presented
                        identically to hosts at both sites.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <span className="text-[10px] text-blue-800 font-mono font-semibold uppercase tracking-wider">
                Domain Placement
              </span>
              <p className="text-[10px] text-blue-700 font-mono mt-1">
                Each domain below can be set to <strong>Local</strong> (runs at one site only) or{" "}
                <strong>Stretched</strong> (spans both sites via synchronous storage replication).
                The management domain auto-stretched when you added the second site. Workload
                domains default to Local — toggle individually. The host-split slider on each
                stretched domain controls how many physical hosts land at {siteById(instance.siteIds[0])?.name || "Site A"} vs{" "}
                {siteById(instance.siteIds[1])?.name || "Site B"}.
              </p>
            </div>
          </>
        )}
      </div>

      {(() => {
        // Precompute context shared across every DomainCard in this instance:
        //
        //   defaultInstancesById — "HA default" instance counts per appliance,
        //     derived from the instance's deploymentProfile. Adding an nsxMgr
        //     to a WLD wldStack on an HA-profile instance should default to 3,
        //     not 1. Non-profile appliances fall back to 1 at StackPicker time.
        //
        //   injectedByClusterId — the authoritative "which cluster hosts which
        //     WLD appliances" map. This mirrors sizeInstance's extraByClusterId
        //     fallback logic so the UI cannot drift from the sizing math: both
        //     walk mgmt domain's first cluster if componentsClusterId is unset
        //     or invalid. Each injected entry carries the owning domain's id
        //     and name so ClusterCard can label it without walking the fleet.
        const profileStack =
          DEPLOYMENT_PROFILES[instance.deploymentProfile]?.stack || [];
        const defaultInstancesById = {};
        for (const entry of profileStack) {
          defaultInstancesById[entry.id] = entry.instances;
        }

        const mgmtDom = instance.domains.find((x) => x.type === "mgmt");
        const clusterById = {};
        for (const dom of instance.domains || []) {
          for (const c of dom.clusters || []) clusterById[c.id] = c;
        }
        const mgmtFirst = mgmtDom?.clusters?.[0];
        const injectedByClusterId = {};
        for (const dom of instance.domains || []) {
          if (dom.type !== "workload") continue;
          const wld = dom.wldStack || [];
          if (wld.length === 0) continue;
          const target = clusterById[dom.componentsClusterId] || mgmtFirst;
          if (!target) continue;
          injectedByClusterId[target.id] = [
            ...(injectedByClusterId[target.id] || []),
            ...wld.map((e) => ({
              ...e,
              ownerDomainId: e.ownerDomainId || dom.id,
              ownerDomainName: dom.name,
            })),
          ];
        }

        return instance.domains.map((d, i) => {
          // Workload domains can host their wldStack on any cluster in the
          // mgmt domain OR on any of their own clusters. Mgmt domains don't
          // render the picker so the eligible list is unused for them.
          const eligibleClusters =
            d.type === "workload"
              ? [
                  ...((mgmtDom?.clusters || []).map((c) => ({
                    id: c.id,
                    label: `${mgmtDom.name} / ${c.name}`,
                    scope: "mgmt",
                  }))),
                  ...((d.clusters || []).map((c) => ({
                    id: c.id,
                    label: `${d.name} / ${c.name}`,
                    scope: "wld",
                  }))),
                ]
              : [];
          return (
            <DomainCard
              key={d.id}
              domain={d}
              isStretched={isStretchedInstance}
              instanceSiteIds={instance.siteIds || []}
              allSites={allSites}
              eligibleClusters={eligibleClusters}
              defaultInstancesById={defaultInstancesById}
              injectedByClusterId={injectedByClusterId}
              onChange={(next) => updateDomain(i, next)}
              onRemove={() => removeDomain(i)}
              canRemove={d.type !== "mgmt"}
              result={result.domainResults[i]}
            />
          );
        });
      })()}

      <button
        onClick={addWorkloadDomain}
        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-rose-600 border border-dashed border-slate-200 hover:border-rose-400 rounded px-3 py-1.5 transition-colors"
      >
        + Add Workload Domain
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SITES PANEL — flat CRUD for fleet.sites with referential-integrity guard
// ─────────────────────────────────────────────────────────────────────────────
function SitesPanel({ fleet, onChange }) {
  const updateSite = (idx, patch) => {
    onChange({
      ...fleet,
      sites: fleet.sites.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };
  const addSite = () => {
    onChange({
      ...fleet,
      sites: [...fleet.sites, newSite(`Site ${fleet.sites.length + 1}`)],
    });
  };
  const removeSite = (idx) => {
    const target = fleet.sites[idx];
    const blockers = fleet.instances.filter((inst) => (inst.siteIds || []).includes(target.id));
    if (blockers.length > 0) {
      alert(
        `Cannot delete "${target.name}" — referenced by ${blockers.length} instance${blockers.length === 1 ? "" : "s"}: ${blockers.map((i) => i.name).join(", ")}.\n\nUntick this site from those instances first.`
      );
      return;
    }
    onChange({ ...fleet, sites: fleet.sites.filter((_, i) => i !== idx) });
  };

  return (
    <div className="border border-slate-200 bg-white shadow-sm rounded-lg p-5 mb-5">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-2 mb-4">
        <h2 className="font-serif text-2xl text-slate-900">Sites</h2>
        <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600 font-mono">
          {fleet.sites.length} site{fleet.sites.length === 1 ? "" : "s"} · physical locations only
        </span>
      </div>
      <p className="text-[11px] text-slate-500 font-mono mb-4 leading-relaxed">
        Sites are pure location metadata. VCF instances reference sites by id and can
        span two sites (stretched). Delete is blocked while any instance still references a site.
      </p>
      {fleet.sites.length === 0 ? (
        <p className="text-[11px] text-slate-400 font-mono mb-3">
          No sites yet. Add at least one site before placing VCF instances.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {fleet.sites.map((s, i) => {
            const refCount = fleet.instances.filter((inst) => (inst.siteIds || []).includes(s.id)).length;
            return (
              <div key={s.id} className="flex items-center gap-3 border border-slate-200 rounded px-3 py-2">
                <span className="text-[11px] uppercase tracking-[0.16em] text-blue-600 font-mono font-semibold">
                  ◼
                </span>
                <input
                  value={s.name}
                  onChange={(e) => updateSite(i, { name: e.target.value })}
                  className="flex-1 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none text-base font-serif text-slate-800 px-1 py-0.5"
                  placeholder="Site name"
                />
                <input
                  value={s.location || ""}
                  onChange={(e) => updateSite(i, { location: e.target.value })}
                  className="flex-1 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-blue-500 focus:outline-none text-sm font-mono text-slate-500 px-1 py-0.5"
                  placeholder="Location (e.g. Dallas, TX)"
                />
                <span className="text-[10px] text-slate-400 font-mono w-28 text-right">
                  {refCount} instance{refCount === 1 ? "" : "s"}
                </span>
                <button
                  onClick={() => removeSite(i)}
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 border rounded ${
                    refCount > 0
                      ? "text-slate-300 border-slate-200 cursor-help"
                      : "text-slate-400 hover:text-rose-600 border-slate-200 hover:border-rose-300"
                  }`}
                  title={refCount > 0 ? `Referenced by ${refCount} instance(s) — untick this site from those instances first` : "Delete site"}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={addSite}
        className="w-full border border-dashed border-slate-200 hover:border-blue-400 hover:text-blue-600 text-slate-400 rounded py-2 transition-colors text-[11px] uppercase tracking-[0.18em] font-mono"
      >
        + Add Site
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCES PANEL — flat list of fleet.instances, each rendered once
// regardless of how many sites it touches (the v5 fix)
// ─────────────────────────────────────────────────────────────────────────────
function InstancesPanel({ fleet, fleetResult, onChange }) {
  const updateInstance = (idx, next) => {
    onChange({
      ...fleet,
      instances: fleet.instances.map((inst, i) => (i === idx ? next : inst)),
    });
  };
  const addInstance = () => {
    const defaultSiteIds = fleet.sites.length > 0 ? [fleet.sites[0].id] : [];
    onChange({
      ...fleet,
      instances: [
        ...fleet.instances,
        newInstance(`vcf-instance-${fleet.instances.length + 1}`, defaultSiteIds),
      ],
    });
  };
  const removeInstance = (idx) => {
    onChange({ ...fleet, instances: fleet.instances.filter((_, i) => i !== idx) });
  };

  return (
    <div className="border border-slate-200 bg-white shadow-sm rounded-lg p-5 mb-5">
      <div className="flex items-baseline justify-between border-b border-slate-200 pb-2 mb-4">
        <h2 className="font-serif text-2xl text-slate-900">VCF Instances</h2>
        <span className="text-[10px] uppercase tracking-[0.2em] text-sky-700 font-mono">
          {fleet.instances.length} instance{fleet.instances.length === 1 ? "" : "s"} · appliance stacks + domains
        </span>
      </div>
      {fleet.instances.length === 0 && (
        <p className="text-[11px] text-slate-400 font-mono mb-3">
          No instances yet. Add a VCF instance to start placing domains and clusters.
        </p>
      )}
      {fleet.instances.map((inst, i) => (
        <InstanceCard
          key={inst.id}
          instance={inst}
          allSites={fleet.sites}
          onChange={(next) => updateInstance(i, next)}
          onRemove={() => removeInstance(i)}
          canRemove={fleet.instances.length > 1}
          result={fleetResult.instanceResults[i]}
        />
      ))}
      <button
        onClick={addInstance}
        className="text-[10px] font-mono uppercase tracking-wider text-slate-400 hover:text-sky-700 border border-dashed border-slate-200 hover:border-sky-400 rounded px-3 py-1.5 transition-colors"
      >
        + Add VCF Instance
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPOLOGY VIEW — auto-generated SVG diagram of the entire fleet
// Layout: horizontal tree, left-to-right. Columns are hierarchy levels.
// Each leaf cluster gets its own row; internal nodes are vertically centered
// over their children.
// ─────────────────────────────────────────────────────────────────────────────
function TopologyView({ fleet, fleetResult, setFleet }) {
  const [topoView, setTopoView] = useState("logical");
  const [showMermaid, setShowMermaid] = useState(false);
  const [mermaidCopied, setMermaidCopied] = useState(false);

  const logicalLayout = useMemo(() => {
    try {
      return computeTopologyLayout(fleet, fleetResult);
    } catch (err) {
      console.error("Topology layout error:", err);
      return { boxes: [], connectors: [], stretchedConnectors: [], width: 400, height: 100, _error: err.message };
    }
  }, [fleet, fleetResult]);

  const physicalLayout = useMemo(() => {
    try {
      return computePhysicalLayout(fleet, fleetResult);
    } catch (err) {
      console.error("Physical layout error:", err);
      return { sites: [], stretchedBands: [], witnesses: [], width: 400, height: 100, _error: err.message };
    }
  }, [fleet, fleetResult]);

  const activeLayout = topoView === "logical" ? logicalLayout : physicalLayout;

  const exportDrawio = () => {
    const xml = generateDrawioXml(activeLayout, topoView);
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(xml, `vcf-topology-${topoView}-${date}.drawio`, "application/xml");
  };

  const handleCopyMermaid = () => {
    const code = generateMermaidCode(activeLayout, topoView);
    navigator.clipboard.writeText(code).then(() => {
      setMermaidCopied(true);
      setTimeout(() => setMermaidCopied(false), 2000);
    });
  };

  if (logicalLayout._error && topoView === "logical") {
    return (
      <div className="border border-rose-300 bg-rose-50 rounded-lg p-5">
        <h2 className="font-serif text-xl text-rose-900 mb-2">Topology rendering error</h2>
        <p className="text-sm text-rose-700 font-mono">{logicalLayout._error}</p>
        <p className="text-xs text-rose-600 font-mono mt-2">
          Check the browser console for details. This usually indicates a stretched-cluster
          configuration referencing a site that no longer exists, or a domain missing required fields.
        </p>
      </div>
    );
  }

  const SubTabBtn = ({ value, children }) => (
    <button
      onClick={() => setTopoView(value)}
      className={`text-[10px] uppercase tracking-wider font-mono px-3 py-1.5 rounded border ${
        topoView === value
          ? "bg-blue-600 text-white border-blue-600"
          : "text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600"
      }`}
    >{children}</button>
  );

  return (
    <div className="border border-blue-200 bg-white rounded-lg p-5">
      <div className="flex items-center justify-between border-b border-blue-200 pb-2 mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl text-slate-900">Fleet Topology</h2>
          <div className="flex gap-1">
            <SubTabBtn value="logical">Logical</SubTabBtn>
            <SubTabBtn value="physical">Physical</SubTabBtn>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportDrawio}
            className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5">
            Export draw.io
          </button>
          <button onClick={() => setShowMermaid(true)}
            className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5">
            Copy Mermaid
          </button>
        </div>
      </div>

      {topoView === "logical" ? (
        <>
          <div className="overflow-auto bg-slate-50 rounded border border-slate-200 p-4">
            <svg
              width={logicalLayout.width}
              height={logicalLayout.height}
              xmlns="http://www.w3.org/2000/svg"
              style={{ minWidth: "100%" }}
            >
              {logicalLayout.connectors.map((conn, i) => (
                <TopologyConnector key={`c-${i}`} from={conn.from} to={conn.to} />
              ))}
              {(logicalLayout.stretchedConnectors || []).map((conn, i) => (
                <TopologyConnector key={`sc-${i}`} from={conn.from} to={conn.to} dashed />
              ))}
              {logicalLayout.boxes.map((box) => (
                <TopologyBox key={box.id} box={box} />
              ))}
            </svg>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-mono text-slate-400">
            <LegendChip color="#2563eb" label="Fleet" />
            <LegendChip color="#475569" label="Site" />
            <LegendChip color="#0284c7" label="VCF Instance" />
            <LegendChip color="#7c3aed" label="Mgmt Domain" />
            <LegendChip color="#e11d48" label="Workload Domain" />
            <LegendChip color="#16a34a" label="Cluster" />
            <LegendChip color="#ca8a04" label="Witness (vSAN)" />
            <span className="flex items-center gap-1.5">
              <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>Stretched</span>
            </span>
          </div>
        </>
      ) : (
        <>
          <PhysicalTopologyView fleet={fleet} fleetResult={fleetResult} setFleet={setFleet} />
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-mono text-slate-400">
            <LegendChip color="#475569" label="Site" />
            <LegendChip color="#7c3aed" label="Mgmt Domain" />
            <LegendChip color="#e11d48" label="Workload Domain" />
            <LegendChip color="#16a34a" label="Cluster" />
            <LegendChip color="#64748b" label="Appliance" />
            <LegendChip color="#ca8a04" label="Witness" />
            <span className="flex items-center gap-1.5">
              <svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="4 2" /></svg>
              <span>Stretched</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-flex gap-0.5">
                <span className="w-2 h-2 rounded-full bg-green-600"></span>
                <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                <span className="w-2 h-2 rounded-full bg-red-600"></span>
              </span>
              <span>Failover</span>
            </span>
          </div>
        </>
      )}

      {/* Mermaid code modal */}
      {showMermaid && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowMermaid(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="font-serif text-lg text-slate-900">
                Mermaid Diagram Code ({topoView === "logical" ? "Logical" : "Physical"})
              </h3>
              <button onClick={() => setShowMermaid(false)}
                className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
              <textarea readOnly
                value={generateMermaidCode(activeLayout, topoView)}
                className="w-full h-64 font-mono text-xs bg-slate-50 border border-slate-200 rounded p-3 resize-none"
              />
              <p className="text-xs text-slate-400 mt-2 font-mono">
                Paste into mermaid.live or a GitHub markdown block to render the diagram.
              </p>
            </div>
            <div className="border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button onClick={handleCopyMermaid}
                className="text-[10px] uppercase tracking-wider font-mono text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-2">
                {mermaidCopied ? "Copied!" : "Copy to Clipboard"}
              </button>
              <button onClick={() => setShowMermaid(false)}
                className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-slate-400 rounded px-4 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendChip({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{ background: color }}
      />
      <span>{label}</span>
    </div>
  );
}

const TOPOLOGY_COLORS = {
  fleet:     { fill: "#eff6ff", stroke: "#2563eb", text: "#1e3a5f" },
  site:      { fill: "#f8fafc", stroke: "#475569", text: "#1e3a5f" },
  instance:  { fill: "#f0f9ff", stroke: "#0284c7", text: "#0c4a6e" },
  mgmt:      { fill: "#f5f3ff", stroke: "#7c3aed", text: "#4c1d95" },
  workload:  { fill: "#fff1f2", stroke: "#e11d48", text: "#881337" },
  cluster:   { fill: "#f0fdf4", stroke: "#16a34a", text: "#14532d" },
  witness:   { fill: "#fefce8", stroke: "#ca8a04", text: "#713f12" },
  appliance: { fill: "#f0f9ff", stroke: "#64748b", text: "#334155" },
};

function TopologyBox({ box }) {
  const c = TOPOLOGY_COLORS[box.kind] || TOPOLOGY_COLORS.cluster;

  // Witness boxes are smaller and simpler
  if (box.kind === "witness") {
    return (
      <g>
        <rect
          x={box.x} y={box.y} width={box.width} height={box.height}
          rx={3} fill={c.fill} stroke={c.stroke} strokeWidth={1} strokeDasharray="4 2"
        />
        <text x={box.x + 8} y={box.y + 18} fontFamily="IBM Plex Mono, monospace"
          fontSize={9} fill={c.text} fontWeight="500">
          {truncate(box.label, 34)}
        </text>
      </g>
    );
  }

  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={4}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={1.5}
      />
      <text
        x={box.x + 10}
        y={box.y + 22}
        fontFamily="Inter, system-ui, sans-serif"
        fontSize={14}
        fontWeight="600"
        fill={c.text}
      >
        {truncate(box.label, 30)}
      </text>
      {box.subtitle && (
        <text
          x={box.x + 10}
          y={box.y + 42}
          fontFamily="IBM Plex Mono, monospace"
          fontSize={10}
          fill={c.text}
          opacity={0.7}
        >
          {box.subtitle}
        </text>
      )}
      {box.subtitle2 && (
        <text
          x={box.x + 10}
          y={box.y + 56}
          fontFamily="IBM Plex Mono, monospace"
          fontSize={9}
          fill={c.text}
          opacity={0.55}
        >
          {box.subtitle2}
        </text>
      )}
    </g>
  );
}

function TopologyConnector({ from, to, dashed }) {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const midX = (x1 + x2) / 2;
  const path = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

  return (
    <path
      d={path}
      stroke={dashed ? "#2563eb" : "#94a3b8"}
      strokeWidth={dashed ? 1.8 : 1.2}
      strokeDasharray={dashed ? "6 3" : "none"}
      fill="none"
    />
  );
}

function truncate(s, n) {
  return s && s.length > n ? s.slice(0, n - 1) + "…" : s || "";
}

// Topology layout — v5 model. Sites and instances are sibling top-level
// arrays; an instance can reference 1 or 2 sites. The visual is left-to-right
// in four columns:
//
//   col 0: Sites          (each at the y-midpoint of its referencing instances)
//   col 1: Instances      (each at the y-midpoint of its domains)
//   col 2: Domains        (each at the y-midpoint of its clusters)
//   col 3: Clusters       (leaves — each on its own row)
//
// Connectors:
//   solid grey  : domain→cluster, instance→domain, and site→instance for siteIds[0]
//   dashed blue : second site→instance for siteIds[1] (the stretched edge)
//
// Witness boxes are collected during the main loop into a separate array and
// appended after iteration completes — never mutate `boxes` while a forEach
// is walking it.
function computeTopologyLayout(fleet, fleetResult) {
  const COL_WIDTH = 240;
  const COL_GAP = 60;
  const BOX_HEIGHT = 78;
  const ROW_GAP = 14;
  const PADDING = 30;

  const SITE_COL = 0;
  const INST_COL = 1;
  const DOM_COL  = 2;
  const CLU_COL  = 3;
  const colX = (col) => PADDING + col * (COL_WIDTH + COL_GAP);

  const boxes = [];
  const connectors = [];
  const stretchedConnectors = [];
  const witnessBoxes = [];

  // Step 1: stub site boxes in col 0. Their y is filled in once instances
  // have been laid out (a site sits at the midpoint of its referencing
  // instances). Sites with no referencing instances (orphans) get appended
  // at the bottom in step 3.
  const siteBoxes = {};
  fleet.sites.forEach((site) => {
    const box = {
      id: site.id,
      x: colX(SITE_COL),
      y: 0,
      width: COL_WIDTH,
      height: BOX_HEIGHT,
      kind: "site",
      label: site.name,
      subtitle: site.location || "",
      subtitle2: null,
    };
    siteBoxes[site.id] = box;
    boxes.push(box);
  });

  // Step 2: lay out instances, their domains, and their clusters. Cluster
  // rows drive a global currentRow counter; domains and instances are
  // y-centered over their children.
  let currentRow = 0;
  const instanceBoxes = [];

  fleet.instances.forEach((inst, iIdx) => {
    const ir = fleetResult.instanceResults[iIdx];
    if (!ir) return;
    const isStretched = (inst.siteIds || []).length === 2;
    const profileLabel = DEPLOYMENT_PROFILES[inst.deploymentProfile]?.label || "Custom";

    const domBoxes = [];
    inst.domains.forEach((dom, dIdx) => {
      const dr = ir.domainResults[dIdx];
      if (!dr) return;
      const cluBoxes = [];
      dom.clusters.forEach((clu, cIdx) => {
        const cr = dr.clusterResults[cIdx];
        if (!cr) return;
        const y = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
        currentRow++;
        const cluBox = {
          id: clu.id,
          x: colX(CLU_COL),
          y,
          width: COL_WIDTH,
          height: BOX_HEIGHT,
          kind: "cluster",
          label: clu.name,
          subtitle: `${cr.finalHosts} hosts · ${fmt(cr.licensedCores)} cores`,
          subtitle2: `Limit: ${cr.limiter}`,
        };
        boxes.push(cluBox);
        cluBoxes.push(cluBox);
      });
      // Domain box vertically centered over its clusters; if no clusters,
      // give it its own row so it doesn't collapse to y=0.
      let domY;
      if (cluBoxes.length > 0) {
        const minY = cluBoxes[0].y;
        const maxY = cluBoxes[cluBoxes.length - 1].y + BOX_HEIGHT;
        domY = (minY + maxY) / 2 - BOX_HEIGHT / 2;
      } else {
        domY = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
        currentRow++;
      }
      const stretchedTag = isStretched && dom.placement === "stretched" ? "↔ Stretched · " : "";
      const domBox = {
        id: dom.id,
        x: colX(DOM_COL),
        y: domY,
        width: COL_WIDTH,
        height: BOX_HEIGHT,
        kind: dom.type === "mgmt" ? "mgmt" : "workload",
        label: dom.name,
        subtitle: `${dr.totalHosts} hosts · ${fmt(dr.totalCores)} cores`,
        subtitle2: `${stretchedTag}${dom.clusters.length} cluster${dom.clusters.length === 1 ? "" : "s"}`,
      };
      boxes.push(domBox);
      cluBoxes.forEach((cb) => connectors.push({ from: domBox, to: cb }));
      domBoxes.push(domBox);
    });

    // Instance box vertically centered over its domains.
    let instY;
    if (domBoxes.length > 0) {
      const minY = domBoxes[0].y;
      const maxY = domBoxes[domBoxes.length - 1].y + BOX_HEIGHT;
      instY = (minY + maxY) / 2 - BOX_HEIGHT / 2;
    } else {
      instY = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
      currentRow++;
    }
    const instBox = {
      id: inst.id,
      x: colX(INST_COL),
      y: instY,
      width: COL_WIDTH,
      height: BOX_HEIGHT,
      kind: "instance",
      label: inst.name,
      subtitle: `${ir.totalHosts} hosts · ${fmt(ir.totalCores)} cores`,
      subtitle2: `${profileLabel}${isStretched ? " · ↔ Stretched" : ""} · ${inst.domains.length} dom`,
    };
    boxes.push(instBox);
    domBoxes.forEach((db) => connectors.push({ from: instBox, to: db }));
    instanceBoxes.push({ instBox, inst });

    // Witness box collected separately — appended after the main loop.
    if (isStretched && inst.witnessEnabled !== false && inst.witnessSite?.name) {
      witnessBoxes.push({
        id: `witness-${inst.id}`,
        x: colX(INST_COL),
        y: instY + BOX_HEIGHT + 6,
        width: COL_WIDTH,
        height: 28,
        kind: "witness",
        label: `⬦ Witness: ${inst.witnessSite.name}`,
        subtitle: null,
        subtitle2: null,
      });
    }
  });

  // Step 3: position site boxes at the y-midpoint of their referencing
  // instance boxes. Orphan sites (no referencing instances) append at the
  // bottom on their own rows.
  fleet.sites.forEach((site) => {
    const refs = instanceBoxes.filter(({ inst }) => (inst.siteIds || []).includes(site.id));
    const sBox = siteBoxes[site.id];
    if (refs.length === 0) {
      sBox.y = PADDING + currentRow * (BOX_HEIGHT + ROW_GAP);
      currentRow++;
    } else {
      const minY = Math.min(...refs.map((r) => r.instBox.y));
      const maxY = Math.max(...refs.map((r) => r.instBox.y + BOX_HEIGHT));
      sBox.y = (minY + maxY) / 2 - BOX_HEIGHT / 2;
    }
    const refCount = refs.length;
    sBox.subtitle2 = `${refCount} instance${refCount === 1 ? "" : "s"}`;
  });

  // Step 4: build site→instance connectors. Solid for siteIds[0], dashed
  // blue for siteIds[1]. Skip silently if a referenced site no longer exists.
  instanceBoxes.forEach(({ instBox, inst }) => {
    const ids = inst.siteIds || [];
    if (ids[0] && siteBoxes[ids[0]]) {
      connectors.push({ from: siteBoxes[ids[0]], to: instBox });
    }
    if (ids[1] && siteBoxes[ids[1]]) {
      stretchedConnectors.push({ from: siteBoxes[ids[1]], to: instBox, dashed: true });
    }
  });

  // Step 5: append witness boxes once the main iteration is complete.
  witnessBoxes.forEach((wb) => boxes.push(wb));
  if (witnessBoxes.length > 0) {
    currentRow += witnessBoxes.length * 0.5;
  }

  // Step 6: defensive — strip back-refs that earlier versions stashed onto
  // boxes. The new layout doesn't add any, but a stale `_instanceData` /
  // `_siteId` would bloat React's serialized state and confuse anyone
  // inspecting the layout.
  boxes.forEach((b) => { delete b._instanceData; delete b._siteId; });

  const totalWidth = PADDING * 2 + 4 * COL_WIDTH + 3 * COL_GAP;
  const totalHeight = Math.max(PADDING * 2 + currentRow * (BOX_HEIGHT + ROW_GAP), 200);

  return { boxes, connectors, stretchedConnectors, width: totalWidth, height: totalHeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function escapeXml(s) {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeMermaidId(s) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "_");
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL (SITE-CENTRIC) TOPOLOGY LAYOUT
//
// Produces a nested container layout: sites as large rectangles containing
// their domains and clusters, with appliance icons inside each cluster.
// Stretched domains appear in both site containers connected by dashed bands.
// ─────────────────────────────────────────────────────────────────────────────
const PHYS_SITE_PAD = 24;
const PHYS_DOMAIN_PAD = 16;
const PHYS_CLUSTER_PAD = 12;
const PHYS_SITE_GAP = 140;
const PHYS_DOMAIN_GAP = 14;
const PHYS_CLUSTER_GAP = 10;
const PHYS_APPLIANCE_W = 280;
const PHYS_APPLIANCE_H = 24;
const PHYS_APPLIANCE_GAP = 3;
const PHYS_APPLIANCE_COLS = 1;
const PHYS_CLUSTER_HEADER_H = 52;
const PHYS_DOMAIN_HEADER_H = 30;
const PHYS_SITE_HEADER_H = 36;
const PHYS_HOST_BADGE_H = 22;
const PHYS_CANVAS_PAD = 30;

function computePhysicalLayout(fleet, fleetResult) {

  const sites = [];
  const stretchedBands = [];
  const witnesses = [];

  // Build lookup maps
  const siteById = {};
  fleet.sites.forEach((s) => { siteById[s.id] = s; });

  // For each site, collect domains that belong to it (local domains pinned here,
  // plus stretched domains from instances touching this site).
  const siteDomains = {};
  fleet.sites.forEach((s) => { siteDomains[s.id] = []; });

  // Track stretched domain pairs to draw bands later
  const stretchedPairs = [];

  fleet.instances.forEach((inst, iIdx) => {
    const ir = fleetResult.instanceResults[iIdx];
    if (!ir) return;
    const isStretched = (inst.siteIds || []).length === 2;

    inst.domains.forEach((dom, dIdx) => {
      const dr = ir.domainResults[dIdx];
      if (!dr) return;

      if (isStretched && dom.placement === "stretched") {
        // Stretched domain appears in both sites
        inst.siteIds.forEach((sId) => {
          if (siteDomains[sId]) {
            const pct = typeof dom.hostSplitPct === "number" ? dom.hostSplitPct : 50;
            const sharePct = sId === inst.siteIds[0] ? pct : 100 - pct;
            siteDomains[sId].push({ dom, dr, inst, ir, sharePct, stretched: true });
          }
        });
        stretchedPairs.push({ domId: dom.id, siteIds: inst.siteIds, dom, hostSplitPct: dom.hostSplitPct });
      } else {
        // Local domain — pinned to localSiteId or siteIds[0]
        const targetSite = dom.localSiteId && inst.siteIds.includes(dom.localSiteId)
          ? dom.localSiteId : inst.siteIds[0];
        if (siteDomains[targetSite]) {
          siteDomains[targetSite].push({ dom, dr, inst, ir, sharePct: 100, stretched: false });
        }
      }
    });

    // Collect witness
    if (isStretched && inst.witnessEnabled !== false && inst.witnessSite?.name && ir.witness) {
      witnesses.push({
        id: `witness-${inst.id}`,
        label: `Witness: ${inst.witnessSite.name}`,
        size: inst.witnessSize || "Medium",
        instanceName: inst.name,
        siteIds: inst.siteIds,
        vcpu: ir.witness.vcpu,
        ram: ir.witness.ram,
        instances: ir.witness.instances,
      });
    }
  });

  // Lay out each site
  let siteX = PHYS_CANVAS_PAD;

  fleet.sites.forEach((site) => {
    const entries = siteDomains[site.id] || [];
    let innerY = PHYS_SITE_PAD + PHYS_SITE_HEADER_H;
    const domainLayouts = [];

    entries.forEach((entry) => {
      const { dom, dr, inst, sharePct, stretched } = entry;
      const placement = stretched ? ensurePlacement(inst) : {};
      let clusterInnerY = PHYS_DOMAIN_PAD + PHYS_DOMAIN_HEADER_H;
      const clusterLayouts = [];

      dom.clusters.forEach((clu, cIdx) => {
        const cr = dr.clusterResults[cIdx];
        if (!cr) return;

        // Collect appliances for this cluster, split by site placement
        const appliances = (clu.infraStack || []).map((item) => {
          const def = APPLIANCE_DB[item.id];
          const sz = def?.sizes?.[item.size] || { vcpu: 0, ram: 0, disk: 0 };
          const totalCount = item.instances || 1;
          // For stretched domains, count only VMs assigned to this site
          let countHere = totalCount;
          if (stretched && placement[item.key]) {
            countHere = placement[item.key].filter((sid) => sid === site.id).length;
          }
          if (countHere === 0) return null;
          return {
            id: item.id,
            key: item.key,
            instId: inst.id,
            label: def?.label || item.id,
            size: item.size,
            count: countHere,
            totalCount,
            vcpu: sz.vcpu * countHere,
            ram: sz.ram * countHere,
            disk: sz.disk * countHere,
            canMove: stretched && totalCount > 1,
          };
        }).filter(Boolean);

        // Calculate cluster box height
        const applianceRows = Math.ceil(appliances.length / PHYS_APPLIANCE_COLS);
        const applianceBlockH = applianceRows > 0
          ? applianceRows * (PHYS_APPLIANCE_H + PHYS_APPLIANCE_GAP) + 4
          : 0;
        const clusterH = PHYS_CLUSTER_HEADER_H + PHYS_HOST_BADGE_H + applianceBlockH + PHYS_CLUSTER_PAD;

        // Compute host count at this site for stretched clusters
        const full = cr.finalHosts || 0;
        let hostsHere = full;
        if (stretched) {
          const pct = typeof dom.hostSplitPct === "number" ? dom.hostSplitPct : 50;
          const primaryHosts = Math.ceil(full * (pct / 100));
          hostsHere = sharePct === pct ? primaryHosts : full - primaryHosts;
        }

        clusterLayouts.push({
          id: clu.id,
          name: clu.name,
          relY: clusterInnerY,
          height: clusterH,
          hostCount: hostsHere,
          totalHosts: full,
          cores: cr.licensedCores,
          rawTib: cr.rawTib,
          limiter: cr.limiter,
          failover: cr.failover,
          appliances,
        });

        clusterInnerY += clusterH + PHYS_CLUSTER_GAP;
      });

      const domainH = clusterInnerY + PHYS_DOMAIN_PAD - PHYS_CLUSTER_GAP;

      domainLayouts.push({
        id: dom.id,
        name: dom.name,
        type: dom.type,
        placement: stretched ? "stretched" : "local",
        sharePct,
        relY: innerY,
        height: domainH,
        clusters: clusterLayouts,
      });

      innerY += domainH + PHYS_DOMAIN_GAP;
    });

    const siteH = innerY + PHYS_SITE_PAD - PHYS_DOMAIN_GAP;

    // Compute widths: cluster content width drives everything
    const clusterContentW = PHYS_CLUSTER_PAD * 2 + PHYS_APPLIANCE_COLS * (PHYS_APPLIANCE_W + PHYS_APPLIANCE_GAP);
    const domainW = PHYS_DOMAIN_PAD * 2 + clusterContentW;
    const siteW = PHYS_SITE_PAD * 2 + domainW;

    // Position clusters and domains absolutely
    const domainsFinal = domainLayouts.map((dl) => ({
      ...dl,
      x: siteX + PHYS_SITE_PAD,
      y: dl.relY,
      width: domainW,
      clusters: dl.clusters.map((cl) => ({
        ...cl,
        x: siteX + PHYS_SITE_PAD + PHYS_DOMAIN_PAD,
        y: dl.relY + cl.relY,
        width: clusterContentW,
      })),
    }));

    sites.push({
      id: site.id,
      name: site.name,
      location: site.location || "",
      x: siteX,
      y: PHYS_CANVAS_PAD,
      width: siteW,
      height: Math.max(siteH, 120),
      domains: domainsFinal,
    });

    siteX += siteW + PHYS_SITE_GAP;
  });

  // Normalize: all sites same height, and matched stretched domains/clusters
  // share the same height so the layout is balanced across sites.
  if (sites.length > 1) {
    // Equalize matched domain heights across sites
    const domIds = new Set();
    sites.forEach((s) => s.domains.forEach((d) => domIds.add(d.id)));
    for (const did of domIds) {
      const matches = sites.flatMap((s) => s.domains.filter((d) => d.id === did));
      if (matches.length > 1) {
        // Equalize matched cluster heights first
        const maxClusters = Math.max(...matches.map((d) => d.clusters.length));
        for (let ci = 0; ci < maxClusters; ci++) {
          const cluMatches = matches.map((d) => d.clusters[ci]).filter(Boolean);
          if (cluMatches.length > 1) {
            const maxCH = Math.max(...cluMatches.map((c) => c.height));
            cluMatches.forEach((c) => { c.height = maxCH; });
          }
        }
        // Recalc domain height from equalized clusters
        matches.forEach((d) => {
          let cy = PHYS_DOMAIN_PAD + PHYS_DOMAIN_HEADER_H;
          d.clusters.forEach((c) => { c.relY = cy; cy += c.height + PHYS_CLUSTER_GAP; });
          d.height = cy + PHYS_DOMAIN_PAD - PHYS_CLUSTER_GAP;
        });
        const maxDH = Math.max(...matches.map((d) => d.height));
        matches.forEach((d) => { d.height = maxDH; });
      }
    }

    // Re-flow domain y positions within each site after height equalization
    sites.forEach((s) => {
      let dy = PHYS_SITE_PAD + PHYS_SITE_HEADER_H;
      s.domains.forEach((d) => {
        d.y = dy;
        // Update absolute cluster positions
        d.clusters.forEach((c) => {
          c.y = dy + c.relY;
        });
        dy += d.height + PHYS_DOMAIN_GAP;
      });
      s.height = Math.max(dy + PHYS_SITE_PAD - PHYS_DOMAIN_GAP, 120);
    });

    // Equalize site heights
    const maxH = Math.max(...sites.map((s) => s.height));
    sites.forEach((s) => { s.height = maxH; });
  }

  // Build stretched bands connecting matching domains across sites
  stretchedPairs.forEach((pair) => {
    const s0 = sites.find((s) => s.id === pair.siteIds[0]);
    const s1 = sites.find((s) => s.id === pair.siteIds[1]);
    if (!s0 || !s1) return;
    const d0 = s0.domains.find((d) => d.id === pair.domId);
    const d1 = s1.domains.find((d) => d.id === pair.domId);
    if (!d0 || !d1) return;
    const pct = typeof pair.hostSplitPct === "number" ? pair.hostSplitPct : 50;
    stretchedBands.push({
      domainId: pair.domId,
      label: `Stretched ${pct}/${100 - pct}`,
      from: { x: s0.x + s0.width, y: PHYS_CANVAS_PAD + d0.y + d0.height / 2 },
      to: { x: s1.x, y: PHYS_CANVAS_PAD + d1.y + d1.height / 2 },
    });
  });

  // Position witnesses below the sites
  const maxSiteBottom = Math.max(...sites.map((s) => s.y + s.height), 200);
  witnesses.forEach((w, i) => {
    w.x = PHYS_CANVAS_PAD + i * 280;
    w.y = maxSiteBottom + 30;
    w.width = 260;
    w.height = 50;
  });

  const totalWidth = Math.max(
    siteX - PHYS_SITE_GAP + PHYS_CANVAS_PAD,
    witnesses.length * 280 + PHYS_CANVAS_PAD * 2,
    400
  );
  const witnessBottom = witnesses.length > 0 ? witnesses[0].y + witnesses[0].height + PHYS_CANVAS_PAD : 0;
  const totalHeight = Math.max(maxSiteBottom + PHYS_CANVAS_PAD, witnessBottom, 200);

  return { sites, stretchedBands, witnesses, width: totalWidth, height: totalHeight };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL TOPOLOGY SVG COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function PhysicalTopologyView({ fleet, fleetResult, setFleet }) {
  const layout = useMemo(() => {
    try {
      return computePhysicalLayout(fleet, fleetResult);
    } catch (err) {
      console.error("Physical layout error:", err);
      return { sites: [], stretchedBands: [], witnesses: [], width: 400, height: 100, _error: err.message };
    }
  }, [fleet, fleetResult]);

  // Move one VM of an appliance from the current site to the other site
  const moveAppliance = (instId, appKey, fromSiteId) => {
    setFleet((prev) => ({
      ...prev,
      instances: prev.instances.map((inst) => {
        if (inst.id !== instId) return inst;
        if ((inst.siteIds || []).length < 2) return inst;
        const otherSite = inst.siteIds.find((s) => s !== fromSiteId) || inst.siteIds[1];
        const placement = ensurePlacement(inst);
        const arr = [...(placement[appKey] || [])];
        // Find first entry matching fromSiteId and move it to otherSite
        const idx = arr.indexOf(fromSiteId);
        if (idx === -1) return inst;
        // Don't allow moving the last VM off a site if it would leave 0 at fromSite
        // (allow it — user may want all VMs at one site)
        arr[idx] = otherSite;
        return { ...inst, appliancePlacement: { ...placement, [appKey]: arr } };
      }),
    }));
  };

  if (layout._error) {
    return (
      <div className="border border-rose-300 bg-rose-50 rounded-lg p-5">
        <h2 className="font-serif text-xl text-rose-900 mb-2">Physical layout error</h2>
        <p className="text-sm text-rose-700 font-mono">{layout._error}</p>
      </div>
    );
  }

  const verdictColor = (v) => v === "green" ? "#16a34a" : v === "yellow" ? "#ca8a04" : "#dc2626";

  return (
    <div className="overflow-auto bg-slate-50 rounded border border-slate-200 p-4">
      <svg width={layout.width} height={layout.height} xmlns="http://www.w3.org/2000/svg"
        style={{ minWidth: "100%" }}>

        {/* Stretched bands */}
        {layout.stretchedBands.map((band, i) => {
          const midX = (band.from.x + band.to.x) / 2;
          return (
            <g key={`band-${i}`}>
              <path
                d={`M ${band.from.x} ${band.from.y} L ${band.to.x} ${band.to.y}`}
                stroke="#2563eb" strokeWidth={2} strokeDasharray="8 4" fill="none"
              />
              <rect x={midX - 50} y={Math.min(band.from.y, band.to.y) - 14}
                width={100} height={18} rx={9} fill="#eff6ff" stroke="#2563eb" strokeWidth={0.8} />
              <text x={midX} y={Math.min(band.from.y, band.to.y) - 2}
                textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                fill="#2563eb" fontWeight="500">{band.label}</text>
            </g>
          );
        })}

        {/* Site containers */}
        {layout.sites.map((site) => (
          <g key={site.id}>
            {/* Site box */}
            <rect x={site.x} y={site.y} width={site.width} height={site.height}
              rx={8} fill={TOPOLOGY_COLORS.site.fill} stroke={TOPOLOGY_COLORS.site.stroke}
              strokeWidth={2} />
            {/* Site header */}
            <text x={site.x + 14} y={site.y + 22}
              fontFamily="Inter, system-ui, sans-serif" fontSize={15} fontWeight="700"
              fill={TOPOLOGY_COLORS.site.text}>{truncate(site.name, 28)}</text>
            <text x={site.x + site.width - 14} y={site.y + 22}
              textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
              fill={TOPOLOGY_COLORS.site.text} opacity={0.6}>{site.location}</text>

            {/* Domains within site */}
            {site.domains.map((dom) => {
              const dc = TOPOLOGY_COLORS[dom.type === "mgmt" ? "mgmt" : "workload"];
              return (
                <g key={`${site.id}-${dom.id}`}>
                  {/* Domain container */}
                  <rect x={dom.x} y={site.y + dom.y} width={dom.width} height={dom.height}
                    rx={6} fill={dc.fill} stroke={dc.stroke} strokeWidth={1.2} />
                  {/* Domain header */}
                  <text x={dom.x + 10} y={site.y + dom.y + 18}
                    fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                    fill={dc.text}>{truncate(dom.name, 32)}</text>
                  {dom.placement === "stretched" && (
                    <text x={dom.x + dom.width - 10} y={site.y + dom.y + 18}
                      textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={8}
                      fill="#2563eb" fontWeight="500">↔ {dom.sharePct}%</text>
                  )}

                  {/* Clusters within domain */}
                  {dom.clusters.map((clu) => {
                    const cc = TOPOLOGY_COLORS.cluster;
                    return (
                      <g key={`${site.id}-${dom.id}-${clu.id}`}>
                        <rect x={clu.x} y={site.y + clu.y} width={clu.width} height={clu.height}
                          rx={4} fill={cc.fill} stroke={cc.stroke} strokeWidth={1} />
                        {/* Cluster header */}
                        <text x={clu.x + 8} y={site.y + clu.y + 16}
                          fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                          fill={cc.text}>{truncate(clu.name, 26)}</text>
                        <text x={clu.x + 8} y={site.y + clu.y + 30}
                          fontFamily="IBM Plex Mono, monospace" fontSize={9}
                          fill={cc.text} opacity={0.7}>
                          Limit: {clu.limiter}
                        </text>
                        {/* Failover badge */}
                        {clu.failover && (
                          <g>
                            <circle cx={clu.x + clu.width - 20} cy={site.y + clu.y + 16}
                              r={5} fill={verdictColor(clu.failover.siteA.verdict)} />
                            <circle cx={clu.x + clu.width - 8} cy={site.y + clu.y + 16}
                              r={5} fill={verdictColor(clu.failover.siteB.verdict)} />
                          </g>
                        )}
                        {/* Host badge */}
                        <rect x={clu.x + 6} y={site.y + clu.y + PHYS_CLUSTER_HEADER_H - 8}
                          width={clu.width - 12} height={PHYS_HOST_BADGE_H} rx={3}
                          fill="white" stroke={cc.stroke} strokeWidth={0.6} opacity={0.9} />
                        <text x={clu.x + 14} y={site.y + clu.y + PHYS_CLUSTER_HEADER_H + 8}
                          fontFamily="IBM Plex Mono, monospace" fontSize={10}
                          fill={cc.text} fontWeight="600">
                          {clu.hostCount} hosts · {fmt(clu.cores)} cores · {(clu.rawTib || 0).toFixed(1)} TiB
                        </text>
                        {/* Appliance pills — single column, full name + resources */}
                        {clu.appliances.map((app, ai) => {
                          const ax = clu.x + PHYS_CLUSTER_PAD;
                          const pillW = clu.width - PHYS_CLUSTER_PAD * 2;
                          const ay = site.y + clu.y + PHYS_CLUSTER_HEADER_H + PHYS_HOST_BADGE_H + 4 +
                            ai * (PHYS_APPLIANCE_H + PHYS_APPLIANCE_GAP);
                          const ac = TOPOLOGY_COLORS.appliance;
                          const movable = app.canMove && setFleet;
                          const resText = `${app.vcpu}cpu ${app.ram}GB`;
                          return (
                            <g key={`app-${clu.id}-${ai}`}
                              style={movable ? { cursor: "pointer" } : undefined}
                              onClick={movable ? () => moveAppliance(app.instId, app.key, site.id) : undefined}>
                              <rect x={ax} y={ay} width={pillW} height={PHYS_APPLIANCE_H}
                                rx={3} fill={ac.fill} stroke={movable ? "#2563eb" : ac.stroke}
                                strokeWidth={movable ? 1 : 0.8} />
                              <text x={ax + 6} y={ay + 16}
                                fontFamily="Inter, system-ui, sans-serif" fontSize={10} fontWeight="500"
                                fill={ac.text}>{truncate(app.label, 26)}{app.count > 1 ? ` ×${app.count}` : ""}</text>
                              <text x={ax + pillW - (movable ? 20 : 6)} y={ay + 16}
                                textAnchor="end" fontFamily="IBM Plex Mono, monospace" fontSize={9}
                                fill={ac.text} opacity={0.55}>{resText}</text>
                              {movable && (
                                <text x={ax + pillW - 6} y={ay + 16}
                                  fontFamily="IBM Plex Mono, monospace" fontSize={10}
                                  fill="#2563eb" textAnchor="end">→</text>
                              )}
                            </g>
                          );
                        })}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>
        ))}

        {/* Witness boxes */}
        {layout.witnesses.map((w) => {
          const wc = TOPOLOGY_COLORS.witness;
          return (
            <g key={w.id}>
              <rect x={w.x} y={w.y} width={w.width} height={w.height}
                rx={4} fill={wc.fill} stroke={wc.stroke} strokeWidth={1.2}
                strokeDasharray="4 2" />
              <text x={w.x + 10} y={w.y + 20}
                fontFamily="Inter, system-ui, sans-serif" fontSize={11} fontWeight="600"
                fill={wc.text}>⬦ {w.label}</text>
              <text x={w.x + 10} y={w.y + 36}
                fontFamily="IBM Plex Mono, monospace" fontSize={9}
                fill={wc.text} opacity={0.7}>
                {w.size} · {w.instances} cluster{w.instances === 1 ? "" : "s"} · {w.instanceName}
              </text>
              {/* Connectors to sites */}
              {w.siteIds.map((sId, si) => {
                const s = layout.sites.find((ls) => ls.id === sId);
                if (!s) return null;
                const sx = s.x + s.width / 2;
                const sy = s.y + s.height;
                const wx = w.x + w.width / 2;
                const wy = w.y;
                return (
                  <path key={`wc-${si}`}
                    d={`M ${wx} ${wy} L ${wx} ${(wy + sy) / 2} L ${sx} ${(wy + sy) / 2} L ${sx} ${sy}`}
                    stroke={wc.stroke} strokeWidth={1} strokeDasharray="4 2" fill="none" />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAW.IO XML EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function generateDrawioXml(layoutData, layoutType) {
  let nextId = 2;
  const id = () => nextId++;
  const cells = [];

  const styleStr = (opts) => Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(";") + ";";

  if (layoutType === "logical") {
    // Logical layout: flat boxes and connectors
    const idMap = {};
    for (const box of layoutData.boxes) {
      const cellId = id();
      idMap[box.id] = cellId;
      const tc = TOPOLOGY_COLORS[box.kind] || TOPOLOGY_COLORS.cluster;
      const label = [
        `<b>${escapeXml(box.label)}</b>`,
        box.subtitle ? `<br/><font style="font-size:10px">${escapeXml(box.subtitle)}</font>` : "",
        box.subtitle2 ? `<br/><font style="font-size:9px;opacity:0.6">${escapeXml(box.subtitle2)}</font>` : "",
      ].join("");
      const style = styleStr({
        rounded: 1, whiteSpace: "wrap", html: 1,
        fillColor: tc.fill, strokeColor: tc.stroke, fontColor: tc.text,
        strokeWidth: box.kind === "witness" ? 1 : 1.5, arcSize: 8,
        ...(box.kind === "witness" ? { dashed: 1, dashPattern: "4 2" } : {}),
      });
      cells.push(`    <mxCell id="${cellId}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="1">
      <mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/>
    </mxCell>`);
    }
    for (const conn of layoutData.connectors) {
      const src = idMap[conn.from.id];
      const tgt = idMap[conn.to.id];
      if (!src || !tgt) continue;
      const style = styleStr({
        edgeStyle: "orthogonalEdgeStyle", strokeColor: "#94a3b8", strokeWidth: 1.2,
      });
      cells.push(`    <mxCell id="${id()}" style="${style}" edge="1" source="${src}" target="${tgt}" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>`);
    }
    for (const conn of (layoutData.stretchedConnectors || [])) {
      const src = idMap[conn.from.id];
      const tgt = idMap[conn.to.id];
      if (!src || !tgt) continue;
      const style = styleStr({
        edgeStyle: "orthogonalEdgeStyle", strokeColor: "#2563eb", strokeWidth: 2,
        dashed: 1, dashPattern: "6 3",
      });
      cells.push(`    <mxCell id="${id()}" style="${style}" edge="1" source="${src}" target="${tgt}" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>`);
    }
  } else {
    // Physical layout: nested containers
    const idMap = {};
    for (const site of layoutData.sites) {
      const siteId = id();
      idMap[site.id] = siteId;
      const sc = TOPOLOGY_COLORS.site;
      const style = styleStr({
        rounded: 1, whiteSpace: "wrap", html: 1, container: 1,
        fillColor: sc.fill, strokeColor: sc.stroke, fontColor: sc.text,
        strokeWidth: 2, arcSize: 4, verticalAlign: "top", fontStyle: 1, fontSize: 14,
      });
      cells.push(`    <mxCell id="${siteId}" value="${escapeXml(site.name + (site.location ? ' — ' + site.location : ''))}" style="${style}" vertex="1" parent="1">
      <mxGeometry x="${site.x}" y="${site.y}" width="${site.width}" height="${site.height}" as="geometry"/>
    </mxCell>`);

      for (const dom of site.domains) {
        const domCellId = id();
        const dc = TOPOLOGY_COLORS[dom.type === "mgmt" ? "mgmt" : "workload"];
        const domLabel = dom.name + (dom.placement === "stretched" ? ` (${dom.sharePct}%)` : "");
        const dStyle = styleStr({
          rounded: 1, whiteSpace: "wrap", html: 1, container: 1,
          fillColor: dc.fill, strokeColor: dc.stroke, fontColor: dc.text,
          strokeWidth: 1.2, arcSize: 4, verticalAlign: "top", fontSize: 11,
        });
        cells.push(`    <mxCell id="${domCellId}" value="${escapeXml(domLabel)}" style="${dStyle}" vertex="1" parent="${siteId}">
      <mxGeometry x="${dom.x - site.x}" y="${dom.y}" width="${dom.width}" height="${dom.height}" as="geometry"/>
    </mxCell>`);

        for (const clu of dom.clusters) {
          const cluCellId = id();
          const cc = TOPOLOGY_COLORS.cluster;
          const cluLabel = `<b>${escapeXml(clu.name)}</b><br/><font style="font-size:10px">${clu.hostCount} hosts · ${fmt(clu.cores)} cores · ${(clu.rawTib || 0).toFixed(1)} TiB</font><br/><font style="font-size:9px">Limit: ${escapeXml(clu.limiter)}</font>`;
          const cStyle = styleStr({
            rounded: 1, whiteSpace: "wrap", html: 1, container: 1,
            fillColor: cc.fill, strokeColor: cc.stroke, fontColor: cc.text,
            strokeWidth: 1, arcSize: 4, verticalAlign: "top", fontSize: 11,
          });
          cells.push(`    <mxCell id="${cluCellId}" value="${escapeXml(cluLabel)}" style="${cStyle}" vertex="1" parent="${domCellId}">
      <mxGeometry x="${clu.x - dom.x}" y="${clu.y - dom.y}" width="${clu.width}" height="${clu.height}" as="geometry"/>
    </mxCell>`);

          for (const app of clu.appliances) {
            const appId = id();
            const ac = TOPOLOGY_COLORS.appliance;
            const appLabel = app.label + (app.count > 1 ? ` ×${app.count}` : "");
            const aStyle = styleStr({
              rounded: 1, whiteSpace: "wrap", html: 1,
              fillColor: ac.fill, strokeColor: ac.stroke, fontColor: ac.text,
              strokeWidth: 0.8, fontSize: 8,
            });
            const ai = clu.appliances.indexOf(app);
            const col = ai % 2;
            const row = Math.floor(ai / 2);
            const ax = 12 + col * 134;
            const ay = 60 + row * 26;
            cells.push(`    <mxCell id="${appId}" value="${escapeXml(appLabel)}" style="${aStyle}" vertex="1" parent="${cluCellId}">
      <mxGeometry x="${ax}" y="${ay}" width="130" height="22" as="geometry"/>
    </mxCell>`);
          }
        }
      }
    }

    // Stretched bands as edges between sites
    for (const band of layoutData.stretchedBands) {
      const style = styleStr({
        edgeStyle: "orthogonalEdgeStyle", strokeColor: "#2563eb", strokeWidth: 2,
        dashed: 1, dashPattern: "8 4",
      });
      // Find the two site cells
      const siteIds = layoutData.sites.filter((s) =>
        s.domains.some((d) => d.id === band.domainId)
      ).map((s) => idMap[s.id]).filter(Boolean);
      if (siteIds.length === 2) {
        cells.push(`    <mxCell id="${id()}" value="${escapeXml(band.label)}" style="${style}" edge="1" source="${siteIds[0]}" target="${siteIds[1]}" parent="1">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>`);
      }
    }

    // Witness boxes
    for (const w of layoutData.witnesses) {
      const wId = id();
      const wc = TOPOLOGY_COLORS.witness;
      const wStyle = styleStr({
        rounded: 1, whiteSpace: "wrap", html: 1,
        fillColor: wc.fill, strokeColor: wc.stroke, fontColor: wc.text,
        strokeWidth: 1.2, dashed: 1, dashPattern: "4 2", fontSize: 10,
      });
      cells.push(`    <mxCell id="${wId}" value="${escapeXml('⬦ ' + w.label)}" style="${wStyle}" vertex="1" parent="1">
      <mxGeometry x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}" as="geometry"/>
    </mxCell>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
${cells.join("\n")}
  </root>
</mxGraphModel>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MERMAID EXPORT
// ─────────────────────────────────────────────────────────────────────────────
function generateMermaidCode(layoutData, layoutType) {
  const lines = [];
  const san = sanitizeMermaidId;

  if (layoutType === "logical") {
    lines.push("flowchart LR");
    const shapes = { site: "[[", instance: "[", mgmt: "(", workload: "(", cluster: "[", witness: ">" };
    const closes = { site: "]]", instance: "]", mgmt: ")", workload: ")", cluster: "]", witness: "]" };

    for (const box of layoutData.boxes) {
      const nid = san(box.id);
      const open = shapes[box.kind] || "[";
      const close = closes[box.kind] || "]";
      const parts = [box.label];
      if (box.subtitle) parts.push(box.subtitle);
      if (box.subtitle2) parts.push(box.subtitle2);
      const label = `"${parts.join("\\n")}"`;
      lines.push(`    ${nid}${open}${label}${close}`);
    }
    lines.push("");
    for (const conn of layoutData.connectors) {
      lines.push(`    ${san(conn.from.id)} --> ${san(conn.to.id)}`);
    }
    for (const conn of (layoutData.stretchedConnectors || [])) {
      lines.push(`    ${san(conn.from.id)} -.-> ${san(conn.to.id)}`);
    }
  } else {
    lines.push("flowchart TB");

    for (const site of layoutData.sites) {
      lines.push(`    subgraph ${san(site.id)}["${site.name} — ${site.location}"]`);
      for (const dom of site.domains) {
        const domId = san(site.id + "_" + dom.id);
        lines.push(`        subgraph ${domId}["${dom.name}${dom.placement === 'stretched' ? ' ↔ ' + dom.sharePct + '%' : ''}"]`);
        for (const clu of dom.clusters) {
          const cluId = san(site.id + "_" + dom.id + "_" + clu.id);
          const appList = clu.appliances.map((a) => a.label + (a.count > 1 ? ` ×${a.count}` : "")).join(", ");
          const label = `${clu.name}\\n${clu.hostCount} hosts · ${fmt(clu.cores)} cores\\n${appList ? appList : ""}`;
          lines.push(`            ${cluId}["${label}"]`);
        }
        lines.push("        end");
      }
      lines.push("    end");
    }

    // Stretched connections between matching domain subgraphs
    for (const band of layoutData.stretchedBands) {
      const sites = layoutData.sites.filter((s) => s.domains.some((d) => d.id === band.domainId));
      if (sites.length === 2) {
        const d0 = san(sites[0].id + "_" + band.domainId);
        const d1 = san(sites[1].id + "_" + band.domainId);
        lines.push(`    ${d0} -. "${band.label}" .-> ${d1}`);
      }
    }

    // Witnesses
    for (const w of layoutData.witnesses) {
      const wid = san(w.id);
      lines.push(`    ${wid}>"${w.label}\\n${w.size} · ${w.instances} cluster${w.instances === 1 ? '' : 's'}"]`);
      for (const sId of w.siteIds) {
        lines.push(`    ${wid} -.-> ${san(sId)}`);
      }
    }
  }

  // Color classes
  lines.push("");
  for (const [kind, col] of Object.entries(TOPOLOGY_COLORS)) {
    lines.push(`    classDef ${kind} fill:${col.fill},stroke:${col.stroke},color:${col.text}`);
  }

  if (layoutType === "logical") {
    for (const box of layoutData.boxes) {
      lines.push(`    class ${san(box.id)} ${box.kind}`);
    }
  }

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP-LEVEL COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function VcfFleetSizer() {
  const [fleet, setFleet] = useState(newFleet());
  const [view, setView] = useState("editor"); // "editor" | "topology"
  const fileInputRef = useRef(null);

  const fleetResult = useMemo(() => sizeFleet(fleet), [fleet]);

  const exportConfig = () => {
    const config = {
      version: "vcf-sizer-v5",
      exportedAt: new Date().toISOString(),
      fleet,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vcf-fleet-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target.result);
        const originalVersion = raw?.version || "unknown";
        const migrated = migrateFleet(raw);
        if (!migrated || !Array.isArray(migrated.sites) || !Array.isArray(migrated.instances)) {
          alert("Unrecognized config file format.");
          return;
        }
        setFleet(migrated);
        if (originalVersion !== "vcf-sizer-v5") {
          alert(
            `Imported ${originalVersion} config and auto-migrated to v5. Stretched VCF instances that were previously duplicated across sites have been consolidated. Original file was not modified.`
          );
        }
      } catch (err) {
        alert("Failed to parse config: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const resetAll = () => {
    if (confirm("Reset all inputs to defaults?")) {
      setFleet(newFleet());
    }
  };

  return (
    <div
      className="min-h-screen p-6 lg:p-10 text-slate-800"
      style={{
        background: "#f8fafc",
        fontFamily: '"Inter", system-ui, sans-serif',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .font-serif { font-family: 'Inter', system-ui, sans-serif; font-weight: 600; }
        .font-mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        select option { background: #fff; }
      `}</style>

      <header className="max-w-[1800px] mx-auto mb-8">
        <div className="flex items-baseline justify-between gap-4 mb-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.3em] text-blue-600 font-mono">
            VMware Cloud Foundation 9 · Design Studio · v5
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5"
            >
              Import JSON
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={importConfig}
              className="hidden"
            />
            <button
              onClick={exportConfig}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-600 border border-slate-200 hover:border-blue-400 hover:text-blue-600 rounded px-3 py-1.5"
            >
              Export JSON
            </button>
            <button
              onClick={resetAll}
              className="text-[10px] uppercase tracking-wider font-mono text-slate-400 border border-slate-200 hover:border-rose-400 hover:text-rose-600 rounded px-3 py-1.5"
            >
              Reset
            </button>
          </div>
        </div>
        <h1 className="font-serif text-5xl lg:text-6xl text-slate-900 leading-none mb-3">
          VCF <span className="italic text-blue-600">Design Studio</span>
        </h1>
        <input
          value={fleet.name}
          onChange={(e) => setFleet({ ...fleet, name: e.target.value })}
          className="bg-transparent text-xl text-slate-600 italic font-serif border-none focus:outline-none focus:bg-slate-50 rounded px-1 mb-3"
        />
        <p className="text-slate-500 max-w-3xl text-sm leading-relaxed">
          Design and size multi-site VCF 9 environments. Build a hierarchy of sites,
          VCF instances, domains, and clusters — each cluster gets its own host spec
          and sizing math. Switch to the Topology tab for an auto-generated SVG
          diagram you can drop into design documents.
        </p>

        {/* View tabs */}
        <div className="flex gap-1 mt-5 border-b border-slate-200">
          <TabButton active={view === "editor"} onClick={() => setView("editor")}>
            Editor
          </TabButton>
          <TabButton active={view === "topology"} onClick={() => setView("topology")}>
            Topology Diagram
          </TabButton>
          <TabButton active={view === "persite"} onClick={() => setView("persite")}>
            Per-Site View
          </TabButton>
        </div>
      </header>

      <main className="max-w-[1800px] mx-auto">
        {view === "editor" ? (
          <>
            <SitesPanel fleet={fleet} onChange={setFleet} />
            <InstancesPanel fleet={fleet} fleetResult={fleetResult} onChange={setFleet} />
            <FleetSummary fleet={fleet} fleetResult={fleetResult} />
          </>
        ) : view === "topology" ? (
          <>
            <TopologyView fleet={fleet} fleetResult={fleetResult} setFleet={setFleet} />
            <div className="mt-5">
              <FleetSummary fleet={fleet} fleetResult={fleetResult} />
            </div>
          </>
        ) : view === "persite" ? (
          <>
            <PerSiteView fleet={fleet} fleetResult={fleetResult} />
            <div className="mt-5">
              <FleetSummary fleet={fleet} fleetResult={fleetResult} />
            </div>
          </>
        ) : null}

        <div className="border-t border-slate-200 mt-10 pt-6 pb-4">
          <div className="mb-5">
            <h3 className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-mono font-semibold mb-3">
              Official Broadcom Resources
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/planning-and-preparation.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF 9.0 Planning &amp; Preparation Workbook</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF 9.0 Design Guide</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/overview-of-vmware-cloud-foundation-9.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF 9.0 Overview</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/release-notes.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF 9.0 Release Notes</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">vSphere Supervisor (VKS) Installation</span>
              </a>
              <a
                href="https://configmax.broadcom.com/"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VMware Configuration Maximums</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">Working with Workload Domains</span>
              </a>
              <a
                href="https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library.html"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">VCF Validated Solutions Library</span>
              </a>
              <a
                href="https://knowledge.broadcom.com/external/search?searchText=VMware%20Cloud%20Foundation%209"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 rounded px-3 py-2 transition-colors"
              >
                <span className="text-blue-600">→</span>
                <span className="font-mono">Broadcom Knowledge Base (VCF 9)</span>
              </a>
            </div>
          </div>

          <footer className="text-center text-[10px] text-slate-400 font-mono uppercase tracking-[0.16em] pt-4 border-t border-slate-200 leading-relaxed">
            VCF Design Studio v5 · Planning aid only · Appliance data sourced from the official Broadcom VCF 9.0
            Planning &amp; Preparation Workbook and techdocs.broadcom.com · Validate against current VMware documentation before procurement
          </footer>
        </div>
      </main>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-[11px] uppercase tracking-[0.16em] font-mono border-b-2 transition-colors ${
        active
          ? "text-blue-600 border-blue-600"
          : "text-slate-400 border-transparent hover:text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function FleetSummary({ fleet, fleetResult }) {
  return (
    <div className="border border-blue-200 bg-white shadow-sm rounded-lg p-6 mb-6">
      <div className="flex items-baseline justify-between border-b border-blue-200 pb-2 mb-5">
        <h2 className="font-serif text-3xl text-slate-900 italic">Fleet Summary</h2>
        <span className="text-[10px] uppercase tracking-[0.2em] text-blue-600 font-mono">
          Aggregated across all sites
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Stat label="Total Hosts"      value={fleetResult.totalHosts}                         mono />
        <Stat label="Licensed Cores"   value={fmt(fleetResult.totalCores)}                    mono />
        <Stat label="vSAN Entitlement" value={`${fmt(fleetResult.entitlementTib, 0)} TiB`}    mono />
        <Stat label="Fleet Raw vSAN"   value={`${fmt(fleetResult.fleetRawTib, 1)} TiB`}       mono />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
        <Stat label="Sites"             value={fleet.sites.length}                                                                  mono />
        <Stat label="VCF Instances"     value={fleet.instances.length}                                                              mono />
        <Stat label="Total Domains"     value={fleet.instances.reduce((s, inst) => s + inst.domains.length, 0)}                     mono />
      </div>

      <div className={`border rounded p-4 ${
        fleetResult.addonTib > 0
          ? "border-rose-400 bg-rose-50"
          : "border-emerald-400 bg-emerald-50"
      }`}>
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-1 font-mono">
          Add-on TiB Required
        </div>
        <div className="font-serif text-3xl text-slate-900">
          {fmt(fleetResult.addonTib, 1)} <span className="text-base text-slate-500">TiB</span>
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          {fleetResult.addonTib > 0
            ? "Fleet raw exceeds bundled entitlement — additional vSAN capacity licensing needed."
            : "Fleet raw fits within bundled core entitlement."}
        </div>
      </div>
    </div>
  );
}
