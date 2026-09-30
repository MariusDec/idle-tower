import type { GameState } from '../types';
import type { PrestigePerkDef } from '../data/prestige';
import {
  AP_PERKS,
  ASCENSION_UNLOCK_WAVE,
  BASE_IDLE_TIME_SECONDS,
  apForWave,
  perkCost,
  computePerkEffect,
  describeAPPerkBonus,
  formatIdleDuration,
} from '../data/prestige';
import { formatNumber } from '../utils/bigNumber';
import {
  CORES,
  DEFAULT_CORE,
  describeCoreStats,
  type CoreDef,
  type CoreId,
} from '../data/cores';
import { setStyle, setText, toggleClass, setDisplay } from '../utils/dom';
import { renderIcon } from './Icon';

/**
 * What the panel needs to know about cores (plan §6.2).
 *
 * A flat snapshot rather than the manager, so the panel stays a renderer and
 * the three lifetimes (`unlocked` permanent, `selected` run-scoped) are
 * resolved by whoever owns them.
 */
export interface CorePanelState {
  selected: CoreId;
  unlocked: readonly CoreId[];
  /** Whether switching is offered at all — false before the first ascension. */
  pickerAvailable: boolean;
}

export interface PrestigePanelHandlers {
  onAscend: () => void;
  /** progress.md §6.2: ascend and restart at a stored checkpoint. */
  onDeploy: () => void;
  /** The wave a deploy would land on right now, or null when unavailable. */
  deployTargetWave: () => number | null;
  onSpend: (perkId: string) => void;
  canAscend: (wave: number) => boolean;
  canSpend: (perkId: string, ap: number, tp: number) => boolean;
  previewAP: (wave: number) => number;
  ascendUnlockWave: number;
  /** Plan §3.2: AP perks now have prerequisites and exclusive pairs. */
  perkBlockedReason: (perkId: string) => string | null;
  /** Plan §6.2: cores are an AP spend, chosen only at the start of a run. */
  coreState: () => CorePanelState;
  onUnlockCore: (id: CoreId) => void;
  /** prestige-abs §6.1: refund every AP spent on perks. Confirmed by `Game`. */
  onReforge: () => void;
  /** AP a reforge would credit back right now. */
  reforgeValue: () => number;
}

/**
 * Headings for the AP tiers (prestige-abs §6.2). Named rather than numbered:
 * "Tier 2" tells a player nothing, "The Long Game" tells them what the row
 * above bought them access to.
 */
const AP_TIER_TITLES: Record<number, string> = {
  1: 'Foundations',
  2: 'Specialisation',
  3: 'Signature Shots',
  4: 'The Deep Run',
};

export class PrestigePanel {
  private readonly handlers: PrestigePanelHandlers;
  private root: HTMLElement | null = null;

  private summaryAP!: HTMLElement;
  private reforgeTextEl: HTMLElement | null = null;
  private reforgeBtnEl: HTMLButtonElement | null = null;
  private summaryLifetimeAP!: HTMLElement;
  private summaryLifetimeBonus!: HTMLElement;
  private summaryAscensions!: HTMLElement;
  private summaryHighestWave!: HTMLElement;

  private ascendCard!: HTMLElement;
  private ascendStatus!: HTMLElement;
  private ascendUnlockLine!: HTMLElement;
  private ascendPreview!: HTMLElement;
  private ascendBtn!: HTMLButtonElement;
  private deployBtn!: HTMLButtonElement;

  private apRowById = new Map<string, HTMLElement>();
  private apLevelById = new Map<string, HTMLElement>();
  private apCurrentById = new Map<string, HTMLElement>();
  private apBonusById = new Map<string, HTMLElement>();
  private apCostById = new Map<string, HTMLElement>();
  private apBtnById = new Map<string, HTMLButtonElement>();
  private apReasonById = new Map<string, HTMLElement>();
  private coreRowById = new Map<CoreId, HTMLElement>();
  private coreStatusById = new Map<CoreId, HTMLElement>();
  private coreBtnById = new Map<CoreId, HTMLButtonElement>();

