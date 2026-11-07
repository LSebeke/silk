import { describe, expect, it } from 'vitest';
import type { StoryElement } from '../elements';
import {
  HOODED_DEFAULT,
  hoodImage,
  hoodOf,
  imageWrites,
  isHooded,
  realPortrait,
  showWrites,
  touchesPortrait,
  type PortraitDoc,
} from './portrait';

const HOOD = 'icons/svg/mystery-man-black.svg';

const actor = (over: Partial<PortraitDoc> = {}): PortraitDoc => ({
  img: 'alrik.webp',
  prototypeToken: { texture: { src: 'alrik-token.webp' } },
  flags: { silk: {} },
  ...over,
});

const hooded = (): PortraitDoc =>
  actor({
    img: HOOD,
    prototypeToken: { texture: { src: HOOD } },
    flags: { silk: { img: 'alrik.webp', token: 'alrik-token.webp', hood: HOOD } },
  });

describe('Portrait: real vs shown', () => {
  it('an unhooded actor shows its real Portrait', () => {
    expect(isHooded(actor())).toBe(false);
    expect(realPortrait(actor())).toEqual({ img: 'alrik.webp', token: 'alrik-token.webp' });
  });

  it('a hooded actor shows the hood; the real Portrait waits in the flags', () => {
    expect(isHooded(hooded())).toBe(true);
    expect(realPortrait(hooded())).toEqual({ img: 'alrik.webp', token: 'alrik-token.webp' });
  });

  it('a token without its own texture uses the sheet image', () => {
    expect(realPortrait(actor({ prototypeToken: {} }))).toEqual({
      img: 'alrik.webp',
      token: 'alrik.webp',
    });
  });

  it("the record's image wins over the doc's", () => {
    expect(realPortrait(hooded(), 'new.webp').img).toBe('new.webp');
  });
});

describe('Portrait: the hood', () => {
  it('world setting: empty or the 1.0 default falls back to the core icon (v1.1 §C.4)', () => {
    expect(HOODED_DEFAULT).toBe(HOOD);
    expect(hoodImage(undefined)).toBe(HOOD);
    expect(hoodImage('')).toBe(HOOD);
    expect(hoodImage('modules/silk/assets/hooded.svg')).toBe(HOOD);
    expect(hoodImage('worlds/w/hood.webp')).toBe('worlds/w/hood.webp');
  });

  const person = (infoBlocks: StoryElement['infoBlocks']): StoryElement =>
    ({ id: 'e1', class: 'person', name: 'Alrik', infoBlocks }) as StoryElement;

  it('with an Appearance block: the world hood', () => {
    const el = person([{ _id: 'b1', name: 'Aussehen', text: '', appearance: true }]);
    expect(hoodOf(el, 'worlds/w/hood.webp')).toBe('worlds/w/hood.webp');
  });

  it('Appearance deleted: the class icon, permanently (v1.1 §C.2)', () => {
    expect(hoodOf(person([]), 'worlds/w/hood.webp')).toBe('icons/svg/mystery-man.svg');
  });
});

describe('Portrait: showing', () => {
  it('hooding moves the real Portrait into the flags; placed tokens show the hood', () => {
    expect(showWrites(actor(), { hood: HOOD })).toEqual({
      doc: {
        img: HOOD,
        'prototypeToken.texture.src': HOOD,
        'flags.silk.img': 'alrik.webp',
        'flags.silk.token': 'alrik-token.webp',
        'flags.silk.hood': HOOD,
      },
      tokens: { 'texture.src': HOOD },
    });
  });

  it('hooding an already hooded actor writes nothing to the doc', () => {
    expect(showWrites(hooded(), { hood: HOOD })).toEqual({
      doc: {},
      tokens: { 'texture.src': HOOD },
    });
  });

  it('a new hood (Appearance deleted) replaces the old one', () => {
    const icon = 'icons/svg/mystery-man.svg';
    expect(showWrites(hooded(), { hood: icon }).doc).toEqual({
      img: icon,
      'prototypeToken.texture.src': icon,
      'flags.silk.img': 'alrik.webp',
      'flags.silk.token': 'alrik-token.webp',
      'flags.silk.hood': icon,
    });
  });

  it('a hand edit of the token while hooded re-hoods, keeping the edit as the real token', () => {
    const doc = hooded();
    doc.prototypeToken = { texture: { src: 'edited.webp' } };
    expect(showWrites(doc, { hood: HOOD }).doc).toMatchObject({
      'prototypeToken.texture.src': HOOD,
      'flags.silk.token': 'edited.webp',
    });
  });

  it('showing the real Portrait restores it and clears the flags', () => {
    expect(showWrites(hooded(), 'real')).toEqual({
      doc: {
        img: 'alrik.webp',
        'prototypeToken.texture.src': 'alrik-token.webp',
        'flags.silk.-=img': null,
        'flags.silk.-=token': null,
        'flags.silk.-=hood': null,
      },
      tokens: { 'texture.src': 'alrik-token.webp' },
    });
  });

  it('showing the real Portrait of an unhooded actor writes nothing to the doc', () => {
    expect(showWrites(actor(), 'real', 'stale.webp')).toEqual({
      doc: {},
      tokens: { 'texture.src': 'alrik-token.webp' },
    });
  });
});

describe('Portrait: a new real image', () => {
  it('unhooded: the sheet image', () => {
    expect(imageWrites(actor(), 'new.webp')).toEqual({ doc: { img: 'new.webp' } });
  });

  it('hooded: waits in the flag; players keep seeing the hood', () => {
    expect(imageWrites(hooded(), 'new.webp')).toEqual({ doc: { 'flags.silk.img': 'new.webp' } });
  });
});

describe('Portrait: hand edits', () => {
  it('an update touching img or the prototype token touches the Portrait', () => {
    expect(touchesPortrait({ img: 'x' })).toBe(true);
    expect(touchesPortrait({ prototypeToken: {} })).toBe(true);
    expect(touchesPortrait({ name: 'x' })).toBe(false);
  });
});
