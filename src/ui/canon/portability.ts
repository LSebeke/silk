/**
 * Canon Backup / Share / import flows (spec §11.6): pure core + FilePicker + zip + dialogs.
 * Lazy chunk (bundles fflate); reached only through the `canon.*` commands.
 */
import {
  createFilePickerAssets,
  createFilePickerFiles,
  foundryFilePicker,
} from '../../adapter/canon-files';
import { getSession } from '../../adapter/session';
import { unzipArchive, zipArchive } from '../../adapter/zip';
import {
  exportBackup,
  exportShare,
  ImportCancelled,
  importArchive,
  ImportRefused,
  type ExportResult,
  type ImportResult,
} from '../../core/canon';

const K = 'SILK.Canon.Portability.';
const t = (key: string, data?: Record<string, string>) =>
  (data ? game.i18n?.format(K + key, data) : game.i18n?.localize(K + key)) ?? key;

function io() {
  const api = foundryFilePicker();
  return { files: createFilePickerFiles(api), assets: createFilePickerAssets(api) };
}

async function boundCanonId(): Promise<string> {
  const canon = await getSession().history.canon();
  if (!canon) throw new Error('Silk: this World is not bound to a Canon yet');
  return canon.manifest.id;
}

const escape = (s: string) => foundry.utils.escapeHTML(s);

async function confirm(title: string, html: string): Promise<boolean> {
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<div class="silk-portability-dialog" data-silk-portability-dialog>${html}</div>`,
    rejectClose: false,
    modal: true,
  });
  return ok === true;
}

function list(items: string[]) {
  return `<ul>${items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>`;
}

/** Summary dialog (orphan count, missing assets, uncommitted warning), then download. */
async function offerDownload(kind: 'backup' | 'share', result: ExportResult) {
  const { manifest, entries, orphanCount } = result;
  const objects = [...entries.keys()].filter((p) => p.startsWith('canon/')).length;
  const parts = [
    `<p>${t('Summary', { objects: String(objects), assets: String(manifest.assets.length) })}</p>`,
  ];
  if (kind === 'backup') parts.push(`<p>${t('Orphans', { count: String(orphanCount) })}</p>`);
  if (manifest.missingAssets.length)
    parts.push(`<p>${t('Missing')}</p>${list(manifest.missingAssets)}`);
  // Only this World's state is known here; other bound Worlds commit on their own.
  if (await getSession().history.isDirty())
    parts.push(`<p class="warning" data-silk-uncommitted>${t('Uncommitted')}</p>`);
  parts.push(`<p>${t('Download')}</p>`);
  const title = t(kind === 'backup' ? 'BackupTitle' : 'ShareTitle');
  if (!(await confirm(title, parts.join('')))) return null;

  const slug = manifest.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'canon';
  const fileName = `silk-${kind}-${slug}-${manifest.exportedAt.slice(0, 10)}.zip`;
  download(zipArchive(entries), fileName);
  return {
    fileName,
    orphanCount,
    assets: manifest.assets.length,
    missingAssets: manifest.missingAssets,
  };
}

function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** `canon.exportBackup` */
export async function runExportBackup() {
  const result = await exportBackup({ ...io(), canonId: await boundCanonId() });
  return offerDownload('backup', result);
}

/** `canon.exportShare`: `commit` is a Commit hash or an Adventure id (its head). */
export async function runExportShare({ commit }: { commit: string }) {
  if (!commit) throw new Error('Silk: pick a Commit or Adventure to share');
  const result = await exportShare({ ...io(), canonId: await boundCanonId(), commit });
  return offerDownload('share', result);
}

/** `canon.import`: Backup (fast-forward, or as copy) or Share (new id). */
export async function runImport({
  file,
  asCopy,
}: {
  file: Blob | ArrayBuffer | Uint8Array;
  asCopy?: boolean;
}): Promise<ImportResult | null> {
  const bytes =
    file instanceof Uint8Array
      ? file
      : new Uint8Array(file instanceof Blob ? await file.arrayBuffer() : file);
  const entries = unzipArchive(bytes);
  const attempt = (copy: boolean) =>
    importArchive({
      ...io(),
      entries,
      asCopy: copy,
      confirmOverwrite: (paths) =>
        confirm(t('OverwriteTitle'), `<p>${t('Overwrite')}</p>${list(paths)}`),
    });

  let result: ImportResult;
  try {
    try {
      result = await attempt(asCopy ?? false);
    } catch (error) {
      if (!(error instanceof ImportRefused)) throw error;
      if (!(await confirm(t('DivergedTitle'), `<p>${t('Diverged')}</p>`))) return null;
      result = await attempt(true);
    }
  } catch (error) {
    if (!(error instanceof ImportCancelled)) throw error;
    ui.notifications?.info(t('Cancelled'));
    return null;
  }
  ui.notifications?.info(t('Imported', { name: result.name, id: result.canonId }));
  if (result.assets.missing.length)
    ui.notifications?.warn(t('ImportedMissing', { files: result.assets.missing.join(', ') }));
  return result;
}
