export const systemDesignContent = `
# System Design

To overcome historical limitations with API bottlenecks and pod orchestration limits, FCTF Version 4 implements a highly decoupled, event-driven microservice architecture stacked on top of a lightweight K3s cluster.

## Decoupled Deployment Layer

In traditional setups, the core backend synchronously communicates with the Kubernetes API to spin up challenge pods. Under heavy load (e.g., hundreds of students clicking "Start Instance" simultaneously), this architecture collapses due to controller congestion.

**FCTF fixes this by implementing an asynchronous event queue:**

1. **Deployment Center**: The core monolith triggers a deployment request and immediately returns a "Pending" state to the user. Behind the scenes, it pushes a deployment message to **RabbitMQ**.
2. **RabbitMQ Message Broker**: Acts as the decoupled buffer handling bursts of requests effectively.
3. **Deployment Consumer & Argo Workflows**: Sharded worker nodes pull messages from RabbitMQ and pipe them into **Argo Workflows**. Argo manages the actual K8s job orchestration, ensuring resources are constrained via sophisticated capacity checks.
4. **Deployment Listener**: A self-healing reconciliation loop that constantly monitors the K3s event stream and syncs the running Pod statuses back down to the Core MariaDB database.

## Microservices Topology

- \`FCTF-ManagementPlatform\`: The central monolithic core handling UI logic, routing, users, and DB connections.
- \`ChallengeGateway\`: The ingress proxy handling routing and token verification.
- \`ControlCenter\`: The suite encompassing the RabbitMQ consumers and Listener services.

## Infrastructure
The system runs via **K3s** orchestrator.
- A dedicated **Control Plane node** to ensure orchestration APIs remain responsive.
- Isolated, tainted **Worker network nodes** specifically sandboxed for challenge execution.
`;
