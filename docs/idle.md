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
| `auto-ult` | the Autocaster casts the ultimate into a crowd of 8, or at a standing boss | `autoUlt`, `autoUltWanted` |
| `tactician`, `tactician-2` | the player's priority list for draft picks; II keeps one per frame | `tacticsKey`, `priorityList` |
| `offline` … `offline-4` | Night Watch I–IV: offline earnings | `offlineTier` |

Auto-restart waits while a card (welcome back) is up, and a first boss kill
holds the results for its ceremony unless Frontier March carries the next
run onward.

### The Tactician

The editor lists every card item the player has seen; the player drags the
ones they care about into an order. `RunConfig.priority` carries the list
into the sim, where `suggest` ranks an evolution first, then the list,
then the scorer for everything unlisted, so buying the Tactician never
makes the suggestion worse. With it, a draft waits 6 s instead of 10: the
player's own plan needs no thinking time. An empty list hands the choice
back to the scorer.

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
