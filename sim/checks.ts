/**
 * Behavioural checks for the Part 2 balance work. Run with `npm run checks`.
 *
 * These drive the real manager classes, not copies of their logic, so they
 * catch the class of bug the plan's Part 1 was full of: a formula that is
 * correct in isolation but whose caller never applies it.
 */

import { EventBus } from '../src/game/EventBus.ts';
import { WaveManager } from '../src/systems/WaveManager.ts';
import { UpgradeManager } from '../src/systems/UpgradeManager.ts';
import { ResourceManager } from '../src/systems/ResourceManager.ts';
import { TalentManager } from '../src/systems/TalentManager.ts';
import { SaveManager } from '../src/systems/SaveManager.ts';
import { PassiveAbilityManager } from '../src/systems/PassiveAbilityManager.ts';
import { TowerXpManager } from '../src/systems/TowerXpManager.ts';
import { PrestigeManager } from '../src/systems/PrestigeManager.ts';
import { AutomationManager } from '../src/systems/AutomationManager.ts';
import { ResearchTree } from '../src/systems/ResearchTree.ts';
import { eliteChanceForWave } from '../src/systems/EnemyManager.ts';
import { ABILITIES, ABILITY_BY_ID, METEOR_SPLASH_FRACTION, placementRadius } from '../src/data/abilities.ts';
import { ARENA, world } from '../src/data/arena.ts';
import { RESEARCH_NODES } from '../src/data/research.ts';
import {
  MUTATOR_DURATION_WAVES,
  waveModifierRewardMultiplier,
  waveModifierTotalRewardMultiplier,
} from '../src/data/waveModifiers.ts';
import { bossEncounterHpForWave } from '../src/data/enemies.ts';
import {
  enrageThresholdSeconds,
  enrageStacksFor,
  lifetimeAPDamageBonus,
  ENEMY_HP_GROWTH,
  GOLD_GROWTH,
  enemyHPForWave,
  enemyCountForWave,
  goldDropForWave,
  spawnCountForWave,
} from '../src/data/formulas.ts';
import {
  ASCENSION_UNLOCK_WAVE,
  FIRST_ASCENSION_AP,
  apForWave,
  AP_PERK_BY_ID,
  TP_PERK_BY_ID,
  perkCost,
  computePerkEffect,
  tpForAP,
} from '../src/data/prestige.ts';
import { talentPointsAtLevel, xpPerKill, TOWER_XP_TABLE, TOWER_LEVEL_CAP, xpToLevel, xpPerWaveClear, pioneerBonusXp, PIONEER_CLEAR_MULTIPLIER } from '../src/data/xpTables.ts';
import { PASSIVE_ABILITIES } from '../src/data/passiveAbilities.ts';
import { PROGRESSION_ENTRIES } from '../src/data/milestones.ts';
import { TALENTS_BY_BRANCH, talentRespecCost } from '../src/data/talentTree.ts';
import type { EnemyManager } from '../src/systems/EnemyManager.ts';
import type {
  GameStats,
  PassiveAbilityState,
  ResourceState,
  TalentState,
  TowerXpState,
} from '../src/types.ts';

let failures = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ── §2.3.1 curves ─────────────────────────────────────────────────────────
section('§2.3.1 HP / gold curves');
{
  // gold-per-HP decay is the ratio the plan targets at <= 1.03^wave.
  const decay = ENEMY_HP_GROWTH / GOLD_GROWTH;
  check('gold-per-HP decays no faster than 1.03^wave', decay <= 1.03, `decay=${decay.toFixed(4)}`);

  // Bosses must stay a spike, not a wall: a boss wave's HP against the wave
  // before it, at several depths.
  for (const wave of [20, 50, 100]) {
    // The escort is carved *out* of the boss's bar, so the encounter budget is
    // already the whole wave's HP — adding the escort again double-counts it.
    const bossWaveHp = bossEncounterHpForWave(wave);
    const prevWaveHp = enemyHPForWave(9, wave - 1) * spawnCountForWave(wave - 1);
    const spike = bossWaveHp / prevWaveHp;
    check(
      `boss wave ${wave} is a 1.5-3x spike`,
      spike > 1.5 && spike < 3,
      `spike=${spike.toFixed(2)}x`,
    );
  }
  check(
    'gold still grows with wave',
    goldDropForWave(1, 50) > goldDropForWave(1, 10),
  );
}

