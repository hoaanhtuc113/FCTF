# FCTF Platform

FCTF is a microservices-based CTF platform designed to run large-scale competitions with dynamic challenge deployment, isolated runtime environments, and full lifecycle management on container/Kubernetes infrastructure.

The system helps organizers operate competitions reliably at scale while providing contestants with a smooth experience across registration, challenge solving, flag submission, and scoreboard tracking.

## Features

- Dynamic challenge deployment per session for stronger isolation and security.
- Central gateway for request routing, rate limiting, and access control.
- Modern contestant portal optimized for fast and intuitive competition workflows.
- Control Center for challenge, user, and system status administration.
- Deployment listener/consumer components for automated service lifecycle operations.
- Data migration and synchronization support from legacy CTF platforms.
- Gateway test suite (quick/all/race/load) for functional and performance validation.
- Docker and K3s manifest-based infrastructure for easier staging/production deployment.

## Quick Start

Recommended installation flow:

1. Run **Setup master** on the master node.
2. Run **Setup worker** on each worker node to join the cluster (requires master URL and master token).
3. Return to the master node and run **Install FCTF**.
4. Run **Setup Harbor** on the master node.

### Prerequisites

- Ubuntu on all nodes (master and workers)
- `sudo` privileges
- Repository available on each node

```bash
git clone <repo-url> FCTF
cd FCTF
chmod +x manage.sh
```

### Step 1: Set up the master node

```bash
./manage.sh
```

Select:

- `1) Setup master`

This installs K3s server and prints the worker join token at the end.

### Step 2: Set up worker nodes and join the cluster

On each worker node:

```bash
cd FCTF
./manage.sh
```

Select:

- `2) Setup worker`

When prompted, provide:

- Master URL (example: `https://10.x.x.x:6443`)
- Master token (from Step 1 output)

Repeat for all worker nodes.

### Step 3: Install FCTF platform components

Back on the master node:

```bash
cd FCTF
./manage.sh
```

Select:

- `3) Install FCTF`

### Step 4: Set up Harbor

On the master node:

```bash
cd FCTF
./manage.sh
```

Select:

- `4) Setup harbor`

### Optional operations

`manage.sh` also provides:

- `5) Setup CI/CD`
- `6) Get Argo token`

### Environment-specific configuration checklist (Important)

Before running production deployment, review and update the following values based on your target environment:

- **NFS server IP in PV manifests**  
	Update the NFS server address in PersistentVolume files under the K3s manifests (NFS-backed storage).

- **Nginx domain**  
	Update ingress/nginx hostnames and related domain references to match your actual public domain.

- **Rancher domain in `rancher-values.yaml`**  
	Ensure Rancher hostname/domain values are set correctly for your environment.

- **ConfigMaps and Secrets**  
	Review all application configuration and secret values (URLs, keys, credentials, feature flags, etc.).

- **Helm credentials (accounts/passwords)**  
	Replace default or placeholder usernames/passwords in Helm values files (database, RabbitMQ, Redis, Harbor, and other components).

> All items above must be adjusted per environment (dev/staging/prod) before installation.

## Uninstall

Use the management menu:

```bash
./manage.sh
```

Select:

- `7) Uninstall`

Then choose one of the following:

- `1) Uninstall worker`: remove a worker node
- `2) Uninstall master`: remove the master node and related resources

Recommended order:

1. Uninstall all worker nodes first.
2. Uninstall the master node last.

## For more information

https://hoaanhtuc113.github.io/FCTF



