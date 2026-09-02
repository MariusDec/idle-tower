import type { GameState } from '../types';
import type { PrestigePerkDef, TPBranch } from '../data/prestige';
import {
  TP_PERKS,
  TRANSCENDENCE_UNLOCK_AP,
  tpForAP,
  perkCost,
  computePerkEffect,
} from '../data/prestige';
import { formatNumber } from '../utils/bigNumber';
import { setDataAttr, setInnerHTML, setStyle, setText, toggleClass, setDisplay } from '../utils/dom';
import { renderIcon } from './Icon';
import { FX, RARITY } from '../data/palette';

export interface TranscendencePanelHandlers {
  onTranscend: () => void;
  onSpend: (perkId: string) => void;
  canTranscend: (ap: number) => boolean;
  canSpend: (perkId: string, ap: number, tp: number) => boolean;
  meetsPrerequisites: (perkId: string) => boolean;
  isExcluded: (perkId: string) => boolean;
  previewTP: (ap: number) => number;
  transcendUnlockAP: number;
}

export class TranscendencePanel {
  private readonly handlers: TranscendencePanelHandlers;
  private root: HTMLElement | null = null;

  private summaryTP!: HTMLElement;
  private summaryTranscendences!: HTMLElement;
  private summaryTpDamage!: HTMLElement;
  private summaryTpResource!: HTMLElement;

  private transcendCard!: HTMLElement;
  private transcendStatus!: HTMLElement;
  private transcendUnlockLine!: HTMLElement;
  private transcendPreview!: HTMLElement;
  private transcendBtn!: HTMLButtonElement;

  private tpRowById = new Map<string, HTMLElement>();
  private tpLevelById = new Map<string, HTMLElement>();
  private tpBonusById = new Map<string, HTMLElement>();
  private tpCostById = new Map<string, HTMLElement>();
  private tpBtnById = new Map<string, HTMLButtonElement>();

  constructor(handlers: TranscendencePanelHandlers) {
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
    const ap = state.resources.apThisTranscendence;
    const tp = state.resources.transcendencePoints;
    const transcendences = state.stats.transcendences;
    const previewTP = this.handlers.previewTP(ap);
    const canTranscend = this.handlers.canTranscend(ap);

    setText(this.summaryTP, formatNumber(tp));
    setText(this.summaryTranscendences, formatNumber(transcendences));
    setText(this.summaryTpDamage, `+${formatNumber((this.computeTpDamage() - 1) * 100)}%`);
    setText(this.summaryTpResource, `+${formatNumber((this.computeTpResource() - 1) * 100)}%`);

    this.updateTranscend(canTranscend, ap, previewTP);

    for (const p of TP_PERKS) {
      this.updateTPRow(p, tp, state);
    }
  }

  private updateTranscend(canTranscend: boolean, ap: number, preview: number): void {
    if (canTranscend) {
      toggleClass(this.transcendCard, 'is-locked', false);
      toggleClass(this.transcendStatus, 'transcend-status-locked', false);
      toggleClass(this.transcendStatus, 'transcend-status-ready', true);
      setText(this.transcendStatus, 'Transcendence is available.');
      setDisplay(this.transcendUnlockLine, 'none');
    } else {
      toggleClass(this.transcendCard, 'is-locked', true);
      toggleClass(this.transcendStatus, 'transcend-status-locked', true);
      toggleClass(this.transcendStatus, 'transcend-status-ready', false);
      const remaining = Math.max(0, this.handlers.transcendUnlockAP - ap);
      setText(this.transcendStatus, `Reach ${formatNumber(this.handlers.transcendUnlockAP)} AP to unlock Transcendence.`);
      setDisplay(this.transcendUnlockLine, '');
      setText(this.transcendUnlockLine, `${formatNumber(remaining)} more AP to go.`);
    }

    setText(this.transcendPreview, canTranscend
      ? `Transcending now would grant ${formatNumber(preview)} TP.`
      : `At ${formatNumber(this.handlers.transcendUnlockAP)} AP you would earn ${formatNumber(tpForAP(this.handlers.transcendUnlockAP))} TP.`);
    this.transcendBtn.disabled = !canTranscend;
    toggleClass(this.transcendBtn, 'can-transcend', canTranscend);
  }

