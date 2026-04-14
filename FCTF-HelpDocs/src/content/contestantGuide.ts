export const contestantGuideContent = `
# Contestant Guide

The Contestant Portal is built to be resilient, lightning-fast, and deeply integrated with your runtime challenges.

## Navigating the Dashboard

Upon logging in, you are presented with the primary **Dashboard**. This is your hub for accessing ongoing contests, viewing the global scoreboard, and managing your team.

### Deploying a Challenge 

FCTF utilizes dynamic infrastructure. Some challenges require you to deploy a private server:
1. Select a challenge block from the jeopardy board.
2. Click **Start Instance**.
3. *Please wait a few seconds*. Behind the scenes, the **Deployment Consumer** provisions a private Kubernetes Pod exclusively for you.
4. Once ready, you will be provided a secure link. This link is proxied through our **Challenge Gateway** utilizing a uniquely signed access token.

### Submitting Flags

When you compromise the challenge and obtain the secret string, navigate back to the challenge block.
- Enter the flag in the submission box.
- Be careful: Invalid submissions incur progressive timeouts. Repeated guessing will lock your submission ability temporarily.

### Scoreboard and Progress

The **Scoreboard** updates in near real-time. Because challenges use dynamic scoring, your total points may fluctuate slightly as other teams solve the challenges you have already completed.
`;