  constructor(handlers: PrestigePanelHandlers) {
    this.handlers = handlers;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.clearMaps();
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    const ap = state.resources.ascensionPoints;
    const lifetimeAP = state.resources.lifetimeAP;
    const ascensions = state.stats.ascensions;
    const highestWave = state.wave.highestWave;
    const previewAP = this.handlers.previewAP(highestWave);
    const canAscend = this.handlers.canAscend(highestWave);

    setText(this.summaryAP, formatNumber(ap));
    setText(this.summaryLifetimeAP, formatNumber(lifetimeAP));
    const lifetimeBonusPct = (lifetimeAP * 0.02 * 100).toFixed(0);
    setText(this.summaryLifetimeBonus, `+${lifetimeBonusPct}% dmg / gold`);
    setText(this.summaryAscensions, formatNumber(ascensions));
    setText(this.summaryHighestWave, formatNumber(highestWave));

    this.updateAscend(canAscend, highestWave, previewAP);

    for (const p of AP_PERKS) {
      this.updateAPRow(p, ap, state);
    }

    const refund = this.handlers.reforgeValue();
    if (this.reforgeTextEl) {
      setText(
        this.reforgeTextEl,
        refund > 0
          ? `Reforge refunds ${formatNumber(refund)} AP and clears every perk. Tower cores are not refunded.`
          : 'Reforge refunds every AP spent on perks. Nothing is spent yet.',
      );
    }
    if (this.reforgeBtnEl) this.reforgeBtnEl.disabled = refund <= 0;
    this.updateCores(ap);
  }

  /**
   * Refresh the core rows.
   *
   * The button is one control with two states rather than a buy button and a
   * separate select button: an unowned core is bought here, and an owned one
   * cannot be run from the panel at all — the active core only changes at the
   * start of a run, via the picker, so an unlocked row's action is hidden and
   * its status carries the state instead.
   */
  private updateCores(ap: number): void {
    const cs = this.handlers.coreState();
    for (const def of CORES) {
      const row = this.coreRowById.get(def.id);
      const status = this.coreStatusById.get(def.id);
      const btn = this.coreBtnById.get(def.id);
      if (!row || !status || !btn) continue;
      const unlocked = cs.unlocked.includes(def.id);
      const current = cs.selected === def.id;
      toggleClass(row, 'is-core-locked', !unlocked);
      toggleClass(row, 'is-core-current', current);

      if (current) {
        setText(status, 'Running this run');
        setDisplay(btn, 'none');
      } else if (unlocked) {
        setText(status, 'Unlocked');
        setDisplay(btn, 'none');
      } else {
        const affordable = ap >= def.apCost;
        setText(status, `Locked — ${def.apCost} AP`);
        setText(btn, `Unlock (${def.apCost} AP)`);
        btn.disabled = !affordable;
        toggleClass(btn, 'can-afford', affordable);
        setDisplay(btn, '');
      }
    }
  }

  private updateAscend(canAscend: boolean, wave: number, preview: number): void {
    if (canAscend) {
      toggleClass(this.ascendCard, 'is-locked', false);
      toggleClass(this.ascendStatus, 'ascend-status-locked', false);
      toggleClass(this.ascendStatus, 'ascend-status-ready', true);
      setText(this.ascendStatus, 'Ascension is available.');
      setDisplay(this.ascendUnlockLine, 'none');
    } else {
      toggleClass(this.ascendCard, 'is-locked', true);
      toggleClass(this.ascendStatus, 'ascend-status-locked', true);
      toggleClass(this.ascendStatus, 'ascend-status-ready', false);
      const remaining = Math.max(0, this.handlers.ascendUnlockWave - wave);
      setText(this.ascendStatus, `Reach wave ${this.handlers.ascendUnlockWave} to unlock Ascension.`);
      setDisplay(this.ascendUnlockLine, '');
      setText(this.ascendUnlockLine, `${formatNumber(remaining)} more wave${remaining === 1 ? '' : 's'} to go.`);
    }

    setText(this.ascendPreview, canAscend
      ? `Ascending now would grant ${formatNumber(preview)} AP.`
      : `At wave ${this.handlers.ascendUnlockWave} you would earn ${formatNumber(apForWave(this.handlers.ascendUnlockWave))} AP.`);
    this.ascendBtn.disabled = !canAscend;
    toggleClass(this.ascendBtn, 'can-ascend', canAscend);

    // Deploy is Ascend plus a jump, so it is never available when Ascend is
    // not, and it hides entirely until Forward Camp has been bought — a
    // disabled button with no explanation is worse than no button.
    const deployWave = this.handlers.deployTargetWave();
    const canDeploy = canAscend && deployWave !== null;
    this.deployBtn.hidden = deployWave === null && !canDeploy;
    this.deployBtn.textContent = deployWave !== null
      ? `Deploy to wave ${deployWave}`
      : 'Deploy';
    this.deployBtn.title = deployWave !== null
      ? `Ascends, then restarts at wave ${deployWave} with the gold, upgrades, abilities and blessings that run reached it with. Skipped waves pay no XP, contract progress or Watch counters.`
      : '';
    this.deployBtn.disabled = !canDeploy;
    toggleClass(this.deployBtn, 'can-ascend', canDeploy);
  }

