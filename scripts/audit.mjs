// Dependency audit gate: `npm audit` at moderate and above, minus advisories reviewed below.
//   node scripts/audit.mjs
// Each entry names the package it was reviewed for: the same advisory reaching another package, or
// any new advisory, fails. Remove an entry once the fix has landed; a stale entry is reported.
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
 * @param {{ vulnerabilities?: Record<string, { via: (string | Advisory)[] }>, metadata?: object, error?: unknown, message?: string }} report npm audit --json
 * @param {Record<string, { pkg: string }>} [reviewed]
 * @returns {{ failing: Advisory[], accepted: Advisory[], stale: string[] }}
 */
export function judgeAudit(report, reviewed = REVIEWED) {
  // A failed audit (registry down, endpoint error) still prints JSON, without a report: fail closed.
  if (report.error || !report.vulnerabilities || !report.metadata)
    throw new Error(`npm audit gave no report: ${report.message ?? JSON.stringify(report)}`);
  // One advisory can cover several packages, each with its own entry under the same URL.
  /** @type {Map<string, Advisory>} */
  const advisories = new Map();
  for (const vuln of Object.values(report.vulnerabilities))
    for (const via of vuln.via)
      if (typeof via !== 'string') advisories.set(`${via.url} ${via.name}`, via);
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

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let out;
  try {
    out = execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    out = /** @type {{ stdout?: string }} */ (error).stdout;
    if (!out) throw error;
  }
  let verdict;
  try {
    verdict = judgeAudit(JSON.parse(out));
  } catch (error) {
    console.error(`::error::${/** @type {Error} */ (error).message}`);
    process.exit(1);
  }
  const { failing, accepted, stale } = verdict;
  const line = (/** @type {Advisory} */ a) => `${a.severity} ${a.name}: ${a.title} ${a.url}`;
  for (const a of accepted)
    console.log(`reviewed: ${line(a)} (${REVIEWED[a.url.split('/').pop() ?? '']?.reason})`);
  for (const id of stale)
    console.log(`::warning::${id} is no longer reported; remove it from scripts/audit.mjs`);
  for (const a of failing) console.error(`::error::${line(a)}`);
  process.exit(failing.length ? 1 : 0);
}
