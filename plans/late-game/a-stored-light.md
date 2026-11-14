# A. Stored Light

**Status:** 2026-11-03. Outline, to be expanded. Idea 1 of the late-game
review ([README](README.md)), plus the I5 rewrite the other plans need.

**In one line:** most of what a night away pays is stored as a charge,
and only live runs burn it, at a high rate. You come back to an explosive
15 minutes instead of a bigger number.

---

## 1. The problem

`meta/offline.ts#offlineEarnings` pays `farm rate × minutes × efficiency`
straight into `profile.shards`. With Night Watch IV (25% × 12 h) one
night pays about 3 h of farm time, or 9× a 20-minute session. So:

- The best move is to close the app. The hands-off bot reaches the Blight
  with ~3.5 h of screen time, the active bot with ~5.2 h.
- Lowering the rate has been tried (`BALANCE.offline` notes that 60% was cut
  to 15–25%). It only slows the whole game down, idle and active alike.

The fix is to change **what offline pays**, not how much.

## 2. The mechanic

- **Split.** An absence pays `instant` (proposal: 30%) as shards, as it
  does today. That keeps the welcome-back card worth reading and the Foreman
  buying. The rest goes into `profile.storedLight`, counted in shards.
- **Burn.** While `storedLight > 0`, a run's shards are boosted, and the
  bonus comes out of the pool. Proposal: ×3 while engaged (§3), so a pool
  worth 3 h of farm time burns in about 90 minutes of live play.
- **Extra card.** A run that *starts* with a pool of at least one run's worth
  gets +1 draft choice (through `RunConfig`, decided at `createRun`, so the
  sim stays deterministic).
- **No decay, no cap beyond Night Watch's.** Stored Light never runs out on
  its own and never times out (no FOMO). The tier's `capHours` still limits
  what one absence stores.
- **Not a currency (R2).** It can't be spent in a shop. It's a multiplier
  with a fuel gauge, like rested XP.

### Where it's computed

Meta only, so `sim/` doesn't change apart from the extra card:

- `bankRun` works out the bonus: `min(pool, runShards × (mult − 1))`. It
  adds that to the run's pay, takes it off the pool, and the results screen
  gets a line for it.
- The HUD meter is presentation only. It reads the run's live shards and
  the pool, and shows the gauge draining, but never feeds back into the sim.
- `meta/offline.ts`: `offlineEarnings` returns `{ shards, stored }`.

## 3. The open decision: what counts as "engaged"

If every foreground run burns the pool, the idle bot's 20-minute check-ins
burn it too. The feel changes, but the maths doesn't: screen-off still wins.
There are three options:

| Option | Rule | Effect |
|---|---|---|
| a | Every run burns at ×3 | Rested XP. Total income is unchanged; only when it arrives moves. Safest, but it doesn't fix the screen-time gap. |
| b | ×3 when engaged, ×1.25 when hands-off | **Recommended.** Idle players still collect it all, only more slowly. Active play is clearly better. |
| c | Engaged only | Strongest, but hands-off players never see their night's pay. Too harsh for an idle game. |

**Engaged** means the player has given an input recently: a manual draft
pick, a cast, a tap on a Rift (plan B), or any arena touch in the last 30 s.
The app tracks it (`App`), not the sim, and it's sampled per wave, so a
run's bonus is the sum of its engaged and hands-off waves.

## 4. Rewriting I5

I5 today says active shards per hour ÷ idle shards per hour should be 1.15–1.5,
measured at the same Forge state. That measures run efficiency, but the
complaint is about **screen time**. Proposal:

| | Rule | Measured by |
|---|---|---|
| I5 (kept) | active ÷ idle shards per *run hour*, 1.15–1.5 | `idle.ts` farm comparison, unchanged |
| **I7 (new)** | the active bot reaches the Blight with **less screen time** than the idle bot; target ≤ 0.7× | `idle.ts`, both bots on the same clock |
| **I8 (new)** | idle still finishes Act 1 in 5–10 days (that's I2, re-read with Stored Light) | `npm run pacing -- --idle --hours 12 --seeds 4` |
| **I9 (new)** | no active-only reward reaches the idle bot | `idle.ts` asserts it (Rifts, anomalies, cursed relics, contracts) |

The "2–3× per screen hour" in the README is I7 put another way. Pick one
form before building.

## 5. Touches

| File | Change |
|---|---|
| `content/balance.ts` | `BALANCE.offline.instant`, `.storedMult` (engaged / hands-off), `.extraCardAt` |
| `meta/offline.ts` | split the pay; `burnStoredLight(profile, waves)` |
| `meta/profile.ts`, `meta/save/migrate.ts` | `storedLight: number`, profile v15 → v16 |
| `meta/results.ts` / `bankRun` | the bonus line, the burn |
| `meta/runConfig.ts` | +1 choice when the pool is large enough |
| `app/App.ts` | engagement tracking, per wave |
| `ui/` | welcome-back card ("12,400 stored"), a HUD gauge, results line |
| `tools/idle.ts` | model both burn rates; report screen time to the Blight for both bots; I7–I9 |
| `docs/idle.md` | the Offline section |

Reveal (R3): the gauge and card line appear with Night Watch I, when there
is first something stored.

## 6. Checks

- Unit: split, burn, cap, no decay, migration from v15 (`tests/idle.test.ts`,
  `tests/save.test.ts`).
- `npm run pacing -- --idle --hours 12 --seeds 4`: I2 still 5–10 days.
- `idle.ts`: I7 met (active screen time to the Blight ≤ 0.7× idle).
- Play a real morning: open after a night, and the first 15 minutes should feel
  boosted, with the gauge visibly draining.

## 7. Open

- The split (30/70?) and the multiplier (×3?) need a tuning pass.
- Should the burn rate rise with Night Watch tiers, so a bigger pool doesn't
  take longer to burn?
- Should Stored Light also boost Starlight in Act 2, or only shards? Shards
  buy little by then (docs/act2.md), so Act 2 probably needs it on
  Starlight to matter.
