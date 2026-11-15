import { Rng } from '../../core/rng';
import { TAU } from '../../core/math';
import { floorOf, floorWave } from '../../content/abyss';
import { BALANCE } from '../../content/balance';
import { RIFTS, RIFT_BY_ID } from '../../content/rifts';
import type { AuraId, RegionDef, RiftDef, RiftEffect, RiftRarity, RiftSpan } from '../../content/types';
import type { Enemy, RiftHold, RunState } from '../state';
import { refreshStats } from './draft';
import { BOSS_WAVE, isBossWave, localWave, regionAt, rollWave, runRegion, runWave, waveBonus, wavePace } from './waves';

/**
 * Rifts (plans/late-game/02): a tear opens mid-wave; tapped before it shuts,
 * it makes an authored offer. One roll at each eligible wave's start, on the
 * `rifts` stream (when, which, where); what a taken rift rolls (a horde's
 * bodies, a crown's aura) draws on `riftFx`. So a seed shows the same rifts
 * whatever is taken, and a rift never tapped touches nothing outside
 * `rift`, `riftRoll`, `riftLog` and those two streams.
 *
 * A rift's life: pending (rolled, waiting for its delay), shown (`riftAppear`;
 * shut at `closesAt`, or when a boss arrives), choosing (tapped; the app
 * stops the arena, and no draft opens). `tickRifts` runs right after
 * `tickWaves` (step 2b).
 */

/** True once the run is past its region's boss: overtime. Never in the Abyss. */
function overtime(region: RegionDef, n: number): boolean {
  return !region.abyss && !region.rush && n > BOSS_WAVE;
}

/** True when wave `n` may roll a rift at all (§3: never on a boss wave). */
export function riftEligible(run: RunState, region: RegionDef, n: number): boolean {
  const R = BALANCE.rifts;
  if (!run.riftCfg || region.rush || isBossWave(region, n)) return false;
  if (region.abyss) {
    const w = floorWave(n);
    return w >= R.floorFrom && w <= R.floorLast;
  }
  return n >= R.from;
}

/** The rates a run rolls at: Act 1's, Act 2's or the Abyss's. */
function rates(run: RunState, region: RegionDef): { chance: number; ramp: number; gap: number; cap: number } {
  const R = BALANCE.rifts;
  const rate = run.riftCfg?.rate ?? 1;
  if (region.abyss) return { chance: R.chance.abyss * rate, ramp: R.ramp.abyss * rate, gap: 0, cap: Infinity };
  const act2 = run.riftCfg?.act2 ?? false;
  const over = overtime(region, run.wave) ? R.perRun.overtime : 0;
  return act2
    ? { chance: R.chance.act2 * rate, ramp: R.ramp.act2 * rate, gap: R.gap.act2, cap: R.perRun.act2 + over }
    : { chance: R.chance.act1 * rate, ramp: R.ramp.act1 * rate, gap: R.gap.act1, cap: R.perRun.act1 + over };
}

/** The region index a rift's `where` reads: past every region in the Abyss. */
function regionIndex(region: RegionDef): number {
  return region.abyss ? Infinity : region.index;
}

/** True when `def` may be rolled in `region` for this run. */
export function riftCanOpen(run: RunState, region: RegionDef, def: RiftDef): boolean {
  const w = def.where;
  const R = BALANCE.rifts;
  if (w.placed) return false;
  if (w.abyss && !region.abyss) return false;
  if (w.act2 && !run.riftCfg?.act2) return false;
  const idx = regionIndex(region);
  if (w.regions && (region.abyss || !w.regions.includes(region.index))) return false;
  if (w.from !== undefined && idx < w.from) return false;
  if (def.rarity === 'rare' && idx < R.rareFrom) return false;
  if (def.rarity === 'legendary' && idx < R.legendaryFrom) return false;
  if (w.needs === 'alchemy' && !run.behaviours.alchemy) return false;
  if (w.needs === 'relics' && !run.relicDrops) return false;
  return true;
}

