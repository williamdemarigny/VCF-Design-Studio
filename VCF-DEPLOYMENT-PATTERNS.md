# VCF 9.0 Deployment Patterns — Research Report

*Generated: 2026-04-15 | Last updated: 2026-04-15 (fourth follow-up pass) | VCF version: 9.0 | Sources: 31 | Confidence: High across all placement rules, T0 HA limits, SSO topology, fleet DR, and deployment-path exposure matrix. Authoritative Broadcom NSX 9.0 TechDocs citations added for the 8-node A/A T0 limit and stateful A/A sub-cluster rules. No remaining open questions.*

> **Purpose for Claude.** This document is the source of truth for *where* appliances may live when validating fixtures in `test-fixtures/v5/`, generating new test cases, or reviewing logic in `engine.js` (notably `APPLIANCE_DB`, `DEPLOYMENT_PROFILES`, and `computeInstance`). Each rule block is written in a machine-readable YAML-ish form that mirrors the codebase field names (`domain.type`, `domain.placement`, `instance.siteIds`, `cluster.infraStack`). When a fixture or engine change conflicts with a rule here, prefer the rule — or update this document and cite the Broadcom source.
>
> Rule IDs follow the pattern `VCF-<scope>-<nnn>`. Use these IDs in test names (e.g. `describe('VCF-FLEET-002: single Operations per fleet', …)`).

---

## 1. Conceptual Model

```yaml
hierarchy:
  fleet:
    description: "The outermost management boundary. Introduced in VCF 9.0. Managed by a single set of fleet-level appliances."
    contains: [instance]
    cardinality: "1..1 per deployment scope (a customer has one fleet per managed-plane)"
  instance:                       # == 'VCF instance'
    description: "A single SDDC Manager domain. Independent control plane."
    contains: [domain]
    cardinality: "1..N per fleet; N is elastic — see VCF-FLEET-010"
  domain:
    description: "A management domain (exactly one per instance) or workload domain."
    subtypes: [mgmt, wld]
    cardinality:
      mgmt: "1..1 per instance"
      wld:  "0..N per instance"
  cluster:
    description: "vSphere cluster within a domain. First cluster of a mgmt domain is the 'initial management cluster'."
    cardinality: "1..N per domain"
  site:
    description: "Physical availability zone. A stretched instance has siteIds.length == 2."
    cardinality: "1 or 2 per instance"
```

**Scope terms used in this document** (match `placement` field in `APPLIANCE_DB`):

| Scope token          | Meaning                                                                 |
|----------------------|-------------------------------------------------------------------------|
| `per-fleet`          | One deployment exists for the whole fleet (Ops, Automation, Fleet Mgmt)|
| `per-instance`       | One deployment per VCF instance (SDDC Manager, mgmt vCenter, mgmt NSX) |
| `per-domain`         | One deployment per domain (workload vCenter; workload NSX if unshared) |
| `per-domain-shared`  | One deployment can serve multiple workload domains (workload NSX)      |
| `per-cluster`        | One deployment per vSphere cluster (vSAN witness, Edge cluster when scoped that way) |
| `cluster-internal`   | Sizing only — runs inside ESX, not a separate VM (e.g. vSAN services)   |

---

## 2. Appliance Catalog (Authoritative Placement Rules)

Every rule below is valid for **VCF 9.0**. The `id` column should match `APPLIANCE_DB` keys in `engine.js`.

