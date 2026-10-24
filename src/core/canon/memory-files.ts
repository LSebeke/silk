import type { CanonFiles } from './files';

export interface MemoryFiles extends CanonFiles {
  /** Every file, path → text. Mutate it to simulate external edits. */
  readonly contents: Map<string, string>;
  /** Paths in the order they were written. */
  readonly writes: string[];
}

/** In-memory `CanonFiles` for tests and fixtures. */
export function createMemoryFiles(): MemoryFiles {
  const contents = new Map<string, string>();
  const writes: string[] = [];
  return {
    contents,
    writes,
    async read(path) {
      return contents.get(path) ?? null;
    },
    async write(path, text) {
      contents.set(path, text);
      writes.push(path);
    },
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = new Set<string>();
      for (const path of contents.keys()) {
        if (!path.startsWith(prefix)) continue;
        const name = path.slice(prefix.length).split('/')[0];
        if (name) names.add(name);
      }
      return [...names].sort();
    },
  };
}
