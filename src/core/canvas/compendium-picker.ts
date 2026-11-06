/**
 * Compendium picker (spec 1.1 §B.2): the Source Step's ↑ choice. A search over World actors
 * and Actor packs of the class's type, with a side list of sources. Pure: the adapter reads
 * Foundry into a `PickerCatalog`, the UI renders `get()` and forwards keys.
 */
import type { ElementClassId } from '../elements/classes';
import type { SourcePick, SourceProvider } from './pipeline';

export interface PickerEntry {
  uuid: string;
  name: string;
  /** Actor subtype (DSA5 `npc`, `creature`, `character`). */
  type: string;
  img?: string;
}

export interface PickerPack {
  /** `pack.collection`. */
  id: string;
  label: string;
  /** `metadata.flags.dsalang`, if set. */
  lang?: string;
  entries: PickerEntry[];
}

export interface PickerCatalog {
  /** The Actor subtype of the class (Person `npc`, Creature `creature`). */
  type: string;
  /** `game.i18n.lang`. */
  lang: string;
  /** World actors that are not Story Elements. */
  world: PickerEntry[];
  /** Actor packs. */
  packs: PickerPack[];
}

export type PickerSourceId = 'all' | 'world' | (string & {});

/** A side-list entry; packs carry their label, All/World are localised by the UI. */
export interface PickerSource {
  id: PickerSourceId;
  label?: string;
  count: number;
}

export interface PickerRow {
  uuid: string;
  name: string;
  img?: string;
  /** `world` or the pack id. */
  source: string;
  /** Pack label; World rows have none. */
  label?: string;
}

export interface PickerState {
  sources: PickerSource[];
  source: PickerSourceId;
  query: string;
  rows: PickerRow[];
  /** Index of the highlighted row. */
  active: number;
}

export interface CompendiumPicker {
  get(): PickerState;
  subscribe(run: (state: PickerState) => void): () => void;
  setQuery(query: string): void;
  setSource(id: PickerSourceId): void;
  /** ↑ (-1) / ↓ (+1), clamped to the results. */
  move(delta: number): void;
  /** Highlights a row (mouse). */
  activate(index: number): void;
  /** Enter: the active row as a Source Step pick. */
  pick(): SourcePick | undefined;
}

export interface CompendiumProviderDeps {
  /** The Actor subtype a class picks from; undefined = not for this class. */
  actorType(cls: ElementClassId): string | undefined;
  /** Reads World actors and Actor packs (adapter). */
  catalog(type: string): Promise<PickerCatalog>;
  /**
   * Shows the picker window. Resolves with the pick, or undefined when closed (`Esc`);
   * closes itself when `signal` aborts.
   */
  open(picker: CompendiumPicker, signal: AbortSignal): Promise<SourcePick | undefined>;
}

/** The Source Step's Compendium choice (`CreationPipelineDeps.sources.compendium`). */
export function compendiumProvider(deps: CompendiumProviderDeps): SourceProvider {
  return {
    unavailable: (cls) => (deps.actorType(cls) ? undefined : 'SILK.Source.NotForClass'),
    async pick({ class: cls, signal }) {
      const type = deps.actorType(cls);
      if (!type) return undefined;
      const picker = createCompendiumPicker(await deps.catalog(type));
      if (signal.aborted) return undefined;
      return deps.open(picker, signal);
    },
  };
}

/** DSA5's rule (`hooks/sidebar.js`): a pack in another language is hidden; no flag = shown. */
const packShown = (pack: PickerPack, lang: string) => !pack.lang || pack.lang === lang;

const byName = (a: PickerRow, b: PickerRow) => a.name.localeCompare(b.name);

function rowsOf(catalog: PickerCatalog) {
  const ofType = (entries: PickerEntry[]) => entries.filter((e) => e.type === catalog.type);
  const row = (e: PickerEntry, source: string, label?: string): PickerRow => ({
    uuid: e.uuid,
    name: e.name,
    ...(e.img ? { img: e.img } : {}),
    source,
    ...(label ? { label } : {}),
  });
  const world = ofType(catalog.world).map((e) => row(e, 'world'));
  const packs = catalog.packs
    .filter((p) => packShown(p, catalog.lang))
    .map((p) => ({ pack: p, rows: ofType(p.entries).map((e) => row(e, p.id, p.label)) }))
    .filter((p) => p.rows.length);
  const all = [...world, ...packs.flatMap((p) => p.rows)].sort(byName);
  const sources: PickerSource[] = [
    { id: 'all', count: all.length },
    { id: 'world', count: world.length },
    ...packs.map((p) => ({ id: p.pack.id, label: p.pack.label, count: p.rows.length })),
  ];
  return { all, sources };
}

export function createCompendiumPicker(catalog: PickerCatalog): CompendiumPicker {
  const { all, sources } = rowsOf(catalog);
  let source: PickerSourceId = 'all';
  let query = '';
  let active = 0;
  let state = compute();
  const subscribers = new Set<(state: PickerState) => void>();

  function compute(): PickerState {
    const q = query.trim().toLowerCase();
    const rows = all.filter(
      (r) => (source === 'all' || r.source === source) && (!q || r.name.toLowerCase().includes(q)),
    );
    return { sources, source, query, rows, active };
  }

  function update() {
    state = compute();
    for (const s of subscribers) s(state);
  }

  const clamp = (index: number) => Math.max(0, Math.min(index, state.rows.length - 1));

  return {
    get: () => state,
    subscribe(run) {
      subscribers.add(run);
      run(state);
      return () => subscribers.delete(run);
    },
    setQuery(next) {
      query = next;
      active = 0;
      update();
    },
    setSource(id) {
      source = id;
      active = 0;
      update();
    },
    move(delta) {
      active = clamp(active + delta);
      update();
    },
    activate(index) {
      active = clamp(index);
      update();
    },
    pick() {
      const row = state.rows[active];
      if (!row) return undefined;
      return row.source === 'world'
        ? { adopt: { uuid: row.uuid }, name: row.name }
        : { source: { kind: 'compendium', uuid: row.uuid }, name: row.name };
    },
  };
}
