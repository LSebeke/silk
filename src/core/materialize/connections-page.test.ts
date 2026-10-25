import { describe, expect, it } from 'vitest';
import { connectionCommands } from '../connections';
import { createConnectionsPages } from './connections-page';
import { must, page, setup, type TestDoc } from './test-setup';

const SENTENCES: Record<string, string> = {
  directed: '{from} {label} {to}',
  directedUnlabelled: '{from} is connected to {to}',
  mutual: '{from} and {to} {label}',
  owns: '{from} owns {to}',
  locatedIn: '{from} is located in {to}',
};
const format = (key: string, data: Record<string, string>) =>
  must(SENTENCES[key.split('.').pop() ?? ''], key).replace(
    /{(\w+)}/g,
    (_, k: string) => data[k] ?? '',
  );

function world(mode: 'immediate' | 'onDemand' = 'immediate') {
  const t = setup({ mode });
  let n = 0;
  for (const c of connectionCommands({ workingCopy: () => t.workingCopy, newId: () => `c${++n}` }))
    t.registry.register(c);
  const writes: string[] = [];
  const pages = createConnectionsPages({
    workingCopy: () => t.workingCopy,
    docs: {
      ...t.docs,
      updatePage: async (uuid, pageId, data) => {
        writes.push(pageId);
        await t.docs.updatePage(uuid, pageId, data);
      },
    },
    docsOf: (id) => t.materializer.docsOf(id),
    format,
  });
  const stop = pages.watch();
  /** The Connections page content of an element (journal or Companion Journal). */
  const content = async (id: string) => {
    await pages.idle();
    const journal: TestDoc = t.element(id).class === 'location' ? t.doc(id) : t.companion(id);
    return page(journal, journal.flags.silk.connections).text?.content;
  };
  const connect = async (from: string, to: string, extra: object = {}) =>
    (await t.registry.run<{ id: string }>('connection.create', { from, to, ...extra })).id;
  return { ...t, pages, stop, content, connect, writes };
}

describe('Connections page', () => {
  it('a new Connection appears as a sentence on both endpoints’ pages', async () => {
    const w = world();
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    await w.connect(alrik, inn, { label: 'runs' });
    expect(await w.content(alrik)).toBe('<ul><li>Alrik runs Inn</li></ul>');
    expect(await w.content(inn)).toBe('<ul><li>Alrik runs Inn</li></ul>');
  });

  it('follows label edits, flips and deletes', async () => {
    const w = world();
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    const id = await w.connect(alrik, inn, { label: 'runs' });
    await w.registry.run('connection.setLabel', { id, label: 'owns a share of' });
    expect(await w.content(inn)).toBe('<ul><li>Alrik owns a share of Inn</li></ul>');
    await w.registry.run('connection.flip', { id });
    expect(await w.content(alrik)).toBe('<ul><li>Inn owns a share of Alrik</li></ul>');
    await w.registry.run('connection.delete', { ids: [id] });
    expect(await w.content(alrik)).toBe('');
    expect(await w.content(inn)).toBe('');
  });

  it('a renamed endpoint renames the sentence on the other page', async () => {
    const w = world();
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    await w.connect(alrik, inn, { label: 'runs' });
    await w.registry.run('element.rename', { id: inn, name: 'Black Boar' });
    expect(await w.content(alrik)).toBe('<ul><li>Alrik runs Black Boar</li></ul>');
  });

  it('a replaced behavioural Connection leaves the old endpoint’s page', async () => {
    const w = world();
    const sword = await w.create('item', 'Sword');
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    await w.connect(alrik, sword, { type: 'owns' });
    await w.connect(sword, inn, { type: 'locatedIn' });
    expect(await w.content(alrik)).toBe('');
    expect(await w.content(sword)).toBe('<ul><li>Sword is located in Inn</li></ul>');
  });

  it('a Ghost’s Connections fill its page when it is Materialized', async () => {
    const w = world('onDemand');
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    await w.connect(alrik, inn);
    await w.registry.run('materialize.elements', { ids: [inn] });
    expect(await w.content(inn)).toBe('<ul><li>Alrik is connected to Inn</li></ul>');
  });

  it('escapes names and labels as HTML', async () => {
    const w = world();
    const a = await w.create('person', '<b>A</b>');
    const b = await w.create('location', 'B & C');
    await w.connect(a, b, { label: 'likes' });
    expect(await w.content(b)).toBe('<ul><li>&lt;b&gt;A&lt;/b&gt; likes B &amp; C</li></ul>');
  });

  it('refresh() rewrites stale pages (reconcile on load)', async () => {
    const w = world();
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    w.stop();
    await w.connect(alrik, inn, { label: 'runs' });
    expect(await w.content(inn)).toBe('');
    await w.pages.refresh();
    expect(await w.content(inn)).toBe('<ul><li>Alrik runs Inn</li></ul>');
  });

  it('writes nothing when the page is already current', async () => {
    const w = world();
    const alrik = await w.create('person', 'Alrik');
    const inn = await w.create('location', 'Inn');
    await w.connect(alrik, inn, { label: 'runs' });
    await w.pages.idle();
    const count = w.writes.length;
    await w.pages.refresh();
    expect(w.writes.length).toBe(count);
  });
});