/** Pick a rift: a rarity by weight among those present, then within it, unseen ones `unseenWeight` times likelier. */
function pickRift(run: RunState, region: RegionDef, rng: Rng): RiftDef | null {
  const R = BALANCE.rifts;
  const pool = RIFTS.filter((d) => riftCanOpen(run, region, d));
  if (pool.length === 0) return null;
  const tiers: RiftRarity[] = (['common', 'rare', 'legendary'] as const).filter((t) => pool.some((d) => d.rarity === t));
  const tier = tiers[rng.weighted(tiers.map((t) => R.rarity[t]))];
  const within = pool.filter((d) => d.rarity === tier);
  const known = new Set(run.riftCfg?.known ?? []);
  return within[rng.weighted(within.map((d) => (known.has(d.id) ? 1 : R.unseenWeight)))];
}

/** Place a rolled rift: its delay into the wave, and a spot in the upper 240° of the light. */
function placeRift(run: RunState, rng: Rng, def: RiftDef, n: number, first: boolean): void {
  const R = BALANCE.rifts;
  const at = run.time + rng.range(R.delay[0], R.delay[1]);
  // Screen y grows downward: the bottom 120° (under the HUD's bottom row and the draft) is left out.
  const angle = rng.range(Math.PI * (5 / 6), Math.PI * (5 / 6) + TAU * (2 / 3));
  const r = run.stats.light * rng.range(R.radius[0], R.radius[1]);
  run.rift = {
    id: def.id,
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r,
    at,
    closesAt: at + (first ? R.firstOpenSeconds : R.openSeconds),
    wave: n,
    phase: 'pending',
  };
}

/** The wave-start roll (§3): the First Tear while it is owed, else the ramping chance. */
function rollRift(run: RunState, region: RegionDef, n: number): void {
  const cfg = run.riftCfg;
  if (!cfg || run.rift || !riftEligible(run, region, n)) return;
  const R = BALANCE.rifts;
  const rng = Rng.wrap(run.streams.rifts);
  // The First Tear (§2): the first run after the Gatekeeper, at wave 4; again each run until opened.
  if (cfg.first) {
    if (localWave(region, n) === R.firstWave && run.riftRoll.count === 0) {
      run.riftRoll.count++;
      run.riftRoll.last = n;
      placeRift(run, rng, RIFT_BY_ID['first-tear'], n, true);
    }
    return;
  }
  const roll = run.riftRoll;
  const k = rates(run, region);
  if (roll.count >= k.cap) return;
  if (region.abyss) {
    if (roll.floor === floorOf(n)) return;
  } else if (roll.count > 0 && n - roll.last < k.gap) {
    return;
  }
  const hit = rng.next() < k.chance + k.ramp * roll.miss;
  if (!hit) {
    roll.miss++;
    return;
  }
  const def = pickRift(run, region, rng);
  if (!def) return;
  roll.miss = 0;
  roll.count++;
  roll.last = n;
  if (region.abyss) roll.floor = floorOf(n);
  placeRift(run, rng, def, n, false);
}

/** Close the rift on the field: logged as glimpsed (shown, untapped) or left (tapped). A pending one goes unseen. */
export function shutRift(run: RunState): void {
  const r = run.rift;
  if (!r) return;
  run.rift = null;
  if (r.phase === 'pending') return;
  const tapped = r.phase === 'choosing';
  run.riftLog.push({ id: r.id, wave: r.wave, choice: null, tapped });
  run.events.push(tapped ? { kind: 'riftTaken', id: r.id, choice: null, x: r.x, y: r.y } : { kind: 'riftShut', id: r.id, x: r.x, y: r.y });
}

/** True while a span still covers wave `n`. */
function holdLive(run: RunState, h: RiftHold, n: number): boolean {
  if (h.until === 'run') return true;
  if (h.until === 'boss') return run.felled.length <= h.felled;
  return n <= h.until;
}

/** The last wave a span covers, from wave `n`: the rest of this wave and `waves` more. */
function spanUntil(span: RiftSpan, n: number): RiftHold['until'] {
  return typeof span === 'object' ? n + span.waves : span;
}

