/**
 * Portrait (glossary): the image a Story Element shows, sheet image and token. Owns real
 * vs shown for actors/items (spec §8 Appearance, v1.1 §C.2, §C.4) and every write to `img`,
 * the prototype/placed token texture and `flags.silk.img` / `flags.silk.token` /
 * `flags.silk.hood`. Pure: a doc as it is → the update data. Journal Covers are not here.
 *
 * Hooded: `img` and the token textures show `flags.silk.hood` (the world's hooded image, or
 * the class icon once the Appearance block is deleted); the real ones wait in the flags.
 */
import { elementClass } from '../elements/classes';
import { appearanceBlock, type StoryElement } from '../elements/element';
import type { SilkDocFlags } from '../materialize/port';

/** The real Portrait: sheet image and prototype token texture. */
export interface Portrait {
  img: string;
  token: string;
}

/** What players see: the real Portrait, or a hood image in its place. */
export type Shown = 'real' | { hood: string };

/** The slice of an actor/item doc a Portrait lives in. */
export interface PortraitDoc {
  img?: string | null;
  prototypeToken?: { texture?: { src?: string | null } };
  flags: { silk: Pick<SilkDocFlags, 'img' | 'token' | 'hood'> };
}

/**
 * Update data for a Portrait change. `doc`: dotted keys for the actor/item update. `tokens`:
 * for every placed token of the actor (the adapter skips unchanged ones).
 */
export interface PortraitWrites {
  doc: Record<string, unknown>;
  tokens?: Record<string, unknown>;
}

/** v1.1 §C.4: Foundry core's icon replaces the image Silk 1.0 shipped. */
export const HOODED_DEFAULT = 'icons/svg/mystery-man-black.svg';
/** Silk 1.0's shipped hooded image, removed in 1.1. */
const HOODED_1_0 = 'modules/silk/assets/hooded.svg';

/** The world setting `hoodedImage` as used: empty or a saved 1.0 default → the core icon. */
export const hoodImage = (setting: string | undefined): string =>
  !setting || setting === HOODED_1_0 ? HOODED_DEFAULT : setting;

/** The hood for `element`: the world's, or without an Appearance block the class icon. */
export function hoodOf(element: Pick<StoryElement, 'class' | 'infoBlocks'>, world: string) {
  return appearanceBlock(element) ? world : (elementClass(element.class)?.icon ?? world);
}

/** `img` shows the hood; the real image waits in `flags.silk.img`. */
export function isHooded(doc: Pick<PortraitDoc, 'img' | 'flags'>): boolean {
  const { hood } = doc.flags.silk;
  return !!hood && doc.img === hood;
}

/** The real Portrait, wherever it is now. A known `recordImg` (the element's) wins. */
export function realPortrait(doc: PortraitDoc, recordImg?: string): Portrait {
  const flags = doc.flags.silk;
  const protoSrc = doc.prototypeToken?.texture?.src ?? undefined;
  const img = recordImg ?? (isHooded(doc) ? flags.img : (doc.img ?? undefined)) ?? '';
  const token = (protoSrc === flags.hood ? flags.token : protoSrc) ?? img;
  return { img, token };
}

/** Makes `doc` show `shown`. No-op doc writes are left out. */
export function showWrites(doc: PortraitDoc, shown: Shown, recordImg?: string): PortraitWrites {
  const flags = doc.flags.silk;
  const real = realPortrait(doc, recordImg);
  if (shown === 'real') {
    const data = flags.hood
      ? {
          img: real.img,
          'prototypeToken.texture.src': real.token,
          'flags.silk.-=img': null,
          'flags.silk.-=token': null,
          'flags.silk.-=hood': null,
        }
      : {};
    return { doc: data, tokens: { 'texture.src': real.token } };
  }
  const { hood } = shown;
  const done =
    isHooded(doc) &&
    flags.img === real.img &&
    doc.prototypeToken?.texture?.src === hood &&
    flags.hood === hood;
  const data = done
    ? {}
    : {
        img: hood,
        'prototypeToken.texture.src': hood,
        'flags.silk.img': real.img,
        'flags.silk.token': real.token,
        'flags.silk.hood': hood,
      };
  return { doc: data, tokens: { 'texture.src': hood } };
}

/** A new real sheet image. Hooded: it waits in the flag until the hood comes off. */
export function imageWrites(doc: PortraitDoc, img: string): PortraitWrites {
  return { doc: isHooded(doc) ? { 'flags.silk.img': img } : { img } };
}

/** A Foundry update `changed` touches the Portrait (a hand edit may undo the hood). */
export const touchesPortrait = (changed: Record<string, unknown>): boolean =>
  'img' in changed || 'prototypeToken' in changed;
