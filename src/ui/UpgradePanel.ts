import type { UpgradeCategory, UpgradeDef, UpgradeEvolution, GameState } from '../types';
import { computeUpgradeValue } from '../types';
import { UPGRADES, splashRadiusForLevel } from '../data/upgrades';
import { upgradeCost, enemyHPForWave } from '../data/formulas';
import { ENEMY_DEFS, ENEMY_LABELS } from '../data/enemies';
import { TOWER_MARKS, type TowerMarkDef } from '../data/towerMarks';
import { formatNumber } from '../utils/bigNumber';
import { setText, toggleClass, setDisplay, setDataAttr, resetScroll } from '../utils/dom';
import { iconFrame } from './Icon';

type UpgradeTabId = 'attack' | 'defense' | 'utility';

/** How many levels one click buys. `'max'` means "as many as gold allows". */
export type BuyAmount = 1 | 10 | 'max';

/** What a given buy amount would actually purchase, resolved by the host. */
export interface UpgradePlan {
  levels: number;
  cost: number;
}

const BUY_AMOUNTS: { value: BuyAmount; label: string; title: string }[] = [
  { value: 1, label: '×1', title: 'Buy a single level' },
  { value: 10, label: '×10', title: 'Buy up to the next multiple of 10 (from level 18, that is 2 levels)' },
  { value: 'max', label: '×Max', title: 'Buy as many levels as your gold allows' },
];

interface UpgradeTabDef {
  id: UpgradeTabId;
  label: string;
  categories: UpgradeCategory[];
}

const TAB_DEFS: UpgradeTabDef[] = [
  { id: 'attack', label: 'Attack', categories: ['tower'] },
  { id: 'defense', label: 'Defense', categories: ['defense'] },
  { id: 'utility', label: 'Utility', categories: ['economy', 'utility'] },
];

/**
 * The composed shot the panel prices a purchase against (revamp §12.2).
 *
 * Filled by `Game.previewUpgradeShot` out of a resolved stat block, so the
 * "after" numbers are the pipeline's answer rather than a second copy of the
 * balance math living in the UI.
 */
export interface ShotPreview {
  damage: number;
  fireRate: number;
  critChance: number;
  critMultiplier: number;
  /**
   * The full resolved stat block the four fields above were read out of.
   *
   * Damage and fire rate quoted the *composed* number — everything a talent, a
   * blessing, an equipment roll and a core had contributed — while max HP,
   * armor, regen and the rest quoted the upgrade line's own accumulated value
   * in isolation. Two rows in the same panel meant two different things by
   * "current → next", and the isolated one is the less useful of the two: a
   * player deciding whether to buy HP wants the HP the tower will have.
   */
  resolved: Readonly<Record<string, number>>;
}

export interface UpgradeShotPreview {
  before: ShotPreview;
  after: ShotPreview;
}

/** Composed shot before/after buying `levels` of `id`; null before stats resolve. */
export type ShotPreviewGetter = (id: string, levels: number) => UpgradeShotPreview | null;

/**
 * The offence lines whose readout is a *composed* stat rather than the
 * upgrade's own accumulated value — a player wants "1.75 → 1.90 shots/s", not
 * "+0.70 fire-rate bonus" (revamp §12.1).
 */
const COMPOSED_ROWS = new Set(['damage', 'fireRate', 'critChance', 'critDamage']);

/**
 * Rows whose "current → next" is a *composed* stat read straight off the
 * resolved block, keyed by the `StatKey` it maps to.
 *
 * The four offence lines above already worked this way through
 * `previewUpgradeShot`; these are the rows that did not, and read out the
 * upgrade's own accumulated contribution as though nothing else in the game
 * touched the stat. `health` was the clearest case — a tower at 40k max HP
 * with talents and equipment quoted a four-digit "5,900 → 6,400 max HP" that
 * matched no number anywhere else in the UI.
 *
 * Only rows where the upgrade and the stat mean the same quantity in the same
 * unit belong here. `goldMulti` and `xpGain` are deliberately absent: the
 * upgrade is stated as a percentage bonus and the resolved stat is a
 * multiplier, so quoting one in place of the other would be a unit change, not
 * a better number.
 */
const COMPOSED_STAT_ROWS: Record<string, { key: string; percent?: boolean }> = {
  health: { key: 'maxHp' },
  // Resolved `healthRegen` is a *fraction of max HP per second*, not an
  // absolute HP/s (see `Tower.effectiveHealthRegen`), so it reads as a percent
  // exactly like the upgrade's own value did.
  healthRegen: { key: 'healthRegen', percent: true },
  defense: { key: 'defense' },
  armor: { key: 'armor', percent: true },
  thorns: { key: 'thorns', percent: true },
  lifesteal: { key: 'lifesteal', percent: true },
  range: { key: 'range' },
  manaRegen: { key: 'manaRegen' },
  maxMana: { key: 'maxMana' },
};