/** What a kill's shards multiply by under a running bounty; the extra goes to `shardsFrom.rifts`. */
export function riftShardMult(run: RunState, e: Enemy): number {
  let mult = 1;
  for (const h of run.riftHolds) {
    const f = h.effect;
    if (f.kind !== 'bounty' || (f.on === 'elites' && !e.elite)) continue;
    mult *= f.mult;
  }
  return mult;
}

/** Pay `amount` shards from a rift. */
function payRift(run: RunState, amount: number): void {
  run.shards += amount;
  run.shardsFrom.rifts += amount;
}

/** Crown `n` of a wave's unplaced spawn entries from `from` on, evenly spread; an aura from the region's. */
function crown(run: RunState, region: RegionDef, n: number, from: number, champion: boolean): number {
  const cur = run.current;
  if (!cur) return 0;
  const open: number[] = [];
  for (let i = from; i < cur.spawns.length; i++) if (!cur.spawns[i].elite) open.push(i);
  if (open.length === 0) return 0;
  const rng = Rng.wrap(run.streams.riftFx);
  const auras = region.elites.auras;
  const k = Math.min(n, open.length);
  for (let j = 0; j < k; j++) {
    // Champion's way (N4) for a single crown: the next body; else spread through the wave.
    const i = k === 1 && champion ? open[0] : open[Math.floor(((j + 0.5) / k) * open.length)];
    const aura: AuraId | null = auras.length > 0 ? rng.pick(auras) : null;
    cur.spawns[i] = { ...cur.spawns[i], elite: champion ? { aura, champion: true } : { aura } };
  }
  return k;
}

/** A wave's start (§3): spans expire, held shards pay, hordes swell the roll, crowns are placed, the boss swells. */
function waveStarted(run: RunState, region: RegionDef, n: number): void {
  let changed = false;
  const keep: RiftHold[] = [];
  for (const h of run.riftHolds) {
    const f = h.effect;
    if (f.kind === 'shards' && f.atWave !== undefined) {
      if (n >= f.atWave) {
        payRift(run, h.pay ?? 0);
        continue;
      }
      keep.push(h);
      continue;
    }
    if (!holdLive(run, h, n)) {
      if (f.kind === 'stat') changed = true;
      continue;
    }
    keep.push(h);
  }
  run.riftHolds = keep;
  if (changed) refreshStats(run);
  const cur = run.current;
  if (!cur || cur.n !== n) return;
  for (let i = run.riftHolds.length - 1; i >= 0; i--) {
    const h = run.riftHolds[i];
    const f = h.effect;
    switch (f.kind) {
      case 'horde': {
        // More bodies, rolled on `riftFx`: the same template, no elites of its own, merged by time.
        const extra = rollWave(region, n, Rng.wrap(run.streams.riftFx), wavePace(run, n), { count: f.count - 1, elites: 0 })
          .filter((s) => !s.elite);
        cur.spawns = [...cur.spawns, ...extra].sort((a, b) => a.at - b.at);
        break;
      }
      case 'elites':
        if (f.perWave) crown(run, region, f.n, 0, f.champion === true);
        else {
          // The next n bodies, carried over from a wave that had none left to crown.
          crown(run, region, f.n, 0, f.champion === true);
          run.riftHolds.splice(i, 1);
        }
        break;
      case 'boss':
        if (run.boss && run.boss.wave === n) {
          const body = run.enemies.find((e) => e.id === run.boss!.enemy);
          if (body) {
            body.hp *= f.hp;
            body.maxHp *= f.hp;
          }
          run.riftHolds.splice(i, 1);
        }
        break;
      default:
        break;
    }
  }
  // A horde's hold covers its waves from the next on; it is spent once its last wave has been rolled.
  run.riftHolds = run.riftHolds.filter((h) => h.effect.kind !== 'horde' || (typeof h.until === 'number' && n < h.until));
}

