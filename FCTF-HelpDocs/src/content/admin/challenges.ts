export const challengesContent = `
# Challenge Operations

Behind every Jeopardy-style match, the FCTF Platform supports rich challenge deployment, dynamic scoring algorithms, and powerful version controls.

## Deploy Configurations (Container Limits)

When an organizer decides to host a challenge requiring an isolated runtime pod (like a Web or Pwn challenge), the Admin or Challenge Writer configures specific constraints to prevent clustering bottlenecks.

- **CPU / Memory Requests & Limits**: Bounding the pod's resources. E.g., setting a hard '100m' CPU limit to prevent a runaway exploit script from destroying the node.
- **gVisor Sandbox Override**: A critical toggle allowing the pod to be virtualized under a secure application-layer kernel instead of bridging directly to the worker node. Highly recommended for arbitrary-code-execution challenges.
- **Max Deploy Count**: A hard ceiling on how many different users can deploy this specific image simultaneously.

## Dynamic Scoring Mechanics

FCTF heavily relies on dynamic scoring to reward quick solvers while maintaining point inflation logic.

- **Decay Function**: The mathematical curve reducing the reward payload:
  - 'Linear': Decreases points at a constant, fixed rate per solve.
  - 'Logarithmic': Drops the score dramatically on earlier solves, flattening out later.
- **Initial & Minimum Values**: The challenge starts at its exact 'Initial Value' on solve 0, and ceases decaying once it hits the 'Minimum Value'.

## Challenge Version Control (Rollbacks)

Updating a docker image mid-contest can accidentally introduce broken libraries, risking the integrity of the match. For this reason, FCTF introduced a **Version History** feature.

| Attribute Tracked | Function / Visibility |
|-------------------|--------------------------------|
| 'Image Tag'       | Validates which specific digest the container pulls from Harbor. |
| 'Active Status'   | Indicates which version is heavily utilized right now. |
| 'Resource Limits' | Shows if limits were accidentally shifted causing OOM crashes. |

**Rolling Back**: If a newly published challenge is broken, an Admin can click **Rollback** on a stable historic version. Doing this immediately restores previous configurations and triggers an automated **Argo Workflow** to orchestrate the K8s tear-down and rebuild sequence seamlessly.
`;