// ── §2.3.3 enrage ─────────────────────────────────────────────────────────
section('§2.3.3 wave enrage');
{
  check('a wave on schedule has no stacks', enrageStacksFor(10, 5) === 0);
  check(
    'a wave past 2x expected starts stacking',
    enrageStacksFor(10, enrageThresholdSeconds(10) + 1) === 1,
  );
  check(
    'stacks accumulate over time',
    enrageStacksFor(10, enrageThresholdSeconds(10) + 100) > 5,
  );
  // A mutator that triples the enemy count must raise the threshold with it.
  const natural = enrageThresholdSeconds(30);
  const swarmed = enrageThresholdSeconds(30, spawnCountForWave(30) * 3);
  check('a swarm wave gets a longer fuse', swarmed > natural,
    `natural=${natural.toFixed(0)}s swarm=${swarmed.toFixed(0)}s`);

  // Drive the real WaveManager and confirm it pushes enrage onto enemies.
  const bus = new EventBus();
  const applied: Array<[number, number]> = [];
  const stubEnemies = {
    setEnrage: (d: number, s: number) => { applied.push([d, s]); },
    aliveCount: () => 1,
    reset: () => {},
    spawn: () => {},
    spawnElite: () => {},
    beginWave: () => {},
  } as unknown as EnemyManager;
  const wm = new WaveManager(bus, stubEnemies, 800, 600, () => {}, () => {});
  wm.startWave(10);
  applied.length = 0;
  // Advance past the threshold in one-second steps.
  for (let t = 0; t < enrageThresholdSeconds(10, wm.snapshot.enemiesToSpawn) + 20; t++) {
    wm.tick(1);
  }
  check('WaveManager escalates enrage', wm.snapshot.enrageStacks > 0,
    `stacks=${wm.snapshot.enrageStacks}`);
  const last = applied[applied.length - 1];
  check('WaveManager pushes the buff to enemies', !!last && last[0] > 1 && last[1] > 1,
    last ? `damage=${last[0].toFixed(2)} speed=${last[1].toFixed(2)}` : 'never called');

  // Starting a fresh wave must clear the buff, not carry it forward.
  applied.length = 0;
  wm.startWave(11);
  check('a new wave starts calm', wm.snapshot.enrageStacks === 0);
  check('a new wave clears the buff on enemies',
    applied.some(([d, s]) => d === 1 && s === 1));
}

// ── §2.3.4 first prestige ─────────────────────────────────────────────────
section('§2.3.4 first prestige');
{
  check('ascension unlocks at wave 20', ASCENSION_UNLOCK_WAVE === 20);
  check('no AP below the unlock wave', apForWave(ASCENSION_UNLOCK_WAVE - 1) === 0);
  check('AP grows with depth', apForWave(60) > apForWave(40));

  const bus = new EventBus();
  const resources = { ascensionPoints: 0, apThisTranscendence: 0, lifetimeAP: 0 } as never;
  const makeMgr = (lifetimeAscensions: number) => new PrestigeManager(bus, {
    resources,
    stats: { lifetimeAscensions } as never,
    prestige: { apSpent: {}, tpSpent: {} } as never,
  });
  check(
    'first ascension is floored at the scripted award',
    makeMgr(0).previewAP(ASCENSION_UNLOCK_WAVE) === FIRST_ASCENSION_AP,
    `got ${makeMgr(0).previewAP(ASCENSION_UNLOCK_WAVE)}`,
  );
  check(
    'later ascensions are not floored',
    makeMgr(3).previewAP(ASCENSION_UNLOCK_WAVE) === apForWave(ASCENSION_UNLOCK_WAVE),
  );
}

// ── §2.3.5 AP sinks ───────────────────────────────────────────────────────
section('§2.3.5 AP sinks');
{
  check('lifetime AP bonus is sub-linear',
    lifetimeAPDamageBonus(10_000) / lifetimeAPDamageBonus(100) < 100,
    `ratio=${(lifetimeAPDamageBonus(10_000) / lifetimeAPDamageBonus(100)).toFixed(1)}x for 100x the AP`);
  check('lifetime AP bonus still grows', lifetimeAPDamageBonus(10_000) > lifetimeAPDamageBonus(100));
  check('zero AP gives zero bonus', lifetimeAPDamageBonus(0) === 0);

  const might = AP_PERK_BY_ID['ap_might'];
  const fortune = AP_PERK_BY_ID['ap_fortune'];
  check('an unbounded damage sink exists', !!might && might.maxLevel >= 999);
  check('an unbounded gold sink exists', !!fortune && fortune.maxLevel >= 999);
  check('the sink keeps getting more expensive',
    !!might && perkCost(might, 40) > perkCost(might, 10) * 100);

  const bus = new EventBus();
  const resources = { ascensionPoints: 1_000_000, apThisTranscendence: 0, lifetimeAP: 0 } as never;
  const prestige = { apSpent: {}, tpSpent: {}, automationFlags: {} } as never;
  const mgr = new PrestigeManager(bus, { resources, stats: {} as never, prestige });
  // Revamp §8.2: the sinks sit behind a tier-1 utility node (OR-gated), so buy
  // the prerequisite first. Auto-Upgrader opens both.
  mgr.spendAP('ap_auto_upgrader');
  check('the sink can absorb AP', mgr.spendAP('ap_might'));
  check('spending the sink raises damage', mgr.getAPDamageBonus() > 0,
    `bonus=${mgr.getAPDamageBonus()}`);
  mgr.spendAP('ap_fortune');
  check('spending the sink raises gold', mgr.getAPGoldBonus() > 0);
}

