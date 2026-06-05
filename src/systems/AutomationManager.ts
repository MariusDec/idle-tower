import type { AbilityId, GameState } from '../types';
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
const AUTO_CAST_INTERVAL = 5;
const AUTO_ASCEND_INTERVAL = 1;
const AUTO_TRANSCEND_INTERVAL = 5;
const MIN_AUTO_BUY_INTERVAL = 3;

export class AutomationManager {
  private readonly deps: AutomationDeps;
  private autoBuyTimer = 0;
  private autoCastTimer = 0;
  private autoAscendTimer = 0;
  private autoTranscendTimer = 0;

  constructor(deps: AutomationDeps) {
    this.deps = deps;
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
      const interval = Math.max(MIN_AUTO_BUY_INTERVAL, BASE_AUTO_BUY_INTERVAL - reduction);
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

  private runAutoBuy(): void {
    const upgrades = this.deps.upgrades;
    const list = upgrades.all
      .filter(u => !upgrades.isMaxed(u.id) && upgrades.canAfford(u.id))
      .map(u => ({ id: u.id, cost: upgrades.getCost(u.id) }));
    if (list.length === 0) return;
    list.sort((a, b) => a.cost - b.cost);
    const target = list[0];
    upgrades.buy(target.id);
  }

  private runAutoCast(wave: number): void {
    const order: AbilityId[] = [
      'execute',
      'meteor_strike',
      'chain_lightning',
      'precision_shot',
      'vampiric_aura',
      'rain_of_arrows',
      'berserk',
      'frost_nova',
      'gold_rush',
    ];
    for (const id of order) {
      const def = ABILITY_BY_ID[id];
      if (!def) continue;
      if (!this.deps.abilities.canCast(id, wave)) continue;
      if (this.deps.abilities.tryCast(id, wave)) {
        return;
      }
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