/** Step 2b: roll at a wave's start, show, shut, and keep the spans honest. */
export function tickRifts(run: RunState, region: RegionDef): void {
  if (!run.riftCfg && run.riftHolds.length === 0) return;
  const cur = run.current;
  if (cur && cur.n > run.riftRoll.wave) {
    run.riftRoll.wave = cur.n;
    waveStarted(run, region, cur.n);
    // A boss arriving closes any rift: its wave is the boss's.
    if (isBossWave(region, cur.n) && run.rift) shutRift(run);
    rollRift(run, region, cur.n);
  }
  // A 'boss' span ends the moment its boss falls, not at the next wave.
  if (run.riftHolds.some((h) => h.until === 'boss' && run.felled.length > h.felled)) {
    const stat = run.riftHolds.some((h) => h.until === 'boss' && run.felled.length > h.felled && h.effect.kind === 'stat');
    run.riftHolds = run.riftHolds.filter((h) => !(h.until === 'boss' && run.felled.length > h.felled));
    if (stat) refreshStats(run);
  }
  const r = run.rift;
  if (!r) return;
  if (r.phase === 'pending' && run.time >= r.at) {
    r.phase = 'shown';
    run.events.push({ kind: 'riftAppear', id: r.id, x: r.x, y: r.y });
  }
  if (r.phase === 'shown' && run.time >= r.closesAt) shutRift(run);
}

/** Tap the shown rift (§3): it opens for choosing, unless a draft is open. */
export function tapRift(run: RunState): void {
  const r = run.rift;
  if (!r || r.phase !== 'shown' || run.draft) return;
  r.phase = 'choosing';
}

/**
 * Why choice `index` of the open rift can't apply now, or null when it can
 * (§2: greyed out with its reason).
 */
export function riftLegal(run: RunState, index: number): string | null {
  const r = run.rift;
  const choice = r ? RIFT_BY_ID[r.id].choices[index] : undefined;
  if (!choice) return 'Nothing to take';
  const region = runRegion(run);
  const bossAhead = region.abyss || (!region.rush && run.wave < BOSS_WAVE);
  const unevolved = run.weapons.filter((w) => !w.evolved && !w.joined);
  const strongest = strongestWeapon(run);
  for (const f of choice.effects) {
    switch (f.kind) {
      case 'shards':
        if (f.atWave !== undefined && (region.abyss || run.wave >= f.atWave)) return `Wave ${f.atWave} is behind you`;
        break;
      case 'stat':
      case 'bounty':
        if (f.span === 'boss' && !bossAhead) return 'No boss ahead';
        break;
      case 'elites':
        if (f.span === 'boss' && !bossAhead) return 'No boss ahead';
        break;
      case 'boss':
        if (!bossAhead) return 'No boss ahead';
        break;
      case 'levels': {
        const max = BALANCE.maxLevel;
        if (f.target === 'strongest' && (!strongest || strongest.level <= 1)) return 'No weapon to take a level from';
        if (f.target === 'others' && !unevolved.some((w) => w !== strongest && w.level < max)) return 'No other weapon to level';
        if ((f.target === 'all' || f.target === 'weakest') && !unevolved.some((w) => w.level < max)) return 'No weapon to level';
        break;
      }
      case 'draft':
      case 'hurt':
      case 'heal':
      case 'horde':
      case 'charges':
      case 'ult':
      case 'stun':
        break;
      default: {
        const exhaustive: never = f;
        return exhaustive;
      }
    }
  }
  return null;
}

/** The unevolved weapon a "strongest" cost falls on: the highest level, the first mounted on a tie. */
function strongestWeapon(run: RunState): RunState['weapons'][number] | null {
  let best: RunState['weapons'][number] | null = null;
  for (const w of run.weapons) if (!w.evolved && !w.joined && (!best || w.level > best.level)) best = w;
  return best;
}