```yaml
appliances:

  - id: sddc_manager
    rule: VCF-APP-001
    scope: per-instance
    placement:
      domain: mgmt
      cluster: "initial management cluster (cluster[0])"
    nodes:
      simple: 1
      ha:     1           # SDDC Manager is NOT horizontally scaled; vSphere HA protects it
    notes:
      - "SDDC Manager is explicitly OUTSIDE VCF SSO (VCF-SSO-010)."
      - "Governance lives with the platform team; day-2 ops with the VI admin."
    source: [1, 11]

  - id: vcenter_mgmt
    rule: VCF-APP-002
    scope: per-instance
    placement:
      domain: mgmt
      cluster: "initial management cluster"
    nodes: { simple: 1, ha: 1 }     # vCenter HA (VCHA) optional; app-level, not node-count
    notes:
      - "Hosts embedded Identity Broker when VCF-SSO-001 mode is 'embedded'."
    source: [1, 8]

  - id: vcenter_wld
    rule: VCF-APP-003
    scope: per-domain
    placement:
      domain: wld
      cluster: "runs in the management domain of the owning instance, NOT in the workload domain itself"
    nodes: { simple: 1, ha: 1 }
    notes:
      - "CRITICAL: a workload-domain vCenter VM is PLACED in the mgmt domain cluster of its instance. It MANAGES the workload domain but does not run there."
      - "Every VI workload domain has its own vCenter — no sharing."
    source: [1, 5, 11]

  - id: nsx_manager_mgmt
    rule: VCF-APP-004
    scope: per-instance
    placement:
      domain: mgmt
      cluster: "initial management cluster"
    nodes: { simple: 1, ha: 3 }     # HA = 3-node NSX Manager cluster
    source: [1, 8]

  - id: nsx_manager_wld
    rule: VCF-APP-005
    scope: per-domain-shared
    placement:
      domain: "mgmt (VM placement) — manages wld"
      cluster: "management cluster of the owning instance"
    nodes: { simple: 1, ha: 3 }
    sharing_rule: |
      One NSX Manager cluster MAY serve multiple workload domains within the same VCF instance.
      Cross-instance sharing is NOT supported — use NSX Federation instead (VCF-NSX-010).
    source: [5, 11]

  - id: nsx_edge
    rule: VCF-APP-006
    scope: per-nsx-manager       # An Edge cluster is tied to ONE NSX Manager; it serves every workload domain that shares that NSX Manager
    placement:
      cluster: "any vSphere cluster (mgmt domain OR wld domain) whose hosts are prepared by the Edge cluster's NSX Manager"
      domain:  "mgmt OR wld — both are formally supported (VCF-APP-006-SUP below)"
    nodes:
      min: 2                     # CONFIRMED: 2 Edge nodes minimum per Edge cluster (Broadcom TechDocs, source 16)
      max: 10                    # CONFIRMED: up to 10 Edge nodes per Edge cluster (source 17)
      t0_bindings:
        active_standby:
          max_edge_nodes_per_t0: 2              # CONFIRMED: elected active + standby only (source 25)
          rule: "VCF-APP-006-T0-AS"
          bgp_default: "disabled by default (source 27)"
          default_asn: "none — must be supplied (source 27)"
          required_for:
            - "VCF Automation All Apps"        # source 25
            - "vSphere Supervisor (VKS)"       # source 25, 28
            - "Default outbound NAT on VPC"
            - "Any stateful NAT / LB / VPN without A/A stateful licensing"
        active_active:
          max_edge_nodes_per_t0: 8              # CONFIRMED authoritatively by Broadcom NSX 9.0 TechDocs: "In an active-active configuration, when you create tier-0 uplink ports, you can associate each uplink port with up to eight NSX Edge transport nodes, and each NSX Edge node can have two uplinks." (source 29)
          rule: "VCF-APP-006-T0-AA"
          bgp_default: "enabled by default (source 27)"
          default_asn: "65000 (source 27)"
          uplinks_per_edge: 2                    # each Edge node may have up to 2 T0 uplinks in A/A
          stateful_services:
            supported: true                      # CONFIRMED in NSX 9.0 TechDocs: "Stateful services support Active-Active deployment" (source 30)
            requires_even_node_count: true       # "a cluster of four NSX Edge nodes becomes two sub-clusters, where each sub-cluster is a pair of NSX Edge nodes" (source 30)
            sub_cluster_rule: "NSX Manager automatically pairs Edge nodes into sub-clusters of 2 (source 30)"
            interface_group_required: "an interface group must be created to enable stateful A/A (source 30)"
            feature_introduced: "NSX 4.0.1 (source 26)"
          stateless_default: "If stateful services aren't enabled, A/A T0 provides only stateless N-S routing across all Edge nodes (source 29)"
      t0_per_edge_node: 1         # CONFIRMED: "Some services, such as Tier-0 gateways, are limited to a single instance per NSX Edge node" (source 16, 26)
    exposure_matrix:
      # How each HA mode/feature is surfaced across VCF 9.0 deployment paths — for studio UX/test design
      VCF_Installer_greenfield:
        active_standby_t0: "Exposed as a user choice in the Workload Domain Connectivity step of the wizard (source 31)"
        active_active_t0:  "Exposed as a user choice — both modes selectable from the wizard's HA Mode dropdown (source 31)"
        stateful_aa_t0:    "NOT exposed — interface groups and sub-cluster config are Day-2 via NSX Manager UI"
      vCenter_guided_edge_wizard:
        active_standby_t0: "Exposed (default selection for VKS/Supervisor scenarios) (source 25, 31)"
        active_active_t0:  "Exposed as a choice — same wizard, different HA Mode dropdown value (source 25)"
        stateful_aa_t0:    "NOT exposed — Day-2 via NSX Manager UI only"
      NSX_Manager_UI:
        active_standby_t0: "Full control"
        active_active_t0:  "Full control"
        stateful_aa_t0:    "Primary UI for enabling stateful A/A (interface groups, sub-clusters). Required for Day-2 activation of this feature."
    notes:
      - "Official NSX 9.0 TechDocs (source 29) is now the authoritative citation for the 8-node A/A T0 limit — supersedes the earlier community-thread citation."
      - "The VCF 9.0 Installer and vCenter guided-Edge wizard BOTH expose A/A and A/S as user-selectable HA modes. Neither exposes stateful A/A configuration — that is always a Day-2 NSX Manager UI operation."
      - "For the design studio: if a fixture declares `stateful_services: true` on an A/A T0, flag it as requiring Day-2 NSX Manager configuration — the VCF Installer cannot produce this state directly."
    deployment_models:           # From "NSX Edge Cluster Models" page (source 16)
      - host_fault_tolerant:          "Single AZ, survives host failure"
      - rack_fault_tolerant:          "Multi-rack within single AZ, higher N-S throughput"
      - az_fault_tolerant_edge_ha:    "Dual AZ, NSX Edge Node HA (fast failover)"
      - az_fault_tolerant_vsphere_ha: "Dual AZ, vSphere HA (requires VIRTUAL form factor — bare-metal NOT supported)"
    supportability:
      VCF-APP-006-SUP-1: "Edge VMs MAY run on the management cluster. Formally supported — this is the default placement when deploying Aria/Operations-adjacent services. (source 11, 16)"
      VCF-APP-006-SUP-2: "A management-domain Edge cluster is REQUIRED to deploy VMware Aria Suite products. (source 11 — 'You must create an NSX Edge cluster on the default management vSphere cluster in order to deploy VMware Aria Suite products')"
      VCF-APP-006-SUP-3: "An Edge cluster MAY be shared across multiple workload domains IFF those workload domains share the same NSX Manager. Cross-NSX-Manager sharing is NOT supported. (source 5, 16)"
      VCF-APP-006-SUP-4: "Multiple Edge clusters MAY be deployed into either the management domain or a workload domain for scalability/resiliency. (source 11)"
      VCF-APP-006-SUP-5: "If vSphere Supervisor (VKS) is enabled on a cluster, an Edge cluster with an active/standby T0 MUST exist in that cluster's NSX Manager scope. (source 16, 25)"
      VCF-APP-006-SUP-6: "VCF Automation 'All Apps' deployment REQUIRES an Active/Standby T0 gateway. Feature is blocked without it. (source 25)"
      VCF-APP-006-SUP-7: "Stateful services on a T0 (NAT, LB, VPN) run on Active/Standby by default. Active/Active T0 supports stateful services ONLY with NSX 4.0.1+ stateful-AA feature and EVEN node count (sub-cluster pairs). (source 26)"
      VCF-APP-006-SUP-8: "Each Edge node hosts EXACTLY ONE T0 gateway — hard maximum. Multiple T0s in one Edge cluster require separate Edge nodes per T0. (source 26 — NSX Configuration Maximums)"
    notes:
      - "Optional for basic deployments. Required for N-S traffic, stateful services (NAT, load balancing, VPN), and VKS/Supervisor activation."
      - "NOT currently auto-sized in engine.js APPLIANCE_DB — consider adding as an explicit `nsx_edge` entry with placement=per-nsx-manager and a min/max of 2/10."
    source: [5, 11, 16]

  - id: vcf_operations
    rule: VCF-APP-010
    scope: per-fleet
    placement:
      instance: "INITIAL instance of the fleet"
      domain:   mgmt
      cluster:  "initial management cluster"
    nodes:
      simple: 1           # single analytics node, protected by vSphere HA
      ha:     3           # 3-node analytics cluster
      continuous_availability: "3 nodes stretched across 2 AZs"
    sizes: [Small, Medium, Large, XLarge]   # XL: 100K objects / 20M metrics per node; 16-node scale-out possible
    notes:
      - "Exactly ONE VCF Operations instance per fleet — not one per VCF instance."
      - "When adding a NEW instance to an existing fleet, Operations is NOT redeployed; only a Cloud Proxy / Collector is added locally."
    source: [3, 4, 10, 12]

  - id: vcf_operations_collector
    rule: VCF-APP-011
    scope: per-instance
    placement:
      domain: mgmt
      cluster: "initial management cluster of THIS instance"
    nodes: { simple: 1, ha: 1 }  # collectors can be grouped for HA
    notes:
      - "MANDATORY per instance — every VCF instance added to a fleet deploys its own Collector to forward telemetry to the fleet-level Operations."
      - "Also called 'Cloud Proxy' in some docs."
    source: [3, 4, 10]

  - id: vcf_operations_fleet_management
    rule: VCF-APP-012
    scope: per-fleet
    placement:
      instance: "INITIAL instance"
      domain:   mgmt
      cluster:  "initial management cluster"
    nodes: { simple: 1, ha: 1 }  # Single-node, protected by vSphere HA (NOT a 3-node cluster)
    notes:
      - "Drives lifecycle of fleet-level components. Distinct from VCF Operations analytics nodes."
    source: [3, 10]

  - id: vcf_operations_logs
    rule: VCF-APP-013
    scope: per-fleet             # typically; can be per-instance for compliance isolation
    placement:
      domain: mgmt
      cluster: "initial management cluster of initial instance"
    nodes: { simple: 1, ha: 3 }
    source: [1, 11]

  - id: vcf_operations_networks
    rule: VCF-APP-014
    scope:
      platform:  per-fleet                    # CONFIRMED: Platform cluster is fleet-wide
      collector: per-monitored-scope          # CONFIRMED: Collector is typically per workload domain or per VCF instance
    placement:
      platform:
        domain:   mgmt
        instance: "initial instance of the fleet"
        cluster:  "initial management cluster — Platform VMs deploy into the management-domain vCenter (source 20)"
      collector:
        default:  "deployed into management-domain vCenter of the instance it monitors"
        optional: "may be deployed into the workload cluster it monitors for isolation / lower latency (source 20)"
    nodes:
      platform:
        simple: 1                             # Single Platform node
        ha:     3                             # CONFIRMED: 3-node Platform cluster
        sizing: "medium size cannot be clustered directly — must scale up to Large or XL first"
      collector:
        default: 1                            # one Collector VM per monitored scope
        max_per_platform_node: "100 (Small/Medium Platform), 200 (Large/XL Platform)"
      scaling_threshold:
        trigger: ">10,000 VMs OR >4M active flows → MUST move from single node to clustered Platform"
    has_collector: true
    important_constraints:
      - "VMware REQUIRES 100% CPU and Memory reservation on Platform and Collector VMs for full support (source 21)."
      - "Default workload-domain workflow does NOT auto-deploy a Collector. Platform team opts-in per workload domain (source 20)."
      - "Collectors encrypt and forward — Platform does analytics. Keep Collector close to data sources (low latency)."
    source: [1, 20, 21]

  - id: vcf_automation
    rule: VCF-APP-020
    scope: per-fleet
    placement:
      instance: "INITIAL instance"
      domain:   mgmt
      cluster:  "initial management cluster"
    nodes: { simple: 1, ha: 3 }
    notes:
      - "Exactly ONE VCF Automation instance per fleet — same rule as Operations."
    source: [3, 4, 10, 12]

  - id: vcf_identity_broker
    rule: VCF-APP-030
    scope: "flex — three supported SSO deployment models in the VCF 9.0 Design Library (source 22)"
    modes:
      - mode: embedded
        rule:  VCF-SSO-001
        model_name: "Embedded VCF Identity Broker Model"
        nodes: 0                   # runs inside mgmt vCenter as a service
        scope: per-instance
        max_instances_served: 1
        ha: "inherits vCenter HA"
        when_to_use: "single-instance fleet, simplest posture, small availability requirements"
        source: [6, 22]
      - mode: appliance_fleet_wide
        rule:  VCF-SSO-002
        model_name: "VCF Fleet-Wide Single Sign-On Model"
        nodes: 3                   # 3-node VIDB appliance cluster
        scope: per-fleet           # "A single VCF Identity Broker services all VCF Instances in your VCF fleet"
        placement: "deploy in the management domain of the FIRST VCF instance (source 22)"
        max_instances_served: 5    # SOFT recommendation — not a hard technical cap (source 23)
        ha: "tolerates single-node failure"
        tradeoff: "Large SSO Scope (no re-auth) BUT large blast radius — outage affects whole fleet"
        source: [6, 22, 23]
      - mode: appliance_multi_broker
        rule:  VCF-SSO-003
        model_name: "Cross-Instance / Segmented VCF Identity Broker Model"
        nodes: "3 per broker"      # Each broker cluster independently 3 nodes
        scope: "N brokers per fleet — each broker serves a defined subset of VCF instances"
        placement: "each broker lives in a mgmt domain of one of the instances it serves (typically per-region)"
        when_to_use: "> 5 instances per fleet, OR reduced blast radius requirement, OR per-region identity isolation"
        hard_constraint:
          - "VCF Operations and VCF Automation (fleet-level services) can connect to EXACTLY ONE Identity Broker (source 24)."
          - "Therefore: even with multiple brokers in a fleet, the fleet-level management plane is SSO-bound to one broker. Other brokers serve instance-level vCenter / NSX / Ops for Logs / Ops for Networks logins only."
        source: [22, 24]
    notes:
      - "5-instance rule is a SOFT recommendation, not a hard enforced limit. Broadcom TechDocs uses 'recommended' language (source 23)."
      - "Multiple brokers per fleet IS an architected pattern in the VCF 9.0 Design Library — labeled 'Cross-Instance' segmentation. It is documented but requires careful mapping because fleet-level services bind to one broker only."
      - "SDDC Manager and ESX are OUTSIDE the SSO boundary regardless of mode (source 7)."
    source: [6, 7, 13, 22, 23, 24]

  - id: nsx_global_manager
    rule: VCF-APP-040
    scope: "fleet-wide, minimum 2 instances"
    deployment:
      trigger: "only deployed when NSX Federation is enabled (multi-instance L2/L3 stretch)"
      nodes:
        active_cluster:  3        # CONFIRMED: "Each NSX appliance cluster — Global Manager, Local Manager or NSX Manager — must contain three VMs" (source 17)
        standby_cluster: 3        # Same rule applies to the standby Global Manager cluster
        total: 6                  # Active + Standby when Federation HA design is chosen
      placement:
        active:  "mgmt domain of ONE VCF instance (typically the primary region)"
        standby: "mgmt domain of a DIFFERENT VCF instance (typically the secondary region)"
      latency: "<10 ms between the 3 VMs inside a single cluster (intra-cluster); inter-cluster (active ↔ standby) replication is tolerant of higher WAN latency"
    same_rule_applies_to:
      - nsx_manager_mgmt: "HA mode = 3-node cluster"
      - nsx_manager_wld:  "HA mode = 3-node cluster"
      - nsx_local_manager: "Always 3 nodes when Federation is enabled"
    notes:
      - "CONFIRMED via Broadcom docs: 3-node clusters are the only supported production topology for ANY NSX Manager role (Local, Global, or workload-domain). 1-node 'Simple' is lab/PoC."
      - "Deployed MANUALLY — not part of the VCF Installer greenfield flow."
      - "Active/standby failover is manual; configuration sync is automatic."
    source: [8, 9, 17]

  - id: avi_alb
    rule: VCF-APP-050
    scope: per-instance                 # typically; can be per-domain
    placement: { domain: mgmt, cluster: "management cluster" }
    source: [engine.js APPLIANCE_DB]

  - id: site_recovery_manager
    rule: VCF-APP-060
    scope: per-instance
    placement: { domain: mgmt }
    nodes: { simple: 1 }
    paired_with: vsphere_replication
    deployment_profiles: [haSiteProtection, haFederationSiteProtection]
    source: [engine.js DEPLOYMENT_PROFILES]

  - id: vsphere_replication
    rule: VCF-APP-061
    scope: per-instance
    placement: { domain: mgmt }
    nodes: { simple: 1, ha: "up to 10 replication appliances" }
    source: [engine.js]

  - id: vks_supervisor
    rule: VCF-APP-070
    scope: per-cluster           # enabled per cluster
    placement: cluster-internal  # Supervisor control plane VMs run IN the cluster
    nodes: 3
    source: [engine.js]

  - id: vsan_witness
    rule: VCF-APP-080
    scope: per-stretched-cluster
    placement: "EXTERNAL to both AZs — witness site (third failure domain)"
    nodes: 1
    required_when: "cluster.placement == 'stretched' AND cluster.externalStorage == false"
    source: [engine.js analyzeStretchedFailover]
```

