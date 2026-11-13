// Version gate: the version lives in the repo, never in the tag alone.
//   node scripts/versions.mjs            package.json, its lockfile, module.json and the download URL agree
//   node scripts/versions.mjs v1.2.3     ... and the release tag names that same version
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * @param {{ version?: string }} pkg package.json
 * @param {{ id?: string, version?: string, url?: string, manifest?: string, download?: string }} mod module.json
 * @param {string} [tag] release tag, `v` + version
 * @param {{ version?: string, packages?: Record<string, { version?: string }> }} [lock] package-lock.json
 * @returns {string[]} problems, empty when everything agrees
 */
export function checkVersions(pkg, mod, tag, lock) {
  const problems = [];
  const v = mod.version ?? '';
  if (!/^\d+\.\d+\.\d+$/.test(v)) problems.push(`module.json version "${v}" is not X.Y.Z`);
  if (pkg.version !== v) problems.push(`package.json ${pkg.version} != module.json ${v}`);
  if (lock && (lock.version !== v || lock.packages?.['']?.version !== v))
    problems.push(`package-lock.json version != module.json ${v}: bump with npm version`);
  // Foundry checks `manifest` for updates and installs from `download`: the first must follow the
  // latest release, the second must be this version's zip, named after the module id.
  const releases = `${mod.url}/releases`;
  const manifest = `${releases}/latest/download/module.json`;
  const download = `${releases}/download/v${v}/${mod.id}.zip`;
  if (mod.manifest !== manifest) problems.push(`module.json manifest must be ${manifest}`);
  if (mod.download !== download) problems.push(`module.json download must be ${download}`);
  if (tag !== undefined && tag !== `v${v}`) problems.push(`tag ${tag} != v${v} from module.json`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const read = (/** @type {string} */ file) => JSON.parse(readFileSync(file, 'utf8'));
  const problems = checkVersions(
    read('package.json'),
    read('public/module.json'),
    process.argv[2],
    read('package-lock.json'),
  );
  for (const problem of problems) console.error(problem);
  process.exit(problems.length ? 1 : 0);
}
