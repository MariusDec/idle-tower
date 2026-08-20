import type { AbilityId, AutoBuyStrategy, GameState, UpgradeCategory } from '../types';
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities';
import { EventBus } from '../game/EventBus';
import type { UpgradeManager } from './UpgradeManager';
import type { AbilityManager } from './AbilityManager';
import type { PrestigeManager } from './PrestigeManager';
import type { ResearchTree } from './ResearchTree';

export interface AutomationDeps {
  upgrades: UpgradeManager;
  abilities: AbilityManager;
  prestige: PrestigeManager;
  research: ResearchTree;
  getState: () => GameState;
  onAscend: () => number;
  onTranscend: () => number;
  bus: EventBus;
}

const BASE_AUTO_BUY_INTERVAL = 10;
/**
 * Plan §3.1: was 5s, which meant a single ability every five seconds and
 * cooldowns finishing into dead air. Auto-cast now runs every second and casts
 * every ready, enabled ability it can pay for, in priority order.
 */
const AUTO_CAST_INTERVAL = 1;
const AUTO_ASCEND_INTERVAL = 1;
const AUTO_TRANSCEND_INTERVAL = 5;
const MIN_AUTO_BUY_INTERVAL = 3;
/** Upper bound on purchases in one auto-buy tick, so a huge bank cannot stall a frame. */
const MAX_AUTO_BUYS_PER_TICK = 40;

/** Category ranking for the `damage` auto-buy strategy (lower buys first). */
const DAMAGE_PRIORITY: Partial<Record<UpgradeCategory, number>> = {
  tower: 0,
  economy: 1,
  defense: 2,
  utility: 3,
};

/**
 * Default auto-cast order: burst damage first, then buffs, then economy. The
 * player opts individual abilities out rather than reordering — a full priority
 * editor is more UI than the decision is worth.
 */
const AUTO_CAST_PRIORITY: AbilityId[] = [
  'execute',
  'meteor_strike',
  'chain_lightning',
  'rain_of_arrows',
  'multishot',
  'precision_shot',
  'berserk',
  'vampiric_aura',
  'frost_nova',
  'gold_rush',
];

export class AutomationManager {
  private readonly deps: AutomationDeps;
  /** Autonomy talent: fractional reduction of the auto-buy interval. */
  private autoBuyIntervalReduction = 0;
  private autoBuyTimer = 0;
  private autoCastTimer = 0;
  private autoAscendTimer = 0;
  private autoTranscendTimer = 0;

  constructor(deps: AutomationDeps) {
    this.deps = deps;
  }

  setAutoBuyIntervalReduction(reduction: number): void {
    this.autoBuyIntervalReduction = Math.max(0, Math.min(0.9, reduction));
  }

  tick(dt: number): void {
    const state = this.deps.getState();
    const prestige = this.deps.prestige;

    const autoBuyOn = prestige.getAutomationEnabled('autoBuy');
    const autoCastOn = prestige.getAutomationEnabled('autoAbilities');
    const autoAscendOn = prestige.getAutomationEnabled('autoAscend');
    const autoTranscendOn = prestige.getAutomationEnabled('autoTranscend');

    if (autoBuyOn) {
      const reduction = prestige.getAutoBuySpeedReduction();
      const interval = Math.max(
        MIN_AUTO_BUY_INTERVAL,
        (BASE_AUTO_BUY_INTERVAL - reduction) * (1 - this.autoBuyIntervalReduction),
      );
      this.autoBuyTimer += dt;
      if (this.autoBuyTimer >= interval) {
        this.autoBuyTimer = 0;
        this.runAutoBuy();
      }
    } else {
      this.autoBuyTimer = 0;
    }

    if (autoCastOn) {
      this.autoCastTimer += dt;
      if (this.autoCastTimer >= AUTO_CAST_INTERVAL) {
        this.autoCastTimer = 0;
        this.runAutoCast(state.wave.highestWave);
      }
    } else {
      this.autoCastTimer = 0;
    }

    if (autoAscendOn) {
      this.autoAscendTimer += dt;
      if (this.autoAscendTimer >= AUTO_ASCEND_INTERVAL) {
        this.autoAscendTimer = 0;
        this.runAutoAscend(state);
      }
    } else {
      this.autoAscendTimer = 0;
    }

    if (autoTranscendOn) {
      this.autoTranscendTimer += dt;
      if (this.autoTranscendTimer >= AUTO_TRANSCEND_INTERVAL) {
        this.autoTranscendTimer = 0;
        this.runAutoTranscend(state);
      }
    } else {
      this.autoTranscendTimer = 0;
    }
  }

