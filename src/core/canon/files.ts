/**
 * File seam for the Canon store (spec §11.1). Paths are relative to `Data/silk/`,
 * e.g. `<canon-id>/refs/main.json`. The Foundry adapter implements it over
 * `FilePicker.upload('data')` / `browse` + `fetch`; tests use `createMemoryFiles`.
 */
export interface CanonFiles {
  /** File text, or `null` if the file does not exist. */
  read(path: string): Promise<string | null>;
  /** Create or overwrite. Parent directories are created as needed. */
  write(path: string, text: string): Promise<void>;
  /** File and directory names directly inside `dir` (no paths); `[]` if missing. */
  list(dir: string): Promise<string[]>;
}