---

## 3. Placement Invariants (Validation Rules)

These are the `MUST` / `MUST NOT` constraints a validator should check. Each one is testable against a fixture.

```yaml
invariants:

  - id: VCF-INV-001
    rule: "instance.domains must contain exactly one domain with type == 'mgmt'."
    test: "assert fleet.instances[i].domains.filter(d => d.type === 'mgmt').length === 1"
    source: [1, 11]

  - id: VCF-INV-002
    rule: "Every per-instance appliance MUST be placed on the mgmt domain of that instance."
    applies_to: [sddc_manager, vcenter_mgmt, nsx_manager_mgmt, vcf_operations_collector]
    source: [1, 5]

  - id: VCF-INV-003
    rule: "Workload-domain vCenter VMs MUST be placed in the mgmt domain cluster of the owning instance, not the workload domain cluster."
    why: "The mgmt domain is the management plane; workload domains host business workloads only."
    test: "fixture.infraStack entries for vcenter_wld live on a mgmt domain's initial cluster"
    source: [1, 5]

  - id: VCF-INV-010
    rule: "Per-fleet appliances (Operations, Automation, Fleet Mgmt) appear EXACTLY once across the entire fleet."
    test: |
      const perFleet = ['vcf_operations', 'vcf_automation', 'vcf_operations_fleet_management'];
      perFleet.forEach(id => {
        const count = fleet.instances.flatMap(i => i.domains)
          .flatMap(d => d.clusters).flatMap(c => c.infraStack)
          .filter(a => a.id === id).reduce((n, a) => n + a.instances, 0);
        assert(count === 1 || count === 3);   // 1 = simple, 3 = HA nodes of the same appliance
      });
    source: [3, 4, 10]

  - id: VCF-INV-011
    rule: "Per-fleet appliances MUST live on the mgmt domain of the INITIAL instance of the fleet."
    definition_initial_instance: "fleet.instances[0] by convention; or the instance flagged as `isInitial: true`."
    source: [3, 10]

  - id: VCF-INV-012
    rule: "Every VCF instance beyond the first MUST have a VCF Operations Collector (and, if Networks is enabled, a Networks Collector)."
    source: [3, 10]

  - id: VCF-INV-020
    rule: "NSX Manager may be shared across workload domains within the SAME VCF instance, never across instances."
    test: "For each nsx_manager_wld entry, assert all referencing workload domains share instance.id"
    source: [5, 11]

  - id: VCF-INV-021
    rule: "NSX Global Manager is present only if fleet.instances.length >= 2 AND federation.enabled == true."
    source: [8, 9]

  - id: VCF-INV-030
    rule: "Identity Broker mode MUST match fleet size: embedded when instances.length == 1 AND max_future_instances <= 1; otherwise appliance."
    soft_rule: true  # allowed for lab, warn in designer
    source: [6, 13]

  - id: VCF-INV-031
    rule: "5 instances per Identity Broker is a SOFT recommendation. If fleet.instances.length > 5, WARN (don't fail) and suggest multi-broker segmentation per VCF-SSO-003."
    severity: warn                 # NOT a CI-blocking rule — Broadcom uses 'recommended' not 'maximum'
    test: "if instances.length > 5 * count(identity_broker): emit warning — check VCF-SSO-003 segmentation"
    source: [6, 22, 23]

  - id: VCF-INV-032
    rule: "Fleet-level VCF Operations and VCF Automation MUST connect to exactly ONE Identity Broker, even when the fleet has multiple brokers."
    severity: critical
    test: "fleet.sso.fleet_services_broker_id is singular and references an existing broker"
    source: [24]

  - id: VCF-INV-060
    rule: "T0 gateway HA mode constrains Edge-node count: Active/Standby ≤ 2 Edge nodes, Active/Active ≤ 8 Edge nodes per single T0."
    severity: critical
    test: |
      for each t0 in fleet..t0_gateways:
        if t0.ha_mode == 'active-standby': assert t0.edge_nodes.length <= 2
        if t0.ha_mode == 'active-active':  assert t0.edge_nodes.length <= 8
    source: [25, 26]

  - id: VCF-INV-061
    rule: "Each Edge node hosts AT MOST one T0 gateway."
    severity: critical
    test: "for each edge_node: count(t0_gateways hosting this edge_node) <= 1"
    source: [26]

  - id: VCF-INV-062
    rule: "Stateful Active/Active T0 requires an even number of Edge nodes (2, 4, 6, or 8) — sub-clusters pair them."
    severity: critical
    test: "if t0.ha_mode == 'active-active' AND t0.stateful: assert t0.edge_nodes.length % 2 == 0"
    source: [26]

  - id: VCF-INV-063
    rule: "VCF Automation 'All Apps' and vSphere Supervisor REQUIRE Active/Standby T0. Engine MUST block deployment if feature is enabled without compatible T0."
    severity: critical
    test: |
      if cluster.vks_enabled OR instance.vcf_automation_all_apps:
        assert exists T0 with ha_mode == 'active-standby' in the NSX Manager scope
    source: [25]

  - id: VCF-INV-064
    rule: "Stateful A/A T0 configuration cannot be produced by the VCF Installer or vCenter guided Edge wizard. If a fixture declares stateful=true on an A/A T0, the design must be flagged as requiring Day-2 NSX Manager configuration."
    severity: warn
    test: |
      for each t0 in fixture:
        if t0.ha_mode == 'active-active' AND t0.stateful == true:
          emit warning('Requires Day-2 NSX Manager config — not producible via VCF Installer/vCenter wizard')
    source: [30, 31]

  - id: VCF-INV-065
    rule: "Each Edge node in an A/A T0 may have up to 2 uplinks; total T0 uplink ports = (Edge nodes) × 2, capped at 8 Edge nodes per T0."
    severity: info
    test: "for each a/a t0: sum(uplinks_per_edge) <= 16; edge_nodes.length <= 8"
    source: [29]

  - id: VCF-INV-040
    rule: "A stretched instance (instance.siteIds.length == 2) has ONE shared mgmt appliance stack, not duplicated per site."
    why: "The engine's stretched modeling assumes one set of mgmt VMs with vSphere stretched-cluster failover, not active/active per-site duplication."
    source: [engine.js computeInstance, 12]

  - id: VCF-INV-050
    rule: "Deployment profile determines mgmt appliance stack; the stack MUST match DEPLOYMENT_PROFILES[profile] exactly."
    profiles:
      simple:                         "~8 VMs"
      ha:                             "~14 VMs"
      haFederation:                   "~17 VMs — includes 3-node NSX Global Manager"
      haSiteProtection:               "~16 VMs — includes SRM + vSphere Replication"
      haFederationSiteProtection:     "~19 VMs — full enterprise stack"
    source: [engine.js DEPLOYMENT_PROFILES]

  - id: VCF-INV-051
    rule: "haFederation / haFederationSiteProtection profiles REQUIRE fleet.instances.length >= 2."
    test: "if profile includes 'Federation': assert fleet has at least 2 instances in federation pair"
    source: [8, 9, engine.js]
```

