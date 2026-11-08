import { describe, expect, it } from 'vitest';
import { must, page, setup } from './test-setup';

const fig = (src: string) => `<figure data-silk-portrait=""><img src="${src}"></figure>`;

/** A Materialized Person with image `img`; its Appearance block id. */
async function person(img = 'alrik.webp') {
  const t = setup();
  const id = await t.create('person', 'Alrik');
  await t.registry.run('element.setImage', { id, img });
  await t.registry.run('materialize.elements', { ids: [id] });
  const block = must(t.element(id).infoBlocks.find((b) => b.appearance)?._id, 'Appearance');
  const html = () => page(t.companion(id), block).text?.content;
  return { t, id, block, html };
}

describe('Appearance page image (v1.1 §G.4)', () => {
  it('Materialize: the Appearance page starts with the real image; the block text has none', async () => {
    const { t, id, block, html } = await person();
    expect(html()).toBe(fig('alrik.webp'));
    expect(t.element(id).infoBlocks.find((b) => b._id === block)?.text).toBe('');
    const other = t.element(id).infoBlocks.find((b) => !b.appearance);
    expect(page(t.companion(id), must(other)._id).text?.content).toBe('');
  });

  it('a new image rewrites the figure', async () => {
    const { t, id, html } = await person();
    await t.registry.run('element.setImage', { id, img: 'new.webp' });
    expect(html()).toBe(fig('new.webp'));
  });

  it('a hand edit of the sheet image in Foundry rewrites it too', async () => {
    const { t, id, html } = await person();
    t.doc(id).img = 'hand.webp';
    await t.materializer.sync(id);
    expect(html()).toBe(fig('hand.webp'));
  });

  it('the editor edits only the text; the figure stays on top', async () => {
    const { t, id, block, html } = await person();
    await t.registry.run('infoBlock.edit', { id: block, text: '<p>Tall.</p>' });
    expect(html()).toBe(`${fig('alrik.webp')}<p>Tall.</p>`);
    expect(t.element(id).infoBlocks.find((b) => b._id === block)?.text).toBe('<p>Tall.</p>');
  });

  it('restored on load when it is missing', async () => {
    const { t, block, id, html } = await person();
    page(t.companion(id), block).text = { content: '<p>Tall.</p>' };
    await t.lifecycle.reconcile();
    expect(html()).toBe(`${fig('alrik.webp')}<p>Tall.</p>`);
  });

  it('a Ghost keeps only the text in its record', async () => {
    const t = setup();
    const id = await t.create('person', 'Alrik');
    await t.registry.run('element.setImage', { id, img: 'alrik.webp' });
    expect(t.element(id).infoBlocks.find((b) => b.appearance)?.text).toBe('');
  });
});
