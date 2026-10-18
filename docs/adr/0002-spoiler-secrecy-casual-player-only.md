# 2. Spoiler secrecy defends against the casual player only

Silk hides unrevealed content from players through Foundry's UI, not through real access control. A player who opens the browser console can read every spoiler.

## Context

Foundry sends every journal entry and page to every client, NONE ownership included, so ownership only gates the UI. Files in the Data folder are served to anyone, logged in or not. Core Foundry and DSA5 leak GM content to players in the same way.

## Decision

v1 defends against the casual player only: unrevealed content stays out of the player UI. Reading client data and guessing URLs are accepted and documented. The Canon stays in the Data folder under an unguessable directory (`Data/silk/<random 128-bit id>/`), which keeps outsiders out. The GM gets a warning when players can browse files.

## Considered Options

- **Defend against the inspecting player**: unrevealed content would never reach player clients. Rejected, because Foundry modules have no server-side store, and Reveal could no longer be driven by document ownership with the Foundry document as truth.
- **Canon in a world-DB store, e.g. a compendium**: unclear whether the server enforces pack ownership, and it would reopen the Canon storage decision.

## Consequences

- Unrevealed Info Blocks live in world journals at NONE, and the real image waits in a flag.
- Player clients may load Canon data (e.g. layout for the player canvas), which reveals the Canon path to them.
- Hiding the Canon path only keeps out people without a login. A player with file-browse rights can list `Data/silk/`.
