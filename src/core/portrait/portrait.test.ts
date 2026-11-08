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
    const w = showWrites(actor(), { hood: HOOD });
    expect(w.doc).toEqual({
      img: HOOD,
      'prototypeToken.texture.src': HOOD,
      'flags.silk.img': 'alrik.webp',
      'flags.silk.token': 'alrik-token.webp',
      'flags.silk.hood': HOOD,
    });
    expect(w.tokens).toMatchObject({ 'texture.src': HOOD, 'texture.anchorX': 0.5 });
    // No ring: no subject file; a stale one of Silk's would be cleared.
    expect(w.subject).toBeNull();
  });

  it('hooding an already hooded actor writes nothing to the doc', () => {
    const w = showWrites(hooded(), { hood: HOOD });
    expect(w.doc).toEqual({});
    expect(w.tokens).toMatchObject({ 'texture.src': HOOD });
  });

  it('with the ring, the hood goes through the subject crop at 0.7 (#133, #171)', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp' }, ring: { enabled: true } } });
    const w = showWrites(doc, { hood: HOOD });
    expect(w.doc).toMatchObject({ 'prototypeToken.texture.src': HOOD });
    expect(w.doc).not.toHaveProperty(['prototypeToken.texture.scaleX']);
    expect(w.doc).not.toHaveProperty(['flags.silk.pose']);
    expect(w.subject).toEqual({
      src: HOOD,
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 0.7 },
      order: 'ring',
    });
    expect(w.tokens).not.toHaveProperty(['texture.scaleX']);
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
    const w = showWrites(hooded(), 'real');
    expect(w.doc).toEqual({
      img: 'alrik.webp',
      'prototypeToken.texture.src': 'alrik-token.webp',
      'flags.silk.-=img': null,
      'flags.silk.-=token': null,
      'flags.silk.-=hood': null,
    });
    expect(w.tokens).toMatchObject({ 'texture.src': 'alrik-token.webp' });
  });

  it('Reveal with the ring: the real subject, posed', () => {
    const doc = hooded();
    doc.prototypeToken = { texture: { src: HOOD }, ring: { enabled: true } };
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1.5 };
    expect(showWrites(doc, 'real').subject).toEqual({
      src: 'alrik-token.webp',
      pose: { anchorX: 0.3, anchorY: 0.4, scale: 1.5 },
      order: 'ring',
    });
  });

  it('an actor without a Silk look keeps it; only placed tokens follow the image', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', fit: 'cover', scaleX: 0.8, scaleY: 0.8 },
        ring: { enabled: false, subject: { texture: 'own-subject.webp' } },
      },
    });
    expect(showWrites(doc, 'real', 'stale.webp')).toEqual({
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

  it('token same as sheet image (#166): prototype and placed tokens follow an image-only edit', () => {
    const doc = actor({ prototypeToken: { texture: { src: 'alrik.webp' } } });
    const w = imageWrites(doc, { img: 'new.webp' });
    expect(w.doc).toEqual({ img: 'new.webp', 'prototypeToken.texture.src': 'new.webp' });
    expect(w.tokens).toMatchObject({ 'texture.src': 'new.webp' });
  });

  it('token same as sheet image, ring on: a new subject from the new image', () => {
    const doc = actor({
      prototypeToken: { texture: { src: 'alrik.webp' }, ring: { enabled: true } },
    });
    expect(imageWrites(doc, { img: 'new.webp' }).subject).toEqual({
      src: 'new.webp',
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
      order: 'ring',
    });
  });

  it('token same as sheet image, hooded: the real token waits in the flag too', () => {
    const doc = hooded();
    doc.flags.silk.token = 'alrik.webp';
    const w = imageWrites(doc, { img: 'new.webp' });
    expect(w.doc).toMatchObject({ 'flags.silk.img': 'new.webp', 'flags.silk.token': 'new.webp' });
    expect(w.doc).not.toHaveProperty(['prototypeToken.texture.src']);
    expect(w.tokens).not.toHaveProperty(['texture.src']);
  });

  it('merge apply (#166): the record already has the new image; the tokens still follow', () => {
    const doc = actor({ prototypeToken: { texture: { src: 'alrik.webp' } } });
    const w = imageWrites(doc, { img: 'new.webp' }, 'new.webp');
    expect(w.doc).toEqual({ img: 'new.webp', 'prototypeToken.texture.src': 'new.webp' });
    expect(w.tokens).toMatchObject({ 'texture.src': 'new.webp' });
  });

  it('an unchanged image (merge apply) leaves the tokens alone (v1.1 §G.3.1)', () => {
    const doc = actor({ prototypeToken: { texture: { src: 'alrik.webp' } } });
    expect(imageWrites(doc, { img: 'alrik.webp' })).toEqual({ doc: {} });
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
      lockRotation: false,
      order: 'ring',
      sizeFactor: 1,
    });
  });

  it('own token, ring on: the pose from the flag; the size factor for the preview', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', scaleX: 0.8, scaleY: 0.8 },
        lockRotation: true,
        ring: { enabled: true, colors: { ring: '#ff0000', background: null } },
      },
      flags: { silk: { pose: { anchorX: 0.4, anchorY: 0.3, scale: 1.4 } } },
    });
    expect(lookOf(doc, undefined, 0.8)).toMatchObject({
      token: 'alrik-token.webp',
      sameAsImage: false,
      ring: { enabled: true, colors: { ring: '#ff0000', background: null } },
      pose: { anchorX: 0.4, anchorY: 0.3, scale: 1.4 },
      lockRotation: true,
      sizeFactor: 0.8,
    });
  });

  it('without a flag: the texture anchor; the texture scale is the size factor, not the pose', () => {
    const doc = actor({
      prototypeToken: { texture: { src: 'x.webp', anchorX: 0.3, scaleX: 0.5, scaleY: 0.5 } },
    });
    expect(lookOf(doc).pose).toEqual({ anchorX: 0.3, anchorY: 0.5, scale: 1 });
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
  it('ring on: token image and ring to the prototype and placed tokens; the pose to the subject', () => {
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
      'flags.silk.pose': { anchorX: 0.3, anchorY: 0.4, scale: 1.25 },
    });
    expect(w.tokens).toEqual({
      'texture.src': 'own.webp',
      'ring.enabled': true,
      'ring.colors.ring': '#00ff00',
      'ring.colors.background': null,
      'texture.fit': 'contain',
      'texture.anchorX': 0.5,
      'texture.anchorY': 0.5,
      'ring.subject.scale': 1,
    });
    expect(w.subject).toEqual({
      src: 'own.webp',
      pose: { anchorX: 0.3, anchorY: 0.4, scale: 1.25 },
      order: 'ring',
    });
  });

  it('ring off: the anchor on the texture, no subject file, the size factor untouched', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp', scaleX: 0.8, scaleY: 0.8 } } });
    const w = imageWrites(doc, { token: { anchor: { x: 0.3, y: 0.5 }, scale: 1.5 } });
    expect(w.doc).toEqual({
      'prototypeToken.texture.anchorX': 0.3,
      'flags.silk.pose': { anchorX: 0.3, anchorY: 0.5, scale: 1.5 },
    });
    expect(w.tokens).not.toHaveProperty(['texture.scaleX']);
    expect(w.subject).toBeNull();
  });

  it('the scale is kept within 0.5 to 8, whoever calls (#137, #167)', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp' }, ring: { enabled: true } } });
    expect(imageWrites(doc, { token: { scale: 20 } }).subject?.pose.scale).toBe(8);
    expect(imageWrites(doc, { token: { scale: 0.1 } }).subject?.pose.scale).toBe(0.5);
  });

  it('turning the ring on: the subject scale back to 1, the texture centred', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 't.webp', anchorX: 0.3 },
        ring: { subject: { scale: 1.5 } },
      },
      flags: { silk: { pose: { anchorX: 0.3, anchorY: 0.5, scale: 1 } } },
    });
    const w = imageWrites(doc, { token: { ring: { enabled: true } } });
    expect(w.doc).toEqual({
      'prototypeToken.ring.enabled': true,
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.ring.subject.scale': 1,
    });
    expect(w.subject?.pose.anchorX).toBe(0.3);
  });

  it('Lock rotation goes to the prototype and the placed tokens, hooded or not (#136)', () => {
    for (const doc of [actor(), hooded()]) {
      const w = imageWrites(doc, { token: { lockRotation: true } });
      expect(w.doc).toMatchObject({ 'prototypeToken.lockRotation': true });
      expect(w.tokens).toMatchObject({ lockRotation: true });
    }
  });

  it('same as sheet image: the token follows a new sheet image', () => {
    const w = imageWrites(actor(), { img: 'new.webp', token: { sameAsImage: true } });
    expect(w.doc).toEqual({ img: 'new.webp', 'prototypeToken.texture.src': 'new.webp' });
    expect(w.tokens?.['texture.src']).toBe('new.webp');
  });

  it('Reset: centred, no ring colours', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', anchorX: 0.2, anchorY: 0.9 },
        ring: { colors: { ring: '#ff0000' } },
      },
      flags: { silk: { pose: { anchorX: 0.2, anchorY: 0.9, scale: 2 } } },
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
      'flags.silk.-=pose': null,
    });
  });

  it('hooded: token image and pose wait in the flags; the ring and the hood subject at once', () => {
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
    expect(w.tokens).toMatchObject({ 'ring.enabled': true, 'texture.anchorX': 0.5 });
    expect(w.tokens).not.toHaveProperty(['texture.src']);
    expect(w.subject).toEqual({
      src: HOOD,
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 0.7 },
      order: 'ring',
    });
  });

  it('hooded, posed back to centre: the flag goes', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1 };
    expect(imageWrites(doc, { token: { anchor: { x: 0.5, y: 0.5 } } }).doc).toEqual({
      'flags.silk.-=pose': null,
    });
  });
});

