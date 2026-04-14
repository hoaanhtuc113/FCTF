---
title: FCTF Real Feature Systematization
description: Source-code-based inventory of implemented FCTF capabilities across contestant, admin, deployment, and gateway modules.
---

# FCTF Real Feature Systematization

## Purpose

This document inventories features that are implemented in the current repository and visible through real routes, services, and UI flows.

It is intended as an implementation reference, not a marketing roadmap.

## Review Scope

| Module | Repository path | Role |
| --- | --- | --- |
| Contestant Portal | `ContestantPortal/src/*` | Contestant UI and interaction flows |
| Contestant Service | `ControlCenterAndChallengeHostingServer/ContestantBE/*` | Contestant-facing API and policy enforcement |
| Deployment Center | `ControlCenterAndChallengeHostingServer/DeploymentCenter/*` | Deployment orchestration API |
| Deployment Consumer | `ControlCenterAndChallengeHostingServer/DeploymentConsumer/*` | Async deployment worker |
| Deployment Listener | `ControlCenterAndChallengeHostingServer/DeploymentListener/*` | Runtime reconciliation worker |
| Challenge Gateway | `ChallengeGateway/*` | Runtime access gateway (HTTP/TCP) |
| Admin Platform | `FCTF-ManagementPlatform/CTFd/*` | Admin/Jury/Challenge Writer workflows |
| Test suites | `Test/*` | Race, gateway, and stress validation |

## Contestant Feature Inventory

| Domain | Implemented capability | Surface |
| --- | --- | --- |
| Authentication | Contestant login/logout and session-based access control | Login, private routes |
| Team context | Team-linked identity context in header/profile | Layout, profile page |
| Contest timing | Event countdown and contest accessibility signaling | Layout timer + contest access checks |
| Discovery | Topic/category challenge listing and challenge detail open | Challenges page |
| Requirement checks | Prerequisite-aware lock behavior before challenge access | Challenge list/detail and API checks |
| Challenge content | Markdown description, PDF preview, attachment downloads | Challenge detail panel |
| Runtime start | Deploy-required challenge startup flow | `[+] Start Challenge` |
| Runtime state | Pending/health-check/running transitions | Challenge detail + instances table |
| Access token | Token retrieval and copy actions for gateway access | `[YOUR ACCESS TOKEN]` block |
| Protocol support | HTTP and TCP access modes by challenge protocol | Access block in challenge detail |
| Runtime stop | User-triggered stop and timeout-triggered auto-stop | Challenge detail and instances page |
| Flag submission | Correct/incorrect/already solved/rate-limited verdict handling | `[SUBMIT FLAG]` workflow |
| Attempt protection | Max attempts, cooldown windows, and captain-only submit/start policies | Submission + start controls |
| Hint economy | Hint unlock, score cost, and prerequisite controls | Hint grid in challenge detail |
| Scoreboard | Authenticated scoreboard, bracket filtering, freeze indicators | Scoreboard page |
| Public rankings | Public scoreboard view with policy-based access | `/public/scoreboard` |
| Team activity history | Search/filter team action logs by type/topic | Action Logs page |
| Ticket operations | Ticket create/list/view/delete (rule constrained) | Tickets + ticket detail |
| Profile management | Team rank, members, score progress, password change | Profile page |
| Instance operations | View active instances and perform `GO`/`STOP`/`REFRESH` | Instances page |

## Admin and Governance Feature Summary

The admin feature set is fully documented in `docs/product-and-features/admin/*` and includes:

- Account and team governance
- Challenge authoring and deploy/version lifecycle
- Runtime monitoring and intervention controls
- Submissions moderation and scoreboard administration
- Rewards query engine and analytics exports
- Ticket response and compliance-grade logging

## Deployment and Runtime Control Summary

| Domain | Implemented capability |
| --- | --- |
| Queue orchestration | Deployment requests buffered and executed asynchronously |
| Workflow runtime | Argo workflow-based build/deploy pipeline |
| State reconciliation | Listener aligns desired state with Kubernetes reality |
| Runtime isolation | Namespace-level segmentation and policy controls |
| Gateway security | Tokenized HTTP/TCP access with rate and connection limits |

## Key Behavior-Controlling Configuration Areas

Important configuration areas that materially affect contestant behavior include:

- Event timing and freeze windows
- Scoreboard visibility rules
- Captain-only start/submit policies
- Challenge concurrency and incorrect-submission rate limits
- Challenge requirement visibility and anonymization settings

## Testing and Operations Coverage

- `Test/RaceCondition`: concurrency and race-condition scenarios
- `Test/Gateway`: gateway auth, routing, limit, and load checks
- `Test/Stress`: broad endpoint stress coverage
- `manage.sh` and `FCTF-k3s-manifest/*`: setup and operational automation

## Alignment Notes

1. Feature documentation should be updated in the same pull request as behavior changes.
2. Contestant flow changes must update both:
   - [Contestant Features](./contestant-features)
   - [Contestant Guideline](./contestant/contestant-guideline)

## Conclusion

FCTF is an integrated competition platform with:

- A dedicated contestant experience layer
- Policy-enforced fairness and security controls
- Async deployment and runtime reconciliation
- Admin-grade governance and observability tooling

Use this page as the implementation index, then open role-specific pages for operational detail.
