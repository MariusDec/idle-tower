# Mastery capstones: rule-changing ranks instead of endless ×1.03

**Status:** 2026-11-21. Built (all of §5). Readings in `docs/balancing.md`
("Mastery capstones"). Comes out of the "tempering vs masteries"
brainstorm. All decisions are settled (§0).

**Why:** since tempering (`BALANCE.forge.temper`), every percentage combat minor
already goes on forever past its last level. Might, Bulwark and Arsenal Mastery
(damage, Max HP, attack speed ×1.03 a level) are now a tempered minor at a
different price. Fortune Mastery breaks tempering's own rule ("the pay never
compounds with the power that earns it"): it compounds shards without end.

**The idea:** keep tempering as the endless numeric sink and the way out when
the player is stuck on a hard region. Turn Might, Bulwark, Arsenal and
Engineering Mastery into **capstones**: three ranks each, every rank a behaviour
that changes a rule. The theme is **overflow conversion**. Each rank takes
something the game throws away today and turns it into power:

| What is wasted today | Where | Mastery |
|---|---|---|
| Overkill damage with no enemy within `overkillRange` (180) | `combat.ts#damageEnemy` (~l.1913) | Might |
| Healing while at full HP; Thorns does nothing against ranged enemies | `tower.ts` heal paths | Bulwark |
| The Windfall fallback card, once everything is level 5 and slots are full | `draft.ts#rollOffer` (~l.152), banish (~l.294) | Arsenal |
| Ultimate charge past full (`Math.min(1, …)`) | `combat.ts` (~l.1951) | Engineering |

**Fortune Mastery** stays endless, but becomes **additive** (D-1). It is the one
idle-forever shard sink, and it no longer compounds the pay.

The Crown star still seals each mastery (`starGifts(profile).masteries`). The
`mastery` node type stays, for the seal, the ring-7 place and the thicker
stroke in the web.

---

## 0. Decisions

All settled by the owner on 2026-11-21.

| # | Question | Decision |
|---|---|---|
| D-1 | What does Fortune Mastery become? | **Endless and additive:** shards +3% a level, added to the shard multiplier, never compounded. Fortune's job is the economy, so it stays the idle-forever shard sink, in line with tempering's rule that the pay never compounds. |
| D-2 | How many ranks? | **3** for the four capstones. Fortune stays endless. |
| D-3 | Saves that already own mastery levels | **Not an issue:** no save owns mastery levels, so there's no migration and no profile version bump. |
| D-4 | Journeyman (10 mastery levels) and Grandmaster (50) | **New goals:** Journeyman = 5 capstone ranks, Grandmaster = all 12 capstone ranks. Fortune levels don't count. |
| D-5 | Arsenal rank 1: does Overlevel replace both fallbacks, or only Windfall? | **Windfall only.** Mend stays, because it still saves a run when the hand is all fallbacks. |

---

## 1. Where things stand

- `content/forge.ts:685–706`: five masteries, ring 7, `maxLevel: Infinity`,
  `cost: 1_500_000`, `growth: 1.2`, one stat effect each (damage,
  attack speed, ultimate charge, shards, Max HP; ×1.03 a level, compounding).
- `content/stars.ts:181–213`: the Crown's five stars, "gains its endless
  mastery".
- `meta/forge.ts:30`: a mastery stays sealed until its star is lit.
- `meta/feats.ts:44`: `masteryLevels` drives Journeyman and Grandmaster
  (`content/feats.ts:94–95`).
- `tools/act2.ts:103,168`: the Act 2 bot's "power" is
  `starsLit + masteryLevels`, and its hourly report prints mastery levels.
  `docs/balancing.md` quotes "155–176 mastery levels in 12 h".
- Overkill (`forge.ts:87`, a ring-2 Might notable): excess damage leaps once
  to the nearest enemy within 180. An overkill hit never leaps again
  (`source !== 'overkill'`).
- Thorns (`forge.ts:573`): 50% of a contact hit goes back to the attacker.
  Fortress makes it ×3.