// ── §2.4 tower XP ─────────────────────────────────────────────────────────
section('§2.4 tower XP and talent points');
{
  check('kill XP scales with wave depth', xpPerKill('normal', 50) > xpPerKill('normal', 10) * 1.5,
    `w10=${xpPerKill('normal', 10)} w50=${xpPerKill('normal', 50)}`);
  check('bosses are worth more than trash', xpPerKill('boss', 30) > xpPerKill('normal', 30));

  // One talent point per level, capped at 200.
  check('one point per level, capped at 200',
    talentPointsAtLevel(200) === 200 && talentPointsAtLevel(250) === 200);
  check('level 0 grants nothing', talentPointsAtLevel(0) === 0);

  // The XP table is ascending and xpToLevel round-trips.
  check('XP table has cap+1 entries', TOWER_XP_TABLE.length === TOWER_LEVEL_CAP + 1);
  let ascending = true;
  for (let l = 2; l <= TOWER_LEVEL_CAP; l++) {
    if (TOWER_XP_TABLE[l] <= TOWER_XP_TABLE[l - 1]) { ascending = false; break; }
  }
  check('XP table is strictly ascending', ascending);
  let roundTrips = true;
  for (const l of [1, 2, 5, 40, 100, 199, 200]) {
    if (xpToLevel(TOWER_XP_TABLE[l]) !== l) { roundTrips = false; break; }
  }
  check('xpToLevel round-trips against the table', roundTrips);

  // Pioneer bonus only past the lifetime best.
  check('no pioneer bonus at or below the best', pioneerBonusXp(40, 40) === 0);
  check('pioneer bonus pays past the best',
    pioneerBonusXp(41, 40) === Math.round(xpPerWaveClear(41) * PIONEER_CLEAR_MULTIPLIER));

  // The grant loop must pay correctly even when points are already banked.
  const bus = new EventBus();
  const state: TowerXpState = { xp: 0, level: 1, unspentTalentPoints: 1, totalXpEarned: 0 };
  const xpMgr = new TowerXpManager(state, bus);
  for (let i = 0; i < 4000; i++) xpMgr.addKillXp('normal', 40);
  check('banked points do not suppress the grant',
    state.unspentTalentPoints === talentPointsAtLevel(state.level),
    `level=${state.level} points=${state.unspentTalentPoints} expected=${talentPointsAtLevel(state.level)}`);
  check('the tower actually levels', state.level >= 5, `level=${state.level}`);
}

// ── §2.5 passives ─────────────────────────────────────────────────────────
section('§2.5 passive abilities');
{
  const bus = new EventBus();
  const state: Record<string, PassiveAbilityState> = {};
  const mgr = new PassiveAbilityManager(state, bus);
  mgr.ensureInitialized();
  const first = PASSIVE_ABILITIES[0];      // Marksmanship, unlock wave 5
  const last = PASSIVE_ABILITIES[PASSIVE_ABILITIES.length - 1];

  check('a locked passive contributes nothing',
    Object.keys(mgr.getStatTotals()).length === 0);

  mgr.unlock(first.id);
  check('unlocking grants the level-0 effect immediately',
    (mgr.getStatTotals().damage_pct ?? 0) === first.effects[0].base,
    `got ${mgr.getStatTotals().damage_pct}`);

  const before = mgr.getUpgradeCost(first.id);
  for (let i = 0; i < 20; i++) mgr.addKillXp('normal', first.unlockWave);
  check('passives earn XP from kills', mgr.getXp(first.id) > 0);
  check('banked XP discounts the gold cost', mgr.getUpgradeCost(first.id) < before);

  // The headline fix: measured in *waves at its own unlock wave*, a late
  // passive must level no faster than an early one. Before the redesign the
  // wave-65 passive gained ten levels inside a single wave.
  const wavesToLevel = (def: typeof first) => {
    const s: Record<string, PassiveAbilityState> = {};
    const m = new PassiveAbilityManager(s, bus);
    m.ensureInitialized();
    m.unlock(def.id);
    let waves = 0;
    while (m.getLevel(def.id) < 5 && waves < 10_000) {
      const n = Math.max(1, Math.floor(enemyCountForWave(def.unlockWave)));
      for (let k = 0; k < n; k++) m.addKillXp('normal', def.unlockWave);
      m.addWaveClearXp(def.unlockWave);
      waves += 1;
    }
    return waves;
  };
  const early = wavesToLevel(first);
  const late = wavesToLevel(last);
  check('the last passive is not faster than the first, per wave of play',
    Math.abs(early - late) <= 3, `early=${early} late=${late}`);
  check('reaching level 5 from XP alone takes real play',
    early >= 25, `waves=${early}`);

  // Gold has to be a cost, not a rounding error.
  const runGoldAtUnlock = 20 * Math.pow(1.11, last.unlockWave) * 6;
  check('unlocking the deepest passive costs several waves of income',
    last.unlockGoldCost > runGoldAtUnlock * 0.7, `${last.unlockGoldCost}`);
}

