# 5. Limitations Analysis for FCTF and KYPO

In its fourth update, the FCTF system has been significantly improved in both architecture and overall system performance. Improvements focus on challenge deployment on Kubernetes, an open gateway mechanism connecting to challenge pods, monitoring, audit logging, health checks, and challenge version management.

However, after a comprehensive review of the system, some limitations remain:

## 5.1 Application Logic and Data Integrity Limitation for FCTF

The limitation highlighted in this issue relates to administrators updating the Docker image of a challenge in a competition while the team's challenge instance is still running on Kubernetes. This type of update is dangerous because it changes the source code, configuration, or flags inside the container. When a challenge has logical errors and the organizers need to upload a patch, the old instances may no longer be valid in terms of content.

### The Core Issue
When an administrator updates an image that needs fixing, the system:
1. Creates a new `ChallengeVersion`.
2. Changes the challenge state to `hidden` or `pending deployment`.
3. Deletes Redis keys in the format `deploy_challenge_{challenge_id}_*`.
4. Triggers Argo Workflow to build the new image.

**However**, the system does not issue a stop command to running pods on Kubernetes before clearing the cache. The system clears the Redis cache and triggers the build but leaves the pod running in the cluster.

The core issue isn't the image update itself, but rather **clearing the cache before reclaiming actual resources**.
- The Redis key acts as a link between the challenge, the team, and their respective namespaces/pods.
- When the Redis key is deleted, other services no longer have the information to know which instance is running, which namespace needs to be deleted, which team is holding the instance, and how much time is left on the instance's timer.
- Meanwhile, Kubernetes continues to maintain the pod because it hasn't received the delete namespace or delete pod command.
- This creates an inconsistent state: Redis represents the "no instance" state, while Kubernetes represents the "instance is still running" state.

### Potential Consequences
- **Challenge Hidden During Build**: When `challenge.state` is set to `hidden`, contestants might no longer see the challenge on the UI, harming the contest experience and availability.
- **Missing Cleanup after Correct Submission**: The correct flag submission flow has logic that automatically calls `ForceStopChallenge` if the challenge requires deployment and the Redis deployment key still exists. If the Redis key has been deleted previously due to an image update or a caching issue, the Redis check condition returns `false`, and the backend will not call cleanup (in `ChallengeController.cs`, this depends on `KeyExistsAsync(deploymentKey)`).
- **"False Already-Started State" Error**: The system rejects the request to start a new challenge because it assumes the candidate has already started it, even though the interface no longer shows a running challenge instance. This occurs because the cache clearing mechanism only clears Redis keys in the format `deploy_challenge_{challenge_id}_*`, but does not simultaneously clear or update the Redis `ZSET` used to manage the list of running challenges for each team.
  - **`deploymentKey`** stores instance details such as deployment status, access URL, end time, and Kubernetes namespace.
  - **Team-based ZSET** (`active_deploys_team_{teamId}`) stores `challenge_id` as an index to control the number of running challenges. This prevents the same team from starting the same challenge, returning the error: `"You have already started this challenge."`.
  - Users are forced to wait until the score in the Redis `ZSET` expires (i.e., wait until the time limit of the old instance expires) for Redis's self-healing mechanism to remove the expired member.

## 5.2 Infrastructure, Resource Management and Challenge Lifecycle Management Limitation for FCTF

The limitations identified in this group of issues relate to the time gap between the end of the competition and the complete recovery of Kubernetes resources.

### Identified Issues
1. **Lack of Automatic `StopAll` Trigger at Contest End**:
   - The system lacks an automatic `StopAll` trigger mechanism when the competition ends. It does not have any schedulers or hooks attached to the `end_date` event.
   - When the clock passes `end_time`, the `DuringCtfTimeOnly` filter only blocks new requests from contestants but does not send any signal to the cluster to recover resources.
   - The entire cleanup depends on either:
     - The admin actively clicking the **"Stop All"** button on the Monitoring page.
     - The `challenge.TimeLimit` expiring and the CronJob deleting the namespace according to its TTL.
   - This creates a maximum gap equal to `MAX(TimeLimit)` minutes. For instance, if a challenge has a `TimeLimit` of 60 minutes and a contestant starts near the `end_date`, that pod continues to run for almost 60 minutes after the competition has ended.
