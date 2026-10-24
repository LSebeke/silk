/** Zip for Canon Backup / Share archives (spec §11.6). Imported only from lazy chunks. */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import type { ArchiveEntries } from '../core/canon';

/** Images and audio are already compressed; store them, deflate the JSON. */
const STORED = /\.(png|jpe?g|webp|gif|avif|mp3|ogg|oga|opus|m4a|aac|webm|mp4|m4v|ogv|flac)$/i;

export function zipArchive(entries: ArchiveEntries): Uint8Array {
  const zippable: Zippable = {};
  for (const [path, bytes] of entries)
    zippable[path] = [bytes, { level: STORED.test(path) ? 0 : 6 }];
  return zipSync(zippable);
}

export function unzipArchive(bytes: Uint8Array): ArchiveEntries {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new Error(`Silk: not a readable zip file (${String(error)})`, { cause: error });
  }
  return new Map(Object.entries(files).filter(([path]) => !path.endsWith('/')));
}
