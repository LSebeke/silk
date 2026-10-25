/**
 * Node and Connection-edge context menus (spec §8 Controls, §10.3), built from registry
 * commands: labels are command titles, entries the registry can't run are disabled.
 * Pure; the canvas and the Element Detail window render the same entries.
 */
import type { RevealKind } from '../../core/campaigns';
import { hasStatus, type ElementClassId } from '../../core/elements';

export interface MenuEntry {
  key: string;
  label: string;
  /** Registry command and its args… */
  command?: string;
  args?: object;
  /** …or a canvas UI step (y/n prompt, inline editor). */
  action?: 'status' | 'rename' | 'editConnection';
  disabled?: boolean;
  /** Tooltip of a disabled entry. */
  hint?: string;
  danger?: boolean;
}

export interface MenuDeps {
  /** Registry `isAvailable`. */
  available(name: string): boolean;
  /** Localised command title. */
  title(name: string): string;
  /** The World's reveal state. */
  isRevealed(kind: RevealKind, id: string): boolean;
  /** Canvas selection. */
  selection: readonly string[];
}

const NEEDS_ADVENTURE = 'SILK.Reveal.NeedsAdventure';

function command(deps: MenuDeps, name: string, args: object, label?: string): MenuEntry {
  const off = !deps.available(name);
  return {
    key: name,
    label: label ?? deps.title(name),
    command: name,
    args,
    ...(off ? { disabled: true } : {}),
    ...(off && name.startsWith('reveal.') ? { hint: NEEDS_ADVENTURE } : {}),
  };
}

function toggle(deps: MenuDeps, kind: Exclude<RevealKind, 'playerNote'>, id: string): MenuEntry {
  const revealed = deps.isRevealed(kind, id);
  const label =
    kind === 'appearance'
      ? revealed
        ? 'SILK.Reveal.HideAppearance'
        : 'SILK.Reveal.RevealAppearance'
      : revealed
        ? 'SILK.Reveal.Unreveal'
        : 'SILK.Reveal.Reveal';
  return command(deps, `reveal.${kind}`, { id, revealed: !revealed }, label);
}

export function nodeMenu(
  el: { id: string; class: ElementClassId; name: string; uuid?: string },
  deps: MenuDeps,
): MenuEntry[] {
  const { id } = el;
  const ids = deps.selection.includes(id) ? [...deps.selection] : [id];
  const entries: MenuEntry[] = [toggle(deps, 'element', id)];
  if (el.class === 'person' || el.class === 'creature')
    entries.push(toggle(deps, 'appearance', id));
  entries.push(command(deps, 'reveal.showToPlayers', { id }));
  if (hasStatus(el.class))
    entries.push({ ...command(deps, 'element.toggleStatus', { id }), action: 'status' });
  entries.push(command(deps, 'element.openDetail', { id }));
  entries.push(command(deps, 'element.openSheet', { id }));
  entries.push({ ...command(deps, 'element.rename', { id }), action: 'rename' });
  if (ids.length >= 2) entries.push(command(deps, 'canvas.untangle', { ids }));
  entries.push(
    el.uuid
      ? command(deps, 'materialize.unmaterialize', { ids: [id] })
      : command(deps, 'materialize.elements', { ids: [id] }),
  );
  entries.push({ ...command(deps, 'element.delete', { ids }), danger: true });
  return entries;
}

export function edgeMenu(id: string, deps: MenuDeps): MenuEntry[] {
  return [
    toggle(deps, 'connection', id),
    { ...command(deps, 'connection.setLabel', { id }), action: 'editConnection' },
    command(deps, 'connection.cycleDirection', { id }),
    command(deps, 'connection.cycleType', { id }),
    command(deps, 'connection.flip', { id }),
    { ...command(deps, 'connection.delete', { ids: [id] }), danger: true },
  ];
}
