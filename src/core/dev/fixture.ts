/**
 * Perf fixture (spec §14): a seeded, deterministic Canon of `count` Elements in clusters of
 * ~60 with ~1.4 Connections each, shared by all perf tests. Port of the generator in
 * `prototype/canvas-fast-drag`. Pure; dev only.
 */
import type { CanonRecord } from '../canon';
import {
  check,
  connectionRecord,
  duplicateOf,
  validTypes,
  type ConnectionData,
} from '../connections';
import { elementRecord, type ElementClassId } from '../elements';

export interface FixtureArgs {
  count: number;
  seed: number;
}

/** mulberry32: small, fast, good enough for test data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Alrik', 'Rondra', 'Gerion', 'Yasmina', 'Thorn', 'Ulfhart', 'Selinde', 'Brin'];
const PLACES = ['Gareth', 'Thorwal', 'Punin', 'Festum', 'Havena', 'Kuslik', 'Warunk'];
const FREE: [string, ConnectionData['direction']][] = [
  ['loves', 'directed'],
  ['hates', 'directed'],
  ['serves', 'directed'],
  ['fears', 'directed'],
  ['knows about', 'directed'],
  ['are allies', 'mutual'],
  ['are rivals', 'mutual'],
];
/** Class weights (%) as in the prototype; Player Characters are never created by Silk. */
const WEIGHTS: [ElementClassId, number][] = [
  ['person', 31],
  ['creature', 6],
  ['location', 14],
  ['faction', 4],
  ['item', 14],
  ['event', 16],
  ['quest', 6],
  ['note', 9],
];

/** Cluster layout (prototype values): 60 per cluster, 8 columns of 230 × 140. */
const PER = 60;
const COLS = 8;
const CLUSTER_W = COLS * 230 + 260;
const CLUSTER_H = Math.ceil(PER / COLS) * 140 + 280;

export function generateFixture({ count, seed }: FixtureArgs): CanonRecord[] {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const randomClass = (): ElementClassId => {
    let r = random() * 100;
    for (const [id, w] of WEIGHTS) if ((r -= w) < 0) return id;
    return 'note';
  };
  const title = (cls: ElementClassId) => {
    switch (cls) {
      case 'location':
        return `${pick(PLACES)} ${pick(['Gate', 'Tavern', 'Temple', 'Harbour', 'Keep'])}`;
      case 'item':
        return `${pick(['Cursed', 'Old', 'Elven', 'Dwarven'])} ${pick(['Sword', 'Amulet', 'Map', 'Ring'])}`;
      case 'event':
        return `${pick(['Ambush', 'Feast', 'Duel', 'Fire', 'Trial'])} at ${pick(PLACES)}`;
      case 'quest':
        return `Find the ${pick(['heir', 'traitor', 'relic', 'ship'])}`;
      case 'faction':
        return `${pick(['Guild', 'Order', 'House'])} of ${pick(PLACES)}`;
      case 'note':
        return `Rumour #${Math.floor(random() * 99)}`;
      default:
        return `${pick(NAMES)} ${pick(['the Bold', `of ${pick(PLACES)}`, 'Ironhand'])}`;
    }
  };

  const prefix = `fx${seed.toString(36)}`;
  const clusters = Math.ceil(count / PER);
  const clusterCols = Math.ceil(Math.sqrt(clusters));
  const elements: { id: string; cls: ElementClassId; cluster: number }[] = [];
  const records = new Map<string, CanonRecord>();
  for (let i = 0; i < count; i++) {
    const cluster = Math.floor(i / PER);
    const k = i % PER;
    const cls = randomClass();
    const id = `${prefix}e${i}`;
    elements.push({ id, cls, cluster });
    records.set(
      id,
      elementRecord(id, {
        class: cls,
        name: title(cls),
        position: {
          x: (cluster % clusterCols) * CLUSTER_W + (k % COLS) * 230,
          y: Math.floor(cluster / clusterCols) * CLUSTER_H + Math.floor(k / COLS) * 140,
        },
      }),
    );
  }

  let c = 0;
  for (const a of elements) {
    const links = random() < 0.4 ? 2 : 1;
    for (let j = 0; j < links; j++) {
      // 85% within the cluster.
      const b =
        random() < 0.85
          ? elements[
              a.cluster * PER + Math.floor(random() * Math.min(PER, count - a.cluster * PER))
            ]
          : pick(elements);
      if (!b || b.id === a.id) continue;
      const behavioural = validTypes(a.cls, b.cls)[0];
      const id = `${prefix}c${c++}`;
      let data: ConnectionData | undefined;
      if (behavioural && random() < 0.7) {
        const candidate: ConnectionData = {
          from: a.id,
          to: b.id,
          type: behavioural,
          direction: 'directed',
          label: '',
        };
        // Keep the fixture valid: no replacements, cycles or duplicates.
        const verdict = check(records, candidate);
        if (verdict.ok && !verdict.replaces.length && !duplicateOf(records, candidate))
          data = candidate;
      }
      if (!data) {
        const [label, direction] = pick(FREE);
        data = { from: a.id, to: b.id, type: 'free', direction, label };
      }
      records.set(id, connectionRecord(id, data));
    }
  }
  return [...records.values()];
}
