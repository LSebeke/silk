import { describe, expect, it } from 'vitest';
import type { StoryElement } from '../elements';
import {
  HOODED_DEFAULT,
  hoodImage,
  hoodOf,
  imageWrites,
  isHooded,
  lookOf,
  originalLook,
  realPortrait,
  restoreWrites,
  round2Writes,
  showWrites,
  touchesPortrait,
  lookWriter,
  type LookSource,
  type PlacedToken,
  type PortraitDoc,
  type PortraitWrites,
} from '.';
import { applyUpdate } from '../materialize/memory-docs';
import { testLookStage } from './test-stage';

/** The `LookSource` of `doc`. */
const of = (doc: PortraitDoc, recordImg?: string, sizeFactor = 1): LookSource => ({
  doc,
  ...(recordImg !== undefined ? { recordImg } : {}),
  sizeFactor,
});

const HOOD = 'icons/svg/mystery-man-black.svg';

const actor = (over: Partial<PortraitDoc> = {}): PortraitDoc => ({
  img: 'alrik.webp',
  prototypeToken: { texture: { src: 'alrik-token.webp' } },
  flags: { silk: {} },
  ...over,
});

/** Hooded: the hood in its ring (#182); the real ring (off) waits in the flag. */
const hooded = (): PortraitDoc =>
  actor({
    img: HOOD,
    prototypeToken: {
      texture: { src: HOOD },
      ring: { enabled: true, colors: { ring: null, background: null } },
    },
    flags: {
      silk: {
        img: 'alrik.webp',
        token: 'alrik-token.webp',
        hood: HOOD,
        ring: { enabled: false, colors: { ring: null, background: null } },
      },
    },
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
    const w = showWrites(of(actor()), { hood: HOOD });
    expect(w.doc).toEqual({
      img: HOOD,
      'prototypeToken.texture.src': HOOD,
      'flags.silk.img': 'alrik.webp',
      'flags.silk.token': 'alrik-token.webp',
      'flags.silk.hood': HOOD,
      // What the hood overwrites (v1.1 §G.3.1); the real ring waits (#182).
      'flags.silk.unhooded': {
        texture: { fit: 'contain', anchorX: 0.5, anchorY: 0.5 },
        subject: { scale: 1, texture: null },
      },
      'flags.silk.ring': { enabled: false, colors: { ring: null, background: null } },
      'prototypeToken.ring.enabled': true,
    });
    expect(w.tokens).toMatchObject({ 'texture.src': HOOD, 'texture.anchorX': 0.5 });
    // Real ring off, yet the hood is ringed: its own subject file.
    expect(w.subject).toMatchObject({ src: HOOD });
  });

  it('hooding an already hooded actor writes nothing to the doc', () => {
    const w = showWrites(of(hooded()), { hood: HOOD });
    expect(w.doc).toEqual({});
    expect(w.tokens).toMatchObject({ 'texture.src': HOOD });
  });

  it('with the ring, the hood goes through the subject crop at 0.7 (#133, #171)', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp' }, ring: { enabled: true } } });
    const w = showWrites(of(doc), { hood: HOOD });
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

  it('the hood always shows the ring, world style and default colours; the real ring waits (#182)', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 't.webp' },
        ring: { enabled: false, colors: { ring: '#ff0000', background: '#00ff00' } },
      },
    });
    const w = showWrites(of(doc), { hood: HOOD });
    expect(w.doc).toMatchObject({
      'prototypeToken.ring.enabled': true,
      'prototypeToken.ring.colors.ring': null,
      'prototypeToken.ring.colors.background': null,
      'flags.silk.ring': { enabled: false, colors: { ring: '#ff0000', background: '#00ff00' } },
    });
    expect(w.tokens).toMatchObject({
      'texture.src': HOOD,
      'ring.enabled': true,
      'ring.colors.ring': null,
      'ring.colors.background': null,
    });
    expect(w.subject).toEqual({
      src: HOOD,
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 0.7 },
      order: 'ring',
    });
  });

  it('Reveal: the real ring back on the prototype and placed tokens (#182)', async () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp' },
        ring: { colors: { ring: '#ff0000' } },
      },
    });
    const before = structuredClone(doc);
    const placed: PlacedToken[] = [
      {
        texture: { src: 'alrik-token.webp' },
        ring: { enabled: false, colors: { ring: '#ff0000' } },
      },
    ];
    await look(doc, showWrites(of(doc), { hood: HOOD }), placed);
    expect(placed[0]?.ring?.enabled).toBe(true);
    await look(doc, showWrites(of(doc), 'real'), placed);
    expect(doc.prototypeToken?.ring).toMatchObject({ enabled: false, colors: { ring: '#ff0000' } });
    expect(doc.flags.silk).not.toHaveProperty('ring');
    expect(doc.img).toBe(before.img);
    expect(placed[0]?.ring).toMatchObject({ enabled: false, colors: { ring: '#ff0000' } });
  });

  it('a new hood (Appearance deleted) replaces the old one', () => {
    const icon = 'icons/svg/mystery-man.svg';
    expect(showWrites(of(hooded()), { hood: icon }).doc).toEqual({
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
    expect(showWrites(of(doc), { hood: HOOD }).doc).toMatchObject({
      'prototypeToken.texture.src': HOOD,
      'flags.silk.token': 'edited.webp',
    });
  });

  it('showing the real Portrait restores it and clears the flags', () => {
    const w = showWrites(of(hooded()), 'real');
    expect(w.doc).toEqual({
      img: 'alrik.webp',
      'prototypeToken.texture.src': 'alrik-token.webp',
      'prototypeToken.ring.enabled': false,
      'flags.silk.-=img': null,
      'flags.silk.-=token': null,
      'flags.silk.-=hood': null,
      'flags.silk.-=ring': null,
    });
    expect(w.tokens).toMatchObject({ 'texture.src': 'alrik-token.webp' });
  });

  it('Reveal with the ring: the real subject, posed', () => {
    const doc = hooded();
    doc.flags.silk.ring = { enabled: true, colors: { ring: null, background: null } };
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1.5 };
    expect(showWrites(of(doc), 'real').subject).toEqual({
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
    expect(showWrites(of(doc, 'stale.webp'), 'real')).toEqual({
      doc: {},
      tokens: { 'texture.src': 'alrik-token.webp' },
    });
  });
});

describe('Portrait: a new real image', () => {
  it('unhooded: the sheet image', () => {
    expect(imageWrites(of(actor()), { img: 'new.webp' })).toEqual({ doc: { img: 'new.webp' } });
  });

  it('hooded: waits in the flag; players keep seeing the hood', () => {
    expect(imageWrites(of(hooded()), { img: 'new.webp' })).toEqual({
      doc: { 'flags.silk.img': 'new.webp' },
    });
  });

  it('token same as sheet image (#166): prototype and placed tokens follow an image-only edit', () => {
    const doc = actor({ prototypeToken: { texture: { src: 'alrik.webp' } } });
    const w = imageWrites(of(doc), { img: 'new.webp' });
    expect(w.doc).toEqual({ img: 'new.webp', 'prototypeToken.texture.src': 'new.webp' });
    expect(w.tokens).toMatchObject({ 'texture.src': 'new.webp' });
  });

  it('token same as sheet image, ring on: a new subject from the new image', () => {
    const doc = actor({
      prototypeToken: { texture: { src: 'alrik.webp' }, ring: { enabled: true } },
    });
    expect(imageWrites(of(doc), { img: 'new.webp' }).subject).toEqual({
      src: 'new.webp',
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
      order: 'ring',
    });
  });

  it('token same as sheet image, hooded: the real token waits in the flag too', () => {
    const doc = hooded();
    doc.flags.silk.token = 'alrik.webp';
    const w = imageWrites(of(doc), { img: 'new.webp' });
    expect(w.doc).toMatchObject({ 'flags.silk.img': 'new.webp', 'flags.silk.token': 'new.webp' });
    expect(w.doc).not.toHaveProperty(['prototypeToken.texture.src']);
    // Placed tokens keep (or get back) the hood.
    expect(w.tokens).toMatchObject({ 'texture.src': HOOD });
  });

  it('merge apply (#166): the record already has the new image; the tokens still follow', () => {
    const doc = actor({ prototypeToken: { texture: { src: 'alrik.webp' } } });
    const w = imageWrites(of(doc, 'new.webp'), { img: 'new.webp' });
    expect(w.doc).toEqual({ img: 'new.webp', 'prototypeToken.texture.src': 'new.webp' });
    expect(w.tokens).toMatchObject({ 'texture.src': 'new.webp' });
  });

  it('an unchanged image (merge apply) leaves the tokens alone (v1.1 §G.3.1)', () => {
    const doc = actor({ prototypeToken: { texture: { src: 'alrik.webp' } } });
    expect(imageWrites(of(doc), { img: 'alrik.webp' })).toEqual({ doc: {} });
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
    expect(lookOf(of(actor({ prototypeToken: {} })))).toEqual({
      img: 'alrik.webp',
      token: 'alrik.webp',
      sameAsImage: true,
      hooded: false,
      ring: { enabled: false, colors: { ring: null, background: null } },
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
      lockRotation: false,
      order: 'ring',
      sizeFactor: 1,
      size: 1,
      restorable: false,
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
    expect(lookOf(of(doc, undefined, 0.8))).toMatchObject({
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
    expect(lookOf(of(doc)).pose).toEqual({ anchorX: 0.3, anchorY: 0.5, scale: 1 });
  });

  it('hooded: the real look waiting in the flags', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.2, anchorY: 0.6, scale: 1.5 };
    expect(lookOf(of(doc))).toMatchObject({
      img: 'alrik.webp',
      token: 'alrik-token.webp',
      pose: { anchorX: 0.2, anchorY: 0.6, scale: 1.5 },
    });
  });
});

describe('Portrait: token edits (v1.1 §G.3)', () => {
  it('ring on: token image and ring to the prototype and placed tokens; the pose to the subject', () => {
    const w = imageWrites(of(actor()), {
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
    const w = imageWrites(of(doc), { token: { anchor: { x: 0.3, y: 0.5 }, scale: 1.5 } });
    expect(w.doc).toEqual({
      'prototypeToken.texture.anchorX': 0.3,
      'flags.silk.pose': { anchorX: 0.3, anchorY: 0.5, scale: 1.5 },
    });
    expect(w.tokens).not.toHaveProperty(['texture.scaleX']);
    expect(w.subject).toBeNull();
  });

  it('the scale is kept within 0.5 to 8, whoever calls (#137, #167)', () => {
    const doc = actor({ prototypeToken: { texture: { src: 't.webp' }, ring: { enabled: true } } });
    expect(imageWrites(of(doc), { token: { scale: 20 } }).subject?.pose.scale).toBe(8);
    expect(imageWrites(of(doc), { token: { scale: 0.1 } }).subject?.pose.scale).toBe(0.5);
  });

  it('turning the ring on: the subject scale back to 1, the texture centred', () => {
    const doc = actor({
      prototypeToken: {
        texture: { src: 't.webp', anchorX: 0.3 },
        ring: { subject: { scale: 1.5 } },
      },
      flags: { silk: { pose: { anchorX: 0.3, anchorY: 0.5, scale: 1 } } },
    });
    const w = imageWrites(of(doc), { token: { ring: { enabled: true } } });
    expect(w.doc).toEqual({
      'prototypeToken.ring.enabled': true,
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.ring.subject.scale': 1,
    });
    expect(w.subject?.pose.anchorX).toBe(0.3);
  });

  it('Lock rotation goes to the prototype and the placed tokens, hooded or not (#136)', () => {
    for (const doc of [actor(), hooded()]) {
      const w = imageWrites(of(doc), { token: { lockRotation: true } });
      expect(w.doc).toMatchObject({ 'prototypeToken.lockRotation': true });
      expect(w.tokens).toMatchObject({ lockRotation: true });
    }
  });

  it('Lock rotation alone writes only lockRotation: no look edit, no subject file (#181)', () => {
    for (const doc of [imported(), hooded()]) {
      const w = imageWrites(of(doc), { token: { lockRotation: true } });
      expect(w).toEqual({
        doc: { 'prototypeToken.lockRotation': true },
        tokens: { lockRotation: true },
      });
    }
  });

  it('Lock rotation on a hooded imported actor: Reveal still restores its original look (#181)', async () => {
    const wolf = imported();
    const before = structuredClone(wolf);
    const placed: PlacedToken[] = [{ texture: { src: 'wolf-2.webp' } }];
    await look(wolf, showWrites(of(wolf), { hood: HOOD }), placed);
    await look(wolf, imageWrites(of(wolf), { token: { lockRotation: true } }), placed);
    await look(wolf, showWrites(of(wolf), 'real'), placed);
    expect(wolf).toEqual({
      ...before,
      prototypeToken: { ...before.prototypeToken, lockRotation: true },
    });
    expect(placed[0]).toMatchObject({ texture: { src: 'wolf-2.webp' }, lockRotation: true });
  });

  it('same as sheet image: the token follows a new sheet image', () => {
    const w = imageWrites(of(actor()), { img: 'new.webp', token: { sameAsImage: true } });
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
    expect(imageWrites(of(doc), { token: reset }).doc).toEqual({
      'prototypeToken.ring.colors.ring': null,
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.texture.anchorY': 0.5,
      'flags.silk.-=pose': null,
    });
  });

  it('hooded: token image, ring and pose wait in the flags; the hood subject at once', () => {
    const w = imageWrites(of(hooded()), {
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
      'flags.silk.ring': { enabled: true, colors: { ring: null, background: null } },
    });
    expect(w.tokens).toMatchObject({ 'ring.enabled': true, 'texture.anchorX': 0.5 });
    expect(w.tokens).toMatchObject({ 'texture.src': HOOD });
    expect(w.subject).toEqual({
      src: HOOD,
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 0.7 },
      order: 'ring',
    });
  });

  it('hooded: ring settings wait for the Reveal; the hood keeps its ring (#182)', async () => {
    const doc = hooded();
    const w = imageWrites(of(doc), {
      token: { ring: { enabled: false, colors: { ring: '#ff0000' } } },
    });
    expect(w.doc).toEqual({
      'flags.silk.ring': { enabled: false, colors: { ring: '#ff0000', background: null } },
    });
    expect(w.tokens).toMatchObject({ 'ring.enabled': true, 'ring.colors.ring': null });
    await look(doc, w);
    expect(lookOf(of(doc)).ring).toEqual({
      enabled: false,
      colors: { ring: '#ff0000', background: null },
    });
  });

  it('hooded, posed back to centre: the flag goes', () => {
    const doc = hooded();
    doc.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 1 };
    expect(imageWrites(of(doc), { token: { anchor: { x: 0.5, y: 0.5 } } }).doc).toEqual({
      'flags.silk.-=pose': null,
    });
  });
});

describe('Portrait: draw order (v1.1 §G.3, #170)', () => {
  const ringed = () =>
    actor({ prototypeToken: { texture: { src: 't.webp' }, ring: { enabled: true } } });

  it('Illustration in front: kept per actor; the subject is cut for it', () => {
    const w = imageWrites(of(ringed()), { token: { order: 'illustration' } });
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
    expect(lookOf(of(doc)).order).toBe('illustration');
    const w = imageWrites(of(doc), { token: { order: 'ring' } });
    expect(w.doc).toEqual({ 'flags.silk.-=order': null });
    expect(w.subject?.order).toBe('ring');
  });

  it('an edit that leaves the order keeps it', () => {
    const doc = ringed();
    doc.flags.silk.order = 'illustration';
    const w = imageWrites(of(doc), { token: { scale: 2 } });
    expect(w.doc).not.toHaveProperty(['flags.silk.-=order']);
    expect(w.subject?.order).toBe('illustration');
  });

  it('the hood goes through the same draw order (its own file), whatever the real ring', () => {
    const doc = hooded();
    doc.flags.silk.order = 'illustration';
    expect(showWrites(of(doc), { hood: HOOD }).subject?.order).toBe('illustration');
    expect(imageWrites(of(doc), { token: { scale: 2 } }).subject?.order).toBe('illustration');
  });

  it("Reveal: the real subject in the actor's order", () => {
    const doc = hooded();
    doc.flags.silk.ring = { enabled: true, colors: { ring: null, background: null } };
    doc.flags.silk.order = 'illustration';
    expect(showWrites(of(doc), 'real').subject?.order).toBe('illustration');
  });
});

describe('Portrait: the pose under the hood', () => {
  it('hooding centres the token; the real pose waits in the flag', () => {
    const doc = actor({
      prototypeToken: { texture: { src: 'alrik-token.webp', anchorX: 0.3, anchorY: 0.4 } },
    });
    const w = showWrites(of(doc), { hood: HOOD });
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
    const w = showWrites(of(doc), 'real');
    expect(w.doc).toMatchObject({
      'prototypeToken.texture.anchorX': 0.3,
      'prototypeToken.texture.anchorY': 0.4,
    });
    expect(w.doc).not.toHaveProperty(['flags.silk.-=pose']);
    expect(w.tokens).toMatchObject({ 'texture.src': 'alrik-token.webp', 'texture.anchorX': 0.3 });
  });
});

describe('Portrait: round 3 migration of round 2 looks (v1.1 §G.3.2)', () => {
  // Round 2: ring on, fit cover, the pose as texture scale and anchor, no subject file.
  const round2 = () =>
    actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', fit: 'cover', anchorX: 0.4, scaleX: -1.5, scaleY: 1.5 },
        ring: { enabled: true },
      },
    });
  // Round 2, ring off: fit contain, the pose scale still the texture scale.
  const round2RingOff = () =>
    actor({
      prototypeToken: {
        texture: { src: 'alrik-token.webp', fit: 'contain', anchorX: 0.4, scaleX: 2, scaleY: 2 },
      },
    });

  it('ring on: the subject built, the pose to its flag; prototype scale 1, placed tokens the size factor', () => {
    const w = round2Writes(of(round2(), undefined, 0.8));
    expect(w?.doc).toMatchObject({
      'prototypeToken.texture.fit': 'contain',
      'prototypeToken.texture.anchorX': 0.5,
      'prototypeToken.texture.scaleX': -1,
      'prototypeToken.texture.scaleY': 1,
      'flags.silk.pose': { anchorX: 0.4, anchorY: 0.5, scale: 1.5 },
    });
    expect(w?.tokens).toMatchObject({ 'texture.scaleX': -0.8, 'texture.scaleY': 0.8 });
    expect(w?.subject).toEqual({
      src: 'alrik-token.webp',
      pose: { anchorX: 0.4, anchorY: 0.5, scale: 1.5 },
      order: 'ring',
    });
  });

  it('ring off: detected by its texture scale; the pose recovered before the scale is reset', () => {
    const w = round2Writes(of(round2RingOff(), undefined, 0.5));
    expect(w?.doc).toMatchObject({
      'prototypeToken.texture.scaleX': 1,
      'prototypeToken.texture.scaleY': 1,
      'flags.silk.pose': { anchorX: 0.4, anchorY: 0.5, scale: 2 },
    });
    expect(w?.tokens).toMatchObject({
      'texture.anchorX': 0.4,
      'texture.scaleX': 0.5,
      'texture.scaleY': 0.5,
    });
    expect(w?.subject).toBeNull();
  });

  it('hooded: the hood goes through its subject; the real pose stays in its flag', () => {
    const doc = round2();
    doc.img = HOOD;
    doc.prototypeToken = {
      texture: { src: HOOD, fit: 'cover', scaleX: 0.7, scaleY: 0.7 },
      ring: { enabled: true },
    };
    doc.flags.silk = {
      img: 'alrik.webp',
      token: 'alrik-token.webp',
      hood: HOOD,
      pose: { anchorX: 0.3, anchorY: 0.5, scale: 2 },
    };
    const w = round2Writes(of(doc, undefined, 1));
    expect(w?.doc).toMatchObject({ 'prototypeToken.texture.scaleX': 1 });
    expect(w?.doc).not.toHaveProperty(['flags.silk.pose']);
    expect(w?.subject).toEqual({
      src: HOOD,
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 0.7 },
      order: 'ring',
    });
  });

  it('a migrated look (subject file) and an imported look are left alone', () => {
    const doc = round2();
    doc.flags.silk.subject = {
      file: 'silk/w/tokens/a-1.webp',
      src: 'alrik-token.webp',
      pose: { anchorX: 0.5, anchorY: 0.5, scale: 1 },
      edges: { inner: 0.6, outer: 0.7 },
    };
    expect(round2Writes(of(doc))).toBeUndefined();
    expect(round2Writes(of(imported()))).toBeUndefined();
    expect(round2Writes(of(actor()))).toBeUndefined();
  });

  it('Reveal never migrates: that is the one-time sweep', () => {
    expect(showWrites(of(round2(), undefined, 0.8), 'real').tokens).not.toHaveProperty([
      'texture.scaleX',
    ]);
  });
});

