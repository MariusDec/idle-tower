import { describe, expect, it } from 'vitest';
import { applyInput, createRun, step } from '../src/sim/run';
import { buildRunConfig, FIRST_DRAFT } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { hashString } from '../src/core/rng';
import { allMods, passiveMods, resolveStat, resolveStats } from '../src/sim/stats';
import { FORGE } from '../src/content/forge';
import {
  applyCard, candidateCards, cardKey, gainXp, pickCard, tickDraft, xpToNext,
} from '../src/sim/systems/draft';
import { castUltimate } from '../src/sim/systems/ultimate';
import { cardBadges } from '../src/sim/suggest';
import { EVOLUTION_OF } from '../src/content/evolutions';
import { WEAPON_BY_ID } from '../src/content/weapons';
import { runRegion } from '../src/sim/systems/waves';
import type { Card, RunState } from '../src/sim/state';
import { botInput, type Policy } from '../tools/bot';
import { FRAME_BY_ID } from '../src/content/frames';
import { body } from './helpers/body';

/**
 * Past the first-draft lesson, and owning Arsenal's ring 1 (weapon slot 2,
 * Scattershot, Chain Lightning): the loadout the P2 gate was measured on.
 */
function veteran(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  p.forge = { 'might-damage': 1, scattershot: 1, 'chain-lightning': 1 };
  return p;
}

const fresh = (seed = 1): RunState => createRun(buildRunConfig(veteran()), seed);

function play(seed: number, seconds: number, policy: Policy): RunState {
  const run = fresh(seed);
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks && !run.outcome; i++) {
    step(run, SIM_DT, botInput(run, policy));
    run.events.length = 0;
  }
  return run;
}

function stateHash(run: RunState): number {
  const { events: _events, ...rest } = run;
  return hashString(JSON.stringify(rest));
}

/** Level the run up and open its draft, without playing. */
function levelUp(run: RunState): void {
  gainXp(run, run.xpNext / run.stats.xpMult + 1e-9);
  tickDraft(run);
}

describe('stat resolver (§12.3)', () => {
  it('adds flat, then sums percentages, then multiplies', () => {
    const r = resolveStat('damage', [
      { key: 'damage', add: 1 },
      { key: 'damage', pct: 0.15 },
      { key: 'damage', pct: 0.15 },
      { key: 'damage', mult: 2 },
      { key: 'maxHp', mult: 99 },
    ]);
    expect(r.value).toBeCloseTo((1 + 1) * 1.3 * 2);
  });

  it('a Power card is worth at least +10% damage with the whole Forge owned (S1)', () => {
    const full = newProfile(0);
    for (const n of FORGE) if (n.type !== 'keystone') full.forge[n.id] = n.type === 'mastery' ? 20 : n.maxLevel;
    const mods = buildRunConfig(full).mods;
    const without = resolveStats(allMods(mods, [])).damageMult;
    const withPower = resolveStats(allMods(mods, [{ id: 'power', level: 1 }])).damageMult;
    expect(withPower / without).toBeGreaterThanOrEqual(1.1);
  });

  it("keeps the run's passives in their own bucket (S1)", () => {
    const r = resolveStat('damage', [
      { key: 'damage', pct: 0.5 },
      { key: 'damage', pct: 0.5 },
      { key: 'damage', pct: 0.25, bucket: 'run' },
    ]);
    expect(r.value).toBeCloseTo(2 * 1.25);
    // A Power level is worth the same over a bare tower as over a full Forge.
    const power = passiveMods('power', 1);
    const bare = resolveStat('damage', []).value;
    const full = resolveStat('damage', [{ key: 'damage', pct: 5 }]).value;
    expect(resolveStat('damage', power).value / bare).toBeCloseTo(resolveStat('damage', [{ key: 'damage', pct: 5 }, ...power]).value / full);
  });

  it('regen is a fraction of Max HP', () => {
    const s = resolveStats([{ key: 'maxHp', pct: 1 }]);
    expect(s.regen).toBeCloseTo(s.maxHp * BALANCE.tower.regen);
  });
});