// ── §3.1 abilities ────────────────────────────────────────────────────────
section('§3.1 abilities');
{
  const frontLoaded = ABILITIES.filter(a => a.unlockWave <= 30).length;
  check('at least six abilities unlock inside a first run', frontLoaded >= 6,
    `count=${frontLoaded}`);
  const steepest = Math.max(...ABILITIES.map(a => a.upgradeCostGrowth));
  check('no ability upgrade curve is steeper than 2x/level', steepest <= 2,
    `max=${steepest}`);
  const rain = ABILITY_BY_ID['rain_of_arrows'];
  const lvl10 = rain.upgradeBaseCost * Math.pow(rain.upgradeCostGrowth, 9);
  check('a level-10 ability costs less than 500K gold', lvl10 < 500_000,
    `cost=${Math.round(lvl10)}`);

  // Auto-cast must honour the per-ability opt-out and keep going past the
  // first success, so a tick with several ready abilities fires all of them.
  const cast: string[] = [];
  const autoBus = new EventBus();
  const state = {
    wave: { highestWave: 60 },
    resources: { gold: 0 },
    prestige: { autoCastEnabled: { berserk: false }, autoBuyStrategy: 'balanced', autoBuyReserve: 0 },
  } as never;
  const auto = new AutomationManager({
    upgrades: { all: [], isMaxed: () => true, getCost: () => Infinity, getLevel: () => 0, buy: () => false } as never,
    abilities: {
      canCast: () => true,
      tryCast: (id: string) => { cast.push(id); return true; },
      autoCastConditionMet: () => true,
    } as never,
    prestige: {
      getAutomationEnabled: (k: string) => k === 'autoAbilities',
      getAutoBuySpeedReduction: () => 0,
    } as never,
    research: {} as never,
    getState: () => state,
    getAutoAim: () => true,
    onAscend: () => 0,
    onTranscend: () => 0,
    bus: autoBus,
  });
  auto.tick(1.1);
  check('auto-cast fires every ready ability, not just one', cast.length > 1,
    `cast=${cast.length}`);
  check('auto-cast skips abilities the player turned off', !cast.includes('berserk'));

  // Plan §I.3: damage-per-mana must not span more than 6x across the damage
  // abilities. The old spread was 26x (plan §1.7), which left half the roster
  // mathematically dead. Model the same crowd the diagnosis used — 15 bodies —
  // and re-derive per-mana DPS at L1.
  const CROWD = 15;
  const damageAbilities = ABILITIES.filter(a =>
    a.effectType === 'aoe_damage'
    || a.effectType === 'single_target_damage'
    || a.effectType === 'chain_damage',
  );
  const perMana = damageAbilities.map(a => {
    const total = CROWD * a.effectValue;
    return { id: a.id, value: total / a.manaCost };
  });
  const max = Math.max(...perMana.map(p => p.value));
  const min = Math.min(...perMana.map(p => p.value));
  check('damage-per-mana spread across damage abilities stays within 6x',
    max / min <= 6,
    `max=${max.toFixed(2)} min=${min.toFixed(2)} (${perMana.map(p => `${p.id}=${p.value.toFixed(2)}`).join(', ')})`);

  // Disc sizes must stay inside the arena on both ends: a sub-60px disc is a
  // cosmetic reticle that does no work, and a disc bigger than the short
  // half-extent is a screen-wipe with a reticle drawn on it.
  const targeted = ABILITIES.filter(a => a.areaRadius && a.areaRadius > 0);
  for (const a of targeted) {
    const l1 = placementRadius(a.id, 1);
    const lmax = placementRadius(a.id, a.maxLevel);
    check(`${a.id} L1 disc is at least world(60)`,
      l1 >= world(60),
      `l1=${l1}`);
    check(`${a.id} max-level disc fits inside the short half-extent`,
      lmax <= ARENA.minHalfExtent,
      `lmax=${lmax} arena.minHalfExtent=${ARENA.minHalfExtent}`);
  }

  // Meteor splash is a fraction, not a multiple (plan §1.4). Anything that
  // makes the splash > 1x the primary hit regresses the original bug.
  check('METEOR_SPLASH_FRACTION is strictly less than 1',
    METEOR_SPLASH_FRACTION < 1,
    `METEOR_SPLASH_FRACTION=${METEOR_SPLASH_FRACTION}`);

  // Every ability that opts into an auto-cast condition has at least one
  // floor set — a stray empty block would be silently permissive and never
  // fail any other check.
  for (const a of ABILITIES) {
    if (!a.autoCast) continue;
    const hasField = ['minEnemies', 'minInDisc', 'bossOnly', 'bossHpBelow', 'towerHpBelow']
      .some(k => (a.autoCast as Record<string, number | undefined>)[k] !== undefined);
    check(`${a.id} autoCast condition has at least one floor set`,
      hasField,
      `autoCast=${JSON.stringify(a.autoCast)}`);
  }
}