  private updateAPRow(p: PrestigePerkDef, ap: number, state: GameState): void {
    const levelEl = this.apLevelById.get(p.id);
    const currentEl = this.apCurrentById.get(p.id);
    const bonusEl = this.apBonusById.get(p.id);
    const costEl = this.apCostById.get(p.id);
    const btn = this.apBtnById.get(p.id);
    if (!levelEl || !currentEl || !bonusEl || !costEl || !btn) return;
    const level = state.prestige.apSpent[p.id] ?? 0;
    const atMax = level >= p.maxLevel;
    const isOneTime = p.maxLevel === 1;
    const cost = atMax ? Infinity : perkCost(p, level);

    if (isOneTime) {
      setText(levelEl, atMax ? 'Unlocked' : 'Locked');
    } else {
      setText(levelEl, atMax ? `Level ${level} (max)` : `Level ${level}`);
    }

    // Plan §10.1: the idle-time perk shows the *current* cap next to its
    // level, so the row states what has already been bought, not just what
    // the next purchase adds.
    if (p.effectType === 'idle_time') {
      const capSeconds = BASE_IDLE_TIME_SECONDS + computePerkEffect(p, level);
      setText(currentEl, `Idle cap: ${formatIdleDuration(capSeconds)}`);
      setDisplay(currentEl, '');
    } else {
      setDisplay(currentEl, 'none');
    }

    setText(bonusEl, describeAPPerkBonus(p, level, atMax));
    setText(costEl, atMax ? '—' : formatNumber(cost));

    const blocked = level > 0 ? null : this.handlers.perkBlockedReason(p.id);
    const reasonEl = this.apReasonById.get(p.id);
    if (reasonEl) {
      setText(reasonEl, blocked ?? '');
      setDisplay(reasonEl, blocked ? '' : 'none');
    }
    const row = this.apRowById.get(p.id);
    if (row) toggleClass(row, 'is-perk-locked', blocked !== null);

    const canSpend = !atMax && blocked === null && ap >= cost;
    btn.disabled = !canSpend;
    toggleClass(btn, 'can-afford', canSpend);
    setText(btn, atMax
      ? (isOneTime ? 'Unlocked' : 'Maxed')
      : (isOneTime ? `Unlock (${cost} AP)` : 'Buy')
    );
  }

  private clearMaps(): void {
    this.coreRowById.clear();
    this.coreStatusById.clear();
    this.coreBtnById.clear();
    this.apRowById.clear();
    this.apLevelById.clear();
    this.apCurrentById.clear();
    this.apBonusById.clear();
    this.apCostById.clear();
    this.apBtnById.clear();
    this.apReasonById.clear();
    this.reforgeTextEl = null;
    this.reforgeBtnEl = null;
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'prestige-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Prestige';
    parent.appendChild(title);

    parent.appendChild(this.renderSummary());
    parent.appendChild(this.renderAscendCard());
    parent.appendChild(this.renderCoreList());
    parent.appendChild(this.renderAPPerksList());
  }

  private renderCoreList(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'perk-section core-section';
    const header = document.createElement('h3');
    header.className = 'perk-section-title';
    header.textContent = 'Tower Cores';
    section.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'A core changes how the tower shoots and which blessings you are offered. '
      + 'Unlocks are permanent; you can switch to another unlocked core only at the start of a run, '
      + 'and the choice lasts until you ascend.';
    section.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'perk-list core-list';
    for (const def of CORES) list.appendChild(this.renderCoreRow(def));
    section.appendChild(list);
    return section;
  }