describe('XP and levels', () => {
  it('each level costs more than the last', () => {
    for (let l = 1; l < 40; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
  });

  it('banks one draft per level, even when one kill crosses several', () => {
    const run = fresh();
    gainXp(run, (xpToNext(1) + xpToNext(2) + 0.5) / run.stats.xpMult);
    expect(run.level).toBe(3);
    expect(run.pendingDrafts).toBe(2);
  });
});

describe('the draft (§4.5)', () => {
  it('offers distinct cards and suggests one of them', () => {
    const run = fresh(3);
    levelUp(run);
    const d = run.draft!;
    expect(d.cards).toHaveLength(BALANCE.draft.choices);
    expect(new Set(d.cards.map(cardKey)).size).toBe(d.cards.length);
    expect(d.suggested).toBeGreaterThanOrEqual(0);
    expect(d.suggested).toBeLessThan(d.cards.length);
  });

  it('never offers a new item for a slot type that is full', () => {
    const run = fresh();
    applyCard(run, { kind: 'weapon', id: 'scattershot', level: 1 });
    applyCard(run, { kind: 'passive', id: 'power', level: 1 });
    applyCard(run, { kind: 'passive', id: 'haste', level: 1 });
    expect(run.weapons).toHaveLength(run.weaponSlots);
    expect(run.passives).toHaveLength(run.passiveSlots);
    for (const c of candidateCards(run)) {
      expect(c.kind === 'fallback' || c.kind === 'evolution' || c.kind === 'fusion' || c.level > 1, cardKey(c)).toBe(true);
    }
  });

  it('never offers a maxed item, and pads with fallbacks once nothing is left', () => {
    const run = fresh();
    applyCard(run, { kind: 'weapon', id: 'scattershot', level: 1 });
    applyCard(run, { kind: 'passive', id: 'power', level: 1 });
    applyCard(run, { kind: 'passive', id: 'haste', level: 1 });
    for (const w of run.weapons) w.level = BALANCE.maxLevel;
    for (const p of run.passives) p.level = BALANCE.maxLevel;
    expect(candidateCards(run)).toEqual([]);
    // With Alchemy, Scattershot + Power is a recipe: nothing is left once it has evolved.
    run.behaviours.alchemy = 1;
    expect(candidateCards(run)).toEqual([{ kind: 'evolution', id: 'dragonbreath' }]);
    applyCard(run, { kind: 'evolution', id: 'dragonbreath' });
    expect(candidateCards(run)).toEqual([]);
    levelUp(run);
    expect(run.draft!.cards.every((c) => c.kind === 'fallback')).toBe(true);
  });

  it('only offers weapons that are in the pool', () => {
    const run = fresh();
    run.pool = run.pool.filter((id) => id !== 'chain-lightning');
    const offered = candidateCards(run);
    expect(offered.some((c) => c.kind === 'weapon' && c.id === 'scattershot')).toBe(true);
    expect(offered.some((c) => c.kind === 'weapon' && c.id === 'chain-lightning')).toBe(false);
  });

  it('a pick applies the card and closes the draft; the next banked one opens', () => {
    const run = fresh(5);
    gainXp(run, (xpToNext(1) + xpToNext(2)) / run.stats.xpMult + 0.01);
    tickDraft(run);
    const card = run.draft!.cards[0];
    pickCard(run, 0);
    expect(run.draft).toBeNull();
    if (card.kind === 'weapon') expect(run.weapons.find((w) => w.id === card.id)?.level).toBe(card.level);
    tickDraft(run);
    expect(run.draft).not.toBeNull();
    expect(run.pendingDrafts).toBe(1);
  });

  it('a passive re-resolves stats, and Max HP gained is HP gained', () => {
    const run = fresh();
    run.tower.hp = 50;
    applyCard(run, { kind: 'passive', id: 'fortify', level: 1 });
    expect(run.stats.maxHp).toBeCloseTo(BALANCE.tower.maxHp * 1.2);
    expect(run.tower.hp).toBeCloseTo(50 + BALANCE.tower.maxHp * 0.2);
  });

  it('the run keeps going while a draft is open', () => {
    const run = fresh(2);
    levelUp(run);
    const t = run.time;
    for (let i = 0; i < 60; i++) step(run, SIM_DT);
    expect(run.time).toBeGreaterThan(t);
    expect(run.draft).not.toBeNull();
  });

  it('the first draft of the game is the authored one, once', () => {
    const run = createRun(buildRunConfig(newProfile(0)), 9);
    levelUp(run);
    expect(run.draft!.cards).toEqual(FIRST_DRAFT);
    pickCard(run, 1);
    levelUp(run);
    expect(run.draft!.cards).not.toEqual(FIRST_DRAFT);
    expect(buildRunConfig(veteran()).firstDraft).toBeNull();
  });
});

describe('take suggested ×N (U2)', () => {
  it('takes every banked draft, exactly as picking each suggestion in turn would', () => {
    const one = fresh(5);
    one.pendingDrafts = 4;
    const all = structuredClone(one);
    while (one.pendingDrafts > 0) {
      tickDraft(one);
      pickCard(one, one.draft!.suggested);
    }
    tickDraft(all);
    applyInput(all, { takeAll: true });
    expect(all.pendingDrafts).toBe(0);
    expect(all.draft).toBeNull();
    expect(all.events.filter((e) => e.kind === 'picked')).toHaveLength(4);
    expect({ w: all.weapons, p: all.passives, s: all.streams.draft }).toEqual({ w: one.weapons, p: one.passives, s: one.streams.draft });
  });

  it('does nothing with nothing banked', () => {
    const run = fresh(5);
    run.pendingDrafts = 0;
    applyInput(run, { takeAll: true });
    expect(run.weapons).toHaveLength(fresh(5).weapons.length);
    expect(run.passives).toHaveLength(0);
  });
});

describe('card badges (U4)', () => {
  it('a new weapon names its slot, and says when it answers the region', () => {
    const run = fresh(5);
    const card: Card = { kind: 'weapon', id: 'chain-lightning', level: 1 };
    const badges = cardBadges(run, card);
    expect(badges).toContainEqual({ kind: 'slot', slot: run.weapons.length + 1, of: run.weaponSlots });
    const counters = WEAPON_BY_ID['chain-lightning'].counters.some((id) => runRegion(run).pool.some((p) => p.enemy === id));
    expect(badges.some((b) => b.kind === 'counter')).toBe(counters);
  });

  it('a known recipe\'s partner is a step; at the evolving level it completes it', () => {
    const run = fresh(5);
    const evo = EVOLUTION_OF['arcane-bolt'];
    const partner: Card = { kind: 'passive', id: evo.passive, level: 1 };
    expect(cardBadges(run, partner).some((b) => b.kind === 'recipe')).toBe(false);
    run.recipes = [evo.id];
    expect(cardBadges(run, partner)).toContainEqual({ kind: 'recipe', evolution: evo.id, completes: false });
    run.weapons.find((w) => w.id === 'arcane-bolt')!.level = BALANCE.maxLevel;
    expect(cardBadges(run, partner)).toContainEqual({ kind: 'recipe', evolution: evo.id, completes: true });
  });
});

describe('the ultimate (§4.4)', () => {
  it('fires only when charged, then charges slower', () => {
    const run = fresh();
    expect(castUltimate(run)).toBe(false);
    run.ult.charge = 1;
    const need = run.ult.need;
    expect(castUltimate(run)).toBe(true);
    expect(run.ult.charge).toBe(0);
    expect(run.ult.need).toBeGreaterThan(need);
  });

  it('hurts and throws back everything in range', () => {
    const run = play(4, 20, 'bare');
    const inRange = run.enemies.filter((e) => e.alive && Math.hypot(e.x, e.y) <= run.stats.range);
    expect(inRange.length).toBeGreaterThan(0);
    const before = inRange.map((e) => ({ hp: e.hp, d: Math.hypot(e.x, e.y) }));
    run.ult.charge = 1;
    applyInput(run, { ult: true });
    inRange.forEach((e, i) => {
      if (!e.alive) return;
      expect(e.hp).toBeLessThan(before[i].hp);
      expect(Math.hypot(e.x, e.y)).toBeGreaterThan(before[i].d);
    });
  });
});

describe('the ultimate keeps pace with the region (S3)', () => {
  it("a Nova takes at least its floor of a body's Max HP, and only its hit from a boss", () => {
    const run = fresh();
    const big = body(run, { hp: 1e9, maxHp: 1e9 });
    const boss = body(run, { hp: 1e9, maxHp: 1e9, boss: 'gatekeeper', y: 40 });
    run.ult.charge = 1;
    castUltimate(run);
    const nova = FRAME_BY_ID.arcanist.ultimate;
    if (nova.id !== 'nova') throw new Error('the Arcanist casts Nova');
    expect(1e9 - big.hp).toBeCloseTo(1e9 * nova.floor);
    expect(1e9 - boss.hp).toBeLessThan(1e6);
    expect(1e9 - boss.hp).toBeGreaterThan(0);
  });
});

describe('determinism with inputs', () => {
  it('the same seed and policy give the same run', () => {
    expect(stateHash(play(21, 120, 'active'))).toBe(stateHash(play(21, 120, 'active')));
  });
});

describe('the P2 gate, measured on the real sim', () => {
  const SEEDS = 12;
  const runs = Array.from({ length: SEEDS }, (_, i) => play(i + 1, 900, 'active'));

  it('a bot-drafted run with no meta progression reaches about wave 10', () => {
    const waves = runs.map((r) => r.outcome?.wave ?? r.wave).sort((a, b) => a - b);
    const median = waves[waves.length >> 1];
    expect(median).toBeGreaterThanOrEqual(8);
    expect(median).toBeLessThanOrEqual(13);
  });

  it('runs end up with different towers', () => {
    const loadouts = new Set(runs.map((r) => r.weapons.map((w) => `${w.id}:${w.level}`).sort().join(',')));
    expect(loadouts.size).toBeGreaterThan(1);
    const weapons = new Set(runs.flatMap((r) => r.weapons.map((w) => w.id)));
    expect(weapons.size).toBe(3);
  });

  it('every card the bot is offered is legal when it is offered', () => {
    const run = fresh(8);
    while (!run.outcome && run.time < 600) {
      if (run.draft) {
        const legal = new Set(candidateCards(run).map((c: Card) => JSON.stringify(c)));
        for (const c of run.draft.cards) if (c.kind !== 'fallback') expect(legal.has(JSON.stringify(c))).toBe(true);
      }
      step(run, SIM_DT, botInput(run, 'active'));
      run.events.length = 0;
    }
  });
});
