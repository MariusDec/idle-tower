import type { GameState } from '../types';
import type { PrestigePerkDef } from '../data/prestige';
import {
  AP_PERKS,
  ASCENSION_UNLOCK_WAVE,
  apForWave,
  perkCost,
  computePerkEffect,
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
  onSpend: (perkId: string) => void;
  canAscend: (wave: number) => boolean;
  canSpend: (perkId: string, ap: number, tp: number) => boolean;
  previewAP: (wave: number) => number;
  ascendUnlockWave: number;
  /** Plan §3.2: AP perks now have prerequisites and exclusive pairs. */
  perkBlockedReason: (perkId: string) => string | null;
  /** Plan §6.2: cores are an AP spend, and switchable between runs. */
  coreState: () => CorePanelState;
  onUnlockCore: (id: CoreId) => void;
  onSelectCore: (id: CoreId) => void;
}

export class PrestigePanel {
  private readonly handlers: PrestigePanelHandlers;
  private root: HTMLElement | null = null;

  private summaryAP!: HTMLElement;
  private summaryLifetimeAP!: HTMLElement;
  private summaryLifetimeBonus!: HTMLElement;
  private summaryAscensions!: HTMLElement;
  private summaryHighestWave!: HTMLElement;

  private ascendCard!: HTMLElement;
  private ascendStatus!: HTMLElement;
  private ascendUnlockLine!: HTMLElement;
  private ascendPreview!: HTMLElement;
  private ascendBtn!: HTMLButtonElement;

  private apRowById = new Map<string, HTMLElement>();
  private apLevelById = new Map<string, HTMLElement>();
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
    this.updateCores(ap);
  }

  /**
   * Refresh the core rows.
   *
   * The button is one control with three states rather than a buy button and a
   * separate select button, because those are the same decision at different
   * times: an unowned core is bought, an owned one is run, and the one already
   * running needs nothing. Three buttons would have meant two of them disabled
   * on every row.
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
        setText(btn, 'Active');
        btn.disabled = true;
        toggleClass(btn, 'can-afford', false);
      } else if (unlocked) {
        setText(status, 'Unlocked');
        setText(btn, 'Run this core');
        btn.disabled = false;
        toggleClass(btn, 'can-afford', true);
      } else {
        const affordable = ap >= def.apCost;
        setText(status, `Locked — ${def.apCost} AP`);
        setText(btn, `Unlock (${def.apCost} AP)`);
        btn.disabled = !affordable;
        toggleClass(btn, 'can-afford', affordable);
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
  }

  private updateAPRow(p: PrestigePerkDef, ap: number, state: GameState): void {
    const levelEl = this.apLevelById.get(p.id);
    const bonusEl = this.apBonusById.get(p.id);
    const costEl = this.apCostById.get(p.id);
    const btn = this.apBtnById.get(p.id);
    if (!levelEl || !bonusEl || !costEl || !btn) return;
    const level = state.prestige.apSpent[p.id] ?? 0;
    const atMax = level >= p.maxLevel;
    const isOneTime = p.maxLevel === 1;
    const cost = atMax ? Infinity : perkCost(p, level);

    if (isOneTime) {
      setText(levelEl, atMax ? 'Unlocked' : 'Locked');
    } else {
      setText(levelEl, atMax ? `Level ${level} (max)` : `Level ${level}`);
    }

    setText(bonusEl, this.formatAPBonusText(p, level, atMax));
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

  private formatAPBonusText(p: PrestigePerkDef, level: number, atMax: boolean): string {
    switch (p.effectType) {
      case 'extra_shots':
        return atMax
          ? `+${level} parallel projectile${level === 1 ? '' : 's'}`
          : `+1 projectile per level`;
      case 'scatter_shots':
        return atMax
          ? `+${level * 2} scatter projectile${level * 2 === 1 ? '' : 's'}`
          : `+2 projectiles per level`;
      case 'back_shots':
        return atMax
          ? `+${level} rear projectile${level === 1 ? '' : 's'}`
          : `+1 projectile per level`;
      case 'auto_buy':
        return 'Unlocks the Auto-Upgrader automation';
      case 'wave_skip':
        return atMax
          ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% wave skip chance`
          : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% wave skip chance per level`;
      case 'damage_mult':
        return level > 0
          ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% damage`
          : '';
      case 'resource_mult':
        return level > 0
          ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% gold`
          : '';
      case 'research_speed':
        return level > 0
          ? `-${(computePerkEffect(p, level) * 100).toFixed(0)}% research time`
          : '';
      default:
        return '';
    }
  }

  private clearMaps(): void {
    this.coreRowById.clear();
    this.coreStatusById.clear();
    this.coreBtnById.clear();
    this.apRowById.clear();
    this.apLevelById.clear();
    this.apBonusById.clear();
    this.apCostById.clear();
    this.apBtnById.clear();
    this.apReasonById.clear();
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
      + 'Unlocks are permanent; the choice itself lasts one run and is offered again each time you '
      + 'ascend.';
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
    btn.addEventListener('click', () => {
      const cs = this.handlers.coreState();
      if (cs.unlocked.includes(def.id)) this.handlers.onSelectCore(def.id);
      else this.handlers.onUnlockCore(def.id);
    });
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
    const note = document.createElement('div');
    note.className = 'ascend-warning';
    note.textContent = 'Resets gold, mana, upgrades, current wave, and any unspent research. Keeps spent AP perks, spent research unlocks (until Transcendence), lifetime AP, and stats.';
    actions.appendChild(btn);
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

    const list = document.createElement('div');
    list.className = 'perk-list';
    for (const p of AP_PERKS) {
      list.appendChild(this.renderAPPerkRow(p));
    }
    section.appendChild(list);
    return section;
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
    const bonus = document.createElement('span');
    bonus.className = 'perk-bonus';
    bonus.textContent = '';
    meta.appendChild(level);
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
    this.apBonusById.set(p.id, bonus);
    this.apCostById.set(p.id, cost);
    this.apBtnById.set(p.id, btn);
    return row;
  }
}
