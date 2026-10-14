# 1. Silk is a FoundryVTT module

Silk is built as a FoundryVTT module, not as a standalone app or an Obsidian plugin.

## Context

The GM needs World State to flow both ways between the Story and the Foundry world, so that nothing has to be transcribed by hand after a Play Session. The GM also needs to use the canvas during a session (Reveal, status toggles, quick-add) and to import existing Foundry documents (for example DSA5 compendium content).

## Decision

Build Silk as a Foundry module. v1 targets the Foundry versions that the DSA5 system supports. Editing the Canon outside Foundry is deferred, but the Canon should stay in a form that makes it possible later.

## Consequences

- Two-way sync becomes in-process hooks instead of a network bridge.
- The canvas must perform well inside a Foundry window, next to Foundry's own PIXI canvas.
- Standalone and Obsidian variants are out of scope for now.
