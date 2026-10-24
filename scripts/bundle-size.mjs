// Bundle-size gate (spec §14): gzipped entry chunk, PR vs main.
//   node scripts/bundle-size.mjs measure [dist] > sizes.json
//   node scripts/bundle-size.mjs compare base.json head.json [--allow-size]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const MAX_GROWTH = 0.1;

/** @typedef {{ entry: number, lazy: Record<string, number> }} Sizes */

/** @param {string} dist @returns {Sizes} */
export function measureSizes(dist) {
  const gz = (/** @type {string} */ file) => gzipSync(readFileSync(file)).length;
  /** @type {Record<string, number>} */
  const lazy = {};
  for (const file of readdirSync(join(dist, 'chunks'), { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.js')) continue;
    const name = file.name.replace(/-[\w-]{8}\.js$/, '');
    lazy[name] = (lazy[name] ?? 0) + gz(join(dist, 'chunks', file.name));
  }
  return { entry: gz(join(dist, 'silk.js')), lazy };
}

/**
 * @param {Sizes} base
 * @param {Sizes} head
 * @param {{ allowSize?: boolean }} [options]
 */
export function compareSizes(base, head, { allowSize = false } = {}) {
  const growth = base.entry ? (head.entry - base.entry) / base.entry : 0;
  const pct = (/** @type {number} */ g) => `${g >= 0 ? '+' : ''}${(g * 100).toFixed(1)}%`;
  const lines = [`entry (gzip): ${base.entry} -> ${head.entry} B (${pct(growth)})`];
  for (const name of new Set([...Object.keys(base.lazy), ...Object.keys(head.lazy)])) {
    lines.push(
      `lazy ${name} (gzip, report only): ${base.lazy[name] ?? 0} -> ${head.lazy[name] ?? 0} B`,
    );
  }
  const tooBig = growth > MAX_GROWTH;
  if (tooBig)
    lines.push(
      allowSize
        ? 'entry grew > 10%, allowed by the allow-size label'
        : 'FAIL: entry grew > 10%. Add the allow-size label if this is intended.',
    );
  return { ok: !tooBig || allowSize, report: lines.join('\n') };
}

const [command, ...args] = process.argv.slice(2);
if (command === 'measure') {
  console.log(JSON.stringify(measureSizes(args[0] ?? 'dist')));
} else if (command === 'compare') {
  const read = (/** @type {string} */ f) => JSON.parse(readFileSync(f, 'utf8'));
  const result = compareSizes(read(String(args[0])), read(String(args[1])), {
    allowSize: args.includes('--allow-size'),
  });
  console.log(result.report);
  process.exitCode = result.ok ? 0 : 1;
}