---

## 4. Fleet Topologies

Four canonical topologies. A fixture should declare one of these (or be explicitly labelled as custom).

### 4.1 `single-instance-single-site` (VCF-TOPO-001)
```yaml
shape:
  fleet.instances: 1
  instance.siteIds: 1
  instance.domains: "1 mgmt + 0..N wld"
appliance_placement:
  all: "co-located in mgmt domain of the sole instance"
identity_broker: embedded          # embedded allowed and preferred
operations_automation: "in this instance's mgmt domain"
federation: not-applicable
example_fixture: test-fixtures/v5/minimal-simple.json
```

### 4.2 `single-instance-stretched` (VCF-TOPO-002)
```yaml
shape:
  fleet.instances: 1
  instance.siteIds: 2
  clusters: "some or all with placement == 'stretched'"
appliance_placement:
  all: "ONE set of mgmt VMs (not duplicated per site); vSphere HA across AZs"
  vsan_witness: "required per stretched vSAN cluster, at a THIRD external site"
identity_broker: embedded
operations_automation: "single stretched mgmt domain"
federation: not-applicable
example_fixture: test-fixtures/v5/stretched-50-50.json
```

### 4.3 `multi-instance-fleet` (VCF-TOPO-003)
```yaml
shape:
  fleet.instances: "2..N"
  each_instance: "independent mgmt domain, may or may not be stretched"
appliance_placement:
  per-fleet:
    - vcf_operations, vcf_automation, vcf_operations_fleet_management: "initial instance only"
    - vcf_identity_broker (appliance mode): "typically initial instance"
  per-instance:
    - sddc_manager, vcenter_mgmt, nsx_manager_mgmt: "every instance"
    - vcf_operations_collector: "every instance (including initial)"
federation:
  nsx_global_manager:
    condition: "only if L2/L3 extension required across instances"
    placement: "active in instance[0] mgmt, standby in instance[1] mgmt"
sso_boundary_options:
  - one_broker_all_instances: "max 5 instances (VCF-INV-031)"
  - one_broker_per_region:    "balanced; multiple brokers"
  - one_broker_per_instance:  "embedded mode per instance; smallest blast radius"
example_fixture: test-fixtures/v5/enterprise-full.json
```

