// Dependency audit gate: `npm audit` at moderate and above, minus advisories reviewed below.
//   node scripts/audit.mjs
// Each entry names the package it was reviewed for: the same advisory reaching another package, or
// any new advisory, fails. Remove an entry once the fix has landed; a stale entry is reported.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** @type {Record<string, { pkg: string, reason: string }>} */
export const REVIEWED = {
  'GHSA-g3hv-75wg-m249': {
    pkg: 'minimatch',
    reason: 'eslint and typescript-eslint match our own lint globs; not in dist/',
  },
  'GHSA-rmmh-p597-ppvv': {
    pkg: 'showdown',
    reason: 'dependency of fvtt-types (type declarations only); never imported, not in dist/',
  },
  'GHSA-cr32-g25g-vxjj': {
    pkg: 'showdown',
    reason: 'dependency of fvtt-types (type declarations only); never imported, not in dist/',
  },
  'GHSA-22g5-r2x5-97cx': {
    pkg: 'showdown',
    reason: 'dependency of fvtt-types (type declarations only); never imported, not in dist/',
  },
};

const GATED = new Set(['moderate', 'high', 'critical']);

/** @typedef {{ name: string, severity: string, url: string, title: string }} Advisory */

/**
 * @param {{ vulnerabilities?: Record<string, { via: (string | Advisory)[] }> }} report npm audit --json
 * @param {Record<string, { pkg: string }>} [reviewed]
 * @returns {{ failing: Advisory[], accepted: Advisory[], stale: string[] }}
 */
export function judgeAudit(report, reviewed = REVIEWED) {
  /** @type {Map<string, Advisory>} */
  const advisories = new Map();
  for (const vuln of Object.values(report.vulnerabilities ?? {}))
    for (const via of vuln.via) if (typeof via !== 'string') advisories.set(via.url, via);
  const failing = [];
  const accepted = [];
  const seen = new Set();
  for (const advisory of advisories.values()) {
    if (!GATED.has(advisory.severity)) continue;
    const id = advisory.url.split('/').pop() ?? '';
    if (reviewed[id]?.pkg === advisory.name) {
      accepted.push(advisory);
      seen.add(id);
    } else failing.push(advisory);
  }
  const stale = Object.keys(reviewed).filter((id) => !seen.has(id));
  return { failing, accepted, stale };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let out;
  try {
    out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    out = /** @type {{ stdout?: string }} */ (error).stdout;
    if (!out) throw error;
  }
  const { failing, accepted, stale } = judgeAudit(JSON.parse(out));
  const line = (/** @type {Advisory} */ a) => `${a.severity} ${a.name}: ${a.title} ${a.url}`;
  for (const a of accepted)
    console.log(`reviewed: ${line(a)} (${REVIEWED[a.url.split('/').pop() ?? '']?.reason})`);
  for (const id of stale)
    console.log(`::warning::${id} is no longer reported; remove it from scripts/audit.mjs`);
  for (const a of failing) console.error(`::error::${line(a)}`);
  process.exit(failing.length ? 1 : 0);
}
