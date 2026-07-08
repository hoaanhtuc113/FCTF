# 5.2 Security Requirements

| Security Requirement | Description |
| :--- | :--- |
| **Contest-scoped access control** | A user assigned to one contest must not view or modify teams, challenges, submissions, tickets, scoreboards, logs, awards, or runtime instances belonging to another contest unless explicitly granted cross-contest administrative privilege. |
| **Cross-contest data isolation** | The features need to be refactored; historical single-contest assumptions cannot leak data or runtime state across concurrent contests. |
| **KYPO identity binding** | The mapping shall be traceable by `team_id` and `contest_id`. Contestants shall not be required to manage a separate KYPO login manually during the FCTF challenge flow and must not know the account credentials for the KYPO system. |
| **Dynamic flag confidentiality** | For challenges configured with a dynamic flag type, the flag verification logic must perform a three-dimensional match: `flag_string == expected` AND `team_id == submitter_team_id` AND `contest_id == active_contest_id`. A flag value generated for Team A must never satisfy a submission by Team B, even if both teams are competing in the same contest with the same challenge. |
| **Secret management** | Credentials and access materials for Keycloak, KYPO CRP, Harbor, Redis, Kubernetes, and database connections shall not be hard-coded or exposed to contestants. |
| **Token-based KYPO redirect protection** | Redirect tokens or access materials shall be short-lived or otherwise constrained, transmitted through protected channels, and must not allow a team to access another team's Training Run. |
| **Role-based authorization** | Admin, Challenge Writer, Jury, and Contestant shall only access capabilities assigned to their role in assigned contests. |
| **Restricted Access to Security-Sensitive Tables** | The system shall restrict access to newly introduced database tables related to contest management, KYPO integration, training instances, contest authorization, and dynamic flag management. Access to these tables shall be granted only to authorized application services and privileged administrative operations. Unauthorized read, write, update, or delete operations shall be denied and logged for auditing purposes. |