  private renderCoreRow(def: CoreDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'perk-row core-row';
    row.dataset.coreId = def.id;
    this.coreRowById.set(def.id, row);

    const icon = document.createElement('div');
    icon.className = 'perk-icon';
    setStyle(icon, '--perk-color', def.color);
    renderIcon(icon, def.icon);
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'perk-info';
    const name = document.createElement('div');
    name.className = 'perk-name';
    name.textContent = def.name;
    const desc = document.createElement('div');
    desc.className = 'perk-desc';
    desc.textContent = `${describeCoreStats(def).join(' · ')} — ${def.shotText}`;
    const meta = document.createElement('div');
    meta.className = 'perk-meta';
    const status = document.createElement('span');
    status.className = 'perk-level';
    status.textContent = def.id === DEFAULT_CORE ? 'Unlocked' : `Locked — ${def.apCost} AP`;
    meta.appendChild(status);
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(meta);
    row.appendChild(info);
    this.coreStatusById.set(def.id, status);

    const action = document.createElement('div');
    action.className = 'perk-action';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-buy';
    btn.textContent = 'Unlock';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onUnlockCore(def.id));
    action.appendChild(btn);
    row.appendChild(action);
    this.coreBtnById.set(def.id, btn);
    return row;
  }

  private renderSummary(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'prestige-summary';
    this.summaryAP = this.addSummaryStat(wrap, 'AP', '0');
    this.summaryLifetimeAP = this.addSummaryStat(wrap, 'Lifetime AP', '0');
    this.summaryLifetimeBonus = this.addSummaryStat(wrap, 'Lifetime AP Bonus', '+0% dmg / gold');
    this.summaryAscensions = this.addSummaryStat(wrap, 'Ascensions', '0');
    this.summaryHighestWave = this.addSummaryStat(wrap, 'Highest wave', '0');
    return wrap;
  }

  private addSummaryStat(parent: HTMLElement, label: string, initial: string): HTMLElement {
    const stat = document.createElement('div');
    stat.className = 'prestige-stat';
    const labelEl = document.createElement('div');
    labelEl.className = 'prestige-stat-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'prestige-stat-value';
    valueEl.textContent = initial;
    stat.appendChild(labelEl);
    stat.appendChild(valueEl);
    parent.appendChild(stat);
    return valueEl;
  }

  private renderAscendCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'ascend-card is-locked';
    this.ascendCard = card;

    const header = document.createElement('div');
    header.className = 'ascend-card-header';
    const headTitle = document.createElement('div');
    headTitle.className = 'ascend-card-title';
    headTitle.textContent = 'Ascension';
    const headHint = document.createElement('div');
    headHint.className = 'ascend-card-hint';
    headHint.textContent = `Unlocks at wave ${ASCENSION_UNLOCK_WAVE}. Resets your run for permanent AP perks.`;
    header.appendChild(headTitle);
    header.appendChild(headHint);
    card.appendChild(header);

    const status = document.createElement('div');
    status.className = 'ascend-status ascend-status-locked';
    this.ascendStatus = status;
    status.textContent = `Reach wave ${ASCENSION_UNLOCK_WAVE} to unlock Ascension.`;
    card.appendChild(status);

    const unlockLine = document.createElement('div');
    unlockLine.className = 'ascend-unlock-line';
    this.ascendUnlockLine = unlockLine;
    card.appendChild(unlockLine);

    const preview = document.createElement('div');
    preview.className = 'ascend-preview';
    this.ascendPreview = preview;
    card.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'ascend-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-ascend';
    btn.textContent = 'Ascend';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onAscend());
    this.ascendBtn = btn;
    const deployBtn = document.createElement('button');
    deployBtn.type = 'button';
    deployBtn.className = 'btn btn-ascend btn-deploy';
    deployBtn.textContent = 'Deploy';
    deployBtn.disabled = true;
    deployBtn.addEventListener('click', () => this.handlers.onDeploy());
    this.deployBtn = deployBtn;

    const note = document.createElement('div');
    note.className = 'ascend-warning';
    note.textContent = 'Resets gold, mana, upgrades, current wave, and any unspent research. Keeps spent AP perks, spent research unlocks (until Transcendence), lifetime AP, and stats.';
    actions.appendChild(btn);
    actions.appendChild(deployBtn);
    actions.appendChild(note);
    card.appendChild(actions);

    return card;
  }

  private renderAPPerksList(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'perk-section';
    const header = document.createElement('h3');
    header.className = 'perk-section-title';
    header.textContent = 'Ascension Perks';
    section.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'Spend AP to permanently strengthen your tower. Effects apply for the rest of the run and stack with upgrades.';
    section.appendChild(intro);

    section.appendChild(this.renderReforgeRow());

    // prestige-abs §6.2: nineteen rows in one flat list is unreadable, so the
    // shelf is grouped by the `tier` the defs already carry — the same shape
    // `TranscendencePanel` uses for its branches. The tier is what the
    // prerequisites are expressed in, so grouping by it is also what makes the
    // "Requires A or B" lines read as a tree rather than as a list of numbers.
    const tiers = new Map<number, PrestigePerkDef[]>();
    for (const p of AP_PERKS) {
      const t = p.tier ?? 1;
      if (!tiers.has(t)) tiers.set(t, []);
      tiers.get(t)!.push(p);
    }
    for (const [tier, perks] of Array.from(tiers.entries()).sort((a, b) => a[0] - b[0])) {
      const group = document.createElement('div');
      group.className = `perk-tier perk-tier--${tier}`;
      const tierHeader = document.createElement('h4');
      tierHeader.className = 'perk-tier-title';
      tierHeader.textContent = AP_TIER_TITLES[tier] ?? `Tier ${tier}`;
      group.appendChild(tierHeader);
      const list = document.createElement('div');
      list.className = 'perk-list';
      for (const p of perks) list.appendChild(this.renderAPPerkRow(p));
      group.appendChild(list);
      section.appendChild(group);
    }
    return section;
  }

  /**
   * The Reforge control (prestige-abs §6.1).
   *
   * Free and confirmed rather than taxed: a fee on a respec is a tax on
   * experimenting, which is the thing the widened tier-1 shelf exists to buy.
   */
  private renderReforgeRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'perk-reforge';

    const text = document.createElement('div');
    text.className = 'perk-reforge-text';
    this.reforgeTextEl = text;
    wrap.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Reforge';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onReforge());
    this.reforgeBtnEl = btn;
    wrap.appendChild(btn);
    return wrap;
  }

  private renderAPPerkRow(p: PrestigePerkDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'perk-row';
    row.dataset.apPerk = p.id;
    this.apRowById.set(p.id, row);

    const icon = document.createElement('div');
    icon.className = 'perk-icon';
    setStyle(icon, '--perk-color', p.color);
    renderIcon(icon, p.icon);
    row.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'perk-info';
    const name = document.createElement('div');
    name.className = 'perk-name';
    name.textContent = p.name;
    const desc = document.createElement('div');
    desc.className = 'perk-desc';
    desc.textContent = p.description;
    const meta = document.createElement('div');
    meta.className = 'perk-meta';
    const level = document.createElement('span');
    level.className = 'perk-level';
    level.textContent = p.maxLevel === 1 ? 'Locked' : 'Level 0';
    const current = document.createElement('span');
    current.className = 'perk-current';
    current.textContent = '';
    current.style.display = 'none';
    const bonus = document.createElement('span');
    bonus.className = 'perk-bonus';
    bonus.textContent = '';
    meta.appendChild(level);
    meta.appendChild(current);
    meta.appendChild(bonus);
    const reason = document.createElement('div');
    reason.className = 'perk-reason';
    reason.style.display = 'none';
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(meta);
    info.appendChild(reason);
    row.appendChild(info);
    this.apReasonById.set(p.id, reason);

    const action = document.createElement('div');
    action.className = 'perk-action';
    const cost = document.createElement('div');
    cost.className = 'perk-cost';
    cost.textContent = '0';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-buy';
    btn.textContent = p.maxLevel === 1 ? 'Unlock' : 'Buy';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onSpend(p.id));
    action.appendChild(cost);
    action.appendChild(btn);
    row.appendChild(action);

    this.apLevelById.set(p.id, level);
    this.apCurrentById.set(p.id, current);
    this.apBonusById.set(p.id, bonus);
    this.apCostById.set(p.id, cost);
    this.apBtnById.set(p.id, btn);
    return row;
  }
}
