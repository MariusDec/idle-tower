/**
 * Behavioural checks for the Part 2 balance work. Run with `npm run checks`.
 *
 * These drive the real manager classes, not copies of their logic, so they
 * catch the class of bug the plan's Part 1 was full of: a formula that is
 * correct in isolation but whose caller never applies it.
 */

import { EventBus } from '../src/game/EventBus.ts';
import { WaveManager } from '../src/systems/WaveManager.ts';
import { PassiveAbilityManager } from '../src/systems/PassiveAbilityManager.ts';
import { TowerXpManager } from '../src/systems/TowerXpManager.ts';
import { PrestigeManager } from '../src/systems/PrestigeManager.ts';
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
  perkCost,
} from '../src/data/prestige.ts';
import { talentPointsAtLevel, xpPerKill } from '../src/data/xpTables.ts';
import { PASSIVE_ABILITIES } from '../src/data/passiveAbilities.ts';
import type { EnemyManager } from '../src/systems/EnemyManager.ts';
import type { PassiveAbilityState, TowerXpState } from '../src/types.ts';

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

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