// ── §3.6 auto-buy ─────────────────────────────────────────────────────────
section('§3.6 auto-buy strategy');
{
  const bought: string[] = [];
  const levels: Record<string, number> = { damage: 0, greed: 0, trinket: 0 };
  const costs: Record<string, number> = { damage: 100, greed: 50, trinket: 10 };
  const cats: Record<string, string> = { damage: 'tower', greed: 'economy', trinket: 'utility' };
  const purse = { gold: 1000 };
  const upgrades = {
    all: Object.keys(levels).map(id => ({ id, category: cats[id] })),
    isMaxed: () => false,
    getCost: (id: string) => costs[id],
    getLevel: (id: string) => levels[id],
    buy: (id: string) => {
      if (purse.gold < costs[id]) return false;
      purse.gold -= costs[id];
      levels[id] += 1;
      bought.push(id);
      return true;
    },
  } as never;
  const makeAuto = (strategy: string, reserve: number) => new AutomationManager({
    upgrades,
    abilities: { canCast: () => false, tryCast: () => false, autoCastConditionMet: () => true } as never,
    prestige: {
      getAutomationEnabled: (k: string) => k === 'autoBuy',
      getAutoBuySpeedReduction: () => 0,
    } as never,
    research: {} as never,
    getState: () => ({
      wave: { highestWave: 1 },
      resources: purse,
      prestige: { autoCastEnabled: {}, autoBuyStrategy: strategy, autoBuyReserve: reserve },
    }) as never,
    getAutoAim: () => true,
    onAscend: () => 0,
    onTranscend: () => 0,
    bus: new EventBus(),
  });

  makeAuto('damage', 0).tick(11);
  check('damage strategy opens on a tower upgrade', bought[0] === 'damage',
    `first=${bought[0]}`);
  check('auto-buy keeps buying within one tick', bought.length > 1,
    `bought=${bought.length}`);

  // A reserve must leave gold on the table.
  purse.gold = 1000;
  bought.length = 0;
  makeAuto('cheapest', 0.5).tick(11);
  check('a 50% reserve stops spending at the floor', purse.gold >= 500,
    `left=${purse.gold}`);
}

// ── §3.2 prestige trees ───────────────────────────────────────────────────
section('§3.2 prestige');
{
  check('deep transcendence pays off',
    tpForAP(100_000) / tpForAP(100) > 10,
    `ratio=${(tpForAP(100_000) / tpForAP(100)).toFixed(1)}x`);
  check('a first transcendence is still worth taking', tpForAP(100) >= 20,
    `tp=${tpForAP(100)}`);

  const bus = new EventBus();
  const resources = { ascensionPoints: 1_000_000, apThisTranscendence: 0, lifetimeAP: 0 } as never;
  const prestige = { apSpent: {}, tpSpent: {}, automationFlags: {} } as never;
  const mgr = new PrestigeManager(bus, { resources, stats: {} as never, prestige });
  check('a gated AP perk cannot be bought first', !mgr.canSpendAP('ap_might'));
  check('the gate names its prerequisite', mgr.perkBlockedReason('ap_might') !== null);
  mgr.spendAP('ap_auto_upgrader');
  check('buying the prerequisite opens the gate', mgr.canSpendAP('ap_might'));
  for (let i = 0; i < 10; i++) mgr.spendAP('ap_might');
  check('the tier-4 fork unlocks at Might 10', mgr.canSpendAP('ap_warlord'));
  mgr.spendAP('ap_warlord');
  check('taking one side locks out the other', mgr.isExcluded('ap_tycoon'));

  // The unbounded TP nodes must taper, or the capped branch perks are noise.
  const cosmic = TP_PERK_BY_ID['tp_damage'];
  const one = computePerkEffect(cosmic, 1);
  const forty = computePerkEffect(cosmic, 40);
  check('the unbounded TP node still grows', forty > computePerkEffect(cosmic, 20));
  check('the unbounded TP node tapers', forty < one * 40 * 0.5,
    `lvl40=${forty.toFixed(2)} vs linear=${(one * 40).toFixed(2)}`);
}

