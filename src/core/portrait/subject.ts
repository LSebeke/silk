/**
 * The ring subject file (v1.1 §G.3 "Ring composition", #171) and the one place a look is
 * written: the actor doc, the subject file and every placed token. A subject is rebuilt only
 * when what it was rendered from (image, pose, draw order, the world ring style's edges)
 * changed, so a changed ring style rebuilds it on the next apply (GM load: reconcile).
 */
import type { SubjectFlag } from './flags';
import { DEFAULT_ORDER, tokenSize, type Edges } from './geometry';
import type { PortraitDoc, PortraitWrites, SnapshotMode, SubjectRequest } from './portrait';
import { samePose } from './writes';

/** What a subject file is rendered from. */
export interface SubjectSpec extends SubjectRequest {
  edges: Edges;
}

/** Foundry effects of a look write. */
export interface LookStage {
  /**
   * Updates every placed token of the actor (all Scenes, linked and unlinked) where it
   * differs: `data`, each token's own snapshot handled by `snapshot` (`placedTokenUpdate`).
   */
  updateTokens(
    actorUuid: string,
    data: Record<string, unknown>,
    snapshot?: SnapshotMode,
  ): Promise<void>;
  /** The world ring style's edges for a token `size` grid units wide. */
  ringEdges(size: number): Promise<Edges>;
  /** Renders and uploads the subject file; its Data path. */
  renderSubject(actorUuid: string, spec: SubjectSpec): Promise<string>;
}

const sameSpec = (flag: SubjectFlag, spec: SubjectSpec) =>
  flag.src === spec.src &&
  samePose(flag.pose, spec.pose) &&
  (flag.order ?? DEFAULT_ORDER) === spec.order &&
  flag.edges.inner === spec.edges.inner &&
  flag.edges.outer === spec.edges.outer;

/** `writes` with the subject resolved to Foundry keys, rendering the file if needed. */
export async function resolveSubject(
  stage: Pick<LookStage, 'ringEdges' | 'renderSubject'>,
  uuid: string,
  doc: PortraitDoc,
  writes: PortraitWrites,
): Promise<Omit<PortraitWrites, 'subject'>> {
  const { subject, ...rest } = writes;
  if (subject === undefined) return rest;
  const flag = doc.flags.silk.subject;
  const current = doc.prototypeToken?.ring?.subject?.texture ?? null;
  const data = { ...rest.doc };
  let file: string | null = null;
  if (subject === null) {
    if (flag) data['flags.silk.-=subject'] = null;
  } else {
    const edges = await stage.ringEdges(tokenSize(doc.prototypeToken));
    const spec: SubjectSpec = { ...subject, edges };
    if (flag && current === flag.file && sameSpec(flag, spec)) file = flag.file;
    else {
      file = await stage.renderSubject(uuid, spec);
      data['flags.silk.subject'] = { file, ...spec };
    }
  }
  if (current !== file) data['prototypeToken.ring.subject.texture'] = file;
  return {
    ...rest,
    doc: data,
    ...(rest.tokens ? { tokens: { ...rest.tokens, 'ring.subject.texture': file } } : {}),
  };
}

/** Writes a look: the doc (with the subject file), then every placed token. */
export type LookWriter = (uuid: string, doc: PortraitDoc, writes: PortraitWrites) => Promise<void>;

/** The `LookWriter` over `stage` and the doc `update`, bound once. */
export function lookWriter(
  stage: LookStage,
  update: (uuid: string, data: Record<string, unknown>) => Promise<void>,
): LookWriter {
  return async (uuid, doc, writes) => {
    const resolved = await resolveSubject(stage, uuid, doc, writes);
    if (Object.keys(resolved.doc).length) await update(uuid, resolved.doc);
    if (resolved.tokens) await stage.updateTokens(uuid, resolved.tokens, resolved.snapshot);
  };
}
