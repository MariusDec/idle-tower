# Save

Code: `meta/profile.ts` (the shape and `newProfile`), `meta/save/index.ts`
(load, save, the run snapshot), `meta/save/migrate.ts` (the ladder),
`meta/save/schema.ts` (shallow shape checks), `meta/save/stores/`
(storage backends).

## Two parts (§12.4)

| Key | What | Written |
|---|---|---|
| `tower-profile` | the profile: all meta state, JSON | every hub action, run end, settings change, every 30 s, on hide or native pause |
| `tower-run` | the run snapshot: the whole `RunState` | at every new wave of a live run; cleared when the run is banked |

The stores are the ported legacy backends: IndexedDB on the web, the
Capacitor Filesystem on Android.

## The profile

`Profile` holds shards and Starlight, records, the Forge and Constellation
levels, what has been seen and found (cards, enemies, kills by type,
recipes), regions and bosses, relics owned and worn, feats, the farm rate
and `lastSeen` for offline, the ceremony owed, the Tactician's lists and
its Never lists (`tacticsNever`, v9), the pacts and the Abyss record, the
Foreman's `wishlist`, the Trials won (`trials`) and the one chosen for the
next run (`trial`), relic-set progress (`sets`, v10), Boss Rush's record
(`rush`) and the fusions found (`fusions`, v11), the Stored Light pool
(`storedLight`, and `records.storedBurned`, v16), the next run's region and
frame, the one-time lessons and the **settings**:

| Setting | Values |
|---|---|
| `speed` | 1–3, within what is unlocked |
| `sound` | the master switch |
| `autoUlt` | the Autocaster switch |
| `volume` | `{ master, sfx, music }`, 0–1 each |
| `shake` | screen shake on or off |
| `motion` | `'system'` (follow the device), `'reduce'`, `'full'` |
| `palette` | `'standard'` or `'safe'` (colourblind-safe canvas colours) |
| `textScale` | 1, 1.15 or 1.3 |

The quality tier is a device's, not a profile's: it lives in
`localStorage` under `blue-hour-quality` ([performance.md](performance.md)).

## Loading

`loadProfile` copies a legacy save to a backup key once (D3: no
migration), then parses and migrates the profile. A save that fails to
parse or migrate is never dropped silently: it is copied to
`tower-profile-corrupt` first, and a fresh profile starts.

## The migration ladder

`MIGRATIONS[n]` takes a raw object at version `n` to `n + 1`; `migrate`
walks it to `PROFILE_VERSION` (28) and throws on a version from the future
or a missing rung. Every rung has a fixture in `tests/save.test.ts`, and a
test walks a v1 profile all the way up and checks it has every field a new
profile has, settings included.

| Rung | Phase | Adds |
|---|---|---|
| 1 → 2 | P2 | NEW stamps, the first-draft lesson |
| 2 → 3 | P3 | the Forge, run totals, enemies seen |
| 3 → 4 | P4 | bosses, regions, relics, feats, frames, the farm rate |
| 4 → 5 | P5 | the Recipe Book, the sound switch |
| 5 → 6 | P6 | the Tactician's lists, the Autocaster switch |
| 6 → 7 | P8 | Starlight, the Constellations, the pacts, the Abyss |
| 7 → 8 | P9 | volumes, shake, motion, palette, text size |
| 8 → 9 | Q2 | the Tactician's Never lists |
| 9 → 10 | Q3 | the Foreman's wishlist, Trials won and chosen, relic-set progress |
| 10 → 11 | Q4 | Boss Rush's record, the fusions found |
| 11 → 12 | — | the camera's framing |
| 12 → 13 | — | the explainers read (`tutorial.explained`) |
| 13 → 14 | — | trims taken off (`trimsOff`) |
| 14 → 15 | — | keystones switched off (`keystonesOff`) |
| 15 → 16 | — | Stored Light (`storedLight`, `records.storedBurned`) |
| 16 → 17 | — | the rift journal (`rifts`), `tutorial.firstRift` |
| 17 → 18 | — | cursed relics (`cursedWorn`, `bound`, `cursedBest`), `tutorial.firstReliquary` |
| 18 → 19 | — | anomalies found, glimpsed and taken, the dry-run count |
| 19 → 20 | — | secrets found, heard, tallied and sighted |
| 20 → 21 | — | Final Forms reached (`forms`) |
| 21 → 22 | — | the strata (`abyss.felled`, `abyss.start`) |
| 22 → 23 | — | the Contract board (`contracts`) |
| 23 → 24 | — | where a taken contract goes back to (`contracts.back`) |
| 24 → 25 | — | the Daily Omen (`omen`: `since`, `days`, `played`, `best`, `pending`) |
| 25 → 26 | R1 | the draft timer setting, runs per region (an old record counts as two) |
| 26 → 27 | R5 | the 60 fps cap and keep-awake settings |
| 27 → 28 | — | when each Forge weapon was bought (`forgedAt`, empty: nothing old is fresh; plans/forge-weapon-pacing.md) |

