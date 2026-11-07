import { describe, expect, it } from 'vitest';
import type { StoryElement } from '../elements';
import {
  HOODED_DEFAULT,
  hoodImage,
  hoodOf,
  imageWrites,
  isHooded,
  lookOf,
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
    expect(imageWrites(actor(), { img: 'new.webp' })).toEqual({ doc: { img: 'new.webp' } });
  });

  it('hooded: waits in the flag; players keep seeing the hood', () => {
    expect(imageWrites(hooded(), { img: 'new.webp' })).toEqual({
      doc: { 'flags.silk.img': 'new.webp' },
    });
  });
});

describe('Portrait: hand edits', () => {
  it('an update touching img or the prototype token touches the Portrait', () => {
    expect(touchesPortrait({ img: 'x' })).toBe(true);
    expect(touchesPortrait({ prototypeToken: {} })).toBe(true);
    expect(touchesPortrait({ name: 'x' })).toBe(false);
  });
});

describe('Portrait: the look the image editor shows (v1.1 §G.3)', () => {
  it('defaults: token same as the sheet image, no ring, centred', () => {
    expect(lookOf(actor({ prototypeToken: {} }))).toEqual({
      img: 'alrik.webp',
      token: 'alrik.webp',
      sameAsImage: true,
      hooded: false,
      ring: { enabled: false, colors: { ring: null, background: null } },
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
    });
  });

  it('own token, ring on: the scale is the ring subject scale', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', anchorX: 0.4, anchorY: 0.3, scaleX: 1, scaleY: 1 },
        ring: {
          enabled: true,
          colors: { ring: '#ff0000', background: null },
          subject: { scale: 1.4 },
        },
      },
    });
    expect(lookOf(doc)).toMatchObject({
      token: 'alrik-token.webp',
      sameAsImage: false,
      ring: { enabled: true, colors: { ring: '#ff0000', background: null } },
      pose: { anchorX: 0.4, anchorY: 0.3, scale: 1.4 },
    });
  });

  it('ring off: the scale is the texture scale, mirrored or not', () => {
    const doc = actor({
      prototypeToken: { texture: { src: 'x.webp', scaleX: -1.2, scaleY: 1.2 } },
    });
    expect(lookOf(doc).pose.scale).toBe(1.2);
  });

  it('hooded: the real look waiting in the flags', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.2, anchorY: 0.6, scale: 1.5 };
    expect(lookOf(doc)).toMatchObject({
      img: 'alrik.webp',
      token: 'alrik-token.webp',
      pose: { anchorX: 0.2, anchorY: 0.6, scale: 1.5 },
    });
  });
});

