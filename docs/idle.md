# Idle: automation and offline

The game never waits (§6.1): a draft times out onto the suggestion, a run
restarts itself, and time away pays. Code: `meta/automation.ts` (the
Engineering branch's automation, the app's not the run's),
`meta/offline.ts`, `ui/hub/tactics.ts`, and the app's timing in
`App.ts`. Constants: `BALANCE.automation`, `BALANCE.offline`.

## Automation (§6.2)

Engineering notables add `automation` effects. `buildRunConfig` skips
them; `automations(profile)` is their one consumer.

| Automation | What it does | Where |
|---|---|---|
| `speed-2`, `speed-3` | the HUD's speed toggle goes to 2×, 3× | `maxSpeed`, `runSpeed` |
| `auto-restart` | the results screen starts the next run after 5 s | `App#endRun`, `ResultsScreen` |
| `frontier-march` | after a first boss kill, the next run moves to the new frontier | `marchOn` |
| `auto-ult` | the Autocaster casts the ultimate on its own rule (U13, below) | `autoUlt`, `autoUltWanted` |
| `tactician`, `tactician-2` | the player's priority and Never lists for draft picks; II keeps them per frame, and per frame in a region; the Opening takes itself (U2) | `tacticsScopes`, `priorityList`, `neverList`, `openingSeconds` |
| `offline` … `offline-4` | Night Watch I–IV: offline earnings | `offlineTier` |
| `foreman` | the Foreman's wishlist (N7, below) | `togglePin`, `foremanBuy` |

Auto-restart waits while a card (welcome back) is up, and a first boss kill
holds the results for its ceremony unless Frontier March carries the next
run onward.

### The Autocaster's rules (U13)

Each ultimate carries its rule as data (`UltimateDef.auto`), read by
`sim/systems/ultimate.ts#autoUltWanted`; the app and the idle bot cast on it.

| Ultimate | Casts |
|---|---|
| Nova | into a boss's slam wind-up, which it staggers (at once if the boss's phase has no slam), or a crowd of 8 |
| Aegis | a shockwave within 0.6 s of the wall, or HP under 40% with 3 at the wall |
| Eclipse | HP in range worth 6 of the wave's bodies, or a boss |
| Tempest, Overclock, Daybreak | a standing boss, or a crowd of 8 |

### The Tactician

The editor lists every card item the player has seen; the player drags the
ones they care about into an order. `RunConfig.priority` carries the list
into the sim, where `suggest` ranks an evolution first, then the list,
then the scorer for everything unlisted, so buying the Tactician never
makes the suggestion worse. With it, a draft waits 6 s instead of 10: the
player's own plan needs no thinking time. An empty list hands the choice
back to the scorer.

**Never** (U7): `profile.tacticsNever`, keyed like the lists; a Never card
is suggested only when nothing else is offered, and once Banish (N1) is
owned the run spends its charges on them by itself: a Never item's new
card is struck as its hand is dealt (`draft.ts#autoBanish`). **Tactician II** keeps lists per frame (`arcanist`) and,
if the player chooses, per frame in a region (`arcanist@3`); a run follows
the most specific key the player has written, then the frame's, then the
shared one. **The Opening** (U2): with the Tactician, a run that starts
with drafts banked takes every suggestion after 2 s unless touched.

### The Foreman (N7)

An Engineering notable (ring 4, off Tactician II, sealed by the Bog
Mother; the plan's ring 3 has no room there). The Forge's node card gets
**Pin**: up to five nodes (`WISHLIST_MAX`), shown on the web with their
place in the queue. `foremanBuy` buys the list in order whenever the
profile changes hands between runs: at the end of `bankRun` (the results
list what it bought) and when offline shards land (the welcome-back card
says so). A pinned node that can't be bought yet (sealed, or not reached)
waits its turn; the first one that can be bought but not afforded stops
the buying, so the shards are kept for it. A node at its last level comes
off the list. Never mid-run.

## Offline (§6.3)

- **Farm rate.** `bankRun` records shards per minute of every run of at
  least 60 s; the farm rate is the median of the last five.
- **Earnings.** `rate × minutes away × efficiency`, with time capped by the
  tier: 25% for 2 h, 40% for 4 h, 60% for 8 h, 75% for 12 h. Absences under
  60 s pay nothing.
- **Shards only.** No simulated combat, no bosses, relics or feats offline.
- **When.** On boot and on every return from an absence (`App#absent`):
  the page shown again, the native resume, or a stalled frame. The
  welcome-back card says what was earned and what became affordable.
  Mid-run it is a toast over the pause menu (or the Settings over it), and
  only the pause menu's Resume resumes.

**Invariant:** the sim is never fast-forwarded. An absence is paid by the
offline formula, never by catching the loop up.

## Idle vs. active

The idle bot (`tools/idle.ts`) checks in twice a day for 20 minutes with
the whole kit. I2 (Act 1 in 5–10 days idle) and I5 (active earns 1.15–1.5×
idle per hour from Region 2 on) are measured on it; see
[balancing.md](balancing.md).
