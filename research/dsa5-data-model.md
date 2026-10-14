# DSA5 system data model (research for #3)

Question: Which Foundry versions does DSA5 support? Actor/Item types, key fields (LeP/death, inventory, location)? Compendium/journal structure? Official module conventions Silk should follow?

Sources (all read 2026-10-14):
- [S1] System repo `Plushtoast/dsa5-foundryVTT`, default branch `foundry14`, commit `73ab7f7e`, release 8.1.10 (2026-10-09). https://github.com/Plushtoast/dsa5-foundryVTT/tree/foundry14
- [S2] `system.json` on branches `foundry14`, `foundry13`, `foundry12`.
- [S3] Foundry package listing https://foundryvtt.com/packages/dsa5 (versions list, "Verified 14.369").
- [S4] Official free adventure module `Plushtoast/dsa5_introduction` (id `dsa5-introduction`, v8.0.1) — reference implementation of the adventure-module conventions used by the Ulisses premium modules (which are closed source and not inspected).

## 1. Foundry version support

| System version | Branch | Foundry compat (min / verified / max) |
|---|---|---|
| 8.1.10 (current) | `foundry14` | 14.364 / 14.369 / 14 |
| 7.5.1 | `foundry13` | 13 / 13 / 13 |
| 6.2.3 | `foundry12` | 12 / 12 / 12 |

- One system major per Foundry major; each release pinned to a single Foundry generation [S2]. Branches exist back to `foundry08` [S1].
- Release cadence: roughly weekly patch releases (8.1.5 → 8.1.10 in Sep–Oct 2026) [S1 releases].
- Implication: Silk v1 should target **Foundry v14 + dsa5 8.x**; v13 support would mean a second dsa5 code path (7.x).

## 2. Data model mechanics

- No `template.json`. All types are declared in `system.json` → `documentTypes` and implemented as **TypeDataModels** (`foundry.abstract.TypeDataModel` subclasses) in `modules/data/` — registry in `modules/data/models.js` [S1].
- Actor/Item models compose mixins from `modules/data/actor/templates/*` and `modules/data/item/templates/*` (e.g. `StatusTemplate`, `DetailsTemplate`, `EquipmentTemplate`) [S1].
- Many derived values (e.g. `status.wounds.max`, `.min`, `.current`) are computed in `prepareDerivedData` (`modules/data/baseactor.js`) — **do not write derived fields**; write only source fields.

## 3. Document subtypes (`system.json` → `documentTypes`) [S2]

- **Actor**: `character`, `npc`, `creature`, `group`, `vehicle`.
  - `character`/`npc` share mixins (Riding, CompanionOwner, Characteristics, Merchant, Details, Status, Magic). `creature` has no `DetailsTemplate`; has `description`, `behaviour`, `creatureClass`, `count`, `specialRules`, etc. (`modules/data/actor/*.js`).
  - `group` = party actor: `members` (TypedObject of `{uuid, sort}`), `locations` (vehicle/mount actors per travel mode — **not** geographic), `travel`, `details.biography/notes`.
  - Merchant/loot is **not** a separate type: any character/npc/creature/vehicle has `system.merchant.merchantType` ∈ `none | merchant | loot | epic` (`config-dsa5.js` `DSA5.merchantTypes`).
- **Item** (38): `equipment, armor, ammunition, rangeweapon, meleeweapon, skill, combatskill, specialability, advantage, disadvantage, trait, money, species, career, culture, spell, liturgy, blessing, magictrick, ceremony, ritual, aggregatedTest, poison, disease, consumable, spellextension, application, effectwrapper, plant, magicalsign, demonmark, patron, information, essence, imprint, book, trap, itempackage`.
- **JournalEntryPage**: `dsacalendar, dsaaptracker, dsamoneytracker, dsaquestlog, dsapersonaedramatis, citydetails`.
- **RegionBehavior**: `DSATrap, DSAAura, DSAZone`. **Combat**/`Combatant`: `dsacombat`/`dsacombatant`. **ActiveEffect**: `enhancement`.

