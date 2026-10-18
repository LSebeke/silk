// PROTOTYPE, throwaway. Element Classes + Behavioural Connection rules from
// "Element Class catalogue" (#6) and "Behavioural Connection types" (#7).

const I = n => `icons/svg/${n}.svg`;
export const CLASSES = {
  Person: { icon: I('mystery-man'), color: '#b5533c', status: ['dead'] },
  Creature: { icon: I('terror'), color: '#7a4a8c', status: ['dead'] },
  'Player Character': { icon: I('statue'), color: '#2f7d4f', status: ['dead'] },
  Location: { icon: I('castle'), color: '#3b6ea8', status: [] },
  Faction: { icon: I('combat'), color: '#a8853b', status: [] },
  Item: { icon: I('item-bag'), color: '#8a6d4b', status: [] },
  Event: { icon: I('clockwork'), color: '#c07a20', status: ['happened'] },
  Quest: { icon: I('book'), color: '#4f7f8a', status: ['quest'] },
  Note: { icon: I('hanging-sign'), color: '#6b6b6b', status: [] },
};
export const CLASS_NAMES = Object.keys(CLASSES);

const ACTOR = ['Person', 'Creature', 'Player Character'];
export const BEHAV = {
  owns: { src: ACTOR, tgt: ['Item'] },
  'present at': { src: ['Person', 'Creature'], tgt: ['Event'] },
  'located in': { src: ['Item', 'Location'], tgt: ['Location'] },
  'takes place at': { src: ['Event'], tgt: ['Location'] },
};

export const validTypes = (a, b) =>
  Object.entries(BEHAV).filter(([, r]) => r.src.includes(a) && r.tgt.includes(b)).map(([k]) => k);

// Default type on create-from. `reverse`: the NEW element is the source.
export function createFromDefault(origin, created) {
  if (['Person', 'Creature'].includes(origin) && created === 'Item') return { kind: 'owns' };
  if (origin === 'Event' && ['Person', 'Creature'].includes(created)) return { kind: 'present at', reverse: true };
  if (origin === 'Location' && ['Location', 'Item'].includes(created)) return { kind: 'located in', reverse: true };
  if (origin === 'Location' && created === 'Event') return { kind: 'takes place at', reverse: true };
  return { kind: 'free' };
}

export const canFlip = (kind, srcCls, tgtCls) => kind !== 'free' && validTypes(tgtCls, srcCls).includes(kind);

const NAMES = ['Alrik', 'Rondra', 'Gerion', 'Yasmina', 'Thorn', 'Ulfhart', 'Selinde', 'Brin', 'Raidri', 'Hesindiane', 'Answin', 'Ardo', 'Leomar', 'Isora', 'Tsaiane'];
const PLACES = ['Gareth', 'Thorwal', 'Punin', 'Festum', 'Havena', 'Al\'Anfa', 'Kuslik', 'Warunk', 'Lowangen'];
const FREE = [['loves', 'ab'], ['hates', 'ab'], ['serves', 'ab'], ['fears', 'ab'], ['owes money to', 'ab'], ['are allies', 'mutual'], ['are rivals', 'mutual'], ['knows about', 'ab']];
const pick = a => a[Math.floor(Math.random() * a.length)];
const WEIGHTS = { Person: 30, Creature: 6, 'Player Character': 1, Location: 14, Faction: 4, Item: 14, Event: 16, Quest: 6, Note: 9 };
const randClass = () => { let r = Math.random() * 100; for (const [k, w] of Object.entries(WEIGHTS)) if ((r -= w) < 0) return k; return 'Note'; };
const title = cls => cls === 'Location' ? `${pick(PLACES)} ${pick(['Gate', 'Tavern', 'Temple', 'Harbour', 'Keep', 'Market'])}`
  : cls === 'Item' ? `${pick(['Cursed', 'Old', 'Elven', 'Dwarven'])} ${pick(['Sword', 'Amulet', 'Map', 'Letter', 'Ring'])}`
  : cls === 'Event' ? `${pick(['Ambush', 'Feast', 'Duel', 'Fire', 'Trial'])} at ${pick(PLACES)}`
  : cls === 'Quest' ? `Find the ${pick(['heir', 'traitor', 'relic', 'ship'])}`
  : cls === 'Faction' ? `${pick(['Guild', 'Order', 'House'])} of ${pick(PLACES)}`
  : cls === 'Note' ? `Rumour #${Math.floor(Math.random() * 99)}` : `${pick(NAMES)} ${pick(['the Bold', 'of ' + pick(PLACES), 'Ironhand', ''])}`.trim();

// n Story Elements in Visual Groups (frames) of ~60, ~1.4 Connections each.
export function generate(n, uid) {
  const per = 60, cols = 8, gw = cols * 230 + 60, rows = Math.ceil(per / cols), gh = rows * 140 + 80;
  const groups = Math.ceil(n / per), gcols = Math.ceil(Math.sqrt(groups));
  const nodes = [], edges = [], byGroup = [];
  for (let g = 0; g < groups; g++) {
    const id = uid('g');
    nodes.push({ id, type: 'frame', position: { x: (g % gcols) * (gw + 200), y: Math.floor(g / gcols) * (gh + 200) }, width: gw, height: gh, data: { title: g === 0 ? 'Act I' : pick(PLACES) + ' arc' } });
    byGroup.push([]);
  }
  for (let i = 0; i < n; i++) {
    const g = Math.floor(i / per), k = i % per, cls = randClass(), id = uid('e');
    nodes.push({ id, type: 'card', parentId: nodes[g].id, position: { x: 30 + (k % cols) * 230, y: 60 + Math.floor(k / cols) * 140 },
      data: { cls, title: title(cls), status: { dead: Math.random() < 0.05, happened: cls === 'Event' && Math.random() < 0.3, quest: 0 }, revealed: Math.random() < 0.3, blocks: Math.floor(Math.random() * 4) } });
    byGroup[g].push(nodes.at(-1));
  }
  const cards = nodes.filter(x => x.type === 'card');
  for (const a of cards) {
    const m = Math.random() < 0.4 ? 2 : 1;
    for (let j = 0; j < m; j++) {
      const pool = Math.random() < 0.85 ? byGroup[nodes.findIndex(x => x.id === a.parentId)] : cards;
      const b = pick(pool); if (b === a) continue;
      const vt = validTypes(a.data.cls, b.data.cls);
      if (vt.length && Math.random() < 0.7) edges.push({ id: uid('c'), source: a.id, target: b.id, type: 'story', data: { kind: vt[0], label: vt[0], dir: 'ab', revealed: false } });
      else { const [label, dir] = pick(FREE); edges.push({ id: uid('c'), source: a.id, target: b.id, type: 'story', data: { kind: 'free', label, dir, revealed: Math.random() < 0.2 } }); }
    }
  }
  return { nodes, edges };
}
