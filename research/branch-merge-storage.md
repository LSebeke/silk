# Branch/merge storage for JSON documents

Ticket: #5. Question: how to do git-style branching and 3-way merging of the Silk document store (Story Elements, Connections, Info Blocks, play state) in the browser inside Foundry? Options compared: isomorphic-git, CRDTs (Automerge, Yjs) with forks, custom per-field 3-way merge over JSON snapshots.

Context: the Canon is branched into Adventures and merged back when an Adventure ends (GLOSSARY.md). The Canon must be independent of any one Foundry world and editable outside Foundry later (ADR 0001). That makes this an **offline, long-lived branch, rare merge, GM-reviewed** workload, not a real-time collaboration workload.

## Summary

| | isomorphic-git | Automerge | Yjs | Custom JSON 3-way |
|---|---|---|---|---|
| Branch | real git branches | `clone()` a doc | copy doc/update | copy snapshot pointer |
| Merge | diff3, **line-based text** | automatic CRDT merge | automatic CRDT merge | per-field, ours |
| Field-level conflicts | only via custom `mergeDriver` | same-key concurrent writes only (`getConflicts`), winner auto-picked | none surfaced; silent winner | yes, by design |
| Storage | git objects; needs Node-style `fs` | binary, full op history | binary updates, tombstones | plain JSON, readable |
| Fit with Foundry | poor: needs `fs` shim (unlink/rmdir/stat) that FilePicker does not offer | OK: blob via upload | OK: blob via upload | good: JSON files or document flags |
| Complexity | high (fs shim + merge driver anyway) | medium (WASM dep, model fit) | medium, wrong semantics | medium, owned code |

**Recommendation: custom per-field 3-way merge over JSON snapshots**, with a small git-like commit model (commit = parents + snapshot hash), stable IDs for every element/connection/Info Block, and merge done record-by-record and field-by-field against the common ancestor. Conflicts become explicit records the GM resolves in a merge UI. Store as JSON in the Foundry Data folder (Canon) via `FilePicker.upload` / `uploadPersistent`. Revisit Automerge only if live multi-user co-editing of the Canon becomes a requirement.

## isomorphic-git

- Merge: fast-forward by default; otherwise "builtin diff3 algorithm"; unresolvable conflicts throw `MergeNotSupportedError` (default `abortOnConflict: true`) or, with `abortOnConflict: false`, write "conflict markers in files with unresolved merge conflicts". A custom `mergeDriver` can be supplied. Limitations: "Currently it will fail if multiple candidate merge bases are found", "does not support selecting alternative merge strategies", "it is not possible to abort an incomplete merge". — https://isomorphic-git.org/docs/en/merge
- Storage: no built-in browser fs; caller passes a Node-`fs`-compatible object with `readFile, writeFile, unlink, readdir, mkdir, rmdir, stat, lstat`. Suggested: LightningFS, or BrowserFS on IndexedDB. — https://isomorphic-git.org/docs/en/fs
- Implications for Silk:
  - diff3 is line-based. JSON would need one-field-per-line formatting or a custom `mergeDriver` — i.e. we write the per-field JSON merge anyway, plus git.
  - IndexedDB lives in one browser profile: repo not shared across GM machines, lost on browser wipe. Persisting to the Foundry server needs an `fs` shim over FilePicker, which exposes `browse`, `upload`, `createDirectory` but no delete/stat (see Foundry section).
  - Upside: real git format; could later be pushed to a real remote / edited outside Foundry (ADR 0001).

## Automerge

- Branch: `clone(doc)` — "Make a full writable copy of an automerge document"; it "generates a new actor ID so that changes made in the new document do not create duplicate sequence numbers". No separate `fork` API. — https://automerge.org/automerge/api-docs/js/functions/clone.html
- Merge: `merge(local, remote)` — "Merge `remote` into `local`." — https://automerge.org/automerge/api-docs/js/functions/merge.html
- Conflicts: concurrent writes to the same key → Automerge "picks one of the concurrently written values as the 'winner'", based "on the internal ID of the operation, not a wall clock time"; losers retrievable via `getConflicts(doc, key)`; re-assigning resolves. — https://automerge.org/docs/reference/documents/conflicts/
- Also exposes `getHeads`, `view`, `diff`, `save`/`load`. — https://automerge.org/automerge/api-docs/js/
- Storage: repo stores incremental change chunks, periodically compacted into a snapshot keyed by heads. — https://automerge.org/docs/reference/under-the-hood/storage/ . Automerge 3 (July 2025) keeps history compressed at runtime, ">10x" less memory, API "nearly fully backwards compatible". — https://automerge.org/blog/automerge-3/
- Implications for Silk:
  - Merge never fails; always yields a state. Conflict detection only for same-key concurrent assignment; GM must walk keys with `getConflicts` to find them. Semantic conflicts (e.g. Canon edited an Info Block while the Adventure deleted it) are not flagged as such.
  - Full op history kept (compressed): storage grows with edit count, not just state size.
  - Binary format; not readable/editable outside Silk without Automerge.
  - Strong fit if live multi-GM co-editing ever matters.