## 4. Key fields Silk would read/write

### Life points (LeP) — `modules/data/actor/templates/status.js`, `baseactor.js`
- Current LeP: **`system.status.wounds.value`** (misleading name: it is remaining LeP, not wounds taken). Token bar: `primaryTokenAttribute: "status.wounds"` [S2].
- Max LeP: `system.status.wounds.max` — derived from `initial + KO*2 + modifier + advances` (character/npc) or `initial` (creature). Floor: `system.status.wounds.min = -KO` (derived).
- Also: `status.astralenergy` (AsP), `status.karmaenergy` (KaP), `status.temporaryLeP` (brawling), `status.fatePoints`.
- Damage path: `actor.applyDamage(formula, options)` → updates `system.status.wounds.value`; fires async hook `preApplyDamage` (`modules/actor/actor-dsa5.js:1520`). Vehicles use `status.structurePoints`/`crew`.

### Death / incapacitation
- Death is a **status effect** (ActiveEffect with `statuses` containing `'dead'`), first entry in `DSA5.statusEffects` (`config-dsa5.js`; icon skull, overlay). Other relevant conditions: `unconscious`, `incapacitated`, `inpain` (levels 0–4, auto-derived from LeP).
- When a `dead`/`defeated` effect is created/deleted during combat, the system calls `actor.markDead(bool)` → sets `combatant.defeated` (`modules/hooks/actor.js`).
- No code found that auto-applies `dead` when LeP ≤ 0 (grep of `modules/`); death is GM-set. **Silk should treat "has `dead` status" as the death signal**, optionally also LeP ≤ `wounds.min`. Check via `actor.hasCondition('dead')`; set via `actor.addCondition('dead')` / `removeCondition`.

### Inventory — `modules/data/item/templates/equipment.js`, `item/equipment.js`
- Inventory = embedded Items on the Actor (physical types: `equipment, armor, meleeweapon, rangeweapon, ammunition, consumable, money, poison, plant, book`, …).
- Common physical fields: `system.quantity.value`, `system.weight.value`, `system.price.value`, `system.parent_id` (container nesting), `system.tradeLocked`.
- Containers: an `equipment` with `system.equipmentType.value === 'bags'`; contained items point to it via `system.parent_id = <bag item _id>` (`actor-dsa5.js:517`, `actor-sheet.js:2150`).
- Worn/equipped: `system.worn.value` (equipment, armor, weapons).
- Money: `money` items, `system.quantity.value`, coin type in `system.subcategory`.
- Looting: set an actor's `system.merchant.merchantType = 'loot'` to make it a loot container players can trade with.

### Location
- **No actor field for geographic location.** Location exists only implicitly as Token-on-Scene; `group.locations` is travel vehicles; `dsaquestlog` quests have a free-text `location` string; `equipment.region` is a plant/region label. → Silk's "located in" must be its own data (flags) or derived from token placement.

### Text fields
- Actors: `system.details.biography.value`, `system.details.notes.value`, `.gmdescription`, `.ownerdescription` (HTML). Creatures: `system.description.value`, `behaviour`, etc.
- Items: `system.description.value` + **`system.gmdescription.value`** (GM-only text) on nearly every type.

## 5. Built-in reveal-style features overlapping Silk

- **`information` Item type** (`modules/data/item/information.js`): a knowledge snippet tiered by quality level — `qs1…qs6`, `crit`, `botch`, `fail` (HTML), tied to a `skill` + `modifier`; players roll to learn it. Equipment items link to info via `system.refs` (`InformableTemplate`, DocumentUUID → `information` item). Close match to Silk's Info Block / Reveal — candidate to reuse or interoperate with.
- **`dsapersonaedramatis` page**: list of persons, each `{name, type, actor_uuid, visible, important, faction, tags, notes, description, img, …}` — a Dramatis Personae with per-entry player visibility.
- **`dsaquestlog` page**: quests `{title, summary, details, gmNotes, status, priority, audience, playerOwners, visible, chapter, location, tags, dates, objectives…}`.
- **`citydetails` page**: city entries by kind (temples, inns, taverns, merchants…), quality, price.
- These are HTML/collection-based JournalEntryPage subtypes using `TypedObjectField` collections (`journallistdatamodel.js`).