2. **`StopAll` Lack of Retries and Weak Warning System**:
   - The `StopAll()` function in `DeployService.cs` calls `DeleteAllChallengeNamespaces()` only once.
   - If some namespaces are in a `Terminating` state, or the API server is under high load and returns an error, the function only writes `failCount` to the message and returns `HttpStatusCode.PartialContent` (HTTP 207).
   - There is no retry, no clear warning log, and no mechanism to notify the admin. The admin sees a successful response but namespaces may still be running.
3. **`ReconcileOrphanedCachesAsync` Only Fixes DB, Missing Redis**:
   - When the `DeploymentListener` briefly loses connection with Kubernetes and misses the pod's `Deleted` event, the `ReconcileOrphanedCachesAsync()` function is called upon reconnection.
   - While it detects the tracking orphan, it only updates `StoppedAt` in the database without calling `AtomicRemoveDeploymentZSet()`.
   - As a result, the Redis key `deploy_challenge_{id}_{teamId}` and the entry in `ZSET` `active_deploys_team_{teamId}` persist even after the pod has been deleted from Kubernetes.

### Current Self-Healing Defense Mechanisms
The current system has two independent defense mechanisms:
- **`cleanup-temp-namespaces` CronJob**: Runs every minute. It lists all namespaces with the label `ctf/temporary=true`, calculates age (`now - creationTimestamp`), and deletes any namespace whose age is greater than `TimeLimit + 30s`. This is a Kubernetes-layer safety grid independent of the application.
- **`DeploymentListener` catching K8s Deleted event**: When a namespace is deleted, the listener watches the stream for `WatchEventType.Deleted` to call `HandleDeletion()`, which then calls `AtomicRemoveDeploymentZSet()` to clean up Redis and updates `StoppedAt` in the database.

### The Impact
During the gap between `end_time` and when the CronJob deletes all pods, challenge pods continue to consume CPU and RAM. For a medium-sized competition with 50 teams, where each team runs two challenges simultaneously (allocating 256MB of RAM and 300MB of CPU per challenge), this leads to unnecessary infrastructure overhead and costs.

## 5.3 Limitations of Single-Contest-Oriented Architecture of FCTF

This limitation reflects the fact that FCTF version 4 was designed around a single competition running at a time. However, in reality, for training environments for system security and information security students, CTF-oriented competitions have a significant need for both testing and experimentation.

The current FCTF system does not handle this because the following entities are not consistently partitioned by `contest_id`:
- Challenges
- Teams
- Submissions
- Scoreboards
- Contest settings
- Redis keys
- Kubernetes resources

Therefore, the system cannot securely support multiple competitions simultaneously, as the data, runtime state, and infrastructure resources of the competitions are at risk of being mixed or affecting each other.

## 5.4 Limitations Regarding Cross-Platform Consistency Between FCTF and KYPO

### 5.4.1 Fragmented User Experience
FCTF and KYPO operate as two completely independent systems that contestants must interact with separately:
- **FCTF** manages CTF challenges.
- **KYPO** manages attack and defense scenarios.

The two platforms use different authentication mechanisms and do not share session state. Users must maintain two sessions simultaneously, navigate between two completely different interfaces, and lack the ability to track overall progress from a single point. Studies on usability in time-limited competition environments show that context switching between platforms reduces cognitive performance and increases error rates.

### 5.4.2 Non-uniform User Identification Model
FCTF uses an internal authentication mechanism (CTFd-based session), while KYPO uses Keycloak OIDC (OpenID Connect) to manage centralized identities with JWT-based access tokens. This inconsistency creates three major problems:
1. **No Single Sign-On (SSO)**: Candidates must log in separately on each platform.
2. **Disconnected Identities**: FCTF does not know which KYPO account corresponds to which user, preventing automatic assignment of access to the KYPO Training Instance when a candidate starts the challenge.
3. **Discrepant Score Management**: KYPO Training Run connects to Keycloak `user_id`, not FCTF `user_id`, causing a discrepancy in score synchronization.

## 5.5 Limitations in the Static Flag Verification Mechanism

In the current FCTF architecture, each challenge is configured with a fixed set of flags (static flags) stored in the database as a string of characters that is immutable over time and consistent across teams.

The Contestant Service layer verifies a submission by matching the input string against a list of valid answers for the corresponding challenge, without reference to the `team_id` or `instance_id` of the running pod.

### Consequence
- This mechanism reflects a design inherited from CTFd, where flags are specified as a challenge attribute rather than a session attribute.
- A correct flag string found by any team is considered a valid submission for all other teams in the same competition, even though FCTF implements execution environment isolation at the Kubernetes layer, with each team allocated a separate pod in an independent namespace.