describe('Portrait: draw order (v1.1 §G.3, #170)', () => {
  const ringed = () =>
    actor({ prototypeToken: { texture: { src: 't.webp' }, ring: { enabled: true } } });

  it('Illustration in front: kept per actor; the subject is cut for it', () => {
    const w = imageWrites(ringed(), { token: { order: 'illustration' } });
    expect(w.doc).toEqual({ 'flags.silk.order': 'illustration' });
    expect(w.subject).toEqual({
      src: 't.webp',
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
      order: 'illustration',
    });
  });

  it('the editor shows it; Ring in front (the default) clears the flag', () => {
    const doc = ringed();
    doc.flags.silk.order = 'illustration';
    expect(lookOf(doc).order).toBe('illustration');
    const w = imageWrites(doc, { token: { order: 'ring' } });
    expect(w.doc).toEqual({ 'flags.silk.-=order': null });
    expect(w.subject?.order).toBe('ring');
  });

  it('an edit that leaves the order keeps it', () => {
    const doc = ringed();
    doc.flags.silk.order = 'illustration';
    const w = imageWrites(doc, { token: { scale: 2 } });
    expect(w.doc).not.toHaveProperty(['flags.silk.-=order']);
    expect(w.subject?.order).toBe('illustration');
  });

  it('the hood goes through the same draw order (its own file)', () => {
    const doc = hooded();
    doc.prototypeToken = { texture: { src: HOOD }, ring: { enabled: true } };
    doc.flags.silk.order = 'illustration';
    expect(showWrites(doc, { hood: HOOD }).subject?.order).toBe('illustration');
    expect(imageWrites(doc, { token: { scale: 2 } }).subject?.order).toBe('illustration');
  });

  it("Reveal: the real subject in the actor's order", () => {
    const doc = hooded();
    doc.prototypeToken = { texture: { src: HOOD }, ring: { enabled: true } };
    doc.flags.silk.order = 'illustration';
    expect(showWrites(doc, 'real').subject?.order).toBe('illustration');
  });
});

