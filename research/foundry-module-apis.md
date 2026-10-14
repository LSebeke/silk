# Foundry module APIs for Silk

Research for issue #2. Researched 2026-10-14.

## Version scope

- Current DSA5 release (8.1.10, 2026-10-09) declares `compatibility: { minimum: "14.364", verified: "14.369", maximum: "14" }`, so the target is **Foundry v14**. Source: [dsa5 system.json on `foundry14` (default branch)](https://raw.githubusercontent.com/Plushtoast/dsa5-foundryVTT/foundry14/system.json).
- API docs used: [foundryvtt.com/api/v14](https://foundryvtt.com/api/v14/) (14.368 Stable).
- **Heads-up:** the local install is Foundry **13.351** with DSA5 **7.4.7** (`/mnt/Data/Software/FoundryVTT`, `~/.local/share/FoundryVTT/Data/systems/dsa5`). The behavior notes below that cite "v13 source" come from that local client code. They are marked as such and assumed unchanged in v14 unless stated. To develop against current DSA5, the local install has to be upgraded to v14.

## 1. ApplicationV2 windows: pop-out and persistent state

**Pop-out is built in from v14.** `ApplicationV2#detachWindow(options)` renders an app in a separate browser window, and `attachWindow()` brings it back to the main workspace. Protected hooks are `_canDetach`, `_canAttach`, `_onDetach(from, to)` and `_onAttach(from, to)`, where `from` and `to` are the `Document`s of the old and new host windows. Child apps registered via `renderChild` move along with the parent. Global hooks `openDetachedWindow(id, win)` and `closeDetachedWindow(id, win)` also exist. Sources: [ApplicationV2 v14](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html), [hookEvents v14](https://foundryvtt.com/api/v14/modules/hookEvents.html).
- The [v14 Year in Review](https://foundryvtt.com/article/year-in-review-2026/) says any ApplicationV2 can be detached and that modules inherit the feature automatically.
- The [v13 ApplicationV2 docs](https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html) have no `detachWindow`. On v13 a pop-out would need a third-party module.
- Gotchas:
  - In a detached window, `document` and `window` are different objects. Any canvas library (PIXI, Konva, d3, etc.) must bind to the app's own element and `ownerDocument`, not to the global `document` or `window`, and must re-bind in `_onDetach` / `_onAttach`.
  - The 14.352, 14.357 and 14.365 release notes fix detach bugs: ProseMirror editors during reparenting, lost scroll, and re-detaching. 14.365 adds `_refit` so an app can control how its host window resizes. Treat this as a young feature. Sources: [14.352](https://foundryvtt.com/releases/14.352), [14.357](https://foundryvtt.com/releases/14.357), [14.365](https://foundryvtt.com/releases/14.365).
- **Persistent state is not built in.** ApplicationV2 has `setPosition()`, `_onPosition()`, `minimize()`/`maximize()` and an `emittedEvents` list of `["prerender","render","close","position"]`. Nothing in the docs persists position or state across reloads, so Silk has to save state itself:
  - Window geometry and canvas pan/zoom: a `scope: "client"` setting (stored per browser) or a `scope: "user"` setting.
  - Per-world view state: user flags or a `world` setting.
  - Detached-across-reload: **unverified**. Nothing in the docs says a detached app reopens detached.
  - Save on `_onPosition` or `_preClose`. `_preClose` is awaited; `_onClose` is not.

## 2. Active Scene and the tokens/actors on it

Two different concepts:
- **Active Scene** (the one the players are pulled to): `game.scenes.active`, and `Scene#active` is a `BooleanField`. To change it, call `scene.activate({pullUsers, ...})`, which in v13 source is `update({active:true})`. To detect a change, use `Hooks.on("updateScene", (scene, changed) => "active" in changed)`.
- **Viewed Scene** (what this client's canvas shows; a GM can view a non-active scene): `game.scenes.viewed`, `scene.isView` and `canvas.scene`. To detect a change, use `canvasReady(canvas)` (also `canvasInit` and `canvasTearDown`).
- Sources: [Scenes collection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.Scenes.html), [Scene](https://foundryvtt.com/api/v14/classes/foundry.documents.Scene.html), [canvasReady](https://foundryvtt.com/api/v14/functions/hookEvents.canvasReady.html).
- For Focus View, decide which of the two counts as "the active Foundry Scene". It is probably `game.scenes.viewed` for the GM.

**Tokens and actors on a scene:**
- Use `scene.tokens` (an embedded collection of `TokenDocument`). Each `TokenDocument` has `actorId`, `actorLink`, `delta` (`ActorDeltaField`), `isLinked` and `actor`.
- Keep the list current with `createToken`, `updateToken` and `deleteToken`. The generic `createDocument` hooks fire for embedded types.
- v14 adds **Scene Levels**: `Scene#levels` is an embedded collection, and `TokenDocument#locatedInLevel(level)` exists. Tokens can sit on different levels of one scene.
- Source: [TokenDocument](https://foundryvtt.com/api/v14/classes/foundry.documents.TokenDocument.html).

**Unlinked tokens (the default for NPCs) are synthetic actors:**
- Changes go into the token's `ActorDelta`, not the world Actor.
- In v13 source, `ActorDelta#_onUpdate` calls `Hooks.callAll("updateActor", this.syntheticActor, …)` (`client/documents/actor-delta.mjs`). So `updateActor` **does** fire for synthetic actors, but the actor passed in is the token's synthetic copy:
  - `actor.isToken === true`
  - `actor.token` is the TokenDocument
  - `actor.id` equals the base actor's id
- Silk must tell "this goblin token died" apart from "the Goblin actor template changed".

## 3. Create/update/delete hooks (capturing World State)

- **Generic hooks:** `create<Doc>`, `update<Doc>` and `delete<Doc>` (e.g. `updateActor`, `deleteItem`, `updateJournalEntryPage`, `updateScene`).
  - Signatures:
    - `(doc, options, userId)` for create and delete
    - `(doc, changed, options, userId)` for update, where `changed` is the diff
  - They fire **on every connected client** after the server has processed the change.
  - Sources: [createDocument](https://foundryvtt.com/api/v14/functions/hookEvents.createDocument.html), [updateDocument](https://foundryvtt.com/api/v14/functions/hookEvents.updateDocument.html), [deleteDocument](https://foundryvtt.com/api/v14/functions/hookEvents.deleteDocument.html).
- **`pre*` hooks** (`preUpdateActor`, etc.) fire **only on the client that started the change**. They can change the data or cancel by returning `false`. Source: [preUpdateDocument](https://foundryvtt.com/api/v14/functions/hookEvents.preUpdateDocument.html).
- **Embedded documents fire their own hooks:**
  - An Item on an Actor fires `createItem`/`updateItem`/`deleteItem`, with `item.parent === actor`.
  - Journal content changes fire `updateJournalEntryPage`, not `updateJournalEntry`.
  - Token moves fire `updateToken` (v14 also has `moveToken`, `preMoveToken`, etc.).
- **Compendium edits** fire `updateCompendium(pack, documents, options, userId)`. Source: [updateCompendium](https://foundryvtt.com/api/v14/functions/hookEvents.updateCompendium.html).
- Gotchas:
  - **Hooks are never awaited.** An `async` handler cannot cancel a `pre*` hook, because it returns a Promise rather than `false`. Source: hookEvents "Cancellable Hooks".
  - **Only one client should write.** Post-hooks run on every client, so World State writes must be gated, e.g. `if (game.user !== game.users.activeGM) return;`. `Users#activeGM` "can be useful for workflows which occur on all clients, but where only one user should take action". Source: [Users](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.Users.html).
  - **The GM may be offline** when players change things (e.g. a player edits their sheet between sessions). Those changes are not captured live. Silk needs a reconcile pass on `ready`, for example by comparing `_stats.modifiedTime` or a stored snapshot.
  - **`changed` is a diff, not the full document.** Deletions use the `-=key` syntax (seen in v13 `unsetFlag` source), and arrays are replaced whole.

## 4. Reveal: show-to-players and per-page ownership

- **Show:** `foundry.documents.collections.Journal.show(doc, {force, users})` accepts a **JournalEntry or a JournalEntryPage**.
  - By default it only shows to users who can already observe the document. `force: true` shows it to all players regardless of permission. `users: [ids]` targets specific users.
  - It throws if the caller does not own the document.
  - `Journal.showDialog(doc)` is the built-in UI.
  - `Journal.showImage(src, config)` shares a bare image.
  - `JournalEntry#show(force)` is the older single-entry shortcut.
  - Sources: [Journal collection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.Journal.html), [JournalEntry](https://foundryvtt.com/api/v14/classes/foundry.documents.JournalEntry.html).
- **Show is transient.** It pops the document up on screen but does not grant lasting access. A lasting Reveal must **update `ownership`**.
- **Per-page ownership:**
  - `JournalEntryPage` has its own `ownership: DocumentOwnershipField`.
  - Levels are `INHERIT -1, NONE 0, LIMITED 1, OBSERVER 2, OWNER 3`. Pages default to inheriting from the entry: "Embedded Documents defer to their parent ownership".
  - So one entry can hold hidden and revealed pages side by side. That fits "Info Block = one page".
  - Sources: [JournalEntryPage](https://foundryvtt.com/api/v14/classes/foundry.documents.JournalEntryPage.html), [DOCUMENT_OWNERSHIP_LEVELS](https://foundryvtt.com/api/v14/variables/CONST.DOCUMENT_OWNERSHIP_LEVELS.html).
  - Gotcha: a player needs at least LIMITED on the **entry** to reach any page in it. *(Inferred from the inheritance model, not stated explicitly; verify in-app.)*
  - Use `doc.testUserPermission(user, "OBSERVER")` to check access and `getUserLevel` to read the raw level.
- **Alternative: secret blocks inside one page.**
  - The text editor has "Secret" blocks that only GM and owners see. The GM can click "reveal" to make one visible. Source: [KB: Journal Entries](https://foundryvtt.com/article/journal/).
  - This is finer-grained than pages but is stored as HTML markup inside `text.content`. Silk would have to parse and rewrite HTML, which is brittle. Prefer page-level ownership for Info Blocks.
- **Ownership is ignored inside compendiums.** "Compendium content ignores the ownership field in favor of User role-based ownership" (`getUserLevel` docs). Reveal therefore only works on **world** documents, so Materialize must have happened first.

## 5. Flags

- **API:** `doc.setFlag(scope, key, value)`, `getFlag(scope, key)` and `unsetFlag(scope, key)`. The scope for a module is its id (`"silk"`). Setting `null` deletes the flag. `setFlag` is just `update({flags:{[scope]:{[key]:value}}})`, so it fires the normal `preUpdate`/`update` hooks. Source: [Document](https://foundryvtt.com/api/v14/classes/foundry.abstract.Document.html).
- Gotchas:
  - **The scope must be an active package.** v13 source `client/data/client-backend.mjs#getFlagScopes` builds the allowed list as `["core","world",game.system.id, ...active module ids]`. `get`, `set` and `unset` all throw `Flag scope "x" is not valid or not currently active` for anything else. If Silk is disabled, the data stays in `doc.flags.silk` but can only be read raw.
  - A Silk flag write is itself an `update<Doc>`. Silk's own World State listener must ignore it, e.g. by passing a custom option such as `{silk: {internal: true}}` in the update and checking `options` in the hook.
  - Flags travel with the document: duplicates, exports, compendium import/export and `toObject()` all carry them. A Story Element id stored in a flag is therefore copied whenever the document is copied, so Silk needs to handle duplicate ids.
  - Large data in flags is synced to every client and bloats the world DB. Store pointers or ids in flags, not the Story graph.

## 6. World-independent storage for a Canon

| Option | World-independent? | Notes / limits |
|---|---|---|
| **Settings** (`game.settings.register`) | **No** | Scopes are `world` (everyone, in the world DB), `user` (per user, in the world DB) and `client` (per browser; `storage` has "the same API as window.localStorage"). None of them crosses worlds; `client` crosses worlds only within one browser. Good for preferences and window state, not the Canon. [ClientSettings](https://foundryvtt.com/api/v14/classes/foundry.helpers.ClientSettings.html) |
| **Module `storage/` folder** via `FilePicker.uploadPersistent(packageId, path, file)` | **Yes** | Uploads to `modules/<id>/storage/`. Needs `"persistentStorage": true` in module.json ("whether updates should leave the contents of the package's /storage folder"; [ModuleManifestData](https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.ModuleManifestData.html)). The data survives module **updates** but **uninstalling the module deletes it** ([11.292 notes](https://foundryvtt.com/releases/11.292)). Read via `fetch()` of the served path, list via `FilePicker.browse`. |
| **User-data folder** via `FilePicker.upload("data", "silk/canons/…", file)` and `FilePicker.createDirectory` | **Yes** | Survives module uninstall. Plain JSON files would allow editing the Canon outside Foundry later (ADR-0001). |
| **Compendium packs** | Only if the pack belongs to a **module** | `CompendiumCollection.createCompendium` creates world packs, which are world-bound ([CompendiumCollection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.CompendiumCollection.html)). A cross-world pack must ship inside a module (KB: [Compendium](https://foundryvtt.com/article/compendium/), [Packaging Guide](https://foundryvtt.com/article/packaging-guide/)). |

Notes on the three file-based options:

**Uploads in general.**
- `json`, `md`, `yaml` and `txt` are allowed upload types ([UPLOADABLE_FILE_EXTENSIONS](https://foundryvtt.com/api/v14/variables/CONST.UPLOADABLE_FILE_EXTENSIONS.html)).
- Uploading needs the `FILES_UPLOAD` permission, which defaults to the Assistant GM role; `FILES_BROWSE` defaults to Trusted Player ([USER_PERMISSIONS](https://foundryvtt.com/api/v14/variables/CONST.USER_PERMISSIONS.html)).
- `sources` are `data`, `public` and `s3`. Hosted setups (Forge, S3) may have no writable `data` source, and paths may resolve to remote URLs.
- Writes replace whole files. There are no atomic multi-file writes and no locking, so Silk must handle concurrent GMs and partial writes itself, for example with one file per element or a versioned write-then-swap.

**Data folder (`FilePicker.upload` to `data`).**
- *Unverified:* files under Data are served over HTTP, so players who know or guess the path could probably read Canon spoilers. Verify before relying on this.

**Compendium packs.**
- Module packs are LevelDB, have only role-based ownership, and are locked by default ("Toggle Edit Lock").
- The KB warns that "changes will be lost when the module or system updates" for content in packs that belong to a module.
- Fine for a Canon in a **dedicated per-user content module that is never updated from a remote** (the in-app Module Maker, see the Packaging Guide). Not fine for packs inside Silk's own module.
- Packs hold only Foundry documents of one type each (Adventure documents excepted), so they don't fit graph data such as Connections or layout.
- LevelDB is locked while Foundry runs, so external editing is hard.

**Recommendation (for the ADR, not decided here):**
- Store the Canon as JSON in `modules/silk/storage/` (with `persistentStorage`) or in a `data` subfolder. Prefer `data` for safety on uninstall, and add export/import.
- Use flags only as links between world documents and Story Elements.
- Use settings for preferences and window state.
- Use module compendiums only as an optional export target.

## Open items to verify in-app (v14)

1. Does a detached ApplicationV2 restore as detached after a reload?
2. Are Data-folder JSON files fetchable by non-GM clients (Canon spoiler exposure)?
3. Does a player need entry-level LIMITED/OBSERVER to see an OBSERVER page inside an otherwise NONE entry?
4. Does `uploadPersistent` overwrite an existing file silently?
