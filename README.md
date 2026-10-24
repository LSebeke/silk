# Silk

FoundryVTT v14 module for DSA5: map a Story on a World Canvas, branch Adventures from a Canon, Reveal content to players. Spec: [`docs/spec/v1.md`](docs/spec/v1.md). Vocabulary: [`GLOSSARY.md`](GLOSSARY.md).

Install: manifest URL `https://github.com/LSebeke/silk/releases/latest/download/module.json`.

## Development

Node per `.nvmrc`, npm.

```sh
npm ci
npm run dev        # vite build --watch into dist/
npm test           # vitest (+ fast-check)
npm run typecheck  # svelte-check, strict TS
npm run lint       # eslint + prettier --check   (npm run format to fix)
npm run build
```

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

### CI and releases

CI runs typecheck, lint, unit tests, build and a bundle-size gate: the gzipped entry chunk may grow at most 10% vs `main` unless the PR has the `allow-size` label (lazy chunks are reported only).

Pushing a tag `vX.Y.Z` builds, stamps the version into `module.json` and publishes a GitHub Release with `module.json` and `silk.zip`.

`fvtt-types` pulls `pixi.js` from GitHub; `package.json` `overrides` swap those for registry versions so `npm ci` needs no git access.
