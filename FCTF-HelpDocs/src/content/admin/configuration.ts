export const configurationContent = `
# Configuration Hub (Configure Settings)

The **Configure Settings** function acts as the central hub for Admins to quickly edit and uniformly apply global configurations without manually altering database records.

## General Settings

The General tab controls the core behaviors available to participants:
- **Captain Only Settings**: Toggle whether only Team Captains are allowed to submit flags or start challenge instances. 
- **Concurrent Deployment Limit**: Sets the maximum number of dynamically deployed challenges a user or team can run concurrently across the entire platform.

## Visibility, Start & End Times

Precision timing controls ensure automated contest pacing:
- **Contest Start & End Time**: Explicitly defines the timeframe during which challenges can be accessed and flags can be submitted. Outside of this window, submissions drop.
- **Frozen Scoreboard Time**: To build suspense near the end of the competition, Admins can set a freeze time. After this timestamp, the public scoreboard stops updating, but users continue accumulating hidden points.

## Data Import & Export

FCTF supports robust migration tools out-of-the-box:
- **Challenge JSON Format**: Allows Challenge Writers to mass-import challenges using the structured CTFd-style format.
- **User & Team Exports**: Admins can export the raw list of candidates and teams to a '.csv' or '.xlsx' format, allowing organizers to quickly email cleartext credentials to contestants before a match begins.

> [!WARNING]
> Warning: Altering the *Start/End Time* while a contest is mid-flight will immediately disconnect all active contestant tokens if the current time suddenly falls out-of-bounds.
`;