### 4.4 `multi-region-fleet` (VCF-TOPO-004)
```yaml
shape:
  fleet.instances: "2..N across multiple geographic regions"
  each_instance: "independent; typically not stretched between regions"
appliance_placement:
  per-fleet:
    hosted_region: "explicitly chosen 'primary' region"
    dr_consideration: "fleet-level services need a DR plan (they are SPOF for the fleet)"
identity_broker: "appliance mode, one-per-region recommended (VCF-SSO-020)"
federation:
  nsx_global_manager: "active in primary region, standby in secondary; MANUAL failover"
operations:
  site_ha_design:         "analytics cluster stretched across AZs within region"
  disaster_recovery_design: "secondary Operations instance in another region via VR/SRM"
source: [3, 12]
```

---

## 5. Deployment Pathways (How the Placement Comes to Be)

```yaml
pathways:
  - id: VCF-PATH-001
    name: greenfield
    description: "New fleet + new instance. VCF Installer deploys everything into a freshly-built mgmt cluster (≥ 4 hosts for vSAN/NFS/VMFS-FC)."
    deploys:
      - "SDDC Manager, mgmt vCenter, mgmt NSX Manager, VCF Operations (+ collector), VCF Operations Fleet Mgmt, VCF Automation"
    skips:
      - "NSX Edge (post-install), NSX Global Manager (only if federating later), Identity Broker appliance (optional)"
    source: [9]

  - id: VCF-PATH-002
    name: expand-fleet
    description: "Add an instance to an existing fleet. Fleet-level services are REUSED."
    deploys:
      - "New instance: SDDC Manager, mgmt vCenter, mgmt NSX Manager, VCF Operations COLLECTOR"
    reuses:
      - "Existing VCF Operations, VCF Automation, Fleet Management appliance in the original instance"
    source: [9, 10]

  - id: VCF-PATH-003
    name: converge
    description: "Convert a non-VCF vCenter into a VCF mgmt cluster."
    deploys:
      - "SDDC Manager, fresh NSX install, Operations/Automation as needed"
    preserves:
      - "Existing vCenter VM, existing vSAN/external storage"
    source: [9]

  - id: VCF-PATH-004
    name: import
    description: "Import an existing vCenter as a WORKLOAD DOMAIN into an existing VCF instance."
    deploys:
      - "No new mgmt appliances — vCenter becomes a wld vCenter"
    source: [9]
```

---

## 5.5 Fleet-Level Services Relocation & DR (VCF-DR-*)

Formal supportability of moving fleet-level appliances to a secondary instance during DR is defined in the **Site Protection and Disaster Recovery for VCF** validated solution (source 18). Two distinct mechanisms apply, and the secondary instance is a **warm standby — it does not actively run Operations/Automation** until failover is triggered.