describe('Portrait: imported images (v1.1 §G.3.1)', () => {
  it('the original look: image, prototype texture and ring, as imported', () => {
    const doc = {
      img: 'wolf.webp',
      prototypeToken: {
        texture: { src: 'wolf-token.webp', fit: 'cover', scaleX: 0.8, scaleY: 0.8 },
        ring: {
          enabled: true,
          colors: { ring: null, background: null },
          subject: { scale: 1.2, texture: 'wolf-subject.webp' },
        },
      },
    };
    expect(originalLook(doc)).toEqual({
      img: 'wolf.webp',
      texture: { src: 'wolf-token.webp', fit: 'cover', scaleX: 0.8, scaleY: 0.8 },
      ring: {
        enabled: true,
        colors: { ring: null, background: null },
        subject: { scale: 1.2, texture: 'wolf-subject.webp' },
      },
    });
    expect(originalLook({ img: 'x.webp' })).toEqual({ img: 'x.webp', texture: {}, ring: {} });
  });

  it('the hood stores everything it overwrites; Reveal restores it exactly', async () => {
    const wolf = imported();
    const before = structuredClone(wolf);
    await look(wolf, showWrites(of(wolf), { hood: HOOD }));
    expect(wolf.img).toBe(HOOD);
    expect(wolf.prototypeToken?.texture).toMatchObject({ src: HOOD, fit: 'contain', anchorY: 0.5 });
    expect(wolf.prototypeToken?.ring?.subject?.texture).not.toBe('wolf-subject.webp');
    // Applied again (every reconcile): nothing changes.
    expect(showWrites(of(wolf), { hood: HOOD }).doc).toEqual({});
    await look(wolf, showWrites(of(wolf), 'real'));
    expect(wolf).toEqual(before);
  });

  it('each placed token keeps its own look under the hood; Reveal restores each exactly', async () => {
    const wolf = imported();
    // Unlinked tokens with their own (wildcard) images, subject and size factor.
    const placed: PlacedToken[] = [
      {
        texture: { src: 'wolf-2.webp', fit: 'cover', anchorX: 0.5, anchorY: 0.8, scaleX: 0.8 },
        ring: {
          enabled: true,
          colors: { ring: null, background: null },
          subject: { scale: 1.2, texture: 'wolf-subject.webp' },
        },
      },
      {
        texture: { src: 'wolf-3.webp', fit: 'contain', anchorX: 0.5, anchorY: 0.5 },
        ring: {
          enabled: false,
          colors: { ring: '#ff0000', background: null },
          subject: { scale: 1, texture: null },
        },
      },
    ];
    const before = structuredClone(placed);
    await look(wolf, showWrites(of(wolf), { hood: HOOD }), placed);
    expect(placed.map((t) => t.texture?.src)).toEqual([HOOD, HOOD]);
    expect(placed[0]?.flags?.silk?.unhooded?.texture.src).toBe('wolf-2.webp');
    // Applied again (every reconcile): the snapshots stay what the hood overwrote.
    await look(wolf, showWrites(of(wolf), { hood: HOOD }), placed);
    expect(placed[1]?.flags?.silk?.unhooded?.texture.src).toBe('wolf-3.webp');
    await look(wolf, showWrites(of(wolf), 'real'), placed);
    expect(placed).toEqual(before.map((t) => ({ ...t, flags: { silk: {} } })));
  });

  it('a token edit while hooded drops the placed tokens’ snapshots too: Reveal shows Silk’s look', async () => {
    const wolf = imported();
    const placed: PlacedToken[] = [{ texture: { src: 'wolf-2.webp' } }];
    await look(wolf, showWrites(of(wolf), { hood: HOOD }), placed);
    await look(wolf, imageWrites(of(wolf), { token: { anchor: { x: 0.3, y: 0.4 } } }), placed);
    expect(placed[0]?.flags?.silk?.unhooded).toBeUndefined();
    await look(wolf, showWrites(of(wolf), 'real'), placed);
    expect(placed[0]?.texture?.src).toBe('wolf-token.webp');
  });

  it('Silk never changes an imported look on its own: its placed tokens keep theirs', () => {
    expect(showWrites(of(imported()), 'real')).toEqual({ doc: {} });
  });

  it('an imported ringed actor with fit cover is not a round 2 look (no migration)', () => {
    const wolf = imported();
    wolf.prototypeToken = { ...wolf.prototypeToken, ring: { enabled: true } };
    expect(showWrites(of(wolf, undefined, 0.8), 'real')).toEqual({ doc: {} });
  });

  it('Restore: the originals back on the sheet, prototype and placed tokens; Silk look cleared', async () => {
    const wolf = imported();
    const before = structuredClone(wolf);
    await look(
      wolf,
      imageWrites(of(wolf), {
        img: 'mine.webp',
        token: { sameAsImage: true, anchor: { x: 0.3, y: 0.4 }, scale: 2, order: 'illustration' },
      }),
    );
    expect(wolf.flags.silk).toMatchObject({ order: 'illustration', subject: expect.anything() });
    const w = restoreWrites(of(wolf));
    await look(wolf, w);
    expect(wolf).toEqual(before);
    // Placed tokens get the originals but keep their size factor (#168).
    expect(w.tokens).toMatchObject({
      'texture.src': 'wolf-token.webp',
      'texture.fit': 'cover',
      'texture.anchorY': 0.8,
      'ring.subject.scale': 1.2,
      'ring.subject.texture': 'wolf-subject.webp',
    });
    expect(w.tokens).not.toHaveProperty(['texture.scaleX']);
  });

  it('Restore while hooded: the originals become the real look; the hood stays until Reveal', async () => {
    const wolf = imported();
    const before = structuredClone(wolf);
    await look(wolf, showWrites(of(wolf), { hood: HOOD }));
    await look(
      wolf,
      imageWrites(of(wolf), { img: 'mine.webp', token: { anchor: { x: 0.3, y: 0.4 } } }),
    );
    await look(wolf, restoreWrites(of(wolf)));
    expect(wolf.img).toBe(HOOD);
    expect(wolf.prototypeToken?.texture?.src).toBe(HOOD);
    expect(wolf.flags.silk).toMatchObject({ img: 'wolf.webp', token: 'wolf-token.webp' });
    await look(wolf, showWrites(of(wolf), 'real'));
    expect(wolf).toEqual(before);
  });

  it('Restore while hooded: the hood subject is cut for the default order it leaves', () => {
    const wolf = imported();
    wolf.img = HOOD;
    wolf.flags.silk = {
      ...wolf.flags.silk,
      img: 'mine.webp',
      token: 'mine.webp',
      hood: HOOD,
      order: 'illustration',
    };
    const w = restoreWrites(of(wolf));
    expect(w.doc).toMatchObject({ 'flags.silk.-=order': null });
    expect(w.subject).toMatchObject({ src: HOOD, order: 'ring' });
  });

  it('Restore while hooded drops the pose the hood had stored', async () => {
    const wolf = imported();
    wolf.flags.silk.pose = { anchorX: 0.3, anchorY: 0.4, scale: 2 };
    await look(wolf, showWrites(of(wolf), { hood: HOOD }));
    expect(wolf.flags.silk.unhooded?.pose).toBeDefined();
    await look(wolf, restoreWrites(of(wolf)));
    expect(wolf.flags.silk.unhooded).not.toHaveProperty('pose');
    expect(wolf.flags.silk.pose).toBeUndefined();
  });
});

