export const rulesContent = `
# Business Rules

To ensure a fair and stable competition, the FCTF Platform enforces a strict set of business and operational rules. These rules are implemented directly at the orchestration and application layers.

## Challenge Deployment Limits

1. **Concurrent Environments**: A single Contestant (or Team) is only allowed to have a limited number of active challenge instances simultaneously (typically 1 or 2, subject to contest configuration). 
2. **Rate Limiting**: To prevent API abuse and infrastructure strain, state transition requests (start, stop, renew) for challenges are rate-limited per user. 
3. **Environment Lifespan**: Challenge environments are spun up with a fixed Time-To-Live (TTL). Once the TTL expires, the environment is automatically terminated to reclaim cluster resources. Contestants must request a "renew" if they need more time.

## Scoring & Flags

1. **Dynamic Scoring**: Challenges employ a dynamic scoring decrease. The amount of points awarded for a flag decreases as more contestants solve the challenge, rewarding the fastest solvers.
2. **Flag Formats**: Flags usually follow a predefined deterministic regular expression (e.g., \`FCTF{...}\`).
3. **Submission Throttling**: Brute-forcing flags is strictly prohibited. The system enforces progressive timeouts for consecutive incorrect flag submissions.

## Networking

1. **Zero-Trust Access**: Every deployed challenge sits behind the **Challenge Gateway**. Direct exposure of Pod IPs is forbidden.
2. **Tokenized Authentication**: Contestants can only access their specific dynamic instance via a mathematically signed short-lived token validating their session.
`;
