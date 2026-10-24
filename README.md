# Silk

FoundryVTT v14 module for DSA5: map a Story on a World Canvas, branch Adventures from a Canon, Reveal content to players. Spec: [`docs/spec/v1.md`](docs/spec/v1.md). Vocabulary: [`GLOSSARY.md`](GLOSSARY.md).

Install: manifest URL `https://github.com/LSebeke/silk/releases/latest/download/module.json`.

## Spoiler secrecy

Silk keeps unrevealed content out of the **player UI**. It does not stop a player who opens the browser console ([ADR 0002](docs/adr/0002-spoiler-secrecy-casual-player-only.md)).

- **Console leak**: Foundry sends every journal page to every client, NONE ownership included. Unrevealed Info Blocks, Silk flags (incl. the real image behind a hooded one) and Canon JSON loaded for the player canvas can be read from the console. Core Foundry and DSA5 leak GM content the same way.
- **Data folder exposure**: Foundry serves the Data folder without login. The Canon lives under an unguessable `Data/silk/<random 128-bit id>/`, which keeps out people who don't know the path. Players learn the path when their client loads Canon data.
- **FILES_BROWSE**: a role with "Use File Browser" can list `Data/silk/` and open the Canon directly. Foundry grants it to Trusted Players by default. Silk shows the GM a one-time notice on load if any non-GM role has it; remove it in _Configure Permissions_ if that matters to your table.

## Development

Node per `.nvmrc`, npm.

```sh
npm ci
npm run dev        # vite build --watch into dist/
npm test           # vitest (+ fast-check)
npm run typecheck  # svelte-check, strict TS
npm run lint       # eslint + prettier --check   (npm run format to fix)
npm run build
npm run test:e2e   # build + Playwright against headless Foundry (local only)
```

**E2E** (`e2e/`, spec §14): each worker starts headless Foundry on a free port with a throwaway data dir (license copied, `dsa5` and `dist/` symlinked), creates and launches world `silk-test-<run>`, enables Silk, adds user `Player`, and deletes everything afterwards. It never sees `silk-dev`. Tests are `*.e2e.ts` and use the `gm` / `player` page fixtures from `e2e/fixtures.ts`. Env overrides: `FOUNDRY_MAIN`, `FOUNDRY_USER_DATA`. One-time: `npx playwright install chromium`.

**Dev loop** (no HMR): symlink `dist/` into Foundry once, run `npm run dev`, press F5 after each rebuild.

```sh
ln -s "$PWD/dist" ~/.local/share/FoundryVTT/Data/modules/silk
```

### Layout and conventions

- `src/core/` pure logic, no Foundry globals (eslint enforces). Unit-tested.
- `src/adapter/` everything that touches Foundry/DSA5. Write functions that take the Foundry call as an injected parameter (see `settings.ts`, `keybindings.ts`) so they test without Foundry.
- `src/ui/` Svelte 5 windows. Each window extends `SvelteApplication` (ApplicationV2, mounts in `_replaceHTML`). Heavy windows are loaded with `import()` so they land in `dist/chunks/`, not the entry bundle.
- `src/module.ts` entry: wires layers on Foundry hooks.
- `public/` copied as-is into `dist/`: `module.json`, `lang/{en,de}.json`, `assets/`.
- Tests sit next to the code as `*.test.ts`.

**Commands** ([ADR 0003](docs/adr/0003-every-ui-action-is-a-command.md)): every UI action is a command `{ name, title, keys?, available(ctx), run(args) }`, named `area.verb` per spec §15. A feature exports its commands (e.g. `src/ui/canvas/commands.ts`), `module.ts` registers them. Buttons, menus and keys only call `registry.run(name, args)`; `keys` become Foundry keybindings automatically. Interactive elements get a `data-silk-*` attribute. The registry is `game.modules.get('silk').api`.

**Settings**: add to `SETTINGS` in `src/adapter/settings.ts`, its type to `src/types/silk.d.ts`, and DE + EN strings (a test checks both).

### Dev MCP server

`tools/mcp/` is a dev/test-only MCP server (stdio) over the command API; it is not part of `dist/`. Each registry command becomes a tool, dots mapped to underscores (`canvas.open` → `canvas_open`); tool args are the command's args object. It drives a Foundry page with Playwright and calls `game.modules.get('silk').api`, connecting on the first tool call, so start Foundry with Silk enabled first.

```sh
claude mcp add silk -- node tools/mcp/main.ts --url http://localhost:30000 --executable /usr/bin/chromium
# options: --cdp <endpoint> (attach to a running browser's /game tab instead of launching),
#          --user <name> (default Gamemaster), --password, --headed
```

### CI and releases

CI runs typecheck, lint, unit tests, build and a bundle-size gate: the gzipped entry chunk may grow at most 10% vs `main` unless the PR has the `allow-size` label (lazy chunks are reported only).

Pushing a tag `vX.Y.Z` builds, stamps the version into `module.json` and publishes a GitHub Release with `module.json` and `silk.zip`.

`fvtt-types` pulls `pixi.js` from GitHub; `package.json` `overrides` swap those for registry versions so `npm ci` needs no git access.
