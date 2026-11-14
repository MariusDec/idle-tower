# B. Moments in a run

**Status:** 2026-11-03. Outline, to be expanded. Ideas 2 (Rifts),
4 (Anomaly cards) and 7 (Final Form) from the late-game review
([README](README.md)).

**In one line:** a run should have moments you'd tell someone about, and
the best of them should only go to a player who is watching.

The three are independent. They're in one plan because they share the
problem (runs got predictable) and they touch the same places: the draft,
`sim/systems/draft.ts`, the ceremony layer, and the idle bot's I9 check
(plan A §4).

| Part | Who gets it | Size |
|---|---|---|
| §1 Rifts | active only | medium: one new panel, ~40 data entries |
| §2 Anomaly cards | active only (never the suggestion) | per-weapon code, so medium-large; ship 3–4 first |
| §3 Final Form | everyone | small: one check, one tower stage, one ceremony |

---

## 1. Rifts

A tear opens in the arena mid-wave. **Tap it within 6 s** and it offers
one or two choices. Leave it and it closes. The Autocaster and the idle bot
never open one.

### Examples (authored, ~40 in `content/rifts.ts`)

| Rift | Choice | Cost | Reward |
|---|---|---|---|
| Wager | double this wave | ×2 count | ×2 shards for the wave |
| Blood price | take a rare card | lose 20% HP | an extra draft, rolled from evolutions, fusions or an anomaly (§2) |
| Hungry dark | feed it | the next elite is a Champion | a relic rank drop at the end of the run |
| Echo | call the last boss back | fight it again now, at 50% HP | its relic roll again |
| Stillness | freeze time | no ultimate charge for 2 waves | the wave's enemies stop for 4 s |

Some Rifts belong to one region (`region?: number`), so each region has
its own and a Rift reads as part of the place. They shouldn't all be
pure upside: half should be wagers.

### Rules

- **Rate:** proposal is one roll every 3–5 waves, never on boss waves or
  during a draft, at most two per run in Act 1.
- **Reveal (R3):** the first Rift is authored, after boss 1 falls, with a
  one-line explainer (`content/explainers.ts`).
- **Determinism:** the spawn rolls on a new `rifts` stream from
  `createRun`'s split, so existing seeds don't shift. The tap is an input
  by tick, like a cast, so a replay reproduces it.
- **The panel** reuses the draft panel's layout: the arena slows to 15%
  and there's no timer. Closing it is the same as declining.
- **R4:** 15 words for each choice.

### Touches

`content/rifts.ts` (new, with `RiftDef` in `content/types.ts`) and
`content/lint.ts`; `sim/systems/rifts.ts` (spawn, timeout, resolve; the
cost and reward effects go through the existing effect consumers where
they can, R8); `sim` input (`openRift`, `chooseRift`); `ui/rift.ts`;
`render/effects.ts` (the tear); `audio/cues.ts`; the Collection's
"Rifts seen" page.

## 2. Anomaly cards

Very rare draft cards that **break a weapon's rule** for the rest of the
run. This isn't +X%: the weapon does something else.

### Examples (one per weapon in the end; ship 3–4 first)

| Weapon | Anomaly | Rule broken |
|---|---|---|
| Frost Ring | Whiteout | the ring leaves its orbit and drifts as a blizzard |
| Glaives | Splinter | glaives never return, but split in two on a kill |
| Mortar | Skyfall | shells fall where enemies *will* be, in a line |
| Chain Lightning | Grounded | each bounce leaves a burning patch where it lands |
| Sentinel Drones | Swarm | drones die on hit, and a new one spawns every 0.5 s |
| Sunlance | Prism | the beam splits into three as it reaches the light's edge |

### Rules

- **Offer:** roughly 1 in 50 drafts, when the weapon is owned at level 3 or
  higher. At most one anomaly per run. It's an alternative to the
  evolution, not on top of it: an anomalised weapon can't evolve (or
  should it? Decide when expanding).
- **Never the suggestion,** and a timed-out draft never takes it, so it's
  active-only (I9). Rifts' Blood Price is the guaranteed way to see one.
- **Discovery:** the Collection shows "Anomalies: 2 found" and **doesn't say
  how many exist**. The first time you take one, it plays a ceremony.
- **Calibration:** `tools/calibrate.ts` must cover each anomaly, so it stays
  within the T2 25% band and the scorer can still rank the rest of the hand.

### Touches

`content/anomalies.ts` (new); a `kind: 'anomaly'` card in
`candidateCards` / `rollOffer`; per-weapon behaviour in `sim/systems/`
(the bulk of the work); `render/` per anomaly; `sim/suggest.ts` (never
suggest); Collection page; `calibrate.ts`.

## 3. Final Form

When **every weapon slot holds an evolved or fused weapon**, the tower
transforms for the rest of the run.

- **Look:** a new tower stage above the crown of light (`render/tower.ts`),
  a burst, a music layer that joins (`audio/music.ts`), and a different
  range-ring colour.
- **Effect:** small and visible, not a stat: the ultimate charges 50% faster
  and the light radius `L` grows 10% (plans/camera-and-fog.md), so the
  arena literally opens up. R1 is met because it changes what you see.
- **Check:** after each `evolve` and `fuse` event in `draft.ts#pick`, emit
  `finalForm` once. Fusions free a slot, so the test is "no empty weapon
  slot, and no weapon that isn't evolved or fused".
- **Everyone gets it,** idle included. It's an in-run payoff, not an active
  reward.
- **Ceremony:** the first time, with a feat ("Final Form"); after that a short
  flash. The Collection notes it per frame.

### Touches

`sim/systems/draft.ts` (the check, the event), `content/balance.ts`
(`BALANCE.finalForm`), `render/tower.ts`, `render/effects.ts`,
`audio/music.ts`, `content/feats.ts`.

---

## Checks

- **Rifts:** `idle.ts` shows the idle bot never opened one (I9). `pacing.ts`
  reads active screen time with Rifts on against off (they should move
  I7, plan A).
- **Anomalies:** `calibrate.ts` passes. `arsenal.ts` shows they don't
  shift I4 (an anomaly shouldn't make its weapon the only pick).
- **Final Form:** `inspect.ts` over many seeds gives the wave it lands on, by
  region. Target: rare in Region 1, common by Region 5 at about wave 14–17,
  so it's a late-run payoff and not a run-start state.
- Determinism test: a seed with Rifts declined matches the same seed's
  pre-Rift run, wave for wave (`tests/sim.test.ts`).

## Open

- How often do Rifts open in Act 2 and the Abyss? Probably more, and plan C's
  strata could have their own.
- Can an anomalised weapon still fuse?
- Should Final Form count passives too ("every slot maxed")? That's
  harder, rarer and more dramatic.