// ── §3.3 wave mutators ────────────────────────────────────────────────────
section('§3.3 wave mutators');
{
  check('a mutator lasts more than one wave', MUTATOR_DURATION_WAVES > 1);
  check('the reward escalates each wave',
    waveModifierRewardMultiplier(2) > waveModifierRewardMultiplier(0));
  check('a full run is worth several waves of reward',
    waveModifierTotalRewardMultiplier() >= 4);

  const bus = new EventBus();
  let offers = 0;
  bus.on('wave_modifier_offer', () => { offers += 1; });
  const stubEnemies = {
    setEnrage: () => {}, aliveCount: () => 0, reset: () => {}, spawn: () => {}, spawnElite: () => {},
    beginWave: () => {},
  } as unknown as EnemyManager;
  const wm = new WaveManager(bus, stubEnemies, 800, 600, () => {}, () => {});
  for (const w of [10, 20, 30]) wm.startWave(w);
  check('every boss wave offers a mutator', offers === 3, `offers=${offers}`);

  offers = 0;
  wm.snapshot.waveModifier.wavesRemaining = 2;
  wm.startWave(40);
  check('no new offer while one is still running', offers === 0);
}

// ── §3.4 elites ───────────────────────────────────────────────────────────
section('§3.4 elites');
{
  check('elites stay absent early', eliteChanceForWave(10) === 0);
  check('elites are common by wave 100', eliteChanceForWave(100) >= 0.2,
    `chance=${eliteChanceForWave(100)}`);
  check('the elite rate is capped', eliteChanceForWave(500) <= 0.25);
}

// ── §3.5 research ─────────────────────────────────────────────────────────
section('§3.5 research');
{
  const startNodes = RESEARCH_NODES.filter(n => n.effectType === 'start_wave');
  check('the start_wave effect has a node', startNodes.length > 0);
  const tree = new ResearchTree(new EventBus());
  tree.replaceLevels({ [startNodes[0].id]: 3 }, 0, null);
  check('researching it moves the starting wave', tree.getStartWave() > 0,
    `wave=${tree.getStartWave()}`);
}


// ── §4.1 bulk buy ─────────────────────────────────────────────────────────
section('§4.1 bulk buy');
{
  const makeUpgrades = (gold: number) => {
    const bus = new EventBus();
    const resources = { gold, lifetimeGold: gold } as unknown as ResourceState;
    const stats = { goldEarned: 0 } as unknown as GameStats;
    return new UpgradeManager(bus, new ResourceManager(resources, stats, bus));
  };

  const mgr = makeUpgrades(1e12);
  const one = mgr.getBulkPlan('damage', 1);
  const ten = mgr.getBulkPlan('damage', 10);
  check('a bulk plan buys the levels it says', ten.levels === 10);
  check('ten levels cost more than one', ten.cost > one.cost);
  check('the total is the sum of its levels', ten.cost > one.cost * 10,
    `ten=${ten.cost} vs 10x one=${one.cost * 10}`);

  // The ×10 button targets the next round level, not "+10".
  mgr.replaceLevels({ damage: 18 });
  check('×10 from level 18 buys 2', mgr.getRoundedPlan('damage', 10).levels === 2,
    `level=${mgr.getLevel('damage')}`);
  mgr.replaceLevels({ damage: 20 });
  check('×10 from a round level buys 10', mgr.getRoundedPlan('damage', 10).levels === 10,
    `level=${mgr.getLevel('damage')}`);
  mgr.replaceLevels({ damage: 1 });

  // A max plan must be exactly affordable — never one level over.
  const poor = makeUpgrades(500);
  const plan = poor.getMaxAffordablePlan('damage');
  check('a max plan is affordable', plan.cost <= 500, `cost=${plan.cost}`);
  check('a max plan is maximal',
    poor.getBulkPlan('damage', plan.levels + 1).cost > 500);
  const bought = poor.buyBulk('damage', plan.levels);
  check('buying the max plan buys every level', bought === plan.levels);

  // A bulk buy must never overdraw, even when asked for more than gold allows.
  const broke = makeUpgrades(0);
  check('an unaffordable bulk buy buys nothing', broke.buyBulk('damage', 10) === 0);
}

