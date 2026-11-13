import { describe, expect, it } from 'vitest';
import { portraitUpdate, withPortrait, withoutPortrait } from './figure';

const FIG = '<figure data-garn-portrait=""><img src="alrik.webp"></figure>';

describe('Portrait figure on the Appearance page (v1.1 §G.4)', () => {
  it('the page starts with the managed figure, then the text', () => {
    expect(withPortrait('<p>Tall.</p>', 'alrik.webp')).toBe(`${FIG}<p>Tall.</p>`);
  });

  it('an old figure is replaced, wherever it is', () => {
    const old = '<p>Tall.</p><figure data-garn-portrait><img src="old.webp" alt=""></figure>';
    expect(withPortrait(old, 'alrik.webp')).toBe(`${FIG}<p>Tall.</p>`);
  });

  it('no real image: no figure', () => {
    expect(withPortrait(`${FIG}<p>Tall.</p>`, '')).toBe('<p>Tall.</p>');
  });

  it('the image path is escaped', () => {
    expect(withPortrait('', 'a "b" & c.webp')).toBe(
      '<figure data-garn-portrait=""><img src="a &quot;b&quot; &amp; c.webp"></figure>',
    );
  });

  it('the text without the figure; other figures stay', () => {
    const own = '<figure><img src="map.webp"></figure>';
    expect(withoutPortrait(`${FIG}\n<p>Tall.</p>${own}`)).toBe(`<p>Tall.</p>${own}`);
  });

  it('update: undefined when the figure is at the top with the image, as Foundry saved it', () => {
    const saved =
      '<figure data-garn-portrait="" class="x"><img src="alrik.webp" alt="A"></figure><p>T</p>';
    expect(portraitUpdate(saved, 'alrik.webp')).toBeUndefined();
    expect(portraitUpdate('<p>T</p>', '')).toBeUndefined();
  });

  it('update: a missing, moved or stale figure is rewritten', () => {
    expect(portraitUpdate('<p>T</p>', 'alrik.webp')).toBe(`${FIG}<p>T</p>`);
    expect(portraitUpdate(`<p>T</p>${FIG}`, 'alrik.webp')).toBe(`${FIG}<p>T</p>`);
    expect(portraitUpdate(FIG, 'new.webp')).toBe(
      '<figure data-garn-portrait=""><img src="new.webp"></figure>',
    );
    expect(portraitUpdate(`${FIG}<p>T</p>`, '')).toBe('<p>T</p>');
  });
});