  private updateTPRow(p: PrestigePerkDef, tp: number, state: GameState): void {
    const levelEl = this.tpLevelById.get(p.id);
    const bonusEl = this.tpBonusById.get(p.id);
    const costEl = this.tpCostById.get(p.id);
    const btn = this.tpBtnById.get(p.id);
    const row = this.tpRowById.get(p.id);
    if (!levelEl || !bonusEl || !costEl || !btn || !row) return;
    const level = state.prestige.tpSpent[p.id] ?? 0;
    const atMax = level >= p.maxLevel;
    const cost = atMax ? Infinity : perkCost(p, level);
    const isOneTime = p.maxLevel === 1;
    const prereqMet = this.handlers.meetsPrerequisites(p.id);
    const excluded = this.handlers.isExcluded(p.id);

    toggleClass(row, 'tp-node--locked', !prereqMet && level === 0);
    toggleClass(row, 'tp-node--excluded', excluded && level === 0);
    toggleClass(row, 'tp-node--purchased', level > 0);
    setDataAttr(row, 'tp-level', String(level));

    setText(levelEl, excluded && level === 0
      ? 'Blocked'
      : atMax
        ? (isOneTime ? 'Unlocked' : `Level ${level} (max)`)
        : !prereqMet && level === 0
          ? 'Locked'
          : (isOneTime ? (level > 0 ? 'Unlocked' : 'Available') : `Level ${level}`));

    if (p.effectType === 'damage_mult' || p.effectType === 'resource_mult'
      || p.effectType === 'fire_rate_mult' || p.effectType === 'crit_damage_mult'
      || p.effectType === 'mana_regen_mult') {
      setText(bonusEl, level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}%`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% per level`);
    } else if (p.effectType === 'treasure_chance') {
      setText(bonusEl, level > 0
        ? `${(computePerkEffect(p, level) * 100).toFixed(0)}% chance`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% per level`);
    } else if (p.effectType === 'start_gold') {
      setText(bonusEl, level > 0
        ? `+${formatNumber(computePerkEffect(p, level))} gold`
        : `+${formatNumber(computePerkEffect(p, 1))} per level`);
    } else if (p.effectType === 'pierce') {
      setText(bonusEl, level > 0
        ? `+${Math.floor(computePerkEffect(p, level))} pierce`
        : '+1 per 2 levels');
    } else if (p.effectType === 'wave_start') {
      setText(bonusEl, level > 0
        ? `Start wave ${computePerkEffect(p, level)}`
        : `+${computePerkEffect(p, 1)} per level`);
    } else if (p.effectType === 'auto_buy_speed') {
      setText(bonusEl, level > 0
        ? `-${level}s interval`
        : '-1s per level');
    } else if (p.effectType === 'upgrade_cap') {
      setText(bonusEl, level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}% level caps`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% per level`);
    } else {
      setText(bonusEl, '');
    }
    setText(costEl, atMax ? '—' : formatNumber(cost));
    const canSpend = !atMax && !excluded && prereqMet && tp >= cost;
    btn.disabled = !canSpend;
    toggleClass(btn, 'can-afford', canSpend);
    setText(btn, excluded && level === 0
      ? 'Blocked'
      : atMax
        ? (isOneTime ? 'Unlocked' : 'Maxed')
        : (isOneTime ? `Unlock (${cost} TP)` : 'Buy'));
  }

  private computeTpDamage(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'damage_mult') continue;
      const row = this.tpRowById.get(p.id);
      const levelAttr = row?.getAttribute('data-tp-level');
      const level = levelAttr ? Number(levelAttr) : 0;
      if (level > 0) factor *= 1 + computePerkEffect(p, level);
    }
    return factor;
  }

  private computeTpResource(): number {
    let factor = 1;
    for (const p of TP_PERKS) {
      if (p.effectType !== 'resource_mult') continue;
      const row = this.tpRowById.get(p.id);
      const levelAttr = row?.getAttribute('data-tp-level');
      const level = levelAttr ? Number(levelAttr) : 0;
      if (level > 0) factor *= 1 + computePerkEffect(p, level);
    }
    return factor;
  }

  private clearMaps(): void {
    this.tpRowById.clear();
    this.tpLevelById.clear();
    this.tpBonusById.clear();
    this.tpCostById.clear();
    this.tpBtnById.clear();
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'transcendence-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Transcendence';
    parent.appendChild(title);

    parent.appendChild(this.renderSummary());
    parent.appendChild(this.renderTranscendCard());
    parent.appendChild(this.renderTPPerksList());
  }

  private renderSummary(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'prestige-summary';
    this.summaryTP = this.addSummaryStat(wrap, 'TP', '0');
    this.summaryTranscendences = this.addSummaryStat(wrap, 'Transcendences', '0');
    this.summaryTpDamage = this.addSummaryStat(wrap, 'TP Damage', '+0%');
    this.summaryTpResource = this.addSummaryStat(wrap, 'TP Resources', '+0%');
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

  private renderTranscendCard(): HTMLElement {
    const card = document.createElement('div');
    card.className = 'transcend-card is-locked';
    this.transcendCard = card;

    const header = document.createElement('div');
    header.className = 'transcend-card-header';
    const headTitle = document.createElement('div');
    headTitle.className = 'transcend-card-title';
    headTitle.textContent = 'Transcendence';
    const headHint = document.createElement('div');
    headHint.className = 'transcend-card-hint';
    headHint.textContent = `Unlocks at ${TRANSCENDENCE_UNLOCK_AP} AP. Resets gold, upgrades, ability levels, passives and the whole ascension layer for permanent TP multipliers and automation. Talents, tower XP, research, achievements and equipment carry over.`;
    header.appendChild(headTitle);
    header.appendChild(headHint);
    card.appendChild(header);

    const status = document.createElement('div');
    status.className = 'transcend-status transcend-status-locked';
    this.transcendStatus = status;
    status.textContent = `Reach ${TRANSCENDENCE_UNLOCK_AP} AP to unlock Transcendence.`;
    card.appendChild(status);

    const unlockLine = document.createElement('div');
    unlockLine.className = 'transcend-unlock-line';
    this.transcendUnlockLine = unlockLine;
    card.appendChild(unlockLine);

    const preview = document.createElement('div');
    preview.className = 'transcend-preview';
    this.transcendPreview = preview;
    card.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'transcend-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-transcend';
    btn.textContent = 'Transcend';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onTranscend());
    this.transcendBtn = btn;
    const note = document.createElement('div');
    note.className = 'transcend-warning';
    note.textContent = 'Resets gold, mana, upgrades, wave, AP, RP, spent research, and all AP perk levels. Keeps TP, spent TP perks, lifetime AP, and lifetime stats.';
    actions.appendChild(btn);
    actions.appendChild(note);
    card.appendChild(actions);

    return card;
  }

  private renderTPPerksList(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'perk-section';
    const header = document.createElement('h3');
    header.className = 'perk-section-title';
    header.textContent = 'Transcendence Skill Tree';
    section.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'Spend TP to specialize your tower. Each branch offers unique powers. Tier 4 choices are exclusive — pick one and the other is locked forever.';
    section.appendChild(intro);

    const tree = document.createElement('div');
    tree.className = 'tp-tree';

    const branchMeta: Array<{ key: TPBranch; title: string; color: string; icon: string }> = [
      { key: 'wrath', title: 'Wrath', color: FX.blood, icon: '⚔' },
      { key: 'fortune', title: 'Fortune', color: FX.nature, icon: '✦' },
      { key: 'dominion', title: 'Dominion', color: RARITY.rare, icon: '⚙' },
    ];

    for (const bm of branchMeta) {
      const branch = document.createElement('div');
      branch.className = `tp-branch tp-branch--${bm.key}`;

      const bHeader = document.createElement('div');
      bHeader.className = 'tp-branch-header';
      setStyle(bHeader, '--branch-color', bm.color);
      setInnerHTML(bHeader, `<span class="tp-branch-icon">${bm.icon}</span> ${bm.title}`);
      branch.appendChild(bHeader);

      const perks = TP_PERKS.filter(p => p.branch === bm.key);
      const tiers = new Map<number, PrestigePerkDef[]>();
      for (const p of perks) {
        const t = p.tier ?? 1;
        if (!tiers.has(t)) tiers.set(t, []);
        tiers.get(t)!.push(p);
      }
      const sortedTiers = Array.from(tiers.entries()).sort((a, b) => a[0] - b[0]);
      for (const [tier, tierPerks] of sortedTiers) {
        const tierWrap = document.createElement('div');
        tierWrap.className = `tp-tier tp-tier--${tier}`;

        const hasExclusive = tierPerks.some(p => p.exclusive && p.exclusive.length > 0);
        if (hasExclusive) {
          const badge = document.createElement('div');
          badge.className = 'tp-choice-badge';
          badge.textContent = 'CHOOSE ONE';
          tierWrap.appendChild(badge);
        }

        for (const p of tierPerks) {
          tierWrap.appendChild(this.renderTPPerkRow(p));
        }
        branch.appendChild(tierWrap);
      }

      tree.appendChild(branch);
    }

    section.appendChild(tree);
    return section;
  }

  private renderTPPerkRow(p: PrestigePerkDef): HTMLElement {
    const row = document.createElement('div');
    row.className = 'perk-row perk-row-tp tp-node';
    row.dataset.tpPerk = p.id;
    setDataAttr(row, 'tp-level', '0');
    if (p.exclusive && p.exclusive.length > 0) row.classList.add('tp-node--exclusive-choice');
    this.tpRowById.set(p.id, row);

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

    if (p.prerequisites && p.prerequisites.length > 0) {
      const prereqEl = document.createElement('div');
      prereqEl.className = 'perk-prereq';
      const prereqNames = p.prerequisites.map(req => {
        const reqDef = TP_PERKS.find(tp => tp.id === req.perkId);
        return reqDef ? `${reqDef.name} ${req.minLevel > 1 ? `Lv${req.minLevel}` : ''}` : req.perkId;
      });
      prereqEl.textContent = `Requires: ${prereqNames.join(' or ')}`;
      info.appendChild(prereqEl);
    }

    const meta = document.createElement('div');
    meta.className = 'perk-meta';
    const level = document.createElement('span');
    level.className = 'perk-level';
    level.textContent = 'Locked';
    const bonus = document.createElement('span');
    bonus.className = 'perk-bonus';
    bonus.textContent = '';
    meta.appendChild(level);
    meta.appendChild(bonus);
    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(meta);
    row.appendChild(info);

    const action = document.createElement('div');
    action.className = 'perk-action';
    const cost = document.createElement('div');
    cost.className = 'perk-cost';
    cost.textContent = '0';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-buy';
    btn.textContent = 'Unlock';
    btn.disabled = true;
    btn.addEventListener('click', () => this.handlers.onSpend(p.id));
    action.appendChild(cost);
    action.appendChild(btn);
    row.appendChild(action);

    this.tpLevelById.set(p.id, level);
    this.tpBonusById.set(p.id, bonus);
    this.tpCostById.set(p.id, cost);
    this.tpBtnById.set(p.id, btn);
    return row;
  }
}
