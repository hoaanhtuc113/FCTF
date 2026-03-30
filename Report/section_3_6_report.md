# Section 3.6 — Security & Architecture Analysis

> Below is the proposed English text for section 3.6 in report1.
> It is based on the review of **55+ configuration-related commits** on the `v4/release/v4.0.0` branch between **March 11 – March 25, 2026**.

---

## 3.6. Security & Architecture Analysis

### 3.6.1. Scope and Review Methodology

Section 3.6 consolidates the infrastructure-level configuration changes committed during the most recent 14-day window on the `v4/release/v4.0.0` branch. The review focuses on six component groups that directly affect isolation, least privilege, and defense-in-depth in the production environment: **NetworkPolicy**, **RabbitMQ**, **MariaDB**, **Redis**, **NFS storage**, and **Argo Workflows / monitoring infrastructure**.

The objective of this section is to describe the state before and after each configuration change, thereby identifying the strengths that have been improved and the weaknesses that remain from an operational architecture perspective.

### 3.6.2. NetworkPolicy and Internal Network Segmentation

**Weakness (Before):** Prior to the recent changes, network segmentation between application workloads was not maintained as an enforced baseline. NetworkPolicy resources existed on a per-function-group basis, but their completeness and restrictiveness varied across update cycles. Some policies were tightened in one release and then relaxed in the next, resulting in an inconsistent security posture.

**Changes Made:** Over the review period, the system underwent a significant restructuring of its NetworkPolicy configuration. First, obsolete and redundant NetworkPolicy files for the gateway, RabbitMQ, and Redis were removed to eliminate conflicting rules. Then, dedicated NetworkPolicy files were created for gateway, RabbitMQ, and Redis with clearer ingress/egress constraints. Most importantly, a comprehensive `app-least-privilege.yaml` file (339 lines) was introduced, defining granular network access rules for all application workloads. This file enforces an allowlist model: each service is explicitly permitted to communicate only with the specific components it requires (for example, backend services may only reach the database on port 5432 and Redis on port 6379), while all other traffic is denied by default. Additionally, network policies were enabled for the monitoring stack (Prometheus, Alertmanager) to restrict the previously unrestricted observability plane.

**Remaining Weakness:** The architecture has shifted from a locally controlled model to a clearer allowlist-based model. However, the primary remaining concern is not the absence of policy files, but the **stability of the baseline across releases**. The commit history shows cycles of tightening, then loosening, then re-tightening. If the baseline is not locked down through automated admission control validation, the risk of security drift will recur with each deployment cycle.

### 3.6.3. RabbitMQ Permissions and Blast Radius Control

**Weakness (Before):** The initial RabbitMQ configuration prioritized operational convenience for the deployment flow, with access permissions broadly scoped to ensure services could communicate without friction. This approach resolved short-term operational needs but widened the blast radius: if authentication credentials were leaked, an attacker could potentially access or manipulate message queues across the entire system.

**Changes Made:** During the review period, the RabbitMQ configuration was enhanced with virtual host (vhost) support, isolating the deployment center and consumer services into dedicated vhosts. Secrets for RabbitMQ connections were updated for both the deployment center and consumer, and application code was refactored to use vhost-aware connection strings. A dedicated `rabbit-admin` user with explicit permissions was added, replacing the reliance on default administrative access.

**Remaining Weakness:** The system has moved from a model with unclear permission boundaries to a more structured vhost-based configuration. However, during some update cycles, admin-level permissions were still expanded temporarily before being restricted again. The operational discipline around RabbitMQ credentials needs to ensure that admin permissions do not become the runtime default, as the message queue directly affects the reliability and integrity of challenge deployment operations.

### 3.6.4. Database (MariaDB): Least Privilege, TLS, and Initialization Behavior

**Weakness (Before):** The previous database access model relied on shared or overly broad credentials at certain points, reducing the ability to isolate the blast radius when incidents occurred. It was also difficult to trace access precisely along service boundaries, as multiple services could use the same database account.

**Changes Made:** Three main improvements were implemented during the review period:

