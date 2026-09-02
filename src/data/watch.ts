import type { EnemyType } from '../types';
import type { IconId } from './icons';
import { CONTRACT_ENEMY_LABELS } from './contracts';
import { ENEMY_DEFS } from './enemies';

/**
 * The Long Watch — the game's campaign spine (`plans/milestones.md`).
 *
 * Twelve ordered chapters, one active at a time, each asking for three things
 * and paying one **content unlock**. The table below is the whole feature:
 * `WatchManager` only knows how to read counters and compare them to targets.
 *
 * Two closed unions do the load-bearing work, and both have a `Record` over
 * them elsewhere so a member cannot ship without an implementation:
 *   - `WatchGoal['kind']` → `WATCH_PROGRESS` in `WatchManager`
 *   - `WatchUnlockId`     → `WATCH_UNLOCK_CONSUMERS`, below
 */

/** What a chapter objective asks for. Every target is a *lifetime* figure. */
export type WatchGoal =
  | { kind: 'reach_wave'; wave: number }
  | { kind: 'kills'; count: number }
  | { kind: 'kills_of'; type: EnemyType; count: number }
  | { kind: 'bosses'; count: number }
  | { kind: 'gold_earned'; amount: number }
  | { kind: 'ascensions'; count: number }
  | { kind: 'transcendences'; count: number }
  | { kind: 'abilities_cast'; count: number }
  | { kind: 'upgrades_bought'; count: number }
  | { kind: 'tower_level'; level: number }
  | { kind: 'blessing_picks'; count: number }
  | { kind: 'contracts_done'; count: number }
  | { kind: 'flawless_waves'; count: number }
  /** Boss *encounters* cleared inside the swift threshold. */
  | { kind: 'swift_bosses'; count: number }
  /** Waves cleared with the risk dial at `risk` or above. */
  | { kind: 'risk_waves'; risk: number; count: number }
  | { kind: 'mutator_waves'; count: number };

export type WatchGoalKind = WatchGoal['kind'];

/** The twenty rewards. Ordered as the chapters grant them. */
export type WatchUnlockId =
  | 'board_expansion'
  | 'quartermaster'
  | 'veteran_start'
  | 'wide_draft'
  | 'cold_forge'
  | 'riskbearer'
  | 'overseer'
  | 'storm_caller'
  | 'heirloom'
  | 'deep_watch'
  | 'sanctum'
  | 'long_memory'
  | 'archivist'
  | 'crown_of_thorns'
  | 'counting_house'
  | 'emberforge'
  | 'eternal_kit'
  | 'master_broker'
  | 'deep_reserves'
  | 'undying_watch'
  | 'deep_stores';

export interface WatchUnlockDef {
  id: WatchUnlockId;
  name: string;
  /** One player-facing sentence. Shown on the chapter card and the modal. */
  description: string;
  icon: IconId;
}

export interface WatchChapterDef {
  id: string;
  /** 1-based, and equal to the index in `WATCH_CHAPTERS` plus one. Pinned by test. */
  number: number;
  name: string;
  /** One line of fiction. Never mechanical — the objectives carry the mechanics. */
  flavour: string;
  icon: IconId;
  /** Accent colour. A `src/data/*` table may hold literal hex (palette test is scoped out). */
  color: string;
  /** Exactly three. Pinned by test. */
  goals: readonly WatchGoal[];
  reward: WatchUnlockId;
}

