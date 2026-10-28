import type { CanonRecord, JsonValue } from '../canon';
import type { Binding, WorkingCopyBackend, WorkingCopyPatch } from './working-copy';

export interface MemoryBackend extends WorkingCopyBackend {
  /** Every patch written, in order. */
  readonly patches: WorkingCopyPatch[];
}

/** In-memory `WorkingCopyBackend` for tests and fixtures. */
export function createMemoryBackend(): MemoryBackend {
  const records = new Map<string, CanonRecord>();
  let binding: Binding | null = null;
  const meta: Record<string, JsonValue> = {};
  const patches: WorkingCopyPatch[] = [];
  return {
    patches,
    load: () => ({ binding, records: [...records.values()], meta: { ...meta } }),
    async write(patch) {
      patches.push(patch);
      if (patch.binding !== undefined) binding = patch.binding;
      for (const r of patch.set ?? []) records.set(r.id, r);
      for (const id of patch.delete ?? []) records.delete(id);
      for (const [key, value] of Object.entries(patch.meta ?? {}))
        if (value === null) Reflect.deleteProperty(meta, key);
        else meta[key] = value;
    },
  };
}