// ── §4.4/4.5 offline progress ─────────────────────────────────────────────
section('§4.4/4.5 offline progress');
{
  const persisted = (dps: number, wave: number, highest: number, agoSeconds: number) => ({
    savedAt: Date.now() - agoSeconds * 1000,
    tower: { baseDamage: dps, fireRate: 1, critChance: 0, critMultiplier: 1 },
    wave: { number: wave, highestWave: highest },
    stats: { lifetimeHighestWave: highest },
    research: {},
  }) as never;

  const save = new SaveManager(new EventBus());
  const hour = 3600;

  const strong = save.computeOfflineProgress(persisted(1e6, 5, 40, hour), 1);
  check('a strong tower clears waves offline', strong.wavesCleared > 0,
    `cleared=${strong.wavesCleared}`);
  check('clearing waves advances the wave', strong.endWave > 5,
    `endWave=${strong.endWave}`);
  check('offline never passes this run\'s deepest wave', strong.endWave <= 40,
    `endWave=${strong.endWave}`);

  // The lifetime best must not raise the ceiling: after an ascension it can be
  // far beyond what the current tower has actually faced.
  const afterAscend = save.computeOfflineProgress(
    { ...(persisted(1e6, 3, 6, hour) as object), stats: { lifetimeHighestWave: 200 } } as never,
    1,
  );
  check('the lifetime best does not raise the ceiling', afterAscend.endWave <= 6,
    `endWave=${afterAscend.endWave}`);

  // Wave 31 rather than 30: the walk backs off a boss wave before starting,
  // so a boss wave would report an end wave one lower for reasons unrelated
  // to whether anything was cleared.
  const weak = save.computeOfflineProgress(persisted(0.001, 31, 40, hour), 1);
  check('a walled tower clears nothing', weak.wavesCleared === 0,
    `cleared=${weak.wavesCleared}`);
  check('a walled tower does not advance', weak.endWave === 31,
    `endWave=${weak.endWave}`);

  // Plan §4.5: offline income must carry the live gold multiplier.
  const plain = save.computeOfflineProgress(persisted(1e4, 5, 40, hour), 1);
  const boosted = save.computeOfflineProgress(persisted(1e4, 5, 40, hour), 4);
  check('offline gold scales with the multiplier',
    Math.abs(boosted.goldEarned / Math.max(1, plain.goldEarned) - 4) < 0.01,
    `plain=${plain.goldEarned} boosted=${boosted.goldEarned}`);
}

// ── §4.6 progression ──────────────────────────────────────────────────────
section('§4.6 progression');
{
  check('progression lists every milestone', PROGRESSION_ENTRIES.length > 20,
    `entries=${PROGRESSION_ENTRIES.length}`);
  check('progression includes passives',
    PROGRESSION_ENTRIES.some(e => e.kind === 'passive'));
  check('progression includes abilities',
    PROGRESSION_ENTRIES.filter(e => e.kind === 'ability').length === ABILITIES.length);
  const waves = PROGRESSION_ENTRIES.map(e => e.wave);
  check('progression is ordered by wave',
    waves.every((w, i) => i === 0 || w >= waves[i - 1]));
  const ids = new Set(PROGRESSION_ENTRIES.map(e => e.id));
  check('progression has no duplicates', ids.size === PROGRESSION_ENTRIES.length);
}