export const WATCH_UNLOCKS: Record<WatchUnlockId, WatchUnlockDef> = {
  board_expansion: {
    id: 'board_expansion', name: 'The Board', icon: 'wanted-reward',
    description: 'A fourth contract runs alongside the other three.',
  },
  quartermaster: {
    id: 'quartermaster', name: 'Quartermaster', icon: 'knapsack',
    description: 'Every blessing draft comes with one extra free reroll.',
  },
  veteran_start: {
    id: 'veteran_start', name: 'Veteran Start', icon: 'walking-scout',
    description: 'Every run begins at wave 5, with the gold to match.',
  },
  wide_draft: {
    id: 'wide_draft', name: 'Wide Draft', icon: 'split-arrows',
    description: 'Blessing drafts offer four cards instead of three.',
  },
  cold_forge: {
    id: 'cold_forge', name: 'The Cold Forge', icon: 'frozen-orb',
    description: 'The Frostwork core is yours, at no AP cost.',
  },
  riskbearer: {
    id: 'riskbearer', name: 'Riskbearer', icon: 'rolling-dices',
    description: 'The risk dial gains a sixth step.',
  },
  overseer: {
    id: 'overseer', name: 'Overseer', icon: 'vintage-robot',
    description: 'Auto-buy is unlocked without spending a single AP.',
  },
  storm_caller: {
    id: 'storm_caller', name: 'Storm Caller', icon: 'lightning-branches',
    description: 'Mutators offer four choices and run one wave longer.',
  },
  heirloom: {
    id: 'heirloom', name: 'Heirloom', icon: 'glowing-artifact',
    description: 'Your best blessing survives the ascension that ends the run.',
  },
  deep_watch: {
    id: 'deep_watch', name: 'Deep Watch', icon: 'all-seeing-eye',
    description: 'The risk dial gains a seventh step.',
  },
  sanctum: {
    id: 'sanctum', name: 'Sanctum', icon: 'wizard-staff',
    description: 'The Arcane core is yours, at no AP cost.',
  },
  long_memory: {
    id: 'long_memory', name: 'Long Memory', icon: 'over-infinity',
    description: 'Ability levels survive an ascension.',
  },
  archivist: {
    id: 'archivist', name: 'Archivist', icon: 'wisdom',
    description: 'Every research project completes 20% faster.',
  },
  crown_of_thorns: {
    id: 'crown_of_thorns', name: 'Crown of Thorns', icon: 'crown',
    description: 'The risk dial gains an eighth step.',
  },
  counting_house: {
    id: 'counting_house', name: 'The Counting House', icon: 'crown-coin',
    description: 'Contracts pay 25% more gold and research points.',
  },
  emberforge: {
    id: 'emberforge', name: 'Emberforge', icon: 'explosion-rays',
    description: 'The Bloodforge core is yours, at no AP cost.',
  },
  eternal_kit: {
    id: 'eternal_kit', name: 'Eternal Kit', icon: 'regeneration',
    description: 'Passive abilities survive a transcendence.',
  },
  master_broker: {
    id: 'master_broker', name: 'Master Broker', icon: 'receive-money',
    description: 'A fifth contract runs alongside the other four.',
  },
  deep_reserves: {
    id: 'deep_reserves', name: 'Deep Reserves', icon: 'energy-tank',
    description: 'Every ability costs 20% less mana.',
  },
  undying_watch: {
    id: 'undying_watch', name: 'The Undying Watch', icon: 'hourglass',
    description: 'Offline progress banks twelve more hours.',
  },
  deep_stores: {
    id: 'deep_stores', name: 'Deep Stores', icon: 'knapsack',
    description: 'Every scalar upgrade may be levelled 50% further.',
  },
};

/**
 * The `deep_stores` unlock's contribution to `upgradeCapExtension`
 * (progress.md §3.1).
 *
 * A constant rather than a literal at the call site, because the number is
 * quoted in the unlock's own copy above and in `Game.applyResolvedStats`, and
 * those two must not be able to drift.
 */
export const WATCH_CAP_EXTENSION = 0.5;

/**
 * Where each unlock is actually read.
 *
 * Same guard as `ACHIEVEMENT_REWARD_CONSUMERS`: a `Record` over the union, held
 * by `tests/watch.test.ts` to a non-placeholder string of real length. An
 * unlock that grants nothing is the exact failure this project has hit before
 * (nine achievement reward types once shipped with no consumer at all).
 */