/**
 * Lines that are saved for rather than trickled into (revamp §12.4). They get
 * the milestone badge and a per-level "what the next one unlocks" line, the
 * same treatment an evolution gets.
 */
const MILESTONE_ROWS = new Set(['pierce', 'splash']);

/** Noun the before → after readout is stated in, per line. */
const EFFECT_LABEL: Record<string, string> = {
  range: 'range',
  landMines: 'mine damage',
  doubleShotChance: 'double-shot chance',
  quickShotChance: 'proc chance',
  quickShotTime: 'duration',
  goldMulti: 'gold',
  prospecting: 'double-gold chance',
  manaRegen: 'mana/s',
  maxMana: 'max mana',
  waveGold: 'gold on wave clear',
  xpGain: 'XP',
  abilityCostReduction: 'ability mana cost',
  goldOnKill: 'gold per kill',
  critGold: 'crit gold',
  health: 'max HP',
  healthRegen: 'HP/s regen',
  defense: 'flat damage reduction',
  armor: 'damage reduction',
  shockwave: 'between pulses',
  thorns: 'damage reflected',
  lifesteal: 'lifesteal',
  defenseShield: 'shield recharge',
  wall: 'wall strength',
};

/** Expected damage of one shot, crits folded in — `Game.computeStatsInfo`'s shape. */
function expectedHit(shot: ShotPreview): number {
  return shot.damage * (1 + shot.critChance * (shot.critMultiplier - 1));
}

/**
 * Shots this tower needs to drop the current wave's `normal` enemy.
 *
 * The HP comes from `enemyHPForWave` and `ENEMY_DEFS`, the damage from the
 * stat pipeline — this is the metric the whole revamp is built on (§12.2), so
 * it must be the shipping formula rather than a UI approximation of it.
 */
function shotsToKill(shot: ShotPreview, wave: number): number {
  const hit = expectedHit(shot);
  if (hit <= 0) return Infinity;
  return enemyHPForWave(ENEMY_DEFS.normal.baseHP, wave) / hit;
}