- Evolution: weapon level 5 + partner passive level 5
  (`BALANCE.evolutions.passiveAt`) + Alchemy.
- `BALANCE.caps`: anything past a weapon's on-screen cap becomes damage.

---

## 2. The capstones

Starting numbers are placeholders for the pacing pass (§6). Each rank is one
behaviour count in `config.behaviours`, read by the system that owns it, the
same route notables already use.

### 2.1 Might: the bank

| Rank | Effect | Notes |
|---|---|---|
| 1 | Overkill that finds no enemy within range is **banked**. The next weapon hit adds the bank. | Bank capped at 2× the tower's last hit, so it can at most triple a hit. Needs the Overkill notable to apply. Without it, all excess counts as "no target". |
| 2 | Overkill **chains**: an overkill hit may leap again, up to 3 times in total. | Lift the `source !== 'overkill'` guard, with a depth counter. |
| 3 | A banked hit that kills runs the Executioner check on every enemy within `overkillRange`. | Needs Executioner. Without it, rank 3 doubles the bank cap instead. |

### 2.2 Bulwark: the overflow shield

| Rank | Effect | Notes |
|---|---|---|
| 1 | Healing at full HP becomes a **shield**, up to 30% of Max HP, decaying 5%/s. | One shield value on the tower. Damage hits the shield first. |
| 2 | A full shield **bursts**: damage equal to the shield to every enemy in range, then the shield empties. | Unlike Thorns, this works against ranged enemies (Spitter, Siege Engine). Source tag `burst` for the T1 damage tally. |
| 3 | Second Wind recharges every 10 waves (Abyss: every 3 floors). | Needs Second Wind. |

### 2.3 Arsenal: Overlevels

| Rank | Effect | Notes |
|---|---|---|
| 1 | The Windfall fallback becomes **Overlevel *weapon***: +25% damage to a weapon that is level 5 or evolved. It stacks. | One card per eligible weapon, never two of the same in a hand. `sim/suggest.ts` must score it, or the bot will never take it. |
| 2 | Each Overlevel also adds +1 to the weapon's count (bolts, blades, drones…) until its cap. Past the cap it becomes damage, as caps already do. | Weapons with no count (beam, cone) get +10% area instead. |
| 3 | The partner passive only needs level 3 for evolution. | Overrides `BALANCE.evolutions.passiveAt` for this run's recipe check. The draft-invariant test must use the run's value. |

### 2.4 Engineering: the echo

| Rank | Effect | Notes |
|---|---|---|
| 1 | The ultimate **echoes**: a second cast at 40% strength, 3 s later. | No new charge spent. Aegis echoes shorter, not weaker. |
| 2 | Kills during the ultimate (or its echo) refund 25% of their charge. | The ultimate charge is XP-based (`e.xp × ultChargeMult`), so reuse that. |
| 3 | Charge gained while full is banked, up to +50%, and added after the next cast. | Each cast still makes the next charge 1.2× longer. The bank works against that, which is what it's for. |

### 2.5 Fortune: endless, additive (D-1)

`maxLevel: Infinity` stays, and so do `cost: 1_500_000` and `growth: 1.2`. The
effect becomes **Shards +3% per level**, added to the other shard percentages
rather than multiplying them (so 20 levels is +60%, not ×1.81). The card text
becomes "Shards +3% per level, without end." Shards stay out of tempering
(`UNTEMPERED`).

Rejected alternative (kept for the record): converters, where unspent
rerolls and Banishes pay shards at run end and a hand past the 6-card limit
gives a free reroll. Fortune already has Choice, Reroll, Banish and Clean
Slate, so it would mostly repeat them.

---

## 3. Costs

