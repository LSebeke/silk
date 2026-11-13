# 3. Every UI action is a command

Every Garn UI action runs as a named command from the core's command registry. Buttons, keys and context menus only invoke commands. The registry is exposed as `game.modules.get('garn').api`, and each interactive element carries a stable `data-garn-*` attribute.

## Context

Agents write almost all of Garn's code, and the GM does not want to repeat UI tests by hand. Automated tests, and an LLM working from Claude Code, must be able to drive Garn the way a GM does.

## Decision

- UI code holds no logic that cannot be reached without a click: if an action exists, it is a command.
- Tests and LLMs call the same commands the UI calls, through the API or through Playwright on `data-garn-*` hooks.
- In v1 the API is documented but **unstable**: it may change between releases without notice.
- In v1 an MCP server wraps the API for development and testing only.

## Considered Options

- **Drive the UI only through DOM selectors**: rejected, because canvas tests become brittle and an LLM has to operate pixels.
- **A separate test-only API**: rejected, because it drifts away from the paths the UI really takes.

## Consequences

- Every new feature adds its commands first and its UI second.
- An LLM-driven import of written adventures (post-v1) can build on the API without new plumbing.