export const WATCH_UNLOCK_CONSUMERS: Record<WatchUnlockId, string> = {
  board_expansion: 'ContractManager.refill via the injected slots() dep — Game passes watch.contractSlots()',
  quartermaster: 'BlessingManager.openDraft via the injected freeRerolls() dep',
  veteran_start: 'Game.applySavedStateReset — fourth term of the startWave Math.max',
  wide_draft: 'BlessingManager.rollOffer via the injected offerSize() dep',
  cold_forge: 'Game.applyWatchUnlock — CoreManager.unlock("frostwork") on chapter completion and on load',
  riskbearer: 'PacingManager.setRisk / clampRisk via the injected maxRisk() dep',
  overseer: 'PrestigeManager.isAutomationUnlocked via the injected externalAutomation() dep',
  storm_caller: 'Game wave_modifier_offer handler — choice count and MUTATOR_DURATION_WAVES bonus',
  heirloom: 'Game.applySavedStateReset — BlessingManager.resetRun({ carryBest: true })',
  deep_watch: 'PacingManager.setRisk / clampRisk via the injected maxRisk() dep',
  sanctum: 'Game.applyWatchUnlock — CoreManager.unlock("arcane") on chapter completion and on load',
  long_memory: 'Game.applySavedStateReset — skips abilityMgr.resetLevels()',
  archivist: 'Game.researchSpeedMultiplier() — the 0.8 factor folded into ResearchTree.setSpeedMultiplier',
  crown_of_thorns: 'Game.maxRisk() — returns 8, read by PacingManager.setRisk / clampRisk via the maxRisk() dep',
  counting_house: 'ContractManager rewardScale dep — Game adds +0.25 to getContractRewardMultiplier()',
  emberforge: 'Game.applyWatchUnlock — CoreManager.unlock("bloodforge") on completion and on load',
  eternal_kit: 'Game.applyFullTranscendenceReset — skips passiveMgr.reset() when held',
  master_broker: 'ContractManager.refill via the injected slots() dep — Game passes watch.contractSlots()',
  deep_reserves: 'Game.applyResolvedStats — multiplies abilityCostMultiplier by 0.8 before setAbilityCostMultiplier',
  undying_watch: 'Game getIdleCapSeconds closure — adds 12h to PrestigeManager.getIdleTimeCapSeconds()',
  deep_stores: 'Game.applyResolvedStats — adds WATCH_CAP_EXTENSION to the fraction passed to setUpgradeCapExtension',
};