## 6. Compendium & journal structure

- System packs: `skills`/`skillsen` (Item), `patzer`/`botch` (RollTable), `gamemanualde`/`gamemanualen` (JournalEntry), `macros` [S2]. Packs are LevelDB dirs (path `packs/<name>.db`).
- **Language split by pack**: each pack duplicated per language, tagged `flags.dsalang: "de" | "en"`; the system filters by this [S2, S4].
- `packFolders` group packs in the compendium sidebar (system uses folder "DSA5/TDE5").
- Large item catalogues come from Ulisses modules and are browsed via the system's **Item Library** (`game.dsa5.itemLibrary`, module filter `LibraryModulsFilter`).

## 7. Official adventure-module conventions [S4, S1]

From `dsa5_introduction` and the system's `DSA5Initializer` (`modules/system/maintenance/initializer.js`) and `BookWizard` (`modules/wizards/adventure_wizard.js`):
- `module.json`: `relationships.systems: [{id: "dsa5", compatibility: {minimum: "8.0.0"}}]`; packs per type × language (`Actor`, `Scene`, `JournalEntry`), `flags.dsalang`, `ownership: {PLAYER: "NONE", ASSISTANT: "OWNER"}`; `packFolders`.
- **`initialization{de|en}.json`**: `{actors, scenes, journal: "<packId>", initialScene, items: [...], folders, playlists, macro}` — consumed by `game.dsa5.apps.DSA5Initializer` to import packs into the world, creating folders, scenes, scene notes; journals matched across imports via **`flags.dsa5.initId`**, nested via `flags.dsa5.parent`, colored via `flags.dsa5.foldercolor`.
- **`adventure{de|en}.json`**: `{moduleName, journal, actors, scenes, chapters: [{name, content: [{id, name, scenes[], actors[]}]}]}` — drives the **Journal Browser** ("Book Wizard"). Registered at `ready`: `game.dsa5.apps.journalBrowser.adventures.push({id, path, visible})` (rules books → `.books`). Journals ordered via `flags.dsa5.parent` + `flags.dsa5.sort`.
- Module-scoped `firstTimeStart` setting + welcome chat message; `DSA5_Utility.registerMasterTokens(moduleId)`.
- Users can also add custom books (a JournalEntry pack) to the browser (`journalBrowserCustomBooks` setting) — chapters auto-built from pack folders.

## 8. Implications for Silk

- Target Foundry v14 / dsa5 ≥ 8.0; expect frequent dsa5 patch releases → read fields through a thin adapter, not scattered paths.
- Element Class → doc mapping: person → `npc` (or `character` for PCs, `creature` for beasts); thing → `equipment` (or weapon/armor types); place → Scene and/or `citydetails` page; event/quest → `dsaquestlog` entry or plain JournalEntry.
- World State signals: `status.wounds.value`, `dead` status effect, embedded-item create/delete/`parent_id` changes (looting), `merchantType: 'loot'`.
- Location/"located in" has no DSA5 home → Silk flags.
- Consider exporting a Story as a dsa5-style adventure module (initialization/adventure JSON + `flags.dsa5.initId`) for Journal Browser compatibility; consider mapping Info Blocks to `information` items.
- Content in Ulisses packs is copyrighted (`COPYRIGHT-NOTICE`); system code is Apache-2.0. Silk may reference, not redistribute, pack content.

## Open points
- Ulisses premium module internals not inspected (closed); assumed to follow §7 since the system code reads exactly these files.
- LevelDB pack contents of `dsa5_introduction` not decoded; journal flag usage inferred from system code that consumes them.
