export const overviewContent = `
# Getting Started

Welcome to the **FCTF Platform Documentation**. 

The **FCTF Platform (Version 4.0)** is an advanced Capture The Flag (CTF) system built to serve information security students at FPT University. While the platform has historical roots in standard CTF architectures like CTFd, Version 4 has been heavily customized to provide unparalleled stability, isolated challenge orchestration, and a seamless contestant experience.

## What is FCTF?

FCTF acts as a centralized environment where contestants can safely participate in practical attack-defense and jeopardy-style scenarios. Contestants solve security challenges, submit flags to score points, and track their performance via dynamic scoreboards.

Unlike standard static platforms, FCTF provisions **isolated runtime environments** for individual challenges on-demand using Kubernetes.

## System Roles

The FCTF ecosystem is accessed and managed through four independent roles, each operating with specific privileges and features.

### 1. Admin
The highest authority account. The Admin is responsible for overall platform governance. 
- **Key Responsibilities**: Administering system configurations, creating and managing user accounts, organizing contests, handling support tickets, and monitoring system-wide resource logs.

### 2. Contestant
The direct participant in the competition. 
- **Key Responsibilities**: Accessing the challenge lists, spinning up and tearing down isolated challenge environments, submitting flags, requesting hints, and viewing the live scoreboard.

### 3. Jury
Acts as an observer to ensure fairness and transparency.
- **Key Responsibilities**: Monitoring contestant behavior, tracking submissions, viewing audit logs, and holding the authority to investigate anomalies in team information without possessing destructive administrative rights.

### 4. Challenge Writer
The domain expert who builds and updates the specific challenges.
- **Key Responsibilities**: Creating challenge images, defining deployment metadata, tracking deployment instances, and verifying stability prior to making challenges public to contestants.

---
`;