**Rules:** a rung writes literal values, never a call to today's defaults
(those may change; the rung must not); and fields the player already set
win over the rung's defaults (`{ ...defaults, ...raw.settings }`).

## The run snapshot

A snapshot carries its own `SNAPSHOT_VERSION` (no ladder: bump it whenever
`RunState` changes shape, and an old snapshot is dropped), the profile it
belongs to, and `records.runs` when it was taken. On boot a snapshot
resumes the run at its wave boundary, paused. Beside the run the
envelope may hold Stored Light's tally (`burn`: played and left-alone base
shards, and the shards when the current wave began); it is optional, so a
snapshot without it resumes with an empty tally and no version bump is
needed. On run end the app writes the
banked profile *before* clearing the snapshot: killed between the two
writes, the snapshot's run count is behind the profile's and it is
dropped, so a run is paid exactly once.

A Daily Omen's run (plans/late-game/11) carries its day and its input log
in `RunState.omen` (snapshot version 21), so a run started at 23:50 banks
against its own date whenever it ends. Resuming one counts (`omen.resumes`,
logged as a `resume` op): the share code shows it. At boot a scored Omen
marked `omen.pending` with no snapshot to resume is cleared, so its try is
open again.

## Carrying a profile, and backups (U12)

`meta/save/transfer.ts`. Settings → Save, between runs only:

- **Copy save** puts the profile's JSON on the clipboard; **Save file**
  writes it to `Documents/BlueHour/` in the Android shell, or downloads it
  in a browser (`platform/files.ts`).
- **Load save** takes a paste or a picked file through `importProfile`:
  parsed, walked up the ladder, checked with `isProfile`. Nothing is
  replaced until the player confirms what the loaded profile holds.
- **Rolling backups:** at every run's end the app keeps the profile under
  `tower-backup-{runs % 3}`, so the last three runs' profiles are there.
  Settings lists them, newest first, each with Restore (confirmed the same
  way).

Moving from the debug APK to a signed release needs an uninstall, which
wipes the app's data: export first, import after.

## The purchase is not in the profile

The full-game entitlement's cache is its own key in the save store,
`tower-entitlement` (`app/entitlement.ts`), never a `Profile` field. So
export and import, the rolling backups, a reset and a corrupt profile never
carry, grant or lose a purchase. There is no founder flag: the game had no
players before the purchase existed (plans/monetization.md D-2).

## Android backup (R9)

On Android the save is a file in the app's private files dir
(`FilesystemSaveStore`), so Auto Backup can carry it to a new phone or
back after a reinstall. `res/xml/backup_rules.xml` (Android 11 and older)
and `res/xml/data_extraction_rules.xml` (12+: cloud and device-to-device)
include only `files/`: the profile, the run snapshot, the three rolling
backups and the seal flag. The WebView's data stays behind on purpose: its
`localStorage` holds per-device render choices (`blue-hour-quality`,
`blue-hour-canvas`), and its caches could push the set past Auto Backup's
25 MB cap, which stops the whole backup. The purchase's cache
(`tower-entitlement.json`) is excluded: a purchase belongs to a Google
account, and a new phone asks Google Play for it ([monetization.md](monetization.md)).
`tests/r9.test.ts` pins the rules.
Settings › Save says so on Android.

Tested with the local transport (`bmgr backupnow`, uninstall, install) on
API 30 and 33 emulators: the files are back before the first launch, and
on API 33 the game opened on the restored profile. Android skips a force-stopped app ("Backup is not
allowed"), so a manual test backs up with the app in the background, not
stopped.

## Reset

Settings → Progress → Reset progress (between runs only, asks twice)
writes a fresh profile, clears the snapshot, and reloads the page. An
import or a restore goes the same way (`App#replace`); the save stamps
`lastSeen`, so a restored profile is not paid offline twice.
