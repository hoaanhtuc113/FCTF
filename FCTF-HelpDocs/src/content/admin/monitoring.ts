export const monitoringContent = `
# System Monitoring & Logs

Monitoring ensures competition integrity by verifying system uptime and highlighting abusive contestant behaviors (such as automated flag-bruteforcing or denial of service attempts).

## Real-time Pod Streaming (Log Detail)

In the event a contestant complains their challenge environment is "broken", Admins can directly tail the pod's logs.

- **Auto-Refresh Polling**: Instead of manual page reloads, the interface provides an automatic asynchronous loop pulling the latest container 'stdout' and 'stderr' directly from K3s.
- **Log Isolation**: Logs are strictly separated via unique deployment IDs, ensuring an Admin monitors the precise instance belonging to a complaining contestant without viewing generic cluster traffic.

## Gateway Request Logs

Challenge Pods do not have direct NodePorts; everything routes through the **Challenge Gateway**. 

Because of this, Admins have access to the **Request Log Detail** view. This exposes every single inbound HTTP transmission a user sent to their exploit target. This allows judges to:
- Trace exact web-based payloads.
- Identify unauthorized scanners (like SQLMap) if scanning is forbidden by contest rules.

## Action Logs (Audit Trail)

Auditing the overall flow of the contest is achievable via the Action Log table. The UI provides robust server-side search filters supporting IDs, usernames, action types, and categories.

**Tracked System Actions include:**
- 'SUBMIT_FLAG' (Indicates Correct/Incorrect attempts)
- 'START_CHALLENGE' / 'STOP_CHALLENGE'
- 'RENEW_INSTANCE'

> [!TIP]
> The entire filtered state of the Action Log dataset can be exported natively to a **.XLSX** file. Organizers use this to create custom offline data models (like visualizing solve trajectories) for post-contest writeup reports.
`;