1. **Least-privilege service accounts:** Dedicated MariaDB accounts were created for each .NET service (Contestant BE, Deployment Center, Admin MVC), with SQL scripts defining granular GRANT statements scoped to only the tables and operations each service requires. The root user deletion logic was also enhanced to prevent residual superuser access.

2. **TLS configuration:** The MariaDB TLS configuration was updated to use `certCAFilename` for the SSL CA certificate path, standardizing encrypted connections to the database and ensuring that data in transit is protected.

3. **Audit plugin:** The MariaDB audit plugin was enabled with configured logging settings, adding the capability to record and post-audit database access events. This is a critical improvement for traceability and forensic analysis.

**Remaining Weakness:** The init scripts and permission bootstrapping process changed across multiple commits, indicating iterative refinement. This frequent modification means the designed permission state and the actual runtime state may diverge if no post-deployment verification step exists. The current improvements are significantly stronger than before, but a deterministic permission initialization process is needed to ensure consistency.

### 3.6.5. Redis ACL, Command Restrictions, and Keyspace Scope

**Weakness (Before):** Before hardening, Redis operated with broad key pattern permissions, reducing isolation between services and extending access capabilities beyond what was necessary. The default Redis user was still active, and any service with network access to Redis could execute any command against any key.

**Changes Made:** The Redis configuration was substantially hardened through multiple commits:

1. **Per-service user accounts:** Redis usernames were introduced per service, with each user granted only the commands and key patterns relevant to its function. The configuration evolved from initial broad permissions to progressively tighter ACL rules.

2. **Default user removal:** The default Redis user was explicitly removed to prevent anonymous or fallback access, ensuring that all connections must authenticate with a named service account.

3. **Command restrictions:** Dangerous commands were disabled, and the allowed command set was narrowed per user role. For example, rate-limiting-related users were granted only the specific commands they need (`incrbyfloat`, `mget`), while administrative commands were restricted.

4. **Key pattern narrowing:** Key pattern permissions were refined from broad wildcards to specific patterns aligned with each service's functional scope (e.g., auth keys, rate-limiting keys).

**Remaining Weakness:** The commit history reveals that during the tuning process, there were periods of temporary over-permission (broadening access) before the final restriction was applied. This pattern of expand-then-restrict indicates the need for operational discipline during hotfix updates, as Redis directly affects the integrity and fairness of the competition system (scores, session state, rate limiting).

### 3.6.6. NFS Hardening: Mount Options, ACL, and Export Policy

**Weakness (Before):** The previous NFS configuration prioritized compatibility and ease of use, with mount options and export policies that did not enforce security constraints uniformly across the storage flow. Per-service access restrictions were not fully synchronized, and the shared storage model allowed potential cross-service data access or payload injection.

**Changes Made:** Hardening was applied through two main vectors:

1. **Mount options on PersistentVolumes:** The `noexec` mount option was added to all PersistentVolumes (admin-mvc, contestant-be, filebrowser, start-challenge-workflow, up-challenge-workflow), preventing the execution of binaries directly from NFS-mounted storage. This is a critical defense-in-depth measure against exploits that attempt to store and execute malicious payloads on shared storage.

2. **NFS server-side configuration:** ACL configurations were introduced per service, and the NFS setup scripts and README were enhanced with detailed ACL installation steps. The direction moves toward `root_squash` enforcement and scoped export policies that limit each service's access to only its required subdirectory.

**Remaining Weakness:** The system has transitioned from a storage model that prioritized convenience to one that prioritizes least privilege. The remaining gap is **mandatory enforcement**: NFS hardening needs to become the default provisioning standard for every PV/PVC, rather than depending on manual per-operation application. Without this enforcement, new PVs created during scaling or recovery operations may not inherit the hardened configuration.

### 3.6.7. Argo Workflows and Monitoring Infrastructure Security

**Weakness (Before):** The Argo Workflows controller and monitoring components (Grafana, Prometheus) operated with default security configurations. The Argo controller lacked workflow restrictions, and communication between components used HTTP rather than HTTPS. Grafana dashboards were editable by default.

**Changes Made:** Multiple security improvements were applied:

1. **Argo workflow restrictions:** The `workflowRestrictions` parameter was added to the Argo controller configuration, enforcing security constraints on workflow processing and preventing unauthorized workflow templates from being executed.

2. **HTTPS enforcement:** The Argo Workflows URL was updated from HTTP to HTTPS, and HTTPS backend protocol with forced SSL redirect was added for the ingress configuration. This ensures that all communication between the deployment services and Argo is encrypted.

3. **Token management:** Argo workflow templates were updated to standardize preemption policies and improve token management, reducing the risk of token exposure. Service account configurations were refined, and `automountServiceAccountToken` handling was tightened.

4. **Grafana hardening:** Grafana was configured to disable default dashboard editing and additional security settings were applied, preventing unauthorized modification of monitoring dashboards.

5. **Service mesh (explored then reverted):** Linkerd service mesh was integrated to provide pod-to-pod mTLS across all application deployments and workflow templates. However, the Linkerd integration was subsequently removed due to operational complexity, and the annotations were cleaned from all workflow templates. This indicates that while in-transit encryption between pods is a recognized need, the specific implementation approach requires further evaluation.

**Remaining Weakness:** The removal of Linkerd means that pod-to-pod traffic encryption is currently not enforced at the infrastructure level. While HTTPS has been applied for external-facing and Argo communications, internal east-west traffic between services (e.g., backend to database, backend to Redis) still relies on the network isolation provided by NetworkPolicy rather than cryptographic protection. A lighter-weight mTLS solution or alternative approach should be considered for future iterations.

### 3.6.8. Namespace Security and Pod Security Admission

**Weakness (Before):** Challenge namespaces were created with default settings, lacking security labels and Pod Security Standards enforcement at the namespace level. This meant that challenge pods could be deployed without automated policy validation.

**Changes Made:** Namespace creation in the workflow templates was enhanced with security labels and settings, applying Pod Security Admission labels at namespace creation time. Conditional namespace creation was added for hardened challenges, and Rancher project block handling was refactored to properly map namespaces to project scopes with appropriate security settings.

**Remaining Weakness:** The namespace handling went through significant iteration (6+ commits addressing Rancher webhook responses and namespace apply logic), indicating that the integration between K3s namespace security and the Rancher management layer is complex. The operational stability of this mechanism under edge cases (webhook failures, concurrent namespace creation) should be verified through testing.

### 3.6.9. Overall Conclusion from the 14-Day Review Period

Across the review of all changes in the most recent 14 days, all six configuration groups demonstrate clear progress toward stronger security posture, particularly in the direction of **least privilege** and **default-deny hardening**.

The table below summarizes the before-and-after state for each configuration area:

| Configuration Area | Before (Weakness) | After (Improvement) | Remaining Gap |
|---|---|---|---|
| NetworkPolicy | Inconsistent, per-group policies with tightening/loosening cycles | Comprehensive allowlist model with `app-least-privilege.yaml` covering all workloads | Baseline stability across releases needs enforcement |
| RabbitMQ | Broad permissions for operational convenience | Vhost isolation, dedicated admin user, service-scoped credentials | Admin permissions occasionally expanded during updates |
| MariaDB | Shared credentials, no per-service accounts | Per-service least-privilege accounts, TLS standardization, audit plugin enabled | Init script stability across commits; need post-deploy verification |
| Redis | Default user active, broad key/command access | Per-service ACL users, default user removed, command/key patterns restricted | Temporary over-permission during tuning cycles |
| NFS | Convenience-first mount options, no ACL enforcement | `noexec` on all PVs, server-side ACL per service | Hardening not yet mandatory provisioning default |
| Argo & Monitoring | HTTP communication, no workflow restrictions, editable Grafana | HTTPS enforcement, `workflowRestrictions`, Grafana hardening | Pod-to-pod mTLS not yet resolved (Linkerd reverted) |

However, the most significant weakness observed is not in any individual component, but in the **stability of the security layers across the continuous commit chain**. Several configuration groups show a pattern of being tightened, then loosened, then tightened again. Therefore, the primary conclusion of this section is that the system has improved in the correct direction, but **stricter release discipline** is necessary to sustainably maintain the "post-improvement" state in Version 4 operations.
