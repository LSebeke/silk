// One-off rename of the working title Silk to Garn, kept in the repo until every open branch
// has been moved over. It is idempotent: run it on any branch, commit the result, done.
//   node scripts/rename-garn.mjs           rewrite tracked files and move silk-named paths
//   node scripts/rename-garn.mjs --check   list what would change, exit 1 if anything would
// Both words have four letters, so ids, padding and line lengths stay the same.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const SELF = 'scripts/rename-garn.mjs';
/** @type {[string, string][]} */
const CASES = [
  ['silk', 'garn'],
  ['Silk', 'Garn'],
  ['SILK', 'GARN'],
];
const ANY = new RegExp(CASES.map(([from]) => from).join('|'), 'g');
const TO = new Map(CASES);

/** @param {string} text */
const renameText = (text) => text.replace(ANY, (m) => TO.get(m) ?? m);

/** @param {string} path */
const renamePath = (path) => {
  const dir = path.slice(0, path.length - basename(path).length);
  return renameText(dir) + renameText(basename(path));
};

/**
 * The lockfile holds third-party names and hashes: only the package's own name is ours.
 * @param {string} text
 */
const renameLock = (text) => text.replaceAll('"name": "silk"', '"name": "garn"');

const git = (/** @type {string[]} */ ...args) =>
  execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);

function main() {
  const check = process.argv.includes('--check');
  const changed = [];
  for (const file of git('ls-files', '-z')) {
    if (file === SELF) continue;
    const buf = readFileSync(file);
    if (buf.includes(0)) continue; // binary
    const text = buf.toString('utf8');
    const next = file === 'package-lock.json' ? renameLock(text) : renameText(text);
    const target = renamePath(file);
    if (next === text && target === file) continue;
    changed.push(target === file ? file : `${file} -> ${target}`);
    if (check) continue;
    if (next !== text) writeFileSync(file, next);
    if (target !== file) execFileSync('git', ['mv', file, target]);
  }
  for (const line of changed) console.log(line);
  console.error(`${changed.length} file(s) ${check ? 'would change' : 'changed'}`);
  if (check && changed.length) process.exit(1);
}

main();