export const WATCH_CHAPTERS: readonly WatchChapterDef[] = [
  {
    id: 'wc_first_watch', number: 1, name: 'The First Watch',
    flavour: 'Someone has to stand the first night.',
    icon: 'lantern-flame', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 15 },
      { kind: 'kills', count: 1_500 },
      { kind: 'flawless_waves', count: 5 },
    ],
    reward: 'board_expansion',
  },
  {
    id: 'wc_blood_and_iron', number: 2, name: 'Blood and Iron',
    flavour: 'The heavy ones come slowly. That is the only mercy in them.',
    icon: 'bloody-sword', color: '#d04848',
    goals: [
      { kind: 'reach_wave', wave: 25 },
      { kind: 'kills_of', type: 'tank', count: 400 },
      // Boss *kills*, and a boss wave fields one boss rather than the `2 + tier`
      // it used to, so every lifetime boss target on the board is quoted in
      // encounters now: four is about two runs to the chapter's own wave 25.
      { kind: 'bosses', count: 4 },
    ],
    reward: 'quartermaster',
  },
  {
    id: 'wc_ascendant_step', number: 3, name: 'The Ascendant Step',
    flavour: 'The tower falls so the tower may stand taller.',
    icon: 'upgrade', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 35 },
      { kind: 'ascensions', count: 3 },
      { kind: 'contracts_done', count: 25 },
    ],
    reward: 'veteran_start',
  },
  {
    id: 'wc_arsenal', number: 4, name: 'Arsenal',
    flavour: 'Every spell you have ever cast was rehearsal for the next one.',
    icon: 'magic-swirl', color: '#5b8def',
    goals: [
      { kind: 'reach_wave', wave: 45 },
      { kind: 'abilities_cast', count: 1_000 },
      { kind: 'blessing_picks', count: 40 },
    ],
    reward: 'wide_draft',
  },
  {
    id: 'wc_cold_forge', number: 5, name: 'The Cold Forge',
    flavour: 'Break the shield, and the thing behind it is only an enemy.',
    icon: 'snowflake-1', color: '#5dade2',
    goals: [
      { kind: 'reach_wave', wave: 60 },
      { kind: 'kills_of', type: 'shielded', count: 600 },
      { kind: 'swift_bosses', count: 10 },
    ],
    reward: 'cold_forge',
  },
  {
    id: 'wc_riskbearer', number: 6, name: 'Riskbearer',
    flavour: 'Turn the dial. The gold is on the other side of the fear.',
    icon: 'rolling-dices', color: '#c0392b',
    goals: [
      { kind: 'reach_wave', wave: 75 },
      { kind: 'risk_waves', risk: 3, count: 40 },
      { kind: 'gold_earned', amount: 50_000_000 },
    ],
    reward: 'riskbearer',
  },
  {
    id: 'wc_overseer', number: 7, name: 'Overseer',
    flavour: 'You have bought this upgrade two thousand times. Let it buy itself.',
    icon: 'gears', color: '#95a5a6',
    goals: [
      { kind: 'reach_wave', wave: 90 },
      { kind: 'ascensions', count: 10 },
      { kind: 'upgrades_bought', count: 2_500 },
    ],
    reward: 'overseer',
  },
  {
    id: 'wc_storm_caller', number: 8, name: 'Storm Caller',
    flavour: 'Weather that answers to a name is weather you can bargain with.',
    icon: 'lightning-trio', color: '#7f5af0',
    goals: [
      { kind: 'reach_wave', wave: 110 },
      { kind: 'mutator_waves', count: 60 },
      { kind: 'kills_of', type: 'warden', count: 300 },
    ],
    reward: 'storm_caller',
  },
  {
    id: 'wc_reliquary', number: 9, name: 'Reliquary',
    flavour: 'Nothing is meant to survive the reset. Something will anyway.',
    icon: 'locked-chest', color: '#9b59ff',
    goals: [
      { kind: 'reach_wave', wave: 130 },
      { kind: 'blessing_picks', count: 200 },
      { kind: 'contracts_done', count: 150 },
    ],
    reward: 'heirloom',
  },
  {
    id: 'wc_deep_watch', number: 10, name: 'Deep Watch',
    flavour: 'Past a certain depth the waves stop counting and start weighing.',
    icon: 'eclipse', color: '#2c5b8f',
    goals: [
      { kind: 'reach_wave', wave: 150 },
      { kind: 'risk_waves', risk: 5, count: 100 },
      { kind: 'kills', count: 2_000_000 },
    ],
    reward: 'deep_watch',
  },
  {
    id: 'wc_sanctum', number: 11, name: 'Sanctum',
    flavour: 'The crystal has been listening the whole time.',
    icon: 'floating-crystal', color: '#c77dff',
    goals: [
      { kind: 'reach_wave', wave: 175 },
      { kind: 'transcendences', count: 5 },
      // progress.md §7.6: level 100 is 12.3 M cumulative XP, which the ladder
      // reaches around run 30 — twenty-seven runs after this chapter's own
      // depth gate (wave 175) falls. Level 40 is what the tower is at the
      // depth this chapter asks for.
      { kind: 'tower_level', level: 40 },
    ],
    reward: 'sanctum',
  },
  {
    id: 'wc_long_watch', number: 12, name: 'The Long Watch',
    flavour: 'You are not holding a wall. You are keeping a promise.',
    icon: 'star-gate', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 200 },
      { kind: 'ascensions', count: 20 },
      { kind: 'bosses', count: 150 },
    ],
    reward: 'long_memory',
  },
  {
    id: 'wc_quiet_archive', number: 13, name: 'The Quiet Archive',
    flavour: 'Everything you learned is written down. Nothing that wrote it survives.',
    icon: 'book-pile', color: '#9b59ff',
    goals: [
      { kind: 'reach_wave', wave: 220 },
      { kind: 'transcendences', count: 10 },
      { kind: 'upgrades_bought', count: 25_000 },
    ],
    reward: 'archivist',
  },
  {
    id: 'wc_hollow_crown', number: 14, name: 'Hollow Crown',
    flavour: 'They keep sending kings. You keep sending them back.',
    icon: 'crowned-skull', color: '#c0392b',
    goals: [
      { kind: 'reach_wave', wave: 240 },
      { kind: 'bosses', count: 400 },
      { kind: 'swift_bosses', count: 150 },
    ],
    reward: 'crown_of_thorns',
  },
  {
    id: 'wc_long_ledger', number: 15, name: 'The Long Ledger',
    flavour: 'Count it twice. The second count is the one the tower is built on.',
    icon: 'money-stack', color: '#f1c40f',
    goals: [
      { kind: 'reach_wave', wave: 265 },
      { kind: 'gold_earned', amount: 1_000_000_000_000 },
      { kind: 'contracts_done', count: 500 },
    ],
    reward: 'counting_house',
  },
  {
    id: 'wc_ash_and_ember', number: 16, name: 'Ash and Ember',
    flavour: 'The field never cools now. That is one way to measure a war.',
    icon: 'fire-bowl', color: '#ff7a1a',
    goals: [
      { kind: 'reach_wave', wave: 320 },
      { kind: 'kills', count: 25_000_000 },
      { kind: 'mutator_waves', count: 400 },
    ],
    reward: 'emberforge',
  },
  {
    id: 'wc_cycles', number: 17, name: 'Cycles',
    flavour: 'You have given everything away so many times it has started coming back.',
    icon: 'clockwork', color: '#5b8def',
    goals: [
      { kind: 'reach_wave', wave: 380 },
      // progress.md §7.6: the depth gates now fall in single-digit run counts,
      // so a 250-ascension counter is not a *deep* requirement, it is the only
      // requirement — and the one that has nothing to do with how strong the
      // tower is.
      { kind: 'ascensions', count: 40 },
      { kind: 'transcendences', count: 12 },
    ],
    reward: 'eternal_kit',
  },
  {
    id: 'wc_wider_board', number: 18, name: 'The Wider Board',
    flavour: 'More work than one watch can hold, which is why there are more of you now.',
    icon: 'treasure-map', color: '#3ec46d',
    goals: [
      { kind: 'reach_wave', wave: 440 },
      { kind: 'contracts_done', count: 1_200 },
      { kind: 'blessing_picks', count: 800 },
    ],
    reward: 'master_broker',
  },
  {
    id: 'wc_starfall', number: 19, name: 'Starfall',
    flavour: 'The sky has run out of things to throw. You have not run out of answers.',
    icon: 'star-formation', color: '#c77dff',
    goals: [
      { kind: 'reach_wave', wave: 500 },
      { kind: 'abilities_cast', count: 50_000 },
      // progress.md §1.7: level 175 is 300.8 M cumulative XP against a ladder
      // that produces 6.2 M in sixteen runs and then plateaus — this chapter
      // was not completable. Level 85 is what the tower is at wave 400.
      { kind: 'tower_level', level: 85 },
    ],
    reward: 'deep_reserves',
  },
  {
    id: 'wc_last_watch', number: 20, name: 'The Last Watch',
    flavour: 'There is no last watch. That is the whole of what you have learned.',
    icon: 'star-swirl', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 560 },
      { kind: 'transcendences', count: 20 },
      { kind: 'risk_waves', risk: 6, count: 500 },
    ],
    reward: 'undying_watch',
  },
  {
    // plans/progress.md §3.1. A twenty-first chapter, because all twenty
    // existing ones already grant a unique unlock and displacing one of those
    // would take a reward off a save that had earned it. Its depth gate sits
    // past chapter 20's, which is also where the re-priced AP ladder is still
    // advancing (§4.1) — the campaign should end at the frontier, not behind it.
    id: 'wc_deep_stores', number: 21, name: 'Deep Stores',
    flavour: 'You stopped counting what the vault could hold and started counting what it could not.',
    icon: 'knapsack', color: '#e8a93b',
    goals: [
      { kind: 'reach_wave', wave: 620 },
      { kind: 'ascensions', count: 60 },
      { kind: 'upgrades_bought', count: 100_000 },
    ],
    reward: 'deep_stores',
  },
];

