# 4. Existing System of KYPO System

## 4.1 System Architecture

KYPO is built on a microservices model, where each functional concern is packaged into a self-deploying service unit in the form of a Docker container. Inter-service communication is done entirely through clearly defined REST API contracts, allowing flexibility in scaling each component according to operational needs without requiring a complete platform redeployment.

The system is organized into three architectural layers:
1. **Presentation Layer**
2. **Backend Microservices Layer**
3. **Infrastructure and Automation Layer**

### Presentation Layer
The Presentation Layer is implemented through the **KYPO Angular Portal**, a web interface serving two distinct user groups: administrators and instructors on one side, and students on the other. The portal is responsible for:
- Receiving user interaction events including login, course registration, and lab creation.
- Forwarding the corresponding requests to backend services via REST.
- Reflecting the resulting system state back to the user, including lab availability, access credentials, and learning progress indicators.

### Backend Microservices Layer
The Backend Microservices layer forms the operational core of the system and includes the following main service units:
- **Authentication and Authorization**: Centrally managed by **Keycloak**, an OpenID Connect-compliant identity management system (OIDC). After successful authentication, Keycloak issues JWT access tokens that serve as authorization credentials for all downstream service interactions on the platform.
- **User Management Service**: Consumes these tokens to maintain user profiles, enforce role assignments, and provide identity context to other backend components as required.
- **Training Service**: The primary orchestrator for maintaining the entire lifecycle of training definitions, including scenario structure, level sequence, and lab topology configuration. It also manages learner progress through the training program.
- **Sandbox Service**: Acts as an infrastructure intermediary. When learners reach the stage requiring a live environment, the Training Service issues provisioning requests to the Sandbox Service. The Sandbox Service receives provisioning specifications from the Training Service, including the number of virtual machines, operating system image, and network topology requirements. It also coordinates the creation, lifecycle management, and revocation of sandbox instances. Internally, the Sandbox Service comprises two functional components:
  - **Sandbox API Gateway**: Handles provisioning requests.
  - **Sandbox Infrastructure Orchestration Engine**: Executes those requests against the underlying virtualization platform.

### Infrastructure and Automation Layer
The Infrastructure and Automation layer is responsible for translating environment provisioning requests from the business layer into actual virtual machine and network resources. This layer consists of three components that work sequentially together:
1. **OpenStack**: Acts as the cloud platform providing physical resources. Upon receiving a request to create an environment, OpenStack is responsible for starting virtual machines, setting up virtual internal networks, configuring firewall rules, and allocating IP addresses to each machine in the sandbox.
2. **Terraform**: Integrated by KYPO using an Infrastructure-as-Code model. Instead of manual configuration, the entire infrastructure of a sandbox is described by declarative code. Terraform reads this description and automatically creates the correct corresponding resources on OpenStack, ensuring that every sandbox created has a consistent structure and is accurately reproducible.
3. **Ansible**: Activated after the virtual machines have successfully started. Ansible handles the internal configuration of each virtual machine according to the training scenario requirements, including installing specialized security tools, creating simulated vulnerabilities for trainees to practice exploiting, and setting up the initial conditions of the scenario.

### Overall System Workflow
The overall system workflow unfolds sequentially as follows:
1. Users log in via the portal and receive an authentication token from Keycloak.
2. Based on this token, the user initiates a training session.
3. The Training Service confirms the request and forwards the environment creation command to the Sandbox Service.
4. The Sandbox Service calls Terraform to set up the infrastructure on OpenStack.
5. The Sandbox Service calls Ansible to finalize the internal configuration of the virtual machines.
6. Once the entire process is complete, the system notifies the portal, and the learner is granted access to their private lab environment to begin practicing.

## 4.2 Sandbox Lifecycle Management

The sandbox subsystem is one of the most operationally significant components of the KYPO platform.

- **Sandbox Definition**: Serves as the declarative blueprint of a lab environment, specifying the network topology, virtual machine components, operating system image, and provisioning scripts. Each definition is stored as a versioned Git repository, allowing for reproducibility and change management throughout training cycles.
- **Pools**: Created from a Sandbox Definition to manage the allocation and use of sandbox resources at runtime. A pool is bound to a specific definition and manages the provisioning of multiple Sandbox Instances concurrently from that definition.
- **Sandbox Instances**: Form completely independent, isolated execution environments, allocated to a specific learner or training group.

### Provisioning Lifecycle
The provisioning lifecycle of a sandbox instance progresses through three sequential phases:
1. **Infrastructure Creation**: Set up via Terraform.
2. **Network Configuration**: Done via Ansible.
3. **Provisioning Content**: Deployment of scenario-specific contents and scripts.

Each transition phase goes through a set of clearly defined operational states such as:
- `Waiting`
- `Running`
- `Completed`
- `Failed`

### Monitoring and Management
- **Error Handling**: Targeted retry operations are supported in case of phase-level errors.
- **Logging**: Administrators are provided with detailed process monitoring through phase-by-phase log access, supporting rapid troubleshooting.
- **Locking Mechanism**: When assigned to a training session, sandbox instances are locked to prevent unintentional modification or deletion during active use.
- **API and Portal Access**: Lifecycle operations including locking, unlocking, and forced deletion can be performed through both the management portal and programmable API endpoints.

## 4.3 Training Framework and Assessment Logic

The pedagogical content model in KYPO is organized around two main entity types:
- **Training Definition**: Defines the complete structure of a training course, including the sequence of levels, the associated sandbox topology, and the instructional content for each stage.
- **Training Run**: Represents a learner's execution session within an instance and maintains an authoritative state regarding that learner's progress, accumulated score, and current level position.

### Levels Supported
Within a Training Definition, two main types of levels are supported:
1. **Training Level**: Presents a practical task in a lab environment, requiring learners to find and submit a series of flags as proof of task completion.
2. **Assessment Level**: Presents structured knowledge assessment items, supporting:
   - Multiple-Choice Questions (MCQs)
   - Fill-in-the-Blank Questions (FFQs)
   - Extended Matching Questions (EMI)

*Note*: **Training Instance** binds a Training Definition to an operational deployment configuration and enforces access control over enrollment.

### Scoring Logic
- **Training Levels**: Follows a penalty-based deduction model:
  - The maximum achievable score for a level is reduced when learners use optional hints during practice.
  - If a learner chooses to view the entire solution, the penalty is set equal to the level's maximum score, resulting in a score of zero for that level.
  - Submitting an incorrect flag increases the submission counter but does not directly decrease the score.
- **Assessment Levels**: Points are calculated for each individual question.
  - Each correct answer contributes its assigned point value to the level's total score.
  - Each incorrect answer incurs a predefined penalty deduction.
  - Accumulated level points are transferred to the training run's assessment score upon completion of the level.

### Flag Verification Mechanism
- Uses **exact string comparison** without case normalization or whitespace truncation, placing a strict accuracy requirement on submissions.
- Once a level has been answered through correct flag submission or assessment completion, resubmissions are rejected to prevent retrospective score manipulation.

## 4.4 Data Collection and Observation Skills

KYPO provides structured data collection capabilities for both operational monitoring and post-training analysis. Throughout the training run, the platform logs:
- **Network Traffic**: System and network traffic generated within the sandbox environment.
- **Behavioral Traces**: Activity logs related to offensive and defensive actions.
- **Event Timeline**: A time-stamped timeline recording the sequence of significant events in each session.