function formatShots(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

const PERCENT_UPGRADES = new Set(['critChance', 'critDamage', 'goldMulti', 'xpGain', 'prospecting', 'abilityCostReduction', 'critGold', 'doubleShotChance', 'quickShotChance']);

function getHighestEvolution(def: UpgradeDef, level: number): UpgradeEvolution | null {
  if (!def.evolutions) return null;
  let best: UpgradeEvolution | null = null;
  for (const evo of def.evolutions) {
    if (level >= evo.level) best = evo;
  }
  return best;
}

function getNextEvolution(def: UpgradeDef, level: number): UpgradeEvolution | null {
  if (!def.evolutions) return null;
  for (const evo of def.evolutions) {
    if (level < evo.level) return evo;
  }
  return null;
}

/**
 * The next tower-visual change this upgrade's line will produce, if any
 * (`plans/tower-ui.md` §F.3).
 *
 * `combine: 'sum'` marks are fed by two lines, so the threshold is against the
 * *combined* level — the hint has to say the combined number or it will be
 * wrong for whichever line the player is looking at. That is why `levels` is
 * the whole record rather than one number.
 */
function getNextMark(
  upgradeId: string,
  levels: Record<string, number>,
): { def: TowerMarkDef; at: number; step: number } | null {
  for (const def of TOWER_MARKS) {
    if (!def.sources.includes(upgradeId)) continue;
    let level = 0;
    if (def.combine === 'sum') for (const id of def.sources) level += levels[id] ?? 0;
    else for (const id of def.sources) level = Math.max(level, levels[id] ?? 0);
    for (let i = 0; i < def.thresholds.length; i++) {
      if (level < def.thresholds[i]) return { def, at: def.thresholds[i], step: i + 1 };
    }
    return null;
  }
  return null;
}

/**
 * `level`, folded together with every sibling level a mark hint for this
 * upgrade would read.
 *
 * `evoInfoLastLevel` is a `Map<string, number>` and stays one — this is still
 * a number, just one that covers more than a single line. `1009` is an
 * arbitrary small prime; two lines never push the product anywhere near
 * `Number.MAX_SAFE_INTEGER` at `maxLevel` 200.
 */
function markMemoKey(upgradeId: string, level: number, levels: Record<string, number>): number {
  let key = level;
  for (const def of TOWER_MARKS) {
    if (!def.sources.includes(upgradeId)) continue;
    for (const id of def.sources) key = key * 1009 + (levels[id] ?? 0);
  }
  return key;
}

function isPercent(def: UpgradeDef): boolean {
  if (def.scaling) return def.scaling.effectType === 'mult';
  return PERCENT_UPGRADES.has(def.id);
}

function isTotalEffectUpgrade(def: UpgradeDef): boolean {
  return def.id === 'damage' || def.id === 'health';
}

function formatNumberValue(v: number, decimalCount = 0): string {
  const abs = Math.abs(v);
  if (abs !== 0 && abs < 1) return v.toFixed(2);
  if (abs < 10) return v.toFixed(1);

  const decimalFactor = Math.pow(10, decimalCount);
  if (abs < 1000) return (Math.floor(abs * decimalFactor) / decimalFactor).toLocaleString();

  return v.toFixed(0);
}

function formatPercentValue(v: number): string {
  const pct = v * 100;
  const decimals = Math.abs(pct) < 10 && pct % 1 !== 0 ? 1 : 0;
  return `${pct.toFixed(decimals)}%`;
}

function formatEffectBonus(def: UpgradeDef, level: number, showSign: boolean = true, decimalCount = 1): string {
  const total = computeUpgradeValue(def, level);
  if (total === 0) return '';
  const unit = def.scaling?.unit ?? '';
  if (isPercent(def)) {
    const sign = showSign ? (total > 0 ? '+' : '') : '';
    return `${sign}${formatPercentValue(total)}`;
  }
  const sign = showSign ? (total > 0 ? '+' : '') : '';
  return `${sign}${formatNumberValue(total, decimalCount)}${unit}`;
}

function formatNextDelta(def: UpgradeDef): string {
  if (def.hideUpgradeScale) return '';

  if (def.scaling?.step) {
    const step = def.scaling.step;
    const inc = formatNumberValue(Math.abs(def.scaling.perLevel), 1);
    return `+${inc} per ${step} levels`;
  }
  if (def.scaling) {
    const v = def.scaling.perLevel;
    const sign = v >= 0 ? '+' : '−';
    const abs = Math.abs(v);
    const unit = def.scaling.unit ?? '';
    if (isPercent(def)) {
      const pct = abs * 100;
      const decimals = pct < 10 && pct % 1 !== 0 ? 1 : 0;
      return `${sign}${pct.toFixed(decimals)}% per level`;
    }
    if (abs !== 0 && abs < 1) return `${sign}${abs.toFixed(2)}${unit} per level`;
    if (abs < 10) return `${sign}${abs.toFixed(1)}${unit} per level`;
    return `${sign}${abs.toFixed(0)}${unit} per level`;
  }
  if (typeof def.effectPerLevel === 'string') return '';
  const v = def.effectPerLevel;
  const sign = v >= 0 ? '+' : '−';
  const abs = Math.abs(v);
  if (isPercent(def)) {
    const pct = abs * 100;
    const decimals = pct < 10 && pct % 1 !== 0 ? 1 : 0;
    return `${sign}${pct.toFixed(decimals)}% per level`;
  }
  if (abs !== 0 && abs < 1) return `${sign}${abs.toFixed(2)} per level`;
  if (abs < 10) return `${sign}${abs.toFixed(1)} per level`;
  return `${sign}${abs.toFixed(0)} per level`;
}

export class UpgradePanel {
  private readonly onBuy: (id: string, amount: BuyAmount) => void;
  private getPlanFn: ((id: string, amount: BuyAmount) => UpgradePlan) | null = null;
  private root: HTMLElement | null = null;
  private costById = new Map<string, HTMLElement>();
  private levelById = new Map<string, HTMLElement>();
  private bonusById = new Map<string, HTMLElement>();
  private buttonById = new Map<string, HTMLButtonElement>();
  private nameById = new Map<string, HTMLElement>();
  private evoInfoById = new Map<string, HTMLElement>();
  private rowById = new Map<string, HTMLElement>();
  private evoInfoLastLevel = new Map<string, number>();
  private levelsById = new Map<string, HTMLElement>();
  private deltaById = new Map<string, HTMLElement>();
  private stkById = new Map<string, HTMLElement>();
  private readoutKeyById = new Map<string, string>();
  private previewFn: ShotPreviewGetter | null = null;
  /**
   * Bumped by the host whenever the resolved stat block changes. It is the
   * memo key for the composed readouts — without it a talent or a blessing
   * would move the tower's damage and leave the panel quoting the old
   * before → after pair.
   */
  private statsVersion = 0;
  private amountBtns = new Map<BuyAmount, HTMLButtonElement>();
  private activeTab: UpgradeTabId = 'attack';
  private buyAmount: BuyAmount = 1;
  /**
   * Amount implied by a held modifier key (shift = ×10, ctrl/cmd = ×Max),
   * which temporarily overrides the selector without changing it.
   */
  private modifierAmount: BuyAmount | null = null;
  private boundModifierChange: ((ev: KeyboardEvent) => void) | null = null;
  private boundBlur: (() => void) | null = null;

  constructor(onBuy: (id: string, amount: BuyAmount) => void) {
    this.onBuy = onBuy;
  }

  setPlanGetter(fn: (id: string, amount: BuyAmount) => UpgradePlan): void {
    this.getPlanFn = fn;
  }

  /** Wire the composed before → after shot preview (revamp §12.2). */
  setShotPreviewGetter(fn: ShotPreviewGetter): void {
    this.previewFn = fn;
    this.readoutKeyById.clear();
  }

  /** Told by the host that the resolved stat block moved; invalidates the memo. */
  statsChanged(): void {
    this.statsVersion += 1;
  }

  /** The amount a click buys right now: a held modifier beats the selector. */
  private effectiveAmount(): BuyAmount {
    return this.modifierAmount ?? this.buyAmount;
  }

  private planFor(id: string, level: number, amount: BuyAmount): UpgradePlan {
    if (this.getPlanFn) return this.getPlanFn(id, amount);
    // Fallback for a panel mounted before the host wired its getter: price a
    // single level off the raw curve.
    const def = UPGRADES.find(u => u.id === id);
    if (!def) return { levels: 0, cost: 0 };
    return { levels: 1, cost: upgradeCost(def.baseCost, def.costGrowth, level) };
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.costById.clear();
    this.levelById.clear();
    this.bonusById.clear();
    this.buttonById.clear();
    this.nameById.clear();
    this.evoInfoById.clear();
    this.rowById.clear();
    this.evoInfoLastLevel.clear();
    this.levelsById.clear();
    this.deltaById.clear();
    this.stkById.clear();
    this.readoutKeyById.clear();
    this.amountBtns.clear();
    this.activeTab = 'attack';
    this.bindModifierKeys();
    this.renderInto(parent);
  }

  /**
   * Shift/ctrl held anywhere in the document temporarily promotes the buy
   * amount, so a player can grab ten levels without leaving ×1 selected.
   * The window blur reset stops a modifier from sticking when focus leaves
   * mid-hold (the keyup never arrives in that case).
   */
  private bindModifierKeys(): void {
    if (this.boundModifierChange) return;
    const onChange = (ev: KeyboardEvent) => {
      const next: BuyAmount | null = (ev.ctrlKey || ev.metaKey) ? 'max' : ev.shiftKey ? 10 : null;
      if (next === this.modifierAmount) return;
      this.modifierAmount = next;
      this.refreshAmountButtons();
    };
    this.boundModifierChange = onChange;
    this.boundBlur = () => {
      if (this.modifierAmount === null) return;
      this.modifierAmount = null;
      this.refreshAmountButtons();
    };
    window.addEventListener('keydown', onChange);
    window.addEventListener('keyup', onChange);
    window.addEventListener('blur', this.boundBlur);
  }

  update(state: GameState): void {
    if (!this.root) return;
    const gold = state.resources.gold;
    const wave = Math.max(1, state.wave.number);
    for (const u of UPGRADES) {
      const btn = this.buttonById.get(u.id);
      const costEl = this.costById.get(u.id);
      const levelEl = this.levelById.get(u.id);
      const bonusEl = this.bonusById.get(u.id);
      const nameEl = this.nameById.get(u.id);
      const evoEl = this.evoInfoById.get(u.id);
      const rowEl = this.rowById.get(u.id);
      if (!btn || !costEl || !levelEl || !bonusEl) continue;
      const level = state.upgrades[u.id] ?? 0;
      const atMax = u.maxLevel > 0 && level >= u.maxLevel;
      const amount = this.effectiveAmount();
      let plan = atMax ? { levels: 0, cost: 0 } : this.planFor(u.id, level, amount);
      // At ×Max with nothing affordable there is no plan to price, but the
      // player still needs to know what they are saving for — fall back to
      // the next single level.
      const emptyMax = !atMax && amount === 'max' && plan.levels === 0;
      if (emptyMax) plan = this.planFor(u.id, level, 1);
      const cost = atMax ? Infinity : plan.cost;
      const levelsEl = this.levelsById.get(u.id);
      if (levelsEl) {
        const showLevels = !atMax && !emptyMax && plan.levels > 1;
        setText(levelsEl, showLevels ? `+${plan.levels} lv` : '');
        setDisplay(levelsEl, showLevels ? '' : 'none');
      }
      setText(levelEl, atMax ? `Level ${level} (max)` : `Level ${level}`);
      setText(costEl, atMax ? '—' : formatNumber(cost));
      setText(bonusEl, isTotalEffectUpgrade(u) ? formatEffectBonus(u, level, false, 0) : formatEffectBonus(u, level));
      const affordable = !atMax && !emptyMax && plan.levels > 0 && gold >= cost;
      btn.disabled = !affordable;
      toggleClass(btn, 'can-afford', affordable);
      setText(btn, atMax ? 'Maxed' : plan.levels > 1 ? `Buy ×${plan.levels}` : 'Buy');
      // §12.1–2: the concrete next effect, and — where the shot changes —
      // shots-to-kill against this wave's Grunt. Rebuilt only when the level,
      // the pending buy, the wave or the resolved stat block moves, so the
      // per-frame path stays a pair of cached `setText` calls.
      const readoutKey = `${level}|${atMax ? 0 : plan.levels}|${wave}|${this.statsVersion}`;
      if (this.readoutKeyById.get(u.id) !== readoutKey) {
        this.readoutKeyById.set(u.id, readoutKey);
        this.renderReadout(u, level, atMax ? 0 : plan.levels, wave);
      }
      if (rowEl) {
        // Plan §8.B: the card's affordability state, legible without colour —
        // the action dims and disables, the cost reads as unmet.
        setDataAttr(rowEl, 'afford', atMax ? 'maxed' : affordable ? 'yes' : 'no');
        // The evolution ribbon fires one level out, not on the level itself.
        const upcoming = getNextEvolution(u, level);
        const near = upcoming !== null && upcoming.level - level <= 1;
        setDataAttr(rowEl, 'evolution', near ? 'near' : 'none');
      }

      // Evolution display
      if (nameEl && u.evolutions) {
        const highestEvo = getHighestEvolution(u, level);
        if (highestEvo) {
          setText(nameEl, highestEvo.name);
          if (rowEl) toggleClass(rowEl, 'upgrade-evolved', true);
        } else {
          setText(nameEl, u.name);
          if (rowEl) toggleClass(rowEl, 'upgrade-evolved', false);
        }
      }
      if (evoEl) {
        // The lines below depend on `level` and — for a `combine: 'sum'` mark
        // — on the *sibling* line's level too. Skip the full innerHTML rebuild
        // unless one of those has changed since the last render, so selecting
        // the description text isn't broken every UI tick.
        const memoKey = markMemoKey(u.id, level, state.upgrades);
        if (this.evoInfoLastLevel.get(u.id) !== memoKey) {
          this.evoInfoLastLevel.set(u.id, memoKey);
          evoEl.innerHTML = '';
          let hasContent = false;
          // Show unlocked evolution effects
          for (const evo of u.evolutions ?? []) {
            if (level >= evo.level) {
              const line = document.createElement('div');
              line.className = 'evo-line evo-unlocked';
              line.textContent = `★ ${evo.name}: ${evo.description}`;
              evoEl.appendChild(line);
              hasContent = true;
            }
          }
          // Show next evolution hint (purple, name only). `getNextEvolution`
          // already returns null for an upgrade with no evolutions.
          // §12.3: an evolution is a milestone, so it is labelled as one and
          // names what it unlocks — the level alone told the player nothing.
          const nextEvo = getNextEvolution(u, level);
          if (nextEvo) {
            const line = document.createElement('div');
            line.className = 'evo-line evo-next evo-milestone';
            line.textContent =
              `Milestone · Lv${nextEvo.level} (${nextEvo.level - level} to go): ${nextEvo.name} — ${nextEvo.description}`;
            evoEl.appendChild(line);
            hasContent = true;
          }
          // §12.4: the coverage lines have no evolutions to carry the moment,
          // so they state their own next step in the same milestone voice.
          const milestone = this.milestoneStepLine(u, level);
          if (milestone) {
            const line = document.createElement('div');
            line.className = 'evo-line evo-next evo-milestone';
            line.textContent = milestone;
            evoEl.appendChild(line);
            hasContent = true;
          }
          // The next tower-visual change on this line (`plans/tower-ui.md` §F.3).
          const nextMark = getNextMark(u.id, state.upgrades);
          if (nextMark) {
            const line = document.createElement('div');
            line.className = 'evo-line mark-next';
            const combined = nextMark.def.sources.length > 1
              ? ` (${nextMark.def.sources.length} lines combined)`
              : '';
            line.textContent =
              `Lv${nextMark.at}${combined}: ${nextMark.def.part} — ${nextMark.def.announce[nextMark.step - 1]}`;
            evoEl.appendChild(line);
            hasContent = true;
          }
          setDisplay(evoEl, hasContent ? '' : 'none');
        }
      }
    }
  }


  /**
   * The milestone sentence for `pierce` / `splash` — what the *next* level of
   * the line changes about the shot, said as a step rather than a trickle
   * (§12.4). Null for every other line and for a maxed one.
   */
  private milestoneStepLine(u: UpgradeDef, level: number): string | null {
    if (!MILESTONE_ROWS.has(u.id)) return null;
    if (u.maxLevel > 0 && level >= u.maxLevel) return null;
    const nextLevel = level + 1;
    if (u.id === 'pierce') {
      return `Milestone · Lv${nextLevel}: each shot hits ${nextLevel + 1} enemies in a line`;
    }
    return `Milestone · Lv${nextLevel}: ${formatPercentValue(computeUpgradeValue(u, nextLevel))} burst`
      + ` in a ${splashRadiusForLevel(nextLevel).toFixed(0)} radius`;
  }

  /**
   * Write the two §12 readout lines for one row.
   *
   * `buyLevels` is what the current buy amount would actually purchase, so the
   * "after" figure is the one the Buy button lands — quoting a single level
   * next to a ×10 button is exactly the disconnect this readout exists to
   * close. Only the four composed offence lines ask the host for a preview;
   * every other row's effect is its own accumulated value, which needs no
   * second stat resolve.
   */
  private renderReadout(u: UpgradeDef, level: number, buyLevels: number, wave: number): void {
    const deltaEl = this.deltaById.get(u.id);
    const stkEl = this.stkById.get(u.id);
    let next = '';
    let stk = '';

    if (buyLevels <= 0) {
      next = formatNextDelta(u);
    } else if (COMPOSED_ROWS.has(u.id)) {
      const preview = this.previewFn ? this.previewFn(u.id, buyLevels) : null;
      if (!preview) {
        next = formatNextDelta(u);
      } else {
        const { before, after } = preview;
        switch (u.id) {
          case 'damage': {
            const gain = before.damage > 0 ? (after.damage / before.damage - 1) * 100 : 0;
            next = `${formatNumberValue(before.damage, 1)} → ${formatNumberValue(after.damage, 1)} damage`
              + (gain > 0 ? ` (+${gain.toFixed(0)}%)` : '');
            break;
          }
          case 'fireRate':
            next = `${before.fireRate.toFixed(2)} → ${after.fireRate.toFixed(2)} shots/s`;
            break;
          case 'critChance': {
            // A single level is half a percentage point, so this readout needs
            // a decimal the generic percent formatter drops above 10%.
            const pp = (v: number) => `${(v * 100).toFixed(1)}%`;
            next = `${pp(before.critChance)} → ${pp(after.critChance)} crit chance`;
            break;
          }
          default:
            next = `×${before.critMultiplier.toFixed(2)} → ×${after.critMultiplier.toFixed(2)} crit damage`;
            break;
        }
        const b = shotsToKill(before, wave);
        const a = shotsToKill(after, wave);
        if (Number.isFinite(b) && Math.abs(a - b) > 0.05) {
          stk = `${formatShots(b)} → ${formatShots(a)} shots to kill a ${ENEMY_LABELS.normal} (wave ${wave})`;
        }
      }
    } else if (COMPOSED_STAT_ROWS[u.id] && this.previewFn) {
      const spec = COMPOSED_STAT_ROWS[u.id];
      const preview = this.previewFn(u.id, buyLevels);
      const b = preview?.before.resolved[spec.key];
      const a = preview?.after.resolved[spec.key];
      if (b === undefined || a === undefined) {
        // No resolved block yet (first frame, or a host that never wired the
        // getter): fall back to the line's own value rather than show nothing.
        const rawB = computeUpgradeValue(u, level);
        const rawA = computeUpgradeValue(u, level + buyLevels);
        const unit = u.scaling?.unit ?? '';
        const fmt = (v: number) => isPercent(u) ? formatPercentValue(v) : `${formatNumberValue(v, 1)}${unit}`;
        next = rawA === rawB ? formatNextDelta(u) : `${fmt(rawB)} → ${fmt(rawA)}${EFFECT_LABEL[u.id] ? ` ${EFFECT_LABEL[u.id]}` : ''}`;
      } else {
        const fmt = (v: number) => spec.percent ? formatPercentValue(v) : formatNumberValue(v, 1);
        const label = EFFECT_LABEL[u.id];
        next = a === b
          ? formatNextDelta(u)
          : `${fmt(b)} → ${fmt(a)}${label ? ` ${label}` : ''}`;
      }
    } else if (u.id === 'pierce') {
      next = `passes through ${level} → ${level + buyLevels} extra ${level + buyLevels === 1 ? 'enemy' : 'enemies'}`;
    } else if (u.id === 'splash') {
      const b = computeUpgradeValue(u, level);
      const a = computeUpgradeValue(u, level + buyLevels);
      // The radius is stated on the milestone line below the row; repeating
      // it here would push the numbers that changed off the end.
      next = `${formatPercentValue(b)} → ${formatPercentValue(a)} splash damage`;
    } else {
      const b = computeUpgradeValue(u, level);
      const a = computeUpgradeValue(u, level + buyLevels);
      const unit = u.scaling?.unit ?? '';
      const fmt = (v: number) => isPercent(u) ? formatPercentValue(v) : `${formatNumberValue(v, 1)}${unit}`;
      const label = EFFECT_LABEL[u.id];
      next = a === b ? formatNextDelta(u) : `${fmt(b)} → ${fmt(a)}${label ? ` ${label}` : ''}`;
    }

    if (deltaEl) setText(deltaEl, next);
    if (stkEl) {
      setText(stkEl, stk);
      setDisplay(stkEl, stk ? '' : 'none');
    }
  }

  private   unmount(): void {
    if (this.boundModifierChange) {
      window.removeEventListener('keydown', this.boundModifierChange);
      window.removeEventListener('keyup', this.boundModifierChange);
      this.boundModifierChange = null;
    }
    if (this.boundBlur) {
      window.removeEventListener('blur', this.boundBlur);
      this.boundBlur = null;
    }
    this.modifierAmount = null;
    this.root = null;
  }

  /**
   * Briefly flash a button white + spawn a floating "+N" to indicate purchase.
   */
  flashButton(id: string, levels = 1): void {
    const btn = this.buttonById.get(id);
    if (!btn) return;
    // Animation restart: always remove + force reflow + add, regardless of
    // cached class state — toggleClass would short-circuit and break the
    // CSS animation.
    btn.classList.remove('is-flash');
    // Force reflow so animation restarts
    void btn.offsetWidth;
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 220);

    // Floating "+1"
    const action = btn.parentElement;
    if (action) {
      const plus = document.createElement('span');
      plus.className = 'upgrade-plus-one';
      plus.textContent = `+${levels}`;
      action.appendChild(plus);
      setTimeout(() => {
        if (plus.parentElement) plus.parentElement.removeChild(plus);
      }, 700);
    }
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'upgrade-panel';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Upgrades';
    parent.appendChild(title);

    const tabs = document.createElement('div');
    tabs.className = 'upgrade-tabs';
    for (const t of TAB_DEFS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab-btn';
      btn.textContent = t.label;
      btn.dataset.upgradeTab = t.id;
      btn.addEventListener('click', () => this.showInnerTab(t.id));
      tabs.appendChild(btn);
    }
    parent.appendChild(tabs);

    parent.appendChild(this.renderAmountSelector());

    const byTab = new Map<UpgradeTabId, UpgradeDef[]>();
    for (const t of TAB_DEFS) byTab.set(t.id, []);
    for (const u of UPGRADES) {
      for (const t of TAB_DEFS) {
        if (t.categories.includes(u.category)) {
          byTab.get(t.id)!.push(u);
          break;
        }
      }
    }

    for (const t of TAB_DEFS) {
      const panel = document.createElement('div');
      panel.className = 'upgrade-tab-panel';
      panel.dataset.upgradeTabPanel = t.id;
      const items = byTab.get(t.id) ?? [];
      if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'panel-note';
        empty.textContent = 'No upgrades available in this section yet.';
        panel.appendChild(empty);
      } else {
        const list = document.createElement('div');
        list.className = 'upgrade-list';
        for (const u of items) {
          list.appendChild(this.renderRow(u));
        }
        panel.appendChild(list);
      }
      parent.appendChild(panel);
    }

    this.showInnerTab(this.activeTab);

    const note = document.createElement('p');
    note.className = 'panel-note';
    note.textContent = 'Spending gold accelerates your tower. Costs grow exponentially per level. '
      + 'The cost shown is the total for the selected buy amount.';
    parent.appendChild(note);
  }

  private renderAmountSelector(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'upgrade-amount-row';

    const label = document.createElement('span');
    label.className = 'upgrade-amount-label';
    label.textContent = 'Buy';
    row.appendChild(label);

    const group = document.createElement('div');
    group.className = 'upgrade-amount-group';
    for (const a of BUY_AMOUNTS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'upgrade-amount-btn';
      btn.textContent = a.label;
      btn.title = a.title;
      btn.addEventListener('click', () => {
        this.buyAmount = a.value;
        this.refreshAmountButtons();
      });
      this.amountBtns.set(a.value, btn);
      group.appendChild(btn);
    }
    row.appendChild(group);

    const hint = document.createElement('span');
    hint.className = 'upgrade-amount-hint';
    hint.textContent = 'hold shift ×10 · ctrl ×Max';
    row.appendChild(hint);

    this.refreshAmountButtons();
    return row;
  }

  private refreshAmountButtons(): void {
    const active = this.effectiveAmount();
    for (const [value, btn] of this.amountBtns) {
      toggleClass(btn, 'active', value === active);
      // A modifier-driven selection is styled apart from a clicked one so it
      // is obvious the state is transient.
      toggleClass(btn, 'is-modifier', this.modifierAmount !== null && value === active);
    }
  }

  private showInnerTab(id: UpgradeTabId): void {
    this.activeTab = id;
    if (!this.root) return;
    for (const el of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.upgrade-tabs .tab-btn'))) {
      toggleClass(el, 'active', el.dataset.upgradeTab === id);
    }
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('.upgrade-tab-panel'))) {
      toggleClass(el, 'active', el.dataset.upgradeTabPanel === id);
    }
    resetScroll(this.root);
  }

  private renderRow(u: UpgradeDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'card upgrade-row';
    row.dataset.upgradeId = u.id;
    this.rowById.set(u.id, row);

    row.appendChild(iconFrame(u.icon, { variant: 'upgrade', className: 'upgrade-icon' }));

    const info = document.createElement('div');
    info.className = 'upgrade-info';
    const name = document.createElement('div');
    name.className = 'upgrade-name';
    // The label is its own span: `update` rewrites it with the unlocked
    // evolution's name, and writing the whole row's `textContent` would take
    // the milestone badge with it.
    const nameText = document.createElement('span');
    nameText.className = 'upgrade-name-text';
    nameText.textContent = u.name;
    name.appendChild(nameText);
    this.nameById.set(u.id, nameText);
    // §12.4: the two coverage lines are milestone purchases, and the row has
    // to say so before the player reads the four-figure price tag.
    if (MILESTONE_ROWS.has(u.id)) {
      row.dataset.milestone = 'yes';
      const badge = document.createElement('span');
      badge.className = 'upgrade-milestone-badge';
      badge.textContent = 'Milestone';
      name.appendChild(badge);
    }
    const desc = document.createElement('div');
    desc.className = 'upgrade-desc';
    desc.textContent = u.description;

    const evoInfo = document.createElement('div');
    evoInfo.className = 'upgrade-evo-info';
    evoInfo.style.display = 'none';
    this.evoInfoById.set(u.id, evoInfo);

    const meta = document.createElement('div');
    meta.className = 'upgrade-meta';
    const level = document.createElement('span');
    level.className = 'upgrade-level';
    level.textContent = 'Level 0';
    const bonus = document.createElement('span');
    bonus.className = 'upgrade-bonus';
    bonus.textContent = formatEffectBonus(u, 0);
    const delta = document.createElement('span');
    delta.className = 'upgrade-delta';
    delta.textContent = formatNextDelta(u);
    this.deltaById.set(u.id, delta);
    meta.appendChild(level);
    meta.appendChild(bonus);
    meta.appendChild(delta);
    // §12.2: shots-to-kill against this wave's Grunt, before → after.
    const stk = document.createElement('div');
    stk.className = 'upgrade-stk';
    stk.style.display = 'none';
    this.stkById.set(u.id, stk);
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(evoInfo);
    info.appendChild(meta);
    info.appendChild(stk);
    row.appendChild(info);

    const action = document.createElement('div');
    action.className = 'card-action upgrade-action';
    const cost = document.createElement('div');
    cost.className = 'card-cost upgrade-cost';
    cost.textContent = '0';
    const levels = document.createElement('div');
    levels.className = 'upgrade-cost-levels';
    levels.style.display = 'none';
    const btn = document.createElement('button');
    btn.className = 'btn btn-buy';
    btn.type = 'button';
    btn.textContent = 'Buy';
    btn.disabled = true;
    btn.addEventListener('click', () => this.onBuy(u.id, this.effectiveAmount()));
    action.appendChild(cost);
    action.appendChild(levels);
    action.appendChild(btn);
    row.appendChild(action);

    this.levelsById.set(u.id, levels);
    this.costById.set(u.id, cost);
    this.levelById.set(u.id, level);
    this.bonusById.set(u.id, bonus);
    this.buttonById.set(u.id, btn);
    return row;
  }
}
