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
(`rush`) and the fusions found (`fusions`, v11), the next run's region and
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
`localStorage` under `the-tower-quality` ([performance.md](performance.md)).

## Loading

`loadProfile` copies a legacy save to a backup key once (D3: no
migration), then parses and migrates the profile. A save that fails to
parse or migrate is never dropped silently: it is copied to
`tower-profile-corrupt` first, and a fresh profile starts.

## The migration ladder

`MIGRATIONS[n]` takes a raw object at version `n` to `n + 1`; `migrate`
walks it to `PROFILE_VERSION` (11) and throws on a version from the future
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

**Rules:** a rung writes literal values, never a call to today's defaults
(those may change; the rung must not); and fields the player already set
win over the rung's defaults (`{ ...defaults, ...raw.settings }`).

## The run snapshot

A snapshot carries its own `SNAPSHOT_VERSION` (no ladder: bump it whenever
`RunState` changes shape, and an old snapshot is dropped), the profile it
belongs to, and `records.runs` when it was taken. On boot a snapshot
resumes the run at its wave boundary, paused. On run end the app writes the
banked profile *before* clearing the snapshot: killed between the two
writes, the snapshot's run count is behind the profile's and it is
dropped, so a run is paid exactly once.

## Carrying a profile, and backups (U12)

`meta/save/transfer.ts`. Settings → Save, between runs only:

- **Copy save** puts the profile's JSON on the clipboard; **Save file**
  writes it to `Documents/TheTower/` in the Android shell, or downloads it
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

## Reset

Settings → Progress → Reset progress (between runs only, asks twice)
writes a fresh profile, clears the snapshot, and reloads the page. An
import or a restore goes the same way (`App#replace`); the save stamps
`lastSeen`, so a restored profile is not paid offline twice.