  /**
   * Plan §3.6. The old heuristic — buy the single cheapest affordable upgrade,
   * once per interval — is the worst available: it floods cheap utility levels,
   * never banks for an expensive damage level, and buys at most six upgrades a
   * minute no matter how rich the player is. Three rules replace it:
   *
   *  1. **Strategy.** `damage` spends on the tower category first and only
   *     falls through to the rest when tower upgrades are unaffordable;
   *     `balanced` keeps categories level with each other by preferring the
   *     lowest-level upgrade; `cheapest` is the old behaviour, kept for players
   *     who want raw throughput.
   *  2. **Reserve.** A purchase only happens if the gold left afterwards still
   *     covers `autoBuyReserve` of the current pile, so a player can bank for a
   *     manual purchase without switching automation off.
   *  3. **Repeat.** Buying continues within the tick until no rule allows
   *     another purchase (bounded, so a huge bank cannot stall a frame).
   */
  private runAutoBuy(): void {
    const upgrades = this.deps.upgrades;
    const state = this.deps.getState();
    const strategy: AutoBuyStrategy = state.prestige.autoBuyStrategy ?? 'balanced';
    const reserve = Math.max(0, Math.min(0.9, state.prestige.autoBuyReserve ?? 0));

    for (let i = 0; i < MAX_AUTO_BUYS_PER_TICK; i++) {
      const gold = state.resources.gold;
      const budget = gold * (1 - reserve);
      const candidates = upgrades.all
        .filter(u => !upgrades.isMaxed(u.id))
        .map(u => ({
          id: u.id,
          cost: upgrades.getCost(u.id),
          category: u.category,
          level: upgrades.getLevel(u.id),
        }))
        .filter(c => Number.isFinite(c.cost) && c.cost <= budget);
      if (candidates.length === 0) return;

      candidates.sort((a, b) => {
        if (strategy === 'damage') {
          const pa = DAMAGE_PRIORITY[a.category] ?? 9;
          const pb = DAMAGE_PRIORITY[b.category] ?? 9;
          if (pa !== pb) return pa - pb;
        } else if (strategy === 'balanced' && a.level !== b.level) {
          return a.level - b.level;
        }
        return a.cost - b.cost;
      });

      if (!upgrades.buy(candidates[0].id)) return;
    }
  }

  /**
   * Priority order the player configured for auto-cast, filtered by the
   * per-ability toggles from plan §3.1. Casting continues down the list rather
   * than stopping at the first success, so a tick that finds four ready
   * abilities fires all four instead of leaving three on cooldown-complete.
   */
  /**
   * Gameplay plan §4.3: automation places targeted abilities too.
   *
   * There is deliberately nothing here to do it — `AbilityManager.tryCast`
   * picks the densest cluster itself whenever no explicit placement is passed,
   * which is the case for every automatic path (this one, the ability bar, and
   * the hotkey with `instantCast` on). Putting the placer behind the cast
   * rather than in front of it is what stops automation and the player's own
   * instant-cast from being two implementations that drift.
   */
  private runAutoCast(wave: number): void {
    const enabled = this.deps.getState().prestige.autoCastEnabled ?? {};
    for (const id of AUTO_CAST_PRIORITY) {
      if (enabled[id] === false) continue;
      const def = ABILITY_BY_ID[id];
      if (!def) continue;
      if (!this.deps.abilities.canCast(id, wave)) continue;
      this.deps.abilities.tryCast(id, wave);
    }
  }

  private runAutoAscend(state: GameState): void {
    const target = state.prestige.targetAscendWave;
    if (state.wave.highestWave < target) return;
    if (!this.deps.prestige.canAscend(state.wave.highestWave)) return;
    this.deps.onAscend();
  }

  private runAutoTranscend(state: GameState): void {
    if (!this.deps.prestige.canTranscend(state.resources.apThisTranscendence)) return;
    this.deps.onTranscend();
  }

  reset(): void {
    this.autoBuyTimer = 0;
    this.autoCastTimer = 0;
    this.autoAscendTimer = 0;
    this.autoTranscendTimer = 0;
  }
}

export { ABILITIES };