describe('Portrait: token edits (v1.1 §G.3)', () => {
  it('unhooded: token image, ring and pose go to the prototype and the placed tokens', () => {
    const w = imageWrites(actor(), {
      token: {
        src: 'own.webp',
        ring: { enabled: true, colors: { ring: '#00ff00' } },
        anchor: { x: 0.3, y: 0.4 },
        scale: 1.25,
      },
    });
    expect(w.doc).toEqual({
      'prototypeToken.texture.src': 'own.webp',
      'prototypeToken.ring.enabled': true,
      'prototypeToken.ring.colors.ring': '#00ff00',
      'prototypeToken.texture.anchorX': 0.3,
      'prototypeToken.texture.anchorY': 0.4,
      'prototypeToken.ring.subject.scale': 1.25,
    });
    expect(w.tokens).toEqual({
      'texture.src': 'own.webp',
      'ring.enabled': true,
      'ring.colors.ring': '#00ff00',
      'ring.colors.background': null,
      'texture.anchorX': 0.3,
      'texture.anchorY': 0.4,
      'texture.scaleX': 1,
      'texture.scaleY': 1,
      'ring.subject.scale': 1.25,
    });
  });

  it('ring off: the scale is the texture scale; a mirrored token stays mirrored', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp', scaleX: -1 } } });
    expect(imageWrites(doc, { token: { scale: 1.5 } }).doc).toEqual({
      'prototypeToken.texture.scaleX': -1.5,
      'prototypeToken.texture.scaleY': 1.5,
    });
  });

  it('turning the ring on keeps the size: the scale moves to the ring subject', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp', scaleX: 1.5, scaleY: 1.5 } } });
    expect(imageWrites(doc, { token: { ring: { enabled: true } } }).doc).toEqual({
      'prototypeToken.ring.enabled': true,
      'prototypeToken.texture.scaleX': 1,
      'prototypeToken.texture.scaleY': 1,
      'prototypeToken.ring.subject.scale': 1.5,
    });
  });

  it('same as sheet image: the token follows a new sheet image', () => {
    const w = imageWrites(actor(), { img: 'new.webp', token: { sameAsImage: true } });
    expect(w.doc).toEqual({ img: 'new.webp', 'prototypeToken.texture.src': 'new.webp' });
    expect(w.tokens?.['texture.src']).toBe('new.webp');
  });

  it('Reset: centred, no ring colours', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', anchorX: 0.2, anchorY: 0.9, scaleX: 2, scaleY: 2 },
        ring: { colors: { ring: '#ff0000' } },
      },
    });
    const reset = {
      anchor: { x: 0.5, y: 0.5 },
      scale: 1,
      ring: { colors: { ring: null, background: null } },
    };
    expect(imageWrites(doc, { token: reset }).doc).toEqual({
      'prototypeToken.ring.colors.ring': null,
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.texture.anchorY': 0.5,
      'prototypeToken.texture.scaleX': 1,
      'prototypeToken.texture.scaleY': 1,
    });
  });

  it('hooded: token image and pose wait in the flags; the ring applies at once', () => {
    const w = imageWrites(hooded(), {
      token: {
        src: 'own.webp',
        ring: { enabled: true },
        anchor: { x: 0.3, y: 0.4 },
        scale: 1.25,
      },
    });
    expect(w.doc).toEqual({
      'flags.silk.token': 'own.webp',
      'flags.silk.pose': { anchorX: 0.3, anchorY: 0.4, scale: 1.25 },
      'prototypeToken.ring.enabled': true,
    });
    // Players keep seeing the hood, centred.
    expect(w.tokens).toMatchObject({
      'ring.enabled': true,
      'texture.anchorX': 0.5,
      'texture.anchorY': 0.5,
      'ring.subject.scale': 1,
    });
    expect(w.tokens).not.toHaveProperty('texture.src');
  });

  it('hooded, posed back to centre: the flag goes', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1 };
    expect(imageWrites(doc, { token: { anchor: { x: 0.5, y: 0.5 } } }).doc).toEqual({
      'flags.silk.-=pose': null,
    });
  });
});

describe('Portrait: the pose under the hood', () => {
  const posed = () =>
    actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', anchorX: 0.3, anchorY: 0.4, scaleX: 1.5, scaleY: 1.5 },
      },
    });

  it('hooding centres the token; the real pose waits in the flag', () => {
    const w = showWrites(posed(), { hood: HOOD });
    expect(w.doc).toMatchObject({
      'prototypeToken.texture.src': HOOD,
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.texture.anchorY': 0.5,
      'prototypeToken.texture.scaleX': 1,
      'prototypeToken.texture.scaleY': 1,
      'flags.silk.pose': { anchorX: 0.3, anchorY: 0.4, scale: 1.5 },
    });
    expect(w.tokens).toMatchObject({ 'texture.anchorX': 0.5, 'texture.scaleX': 1 });
  });

  it('Reveal restores the pose and clears the flag', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1.5 };
    const w = showWrites(doc, 'real');
    expect(w.doc).toMatchObject({
      'prototypeToken.texture.anchorX': 0.3,
      'prototypeToken.texture.anchorY': 0.4,
      'prototypeToken.texture.scaleX': 1.5,
      'flags.silk.-=pose': null,
    });
    expect(w.tokens).toMatchObject({ 'texture.src': 'alrik-token.webp', 'texture.anchorX': 0.3 });
  });

  it('a hooded token posed by hand: that pose is the real one', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1.5 };
    doc.prototypeToken = { texture: { src: HOOD, anchorX: 0.1 } };
    expect(lookOf(doc).pose).toEqual({ anchorX: 0.1, anchorY: 0.5, scale: 1 });
    expect(showWrites(doc, { hood: HOOD }).doc).toMatchObject({
      'prototypeToken.texture.anchorX': 0.5,
      'flags.silk.pose': { anchorX: 0.1, anchorY: 0.5, scale: 1 },
    });
  });
});
