export const securityContent = `
# Security & Isolation

Given the volatile nature of a Capture The Flag competition, hosting applications intentionally built to be exploited carries severe risks. FCTF implements a defense-in-depth security model to ensure contestant exploits cannot affect the host infrastructure.

## Runtime Isolation (gVisor)

Standard Docker containers share the host kernel. If a contestant achieves Container Escape, the entire worker node is compromised. 
FCTF patches this by enforcing **gVisor sandboxing** on all challenge pods. gVisor replaces the host kernel with an application-layer kernel overlay, completely sandboxing syscalls. Even if root is obtained within a challenge container, the hypervisor boundary remains intact.

## Network Zero-Trust

1. **Default-Deny Network Policies**: By default, K3s pods can communicate with each other. FCTF implements strict \`NetworkPolicies\` ensuring that Challenge Pod A cannot scan or communicate with Challenge Pod B.
2. **Egress Blocking**: Challenge pods are completely restricted from initiating outbound traffic to the internet, preventing reverse shells unless explicitly allowed by the Challenge Writer.
3. **Challenge Gateway Authorization**: Pods are not exposed directly via NodePorts. To access a pod, traffic must flow through the **Challenge Gateway**. The Gateway rejects any HTTP request lacking a cryptographically signed JSON Web Token matching the contestant's session and the target pod's identity.

## Least Privilege Data Access

Internal microservices operate under absolute least privilege:
- **MariaDB / Redis ACLs**: Microservices only have credentials scoped to their exact operational needs. The Deployment Listener can write to deployment states, but cannot alter User scores.
- **Atomic Operations**: Redis Lua scripts are aggressively utilized to prevent race conditions during massive bursts of flag submissions and instance spawning.
- **Kubernetes RBAC**: Argo Workflows and the Deployment Listener use locked-down ServiceAccounts bounded explicitly to the namespace where challenges reside.
`;
