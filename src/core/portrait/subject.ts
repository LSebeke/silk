/**
 * The ring subject file (v1.1 §G.3 "Ring composition", #171) and the one place a look is
 * written: the actor doc, the subject file and every placed token. A subject is rebuilt only
 * when what it was rendered from (image, pose, the world ring style's edges) changed, so a
 * changed ring style rebuilds it on the next apply (GM load: reconcile).
 */
import type { SilkDocFlags } from '../materialize/port';
import type { Edges } from './geometry';
import { samePose, type PortraitDoc, type PortraitWrites, type SubjectRequest } from './portrait';

/** What a subject file is rendered from. */
export interface SubjectSpec extends SubjectRequest {
  edges: Edges;
}

/** `flags.silk.subject`: the file and its spec. */
export type SubjectFlag = NonNullable<SilkDocFlags['subject']>;

/** Foundry effects of a look write. */
export interface LookStage {
  /** Updates every placed token of the actor (all Scenes) where it differs. */
  updateTokens(actorUuid: string, data: Record<string, unknown>): Promise<void>;
  /** The world ring style's edges for a token `size` grid units wide. */
  ringEdges(size: number): Promise<Edges>;
  /** Renders and uploads the subject file; its Data path. */
  renderSubject(actorUuid: string, spec: SubjectSpec): Promise<string>;
}

const sameSpec = (flag: SubjectFlag, spec: SubjectSpec) =>
  flag.src === spec.src &&
  samePose(flag.pose, spec.pose) &&
  flag.edges.inner === spec.edges.inner &&
  flag.edges.outer === spec.edges.outer;

/** `writes` with the subject resolved to Foundry keys, rendering the file if needed. */
export async function resolveSubject(
  stage: Pick<LookStage, 'ringEdges' | 'renderSubject'>,
  uuid: string,
  doc: PortraitDoc,
  writes: PortraitWrites,
): Promise<{ doc: Record<string, unknown>; tokens?: Record<string, unknown> }> {
  const { subject, ...rest } = writes;
  if (subject === undefined) return rest;
  const flag = doc.flags.silk.subject;
  const current = doc.prototypeToken?.ring?.subject?.texture ?? null;
  const data = { ...rest.doc };
  let file: string | null = null;
  if (subject === null) {
    if (flag) data['flags.silk.-=subject'] = null;
  } else {
    const token = doc.prototypeToken;
    const edges = await stage.ringEdges(Math.min(token?.width ?? 1, token?.height ?? 1));
    const spec: SubjectSpec = { ...subject, edges };
    if (flag && current === flag.file && sameSpec(flag, spec)) file = flag.file;
    else {
      file = await stage.renderSubject(uuid, spec);
      data['flags.silk.subject'] = { file, ...spec };
    }
  }
  if (current !== file) data['prototypeToken.ring.subject.texture'] = file;
  return {
    doc: data,
    ...(rest.tokens ? { tokens: { ...rest.tokens, 'ring.subject.texture': file } } : {}),
  };
}

/** Writes a look: the doc (with the subject file), then every placed token. */
export async function writeLook(
  stage: LookStage,
  update: (uuid: string, data: Record<string, unknown>) => Promise<void>,
  uuid: string,
  doc: PortraitDoc,
  writes: PortraitWrites,
): Promise<void> {
  const resolved = await resolveSubject(stage, uuid, doc, writes);
  if (Object.keys(resolved.doc).length) await update(uuid, resolved.doc);
  if (resolved.tokens) await stage.updateTokens(uuid, resolved.tokens);
}