## Yjs

- Sync model: `encodeStateAsUpdate`, `applyUpdate`, `mergeUpdates`, state vectors, `diffUpdate`. "Document updates are commutative, associative, and idempotent." No forking/branching or conflict-detection API documented. — https://docs.yjs.dev/api/document-updates
- Philosophy: changes are "merged without merge conflicts". — https://github.com/yjs/yjs/blob/main/README.md
- History: `doc.gc = false` needed "to be able to restore old content" (https://docs.yjs.dev/api/y.doc). Snapshots = state vector + delete set; restoring old state via snapshots "is not recommended". — https://github.com/yjs/yjs/blob/main/INTERNALS.md
- Implications for Silk: built for real-time collab; no way to surface "both sides changed this field" to the GM; history needs gc disabled. Weakest fit.

## Custom per-field 3-way merge over JSON snapshots

Our design; no external source. Sketch:

- Data: each Story Element / Connection / Info Block is a record with a stable ID (UUID), plain JSON.
- History: content-addressed snapshots (hash of canonical JSON per record + a manifest); commit = `{parents, manifest, message, time}`. Branch = named pointer to a commit (Canon, Adventure X). Unchanged records shared by hash, so storage ≈ state size + changed records.
- Merge base: lowest common ancestor in the commit graph (Adventures fork linearly off a Canon commit, so usually just the fork point).
- Merge per record ID: added/removed/changed in ours/theirs vs base; per field in changed records: take the side that changed; both changed to different values → **conflict**. Delete-vs-modify → conflict. Info Block bodies treated as one field (line diff3 later if needed).
- Conflicts become a list the GM resolves in a merge dialog; then write a two-parent merge commit.
- Domain rules easy to add (e.g. World State fields from the Adventure win by default; Reveal state Adventure-local, never merged back).
- Cost: we own a few hundred LOC of diff/merge + tests; no runtime deps; JSON stays readable and editable outside Foundry (ADR 0001).

## Foundry storage fit

- `FilePicker.upload(source, path, file, body?, options?)`, `createDirectory`, static `browse(source, target, options)`; sources `"data"`, `"public"`, `"s3"`. `uploadPersistent(packageId, path, file, …)` writes to the package's `/storage/` dir (Systems and Modules only). No delete/rename method documented. — https://foundryvtt.com/api/classes/foundry.applications.apps.FilePicker.html
- Permissions: `FILES_UPLOAD` default role 3 (Assistant GM), required role 4 (GM); `FILES_BROWSE` default role 2. — https://foundryvtt.com/api/variables/CONST.USER_PERMISSIONS.html . Fine for a GM-only feature.
- Settings: world/client/user scopes. — https://foundryvtt.com/article/settings/ (no size limits documented; not suited to a large store).
- Module data on documents: `flags`, or module sub-types (`documentTypes` + `TypeDataModel`, data under `system`). — https://foundryvtt.com/article/module-sub-types/
- World database: LevelDB since v11 (replaced NeDB). — https://foundryvtt.com/releases/11.299 , https://foundryvtt.com/article/v11-leveldb-packs/
- Implications:
  - Canon must outlive any one world → store in the Data folder (module `/storage/` via `uploadPersistent`, or a `silk/` dir), read back with `fetch`. Content-addressed objects are write-once, so the missing delete API only matters for GC of orphans.
  - Adventure working state can live in world documents (flags / sub-types) and be snapshotted into the Canon store at commit/merge time.

## Open questions

- Unverified: Data-folder files are served over HTTP, so unrevealed Canon content may be fetchable by players who guess the path. Check before storing secrets there.
- Merging several Adventures back into one Canon: LCA design handles it, needs tests.
- GC of orphaned objects given no delete API in FilePicker.