/** Take choice `index` of the open rift, or leave it (−1). Either way it is logged and closes. */
export function chooseRift(run: RunState, index: number): void {
  const r = run.rift;
  if (!r || r.phase !== 'choosing') return;
  const def = RIFT_BY_ID[r.id];
  if (index < 0 || index >= def.choices.length || riftLegal(run, index) !== null) {
    if (index < 0) shutRift(run);
    return;
  }
  run.rift = null;
  // "Strongest" and "others" are read once, before any level moves.
  const strongest = strongestWeapon(run);
  let stats = false;
  for (const f of def.choices[index].effects) stats = applyRiftEffect(run, f, strongest) || stats;
  if (stats) refreshStats(run);
  run.riftLog.push({ id: r.id, wave: r.wave, choice: index, tapped: true });
  run.events.push({ kind: 'riftTaken', id: r.id, choice: index, x: r.x, y: r.y });
}

/**
 * One effect of a taken rift: the union's one consumer. Returns true when
 * the tower's stats need resolving again.
 */
export function applyRiftEffect(run: RunState, f: RiftEffect, strongest: RunState['weapons'][number] | null): boolean {
  const n = runWave(run);
  const region = runRegion(run);
  const hold = (until: RiftHold['until'], pay?: number): void => {
    run.riftHolds.push({ effect: f, until, felled: run.felled.length, ...(pay !== undefined ? { pay } : {}) });
  };
  switch (f.kind) {
    case 'shards': {
      const pay = f.waves * waveBonus(regionAt(run.regionId, n), n) * run.stats.shardMult;
      if (f.atWave !== undefined) hold('run', pay);
      else payRift(run, pay);
      return false;
    }
    case 'hurt': {
      const max = run.stats.maxHp;
      const floor = Math.min(run.tower.hp, max * BALANCE.rifts.hurtFloor);
      run.tower.hp = Math.max(floor, run.tower.hp - max * f.fraction);
      return false;
    }
    case 'heal':
      run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * f.fraction);
      return false;
    case 'stat':
      hold(spanUntil(f.span, n));
      return true;
    case 'horde':
      // The next `waves` waves: from n + 1 to n + waves.
      hold(n + f.waves);
      return false;
    case 'bounty':
      hold(spanUntil(f.span, n));
      return false;
    case 'elites': {
      if (f.perWave) {
        hold(spanUntil(f.span ?? 'boss', n));
        return false;
      }
      // The next n bodies of this wave; any it hasn't left wait for the next wave's.
      const cur = run.current;
      const done = cur ? crown(run, region, f.n, cur.next, f.champion === true) : 0;
      if (done < f.n) run.riftHolds.push({ effect: { ...f, n: f.n - done }, until: 'run', felled: run.felled.length });
      return false;
    }
    case 'draft':
      run.pendingDrafts += f.n;
      if (f.hand === 'forged') run.forgedHand = true;
      return false;
    case 'levels': {
      const max = BALANCE.maxLevel;
      const pool = run.weapons.filter((w) => !w.evolved && !w.joined);
      let targets = pool;
      if (f.target === 'strongest') targets = strongest ? [strongest] : [];
      else if (f.target === 'others') targets = pool.filter((w) => w !== strongest);
      else if (f.target === 'weakest') {
        const low = pool.reduce<typeof pool[number] | null>((a, w) => (!a || w.level < a.level ? w : a), null);
        targets = low ? [low] : [];
      }
      for (const w of targets) w.level = Math.max(1, Math.min(max, w.level + f.delta));
      return false;
    }
    case 'charges':
      run.rerolls += f.rerolls ?? 0;
      run.banishes += f.banishes ?? 0;
      run.revives += f.revives ?? 0;
      return false;
    case 'ult': {
      const was = run.ult.charge;
      run.ult.charge = Math.max(0, Math.min(1, f.charge));
      if (was < 1 && run.ult.charge >= 1) run.events.push({ kind: 'ultReady' });
      return false;
    }
    case 'stun':
      for (const e of run.enemies) if (e.alive && !e.boss) e.stunnedUntil = Math.max(e.stunnedUntil, run.time + f.seconds);
      return false;
    case 'boss':
      hold('run');
      return false;
    default: {
      const exhaustive: never = f;
      return exhaustive;
    }
  }
}
