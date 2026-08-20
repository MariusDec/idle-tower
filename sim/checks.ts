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
import { ABILITIES, ABILITY_BY_ID } from '../src/data/abilities.ts';
import { RESEARCH_NODES } from '../src/data/research.ts';
import {
  MUTATOR_DURATION_WAVES,
  waveModifierRewardMultiplier,
  waveModifierTotalRewardMultiplier,
} from '../src/data/waveModifiers.ts';
import {
  enrageThresholdSeconds,
  enrageStacksFor,
  lifetimeAPDamageBonus,
  ENEMY_HP_GROWTH,
  GOLD_GROWTH,
  enemyHPForWave,
  bossHPForWave,
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
import { talentPointsAtLevel, xpPerKill } from '../src/data/xpTables.ts';
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
    const bossWaveHp = bossHPForWave(120, wave) * spawnCountForWave(wave);
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
  // §3.2: the sinks now sit behind a tier-1 node, so buy the prerequisite first.
  mgr.spendAP('ap_extra_shots');
  mgr.spendAP('ap_wave_skipper');
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

  check('a bonus talent point lands every 5th level',
    talentPointsAtLevel(5) - talentPointsAtLevel(4) === 2);
  check('other levels grant one point',
    talentPointsAtLevel(4) - talentPointsAtLevel(3) === 1);
  check('level 0 grants nothing', talentPointsAtLevel(0) === 0);

  // The grant loop must pay the bonus even when points are already banked —
  // this is what the old reconciliation got wrong.
  const bus = new EventBus();
  const state: TowerXpState = { xp: 0, level: 0, unspentTalentPoints: 0, totalXpEarned: 0 };
  const xpMgr = new TowerXpManager(state, bus);
  for (let i = 0; i < 4000; i++) xpMgr.addKillXp('normal', 40);
  check('banked points do not suppress the bonus grant',
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
  const def = PASSIVE_ABILITIES[0];

  check('a locked passive does nothing', mgr.getEffectValue(def.stat) === 0);
  mgr.unlock(def.id);
  check('unlocking a passive grants its base effect immediately',
    mgr.getEffectValue(def.stat) === def.basePercent,
    `got ${mgr.getEffectValue(def.stat)}, expected ${def.basePercent}`);

  const before = mgr.getUpgradeCost(def.id);
  for (let i = 0; i < 20; i++) mgr.addKillXp('normal', 40);
  check('passives earn XP from kills', mgr.getXp(def.id) > 0, `xp=${mgr.getXp(def.id)}`);
  check('banked XP discounts the gold cost', mgr.getUpgradeCost(def.id) < before,
    `${before} -> ${mgr.getUpgradeCost(def.id)}`);

  // The XP track must resolve on a human timescale, not six million kills.
  const solo: Record<string, PassiveAbilityState> = {};
  const soloMgr = new PassiveAbilityManager(solo, bus);
  soloMgr.ensureInitialized();
  soloMgr.unlock(def.id);
  let kills = 0;
  while (soloMgr.getLevel(def.id) < 10 && kills < 2_000_000) {
    soloMgr.addKillXp('normal', 40);
    kills += 1;
  }
  check('XP alone reaches level 10 in a plausible number of kills',
    kills < 20_000, `kills=${kills}`);
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
    } as never,
    prestige: {
      getAutomationEnabled: (k: string) => k === 'autoAbilities',
      getAutoBuySpeedReduction: () => 0,
    } as never,
    research: {} as never,
    getState: () => state,
    onAscend: () => 0,
    onTranscend: () => 0,
    bus: autoBus,
  });
  auto.tick(1.1);
  check('auto-cast fires every ready ability, not just one', cast.length > 1,
    `cast=${cast.length}`);
  check('auto-cast skips abilities the player turned off', !cast.includes('berserk'));
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
    abilities: { canCast: () => false, tryCast: () => false } as never,
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
  mgr.spendAP('ap_extra_shots');
  check('buying the prerequisite opens the gate', mgr.canSpendAP('ap_might'));
  for (let i = 0; i < 5; i++) mgr.spendAP('ap_might');
  check('the tier-3 choice unlocks at Might 5', mgr.canSpendAP('ap_warlord'));
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

// ── §4.7 talent respec ────────────────────────────────────────────────────
section('§4.7 talent respec');
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

  const first = TALENTS_BY_BRANCH['offense'][0];
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
}

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
