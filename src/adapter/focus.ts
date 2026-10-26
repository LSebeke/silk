/**
 * Foundry side of Focus View (spec §10.6): the active Scene as plain data, and the hooks that
 * tell the core when it (or its tokens) changed. Runs on every client: the view is local.
 */
import type { ActiveScene, Focus } from '../core/canvas';

interface SceneLike {
  id: string | null;
  active?: boolean;
  flags?: { silk?: { sceneOf?: string } };
  tokens?: Iterable<{ actorId?: string | null }>;
}

export function activeScene(scene: SceneLike | null | undefined): ActiveScene | undefined {
  if (!scene?.id) return undefined;
  return {
    id: scene.id,
    sceneOf: scene.flags?.silk?.sceneOf,
    actorIds: [...(scene.tokens ?? [])].map((t) => t.actorId ?? null),
  };
}

export function registerFocusHooks(
  focus: Pick<Focus, 'sceneChanged'>,
  deps: { on(hook: string, fn: (...args: unknown[]) => void): void },
): void {
  const changed = () => focus.sceneChanged();
  deps.on('updateScene', (scene, data) => {
    const d = data as { active?: boolean; flags?: unknown };
    if ('active' in d || ((scene as SceneLike).active && 'flags' in d)) changed();
  });
  deps.on('deleteScene', changed);
  const token = (doc: unknown) => {
    if ((doc as { parent?: SceneLike | null }).parent?.active) changed();
  };
  deps.on('createToken', token);
  deps.on('deleteToken', token);
  deps.on('updateToken', (doc, data) => {
    if ('actorId' in (data as object)) token(doc);
  });
}