Capstones: three ranks at ×10 a rank, so 1.5M, 15M, 150M (the first stays at
today's price). Total per capstone ≈ 166M, ≈ 666M for all four. Fortune keeps
its endless curve. The pacing pass decides whether ×10 is right (§6).

---

## 4. Knock-on changes

- **Stars:** the four capstone stars drop "endless"
  (`content/stars.ts:181–213`). Fortune's keeps it.
- **Feats:** Journeyman = 5 capstone ranks, Grandmaster = all 12 (D-4).
  `meta/feats.ts` gets `capstoneRanks` (mastery nodes with a finite
  `maxLevel`). The feat goal kind and its progress line say ranks.
- **`tools/act2.ts`:** "power" becomes `starsLit + capstoneRanks +
  fortuneLevels + temperedLevels`, so the bot keeps measuring growth once the
  capstones are full. The hourly report shows capstone ranks, Fortune levels
  and tempered levels separately.
- **Docs:** `docs/forge.md` (node types, the mastery line), `docs/act2.md`
  (The Crown), `docs/balancing.md` (the readings quote mastery levels), and
  `docs/combat.md` / `docs/draft.md` for the bank, shield, echo and Overlevel.
- **Lint:** `content/lint.ts:139` describes masteries as endless. Only Fortune
  is now.
- **Save:** nothing. No save owns mastery levels (D-3), so `PROFILE_VERSION`
  stays at 25.
- **Forge UI:** a capstone card shows "Rank n of 3", the next rank's rule, and
  no "Temper" control. Fortune's card is unchanged apart from its text.

---

## 5. Build order

Each step stands alone and leaves the suite green.

0. **Impact analysis first** (CLAUDE.md): `damageEnemy`, `rollOffer`, the heal
   path in `tower.ts`, the ultimate charge, `masteryLevels`,
   `buildRunConfig`. Several of these sit on every hit, so expect HIGH risk
   and report it before editing.
1. **Content and plumbing:** the four capstones to `maxLevel: 3`, behaviour
   effects, new costs. Feats, star text, the `tools/act2.ts` power line.
2. **Engineering** (the smallest sim change: the clamp and the echo).
3. **Might** (the bank and the chain, in `damageEnemy`).
4. **Bulwark** (shield state on the tower, burst, Second Wind recharge).
5. **Arsenal** (Overlevel cards in the draft, scorer support, the counts,
   the evolution override).
6. **Fortune:** additive shards (D-1).
7. **Pacing pass and docs** (§6).

---

## 6. Checks

This changes balance, so the sims are required (not a cosmetic change).

- `npm run typecheck`, `npm test`. New unit tests: bank cap, chain depth,
  shield decay and burst, Overlevel only offered in Windfall's place (Mend
  still offered), echo spends no charge, charge bank cap, Fortune additive
  (20 levels = +60%, not ×1.81), the Journeyman and Grandmaster goals.
- Determinism: no new RNG draws, or only on the run's existing streams.
  Snapshot round-trip with a bank, a shield and a charge bank held.
- `npm run pacing -- --act2 --hours 12 --seeds 4`: heat 10 at the frontier and
  the best Abyss floor should be no worse than today. The shard sink in hours
  6–12 now goes to tempering and Fortune. Watch for unspent shards piling up.
- `npm run arsenal`: Overlevels must not push one weapon past the I4 spread.
- `npm run arsenal -- --keystones`: Fortress plus the Bulwark capstone, and
  Glass Cannon plus the Might bank, are the likely outliers.
- `detect_changes()` before each commit.

---

## 7. Files

`src/content/forge.ts`, `src/content/stars.ts`, `src/content/feats.ts`,
`src/content/balance.ts`, `src/content/types.ts` (behaviour ids),
`src/content/passives.ts` (Overlevel fallback), `src/content/lint.ts`,
`src/meta/forge.ts`, `src/meta/feats.ts`, `src/meta/runConfig.ts`,
`src/sim/state.ts` (bank, shield, charge bank, echo
timer), `src/sim/systems/combat.ts`, `src/sim/systems/tower.ts`,
`src/sim/systems/ultimate.ts`, `src/sim/systems/draft.ts`,
`src/sim/suggest.ts`, `src/ui/hub/forge.ts`, `tools/act2.ts`, the docs in §4.