```yaml
fleet_dr:

  - id: VCF-DR-001
    rule: "Fleet-level appliance relocation to a secondary VCF instance is formally SUPPORTED via VMware Live Recovery (VLR, formerly SRM) + vSphere Replication OR via backup/restore, depending on component."
    authority: "Broadcom VVS: Site Protection and Disaster Recovery for VMware Cloud Foundation (source 18)"
    mode: "warm standby — secondary instance exists but fleet services remain dormant until failover"

  - id: VCF-DR-010
    protection_method: replication           # Continuous VLR/vSphere Replication protection
    components:
      - vcf_operations                       # analytics nodes
      - vcf_operations_fleet_management
      - vcf_operations_logs
      - vcf_operations_networks
    failover: "automated via VLR recovery plan; components fail over TOGETHER as a protection group"
    source: [18]

  - id: VCF-DR-020
    protection_method: backup_restore        # No active replication — redeploy from backup
    components:
      - vcf_automation
      - vcf_identity_broker
    failover: "manual — deploy fresh appliances at recovery site, restore from known-good backup"
    source: [18]

  - id: VCF-DR-030
    rule: "Per-instance appliances (SDDC Manager, mgmt vCenter, mgmt NSX Manager) are NOT failed over as fleet services. Each instance's own SDDC Manager is scoped to its own instance and stays with that instance's site."
    corollary: "DR of a VCF INSTANCE (not just the fleet plane) uses stretched clusters (metro) or a second VCF instance in another region (geographic DR) — see VCF-TOPO-004."
    source: [10, 12]

  - id: VCF-DR-040
    rule: "Fleet services must NOT run actively on both primary and secondary instances simultaneously. The 'one Operations / one Automation per fleet' invariant (VCF-INV-010) still holds during steady state and during DR."
    test: "During DR drill fixtures, the standby instance has placeholder stack entries flagged `status: standby` that do NOT count toward VCF-INV-010 active-instance count."
    source: [18]

  - id: VCF-DR-050
    backup_targets:
      - vcf_operations_fleet_management_inventory:
          procedure: "Synchronize VCF Operations Fleet Management inventory before a planned failover (source 19)"
          frequency: "before every planned migration; continuous in production"
    source: [19]
```

**Implication for the studio / test fixtures**: a "multi-region DR" fixture should model *two* VCF instances where the secondary instance:
- Has its own SDDC Manager, mgmt vCenter, mgmt NSX (always active)
- Has placeholder/standby fleet appliances flagged as non-running (no sizing counted toward fleet-level invariants)
- References a VLR/vSphere Replication pairing with the primary instance

---

## 6. Fleet Scaling Guidance (Non-Binding Limits)

```yaml
fleet_scaling:
  max_instances_per_fleet:
    formal_limit: "no fixed maximum"
    practical_driver: "VCF Operations sizing (objects + metrics capacity)"
    source_note: "William Lam confirms no hard cap; bounded by Operations size class"
  vcf_operations_sizing:
    xlarge_single_node:  { objects: 100000, metrics: "20M" }
    xlarge_16_node:      { objects: 1000000, metrics: "126M" }
    bottleneck: "network latency + bandwidth between Collectors and Operations"
  identity_broker_sizing:
    appliance_mode_per_broker: 5         # max instances
    scaling_pattern: "add additional brokers (e.g. per region) once > 5 instances"
source: [4, 6]
```

---

## 7. Mapping to Codebase

```yaml
engine_js_symbols:
  APPLIANCE_DB:       "27+ entries; keys match `id` column above. Verify placement scope matches rule table."
  DEPLOYMENT_PROFILES:
    keys_that_must_exist: [simple, ha, haFederation, haSiteProtection, haFederationSiteProtection]
    link_to: VCF-INV-050
  computeInstance:    "Asserts stretched instance uses ONE shared appliance stack (VCF-INV-040)."
  analyzeStretchedFailover: "Uses policy.minHosts; witness required when externalStorage == false (VCF-APP-080)."

fixture_fields_to_validate:
  - fleet.instances[].domains[].type in ['mgmt', 'wld']          # VCF-INV-001
  - fleet.instances[].domains[].placement in ['local', 'stretched']
  - fleet.instances[].siteIds.length in [1, 2]                   # VCF-INV-040
  - fleet.instances[].domains[].clusters[].infraStack[].id in APPLIANCE_DB
  - fleet.instances[].deploymentProfile in DEPLOYMENT_PROFILES

suggested_new_test_files:
  - tests/unit/placement-rules.test.js:
      purpose: "Load every v5 fixture and assert VCF-INV-001 .. VCF-INV-051"
  - tests/property/fleet-invariants.test.js:
      purpose: "Property-based (fast-check) generation that fuzzes fleet shapes against invariants"
  - tests/unit/deployment-profile-stacks.test.js:
      purpose: "Assert each profile produces the expected infraStack per VCF-INV-050"
```

---

## 8. Suggested Fixture Coverage

The repo currently has `minimal-simple`, `minimal-ha`, `stretched-50-50`, `enterprise-full`. To cover the topologies and rules above:

```yaml
recommended_new_fixtures:
  - file: test-fixtures/v5/multi-instance-2.json
    topology: VCF-TOPO-003
    instances: 2
    asserts: [VCF-INV-010, VCF-INV-011, VCF-INV-012]

  - file: test-fixtures/v5/multi-instance-federated.json
    topology: VCF-TOPO-003
    instances: 2
    deploymentProfile: haFederation
    asserts: [VCF-INV-021, VCF-INV-051, VCF-APP-040]

  - file: test-fixtures/v5/multi-region-dr.json
    topology: VCF-TOPO-004
    instances: 3
    deploymentProfile: haFederationSiteProtection
    asserts: [VCF-INV-031, VCF-APP-060, VCF-APP-061]

  - file: test-fixtures/v5/sso-appliance-over-5.json
    topology: VCF-TOPO-003
    instances: 6
    asserts: [VCF-INV-031]             # requires 2 identity brokers

  - file: test-fixtures/v5/workload-domain-shared-nsx.json
    topology: VCF-TOPO-001
    wld_count: 3
    asserts: [VCF-APP-005, VCF-INV-020]  # shared NSX Manager across 3 wld
```

---

## 9. Verification Plan

To prove this document is consistent with the engine:

1. `npm test` — existing 215 tests must still pass.
2. Create `tests/unit/placement-rules.test.js` that iterates every fixture in `test-fixtures/v5/` and asserts each `VCF-INV-*` rule.
3. Cross-check `APPLIANCE_DB` in `engine.js` against §2 — every `id` listed here should exist; every `placement` value should match.
4. Cross-check `DEPLOYMENT_PROFILES` against VCF-INV-050 — VM counts approximate; the stack composition must match.
5. Snapshot regression: `npm test -- -u` after any intentional placement change, then diff the `.snap.json` files to verify only the expected appliance stack moved.