// ── §4.7 talent allocation & respec ──────────────────────────────────────
section('§4.7 talent allocation & respec');
{
  const bus = new EventBus();
  const talentState: TalentState = { allocated: {} };
  let points = 10;
  let gold = 100000;
  const talents = new TalentManager(talentState, bus, {
    towerXpUnspentPoints: () => points,
    spendTalentPoint: () => (points > 0 ? (points -= 1, true) : false),
    grantTalentPoint: () => { points += 1; },
    spendGold: (amount) => (gold >= amount ? (gold -= amount, true) : false),
  });

  // TALENTS_BY_BRANCH[branch][0] is now wr_edge / bw_toughness / ft_greed / ar_power,
  // all with requiresBranchPoints: 0.
  const first = TALENTS_BY_BRANCH['offense'][0];
  check('first offense node is wr_edge', first.id === 'wr_edge');
  check('first offense node has requiresBranchPoints 0', first.requiresBranchPoints === 0);

  talents.allocate(first.id);
  talents.allocate(first.id);
  const spent = talents.pointsInBranch('offense');
  check('allocating spends points', points === 10 - spent, `points=${points}`);

  const cost = talents.branchRespecCost('offense');
  check('the respec cost scales with points spent', cost === talentRespecCost(spent),
    `cost=${cost}`);

  const goldBefore = gold;
  check('the respec succeeds', talents.refundBranch('offense'));
  check('the respec charges gold', gold === goldBefore - cost, `gold=${gold}`);
  check('the respec returns the points', points === 10, `points=${points}`);
  check('the respec clears the branch', talents.pointsInBranch('offense') === 0);

  // A respec the player cannot pay for must change nothing.
  talents.allocate(first.id);
  gold = 0;
  const before = talents.pointsInBranch('offense');
  check('an unaffordable respec is refused', talents.refundBranch('offense') === false);
  check('a refused respec keeps the allocation',
    talents.pointsInBranch('offense') === before);

  // Full respec covers every branch at once.
  gold = 100000;
  talents.allocate(TALENTS_BY_BRANCH['defense'][0].id);
  check('a full respec clears everything',
    talents.refundAll() && talents.totalAllocatedPoints() === 0);

  // ── Branch gating ─────────────────────────────────────────────────────
  // wr_precision (row-2) requires 4 branch points.
  gold = 100000;
  points = 100;
  const talentState2: TalentState = { allocated: {} };
  const talents2 = new TalentManager(talentState2, bus, {
    towerXpUnspentPoints: () => points,
    spendTalentPoint: () => (points > 0 ? (points -= 1, true) : false),
    grantTalentPoint: () => { points += 1; },
    spendGold: (amount) => (gold >= amount ? (gold -= amount, true) : false),
  });
  talents2.allocate('wr_edge'); // 1 branch point
  check('row-2 node blocked at 1 branch point',
    talents2.blockedReason('wr_precision') === 'gate');
  talents2.allocate('wr_edge');
  talents2.allocate('wr_edge');
  talents2.allocate('wr_edge'); // 4 branch points
  check('row-2 node unblocked at 4 branch points',
    talents2.blockedReason('wr_precision') === null);

  // ── ExclusiveGroup blocking ───────────────────────────────────────────
  // Build offense to 35 branch points and take one keystone.
  const talentState3: TalentState = { allocated: {} };
  points = 200;
  gold = 100000;
  const talents3 = new TalentManager(talentState3, bus, {
    towerXpUnspentPoints: () => points,
    spendTalentPoint: () => (points > 0 ? (points -= 1, true) : false),
    grantTalentPoint: () => { points += 1; },
    spendGold: (amount) => (gold >= amount ? (gold -= amount, true) : false),
  });
  for (let i = 0; i < 5; i++) talents3.allocate('wr_edge');
  for (let i = 0; i < 5; i++) talents3.allocate('wr_cadence');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_precision');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_cruelty');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_focus_fire');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_volley');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_executioner');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_bloodlust');
  for (let i = 0; i < 3; i++) talents3.allocate('wr_overwatch');
  talents3.allocate('wr_siegebreaker');
  talents3.allocate('wr_killing_spree');
  talents3.allocate('wr_key_annihilation');
  check('taking one keystone blocks the others',
    talents3.blockedReason('wr_key_deadeye') === 'exclusive');
  check('refundBranch releases the exclusive block',
    talents3.refundBranch('offense') && talents3.blockedReason('wr_key_deadeye') === 'prereq');

  // ── behaviours() reflection ───────────────────────────────────────────
  const talentState4: TalentState = { allocated: {} };
  points = 200;
  gold = 100000;
  const talents4 = new TalentManager(talentState4, bus, {
    towerXpUnspentPoints: () => points,
    spendTalentPoint: () => (points > 0 ? (points -= 1, true) : false),
    grantTalentPoint: () => { points += 1; },
    spendGold: (amount) => (gold >= amount ? (gold -= amount, true) : false),
  });
  check('no behaviours before allocation', talents4.behaviors().size === 0);
  talents4.allocate('wr_edge');
  check('a non-behavior node does not add a behavior', !talents4.hasBehavior('relentless'));
  // Build to relentless
  for (let i = 0; i < 4; i++) talents4.allocate('wr_edge');
  for (let i = 0; i < 5; i++) talents4.allocate('wr_cadence');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_precision');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_cruelty');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_focus_fire');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_volley');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_executioner');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_bloodlust');
  for (let i = 0; i < 3; i++) talents4.allocate('wr_overwatch');
  talents4.allocate('wr_killing_spree');
  talents4.allocate('wr_key_relentless');
  check('behaviours() reflects allocation', talents4.hasBehavior('relentless'));
  talents4.refundBranch('offense');
  check('behaviours() reflects refund', !talents4.hasBehavior('relentless'));
}

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