describe('Portrait: the pose under the hood', () => {
  it('hooding centres the token; the real pose waits in the flag', () => {
    const doc = actor({
      prototypeToken: { texture: { src: 'alrik-token.webp', anchorX: 0.3, anchorY: 0.4 } },
    });
    const w = showWrites(doc, { hood: HOOD });
    expect(w.doc).toMatchObject({
      'prototypeToken.texture.src': HOOD,
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.texture.anchorY': 0.5,
      'flags.silk.pose': { anchorX: 0.3, anchorY: 0.4, scale: 1 },
    });
    expect(w.tokens).toMatchObject({ 'texture.anchorX': 0.5 });
  });

  it('Reveal without the ring: the anchor back on the texture, the flag kept', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1.5 };
    const w = showWrites(doc, 'real');
    expect(w.doc).toMatchObject({
      'prototypeToken.texture.anchorX': 0.3,
      'prototypeToken.texture.anchorY': 0.4,
    });
    expect(w.doc).not.toHaveProperty(['flags.silk.-=pose']);
    expect(w.tokens).toMatchObject({ 'texture.src': 'alrik-token.webp', 'texture.anchorX': 0.3 });
  });
});

describe('Portrait: round 2 migration (v1.1 §G.3.2)', () => {
  // Round 2: ring on, fit cover, the pose as texture scale and anchor, no subject file.
  const round2 = () =>
    actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', fit: 'cover', anchorX: 0.4, scaleX: -1.5, scaleY: 1.5 },
        ring: { enabled: true },
      },
    });

  it('the pose is read from the texture', () => {
    expect(lookOf(round2()).pose).toEqual({ anchorX: 0.4, anchorY: 0.5, scale: 1.5 });
  });

  it('the next look write builds the subject and puts the size factor back', () => {
    const w = showWrites(round2(), 'real', undefined, 0.8);
    expect(w.doc).toMatchObject({
      'prototypeToken.texture.fit': 'contain',
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.texture.scaleX': -0.8,
      'prototypeToken.texture.scaleY': 0.8,
      'flags.silk.pose': { anchorX: 0.4, anchorY: 0.5, scale: 1.5 },
    });
    expect(w.tokens).toMatchObject({ 'texture.scaleX': -0.8, 'texture.scaleY': 0.8 });
    expect(w.subject).toEqual({
      src: 'alrik-token.webp',
      pose: { anchorX: 0.4, anchorY: 0.5, scale: 1.5 },
      order: 'ring',
    });
  });

  it('a migrated look (subject file) is left as it is', () => {
    const doc = round2();
    doc.flags.silk.subject = {
      file: 'silk/w/tokens/a-1.webp',
      src: 'alrik-token.webp',
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
      edges: { inner: 0.6, outer: 0.7 },
    };
    expect(showWrites(doc, 'real', undefined, 0.8).tokens).not.toHaveProperty(['texture.scaleX']);
  });
});