---

## 10. Known Gaps in Research

**Resolved in follow-up research (2026-04-15):**
- ✅ **NSX Global Manager node count** — CONFIRMED 3+3 nodes (active cluster + standby cluster). Every NSX appliance cluster (Local Manager, Global Manager, workload NSX Manager) contains exactly 3 VMs; single-node is lab-only. Source 17. See VCF-APP-040.
- ✅ **NSX Edge cluster supportability** — Edge cluster on the management cluster is formally SUPPORTED and in fact REQUIRED for Aria Suite products. Min 2, max 10 Edge nodes per cluster. Four supported deployment models (Host FT, Rack FT, AZ FT w/ Edge HA, AZ FT w/ vSphere HA). Sharing across workload domains is supported IFF they share the same NSX Manager. Sources 11, 16. See VCF-APP-006.
- ✅ **Fleet services relocation / DR** — Formally SUPPORTED via VMware Live Recovery + vSphere Replication (for Operations, Ops Fleet Mgmt, Ops Logs, Ops Networks) or via backup/restore (for Automation, Identity Broker). Secondary instance is a **warm standby** — fleet services do NOT run actively on both sides. Source 18. See §5.5 (VCF-DR-*).

**Also resolved in third pass (2026-04-15):**
- ✅ **Operations for Networks Collector** — CONFIRMED. Platform cluster is fleet-wide (1 or 3 nodes) and deploys to the initial instance's mgmt-domain vCenter. Collector is per-monitored-scope (typically per workload domain OR per VCF instance). Default workload-domain workflow does NOT auto-deploy a Collector — it's opt-in per domain. 100% CPU/Memory reservation REQUIRED for support. Sources 20, 21. See VCF-APP-014.
- ✅ **Multi-IDB fleet patterns** — CONFIRMED as a formally documented design pattern. VCF 9.0 Design Library describes THREE SSO models (source 22): (1) Embedded per-instance, (2) Fleet-Wide (single broker), (3) Cross-Instance Segmentation (multiple brokers, each serving a subset). The 5-instance figure is a SOFT recommendation (VCF-INV-031 now `severity: warn`). Hard constraint: fleet-level services (Operations, Automation) bind to exactly ONE broker — captured as VCF-INV-032. Sources 22, 23, 24.
- ✅ **NSX Edge T0 HA limits** — CONFIRMED with authoritative numbers. Active/Standby = **2 Edge nodes max per T0** (elected active + standby); Active/Active = **8 Edge nodes max per T0**; each Edge node hosts exactly **1 T0**; stateful A/A requires an even Edge count. VCF Automation All Apps and VKS/Supervisor **require** Active/Standby T0. Sources 25, 26. See VCF-INV-060..063.

**Resolved in fourth pass (2026-04-15):**
- ✅ **Authoritative 8-Edge A/A limit citation** — Confirmed directly from Broadcom NSX 9.0 TechDocs "Add an NSX Tier-0 Gateway" page (source 29) with exact language: *"In an active-active configuration, when you create tier-0 uplink ports, you can associate each uplink port with up to eight NSX Edge transport nodes, and each NSX Edge node can have two uplinks."* This supersedes the community-thread citation as the primary source.
- ✅ **Configmax portal** — `configmax.broadcom.com` is an interactive tool (not static HTML), so it resists WebFetch scraping. For studio tests, the official NSX 9.0 TechDocs sources now cover the same ground and are citable.
- ✅ **Stateful A/A support matrix across deployment paths** — Confirmed from NSX 9.0 "Key Concepts Stateful Services" (source 30) and vrealize.it's VCF 9 Edge walkthrough (source 31):
  - **VCF Installer (greenfield)**: exposes both A/A and A/S as user-selectable HA modes; does NOT expose stateful A/A activation.
  - **vCenter guided Edge wizard (Day-2)**: exposes both A/A and A/S; does NOT expose stateful A/A activation.
  - **NSX Manager UI**: required to enable stateful services on A/A T0 (interface groups + sub-cluster formation).
  - Added as VCF-INV-064 (warn) — fixtures declaring `stateful_services: true` on an A/A T0 must be flagged as requiring Day-2 NSX Manager configuration.

---

## 11. Sources

