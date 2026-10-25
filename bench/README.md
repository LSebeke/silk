# Bench results

Fast-pan bench results (spec §14), one file per release: `results/<version>.json`. Each
file is the baseline for the next release. `results/local.json` (ad-hoc runs) is ignored.

## Run

```sh
npm run test:perf                          # writes results/local.json, prints the gate verdict
BENCH_VERSION=0.2.0 BENCH_MACHINE="GM RTX 2080" npm run test:perf   # release run
```

`test:perf` builds with the dev commands (`SILK_DEV=1`) and runs only the `@perf` Playwright
tests (`SILK_PERF=1`): reopen-restores-view timing, create-connected input count, and the
bench. The bench calls `dev.bench.fastPan { count, epf, ms }` for the 500 / 1000 / 2000
fixture (`dev.fixture.generate { count, seed: 1 }`) at 8 mousemoves per frame, 3 s each,
headless Chromium with GPU flags. Release runs belong on the reference machine (GM's RTX
2080); automated runs on other machines only report.

## Format

```json
{
  "version": "0.2.0",
  "date": "2026-10-25T12:00:00.000Z",
  "env": "Chrome/141.0.0.0 · 1600×900@1 · ANGLE (NVIDIA, RTX 2080 …) · GM RTX 2080",
  "results": [
    { "count": 500, "epf": 8, "ms": 3000, "fps": 60, "p99": 21, "p95": 18, "frames": 177 }
  ]
}
```

- `count`: fixture Elements; `epf`: mousemoves per frame; `ms`: pan duration.
- `fps`: average over the run; `p99` / `p95`: worst-1% / worst-5% frame in ms; `frames`: frames measured.
- Types: `BenchFile` in `src/core/dev/bench.ts`.

## Release gate

`benchVerdict` (`src/core/dev/bench.ts`), 500 fixture only: fails at avg < 55 fps, p99 > 70 ms,
or > 15% worse (fps or p99) than the newest committed `results/<version>.json`. 1000 / 2000 are
reported only. The GM also pans manually in Zen/Firefox at release.