/** An imported, ringed actor with its own fit, anchor and subject. */
const imported = (): PortraitDoc => ({
  img: 'wolf.webp',
  prototypeToken: {
    texture: { src: 'wolf-token.webp', fit: 'cover', anchorX: 0.5, anchorY: 0.8 },
    ring: {
      enabled: true,
      colors: { ring: null, background: null },
      subject: { scale: 1.2, texture: 'wolf-subject.webp' },
    },
  },
  flags: {
    silk: {
      original: {
        img: 'wolf.webp',
        texture: { src: 'wolf-token.webp', fit: 'cover', anchorX: 0.5, anchorY: 0.8 },
        ring: {
          enabled: true,
          colors: { ring: null, background: null },
          subject: { scale: 1.2, texture: 'wolf-subject.webp' },
        },
      },
    },
  },
});

/** Writes `writes` into `doc` and its `placed` tokens as Foundry would (`-=` deletes). */
async function look(doc: PortraitDoc, writes: PortraitWrites, placed: PlacedToken[] = []) {
  const { stage, placed: byActor } = testLookStage();
  byActor.set('Actor.wolf', placed);
  await lookWriter(stage, async (_uuid, data) =>
    applyUpdate(doc as unknown as Record<string, unknown>, data),
  )('Actor.wolf', doc, writes);
}