1. [Components Nodes in VCF and vSphere Foundation (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/vcf-management-appliances.html) — canonical appliance list
2. *(intentionally not used — placeholder to keep numbering stable)*
3. [VCF Operations Detailed Design (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/vcf-operations-design.html) — HA node counts, Simple/HA/CA models
4. [VMware Cloud Foundation Fleet Deployment Models (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/vcf-operations-deployment-models.html) — four fleet designs
5. [Managing VCF Domains (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/working-with-workload-domains.html) — NSX Manager sharing rule
6. [Deployment Modes of the VCF Identity Broker (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/deployment-models-for-sso.html) — embedded vs appliance, 5-instance limit
7. [VCF Single Sign-On Architecture (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/fleet-management/what-is/sso-architecture.html) — SSO boundary, SDDC Manager exclusion
8. [Understanding NSX Federation (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/managing-nsx-t-in-multiple-locations/nsx-t-federation/overview-of-federation/understanding-federation.html) — active/standby Global Manager architecture
9. [Deployment Pathways for VMware Cloud Foundation 9 (VMware blog)](https://blogs.vmware.com/cloud-foundation/2025/07/03/vcf-9-0-deployment-pathways/) — greenfield, expand, converge, import
10. [Planning a Successful VCF 9.0 Deployment (VMware blog)](https://blogs.vmware.com/cloud-foundation/2025/07/28/planning-a-successful-vmware-cloud-foundation-9-0-deployment/) — HA sizing, mgmt vs wld
11. [VCF-9 Part 1: Introduction & Architecture (vStellar)](https://vstellar.com/2025/07/vcf-9-part-1-introduction-architecture/) — per-instance vs per-fleet scope
12. [VCF 9.0 GA Mental Model: Fleet Topologies and SSO Boundaries (Digital Thought Disruption)](https://digitalthoughtdisruption.com/2026/02/19/vcf-9-0-ga-fleet-topology-sso-boundaries/) — single/dual/multi-region topology rules
13. [VCF 9.0 GA Mental Model: Fleet Services vs Instance Management Planes (Digital Thought Disruption)](https://digitalthoughtdisruption.com/2026/02/17/vcf-9-0-ga-fleet-services-vs-instance-management-planes/) — service-scope table
14. [How many VCF Instances can a Fleet support? (William Lam)](https://williamlam.com/2025/10/how-many-vmware-cloud-foundation-vcf-instances-can-a-vcf-fleet-support.html) — no hard cap; bounded by Operations sizing
15. [Multiple VCF SSO Identity Providers for a Fleet (William Lam)](https://williamlam.com/2025/10/multiple-vcf-sso-identity-providers-for-vmware-cloud-foundation-vcf-fleet.html) — embedded vs external vIDB patterns
16. [NSX Edge Cluster Models (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/vmware-cloud-foundation-concepts/nsx-edge-cluster-models.html) — four supported Edge cluster models
17. [NSX Edge Cluster & VPC Configuration in VCF 9 (gibsonvirt)](https://gibsonvirt.com/2025/06/18/vcf-9-nsx-edge-cluster-deployment-and-vpc-configuration/) + [Centralized Network Connectivity with Edge Clusters (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/managing-network-connectivity-in-vcenter/managing-centralized-network-connectivity-with-edge-clusters.html) — Edge min 2 / max 10 nodes, Active/Standby vs Active/Active T0 limits; confirms 3-VM rule for every NSX appliance cluster
18. [Detailed Design for Site Protection and Disaster Recovery for VMware Cloud Foundation (Broadcom VVS)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/site-protection-and-disaster-recovery-for-vmware-cloud-foundation/detailed-design-for-site-protection-and-disaster-recovery.html) — replication vs backup/restore matrix for fleet components; warm-standby model
19. [Synchronize VCF Operations Fleet Management Inventory for SRM (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vvs/9-X/site-protection-and-disaster-recovery-for-vmware-cloud-foundation/operational-guidance-for-site-protection-vvs/failover-of-the-sddc-management-applications/synchronize-the-vrealize-suite-lifecycle-manager-environment-inventory.html) — pre-failover inventory sync procedure
20. [Deploying VCF Operations for Networks (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/deployment/deploying-a-new-vmware-cloud-foundation-or-vmware-vsphere-foundation-private-cloud-/manual-deployment-of-components-to-complete-your-vcf-platform/installing-vcf-networks.html) — Platform + Collector deploy to mgmt-domain vCenter; collector optional per workload domain
21. [VCF Operations for Networks Detailed Design (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/vcf-operations-design/vcf-operations-for-networks-deployment-models.html) + [VCF Operations 9.0 Sizing Guidelines (Broadcom KB 397782)](https://knowledge.broadcom.com/external/article/397782/vcf-operations-90-sizing-guidelines.html) — Simple (1-node) vs HA (3-node) Platform, Collector scaling (100/200 per Platform), 10K-VM/4M-flow cluster trigger, mandatory 100% CPU/RAM reservation
22. [VCF Fleet-Wide Single Sign-On Model (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/single-sign-on-models/-fleet.html) + [Single Sign-On Instance Models index](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/single-sign-on-instance-models.html) — three documented SSO models: Embedded, Fleet-Wide single broker, Cross-Instance multi-broker
23. [Appliance VCF Identity Broker Model (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/design/design-library/single-sign-on-instance-models/external-vidb.html) — "recommended up to 5 VCF instances" — soft recommendation, not hard cap
24. [VCF 9.0 GA Mental Model Part 6: Topology and Identity Boundaries (Digital Thought Disruption)](https://digitalthoughtdisruption.com/2026/02/21/vcf-9-0-topology-design/) — fleet-level services (Ops, Automation) constrained to ONE broker; multi-broker segmentation pattern
25. [Configure Centralized Network Connectivity with Edge Clusters (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/building-your-private-cloud-infrastructure/managing-network-connectivity-in-vcenter/managing-centralized-network-connectivity-with-edge-clusters.html) + [VPC Centralized Network Connectivity With Guided Edge Deployment (VMware blog)](https://blogs.vmware.com/cloud-foundation/2025/06/25/vpc-centralized-network-connectivity-with-guided-edge-deployment/) — "VCF Automation All Apps and vCenter Supervisor require Centralized Active/Standby"; 2-node A/S uplink cap
26. [Broadcom community: Tier-0 gateway number per Edge cluster](https://community.broadcom.com/discussion/tier-0-gateway-number-per-edge-cluster) — Broadcom employee statement citing NSX-T Configuration Maximums: "A single T0 can span up to 8 edge nodes in an active-active configuration"; "Tier-0 Gateways per Edge Node: 1". SUPERSEDED by source 29 as the authoritative citation but retained for historical traceability.
27. [Configure BGP in NSX (Broadcom TechDocs, VCF 9.0)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/tier-0-gateways/configure-bgp-in-nsx.html) — BGP default state differs by HA mode: A/A has BGP enabled + ASN 65000 default; A/S has BGP disabled + no default ASN
28. [Configure and Deploy an NSX Edge Transport Node (Broadcom TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/vsphere-supervisor-installation-and-configuration/deploying-supervisor-with-nsx-networking/create-an-nsx-edge-transport-node.html) — vSphere Supervisor requires active-standby T0 with Edge cluster in its NSX Manager scope
29. **[Add an NSX Tier-0 Gateway (Broadcom NSX 9.0 TechDocs — AUTHORITATIVE)](https://techdocs.broadcom.com/us/en/vmware-cis/nsx/vmware-nsx/9-0/administration-guide/tier-0-gateways/add-an-nsx-tier-0-gateway.html)** — exact official text: *"In an active-active configuration, when you create tier-0 uplink ports, you can associate each uplink port with up to eight NSX Edge transport nodes, and each NSX Edge node can have two uplinks."* This is now the primary citation for the 8-node A/A T0 limit, replacing the community thread.
30. [Key Concepts Stateful Services on NSX Tier-0 / Tier-1 (Broadcom NSX 9.0 TechDocs)](https://techdocs.broadcom.com/us/en/vmware-cis/vcf/vcf-9-0-and-later/9-0/advanced-network-management/administration-guide/tier-0-gateways/stateful-services-on-tier-0-and-tier-1-gateways/key-concepts-stateful-services.html) — stateful services ARE supported on A/A T0; require even node count forming sub-clusters of 2; interface groups required; NSX Manager-driven (not VCF Installer)
31. [VCF9 NSX Edge Setup — What Has Changed (vrealize.it, VCF 9.0 walkthrough)](https://vrealize.it/2025/07/11/vcf9-nsx-edge-setup-what-has-changed/) — VCF 9.0 vCenter guided Edge wizard exposes HA Mode dropdown (both A/A and A/S); stateful A/A configuration not in wizard, Day-2 via NSX Manager UI only

---

*To refresh this document: re-run `/deep-research` on the same topic, compare new TechDocs content against §2 and §3, bump rule revisions only when Broadcom publishes a change (not when phrasing shifts). The rule IDs (`VCF-APP-*`, `VCF-INV-*`, `VCF-TOPO-*`) are the stable contract between this document and the test suite.*