export const WATCH_CHAPTER_BY_ID: Record<string, WatchChapterDef> =
  Object.fromEntries(WATCH_CHAPTERS.map(c => [c.id, c]));

/** Total chapters. The Journal's "3 / 12" readout reads this. */
export const WATCH_CHAPTER_COUNT = WATCH_CHAPTERS.length;

/** The objective line shown on the chapter card. */
export function describeGoal(goal: WatchGoal): string {
  switch (goal.kind) {
    case 'reach_wave': return `Reach wave ${goal.wave}`;
    case 'kills': return `Kill ${fmt(goal.count)} enemies`;
    case 'kills_of': return `Kill ${fmt(goal.count)} ${CONTRACT_ENEMY_LABELS[goal.type]}`;
    case 'bosses': return `Kill ${fmt(goal.count)} bosses`;
    case 'gold_earned': return `Earn ${fmt(goal.amount)} lifetime gold`;
    case 'ascensions': return `Ascend ${fmt(goal.count)} times`;
    case 'transcendences': return `Transcend ${fmt(goal.count)} times`;
    case 'abilities_cast': return `Cast ${fmt(goal.count)} abilities`;
    case 'upgrades_bought': return `Buy ${fmt(goal.count)} upgrades`;
    case 'tower_level': return `Reach tower level ${goal.level}`;
    case 'blessing_picks': return `Take ${fmt(goal.count)} blessings`;
    case 'contracts_done': return `Complete ${fmt(goal.count)} contracts`;
    case 'flawless_waves': return `Clear ${fmt(goal.count)} waves without losing HP`;
    case 'swift_bosses': return `Clear ${fmt(goal.count)} boss encounters swiftly`;
    case 'risk_waves': return `Clear ${fmt(goal.count)} waves at risk ${goal.risk}+`;
    case 'mutator_waves': return `Clear ${fmt(goal.count)} waves under a mutator`;
  }
}

/** The absolute figure a goal is measured against. */
export function goalTarget(goal: WatchGoal): number {
  switch (goal.kind) {
    case 'reach_wave': return goal.wave;
    case 'tower_level': return goal.level;
    case 'gold_earned': return goal.amount;
    case 'kills': case 'kills_of': case 'bosses': case 'ascensions':
    case 'transcendences': case 'abilities_cast': case 'upgrades_bought':
    case 'blessing_picks': case 'contracts_done': case 'flawless_waves':
    case 'swift_bosses': case 'risk_waves': case 'mutator_waves':
      return goal.count;
  }
}

/**
 * The earliest wave a goal's subject exists at all.
 *
 * The same correctness floor `goalAvailableFromWave` gives contracts, for the
 * same reason: an objective asking for wardens is dead until wave 40. Only the
 * enemy-typed kind can be wrong, so the rest return 1.
 */
export function goalAvailableFromWave(goal: WatchGoal): number {
  return goal.kind === 'kills_of' ? ENEMY_DEFS[goal.type].unlockWave : 1;
}

function fmt(n: number): string {
  return n.toLocaleString();
}
