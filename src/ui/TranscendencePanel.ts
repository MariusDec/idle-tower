import type { GameState } from '../types';
import type { PrestigePerkDef, AutomationKey, TPBranch } from '../data/prestige';
import {
  TP_PERKS,
  TRANSCENDENCE_UNLOCK_AP,
  tpForAP,
  ASCENSION_UNLOCK_WAVE,
  perkCost,
  computePerkEffect,
} from '../data/prestige';
import { formatNumber } from '../utils/bigNumber';

export interface TranscendencePanelHandlers {
  onTranscend: () => void;
  onSpend: (perkId: string) => void;
  onToggleAutomation: (key: AutomationKey, enabled: boolean) => void;
  onTargetWaveChange: (wave: number) => void;
  canTranscend: (ap: number) => boolean;
  canSpend: (perkId: string, ap: number, tp: number) => boolean;
  isAutomationUnlocked: (key: AutomationKey) => boolean;
  isAutomationEnabled: (key: AutomationKey) => boolean;
  meetsPrerequisites: (perkId: string) => boolean;
  isExcluded: (perkId: string) => boolean;
  previewTP: (ap: number) => number;
  transcendUnlockAP: number;
  targetAscendWave: number;
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
  private targetWaveLabel!: HTMLElement;

  private tpRowById = new Map<string, HTMLElement>();
  private tpLevelById = new Map<string, HTMLElement>();
  private tpBonusById = new Map<string, HTMLElement>();
  private tpCostById = new Map<string, HTMLElement>();
  private tpBtnById = new Map<string, HTMLButtonElement>();

  private autoSwitches: Partial<Record<AutomationKey, HTMLInputElement>> = {};
  private autoRows: Partial<Record<AutomationKey, HTMLElement>> = {};
  private autoStatusEls: Partial<Record<AutomationKey, HTMLElement>> = {};

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

    this.summaryTP.textContent = formatNumber(tp);
    this.summaryTranscendences.textContent = formatNumber(transcendences);
    this.summaryTpDamage.textContent = `+${formatNumber((this.computeTpDamage() - 1) * 100)}%`;
    this.summaryTpResource.textContent = `+${formatNumber((this.computeTpResource() - 1) * 100)}%`;

    this.updateTranscend(canTranscend, ap, previewTP);

    for (const p of TP_PERKS) {
      this.updateTPRow(p, tp, state);
    }

    const autoKeys: AutomationKey[] = ['autoBuy', 'autoAbilities', 'autoAscend', 'autoTranscend'];
    for (const key of autoKeys) {
      this.updateAutomationRow(key);
    }
  }

  private updateTranscend(canTranscend: boolean, ap: number, preview: number): void {
    if (canTranscend) {
      this.transcendCard.classList.remove('is-locked');
      this.transcendStatus.classList.remove('transcend-status-locked');
      this.transcendStatus.classList.add('transcend-status-ready');
      this.transcendStatus.textContent = 'Transcendence is available.';
      this.transcendUnlockLine.style.display = 'none';
    } else {
      this.transcendCard.classList.add('is-locked');
      this.transcendStatus.classList.add('transcend-status-locked');
      this.transcendStatus.classList.remove('transcend-status-ready');
      const remaining = Math.max(0, this.handlers.transcendUnlockAP - ap);
      this.transcendStatus.textContent = `Reach ${formatNumber(this.handlers.transcendUnlockAP)} AP to unlock Transcendence.`;
      this.transcendUnlockLine.style.display = '';
      this.transcendUnlockLine.textContent = `${formatNumber(remaining)} more AP to go.`;
    }

    this.transcendPreview.textContent = canTranscend
      ? `Transcending now would grant ${formatNumber(preview)} TP.`
      : `At ${formatNumber(this.handlers.transcendUnlockAP)} AP you would earn ${formatNumber(tpForAP(this.handlers.transcendUnlockAP))} TP.`;
    this.transcendBtn.disabled = !canTranscend;
    this.transcendBtn.classList.toggle('can-transcend', canTranscend);

    this.targetWaveLabel.textContent = `Auto-Ascend target wave: ${this.handlers.targetAscendWave}`;
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

    row.classList.toggle('tp-node--locked', !prereqMet && level === 0);
    row.classList.toggle('tp-node--excluded', excluded && level === 0);
    row.classList.toggle('tp-node--purchased', level > 0);
    row.setAttribute('data-tp-level', String(level));

    levelEl.textContent = excluded && level === 0
      ? 'Blocked'
      : atMax
        ? (isOneTime ? 'Unlocked' : `Level ${level} (max)`)
        : !prereqMet && level === 0
          ? 'Locked'
          : (isOneTime ? (level > 0 ? 'Unlocked' : 'Available') : `Level ${level}`);

    if (p.effectType === 'damage_mult' || p.effectType === 'resource_mult'
      || p.effectType === 'fire_rate_mult' || p.effectType === 'crit_damage_mult'
      || p.effectType === 'mana_regen_mult') {
      bonusEl.textContent = level > 0
        ? `+${(computePerkEffect(p, level) * 100).toFixed(0)}%`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% per level`;
    } else if (p.effectType === 'treasure_chance') {
      bonusEl.textContent = level > 0
        ? `${(computePerkEffect(p, level) * 100).toFixed(0)}% chance`
        : `+${(computePerkEffect(p, 1) * 100).toFixed(0)}% per level`;
    } else if (p.effectType === 'start_gold') {
      bonusEl.textContent = level > 0
        ? `+${formatNumber(computePerkEffect(p, level))} gold`
        : `+${formatNumber(computePerkEffect(p, 1))} per level`;
    } else if (p.effectType === 'pierce') {
      bonusEl.textContent = level > 0
        ? `+${Math.floor(computePerkEffect(p, level))} pierce`
        : '+1 per 2 levels';
    } else if (p.effectType === 'wave_start') {
      bonusEl.textContent = level > 0
        ? `Start wave ${computePerkEffect(p, level)}`
        : `+${computePerkEffect(p, 1)} per level`;
    } else if (p.effectType === 'auto_buy_speed') {
      bonusEl.textContent = level > 0
        ? `-${level}s interval`
        : '-1s per level';
    } else {
      bonusEl.textContent = '';
    }
    costEl.textContent = atMax ? '—' : formatNumber(cost);
    const canSpend = !atMax && !excluded && prereqMet && tp >= cost;
    btn.disabled = !canSpend;
    btn.classList.toggle('can-afford', canSpend);
    btn.textContent = excluded && level === 0
      ? 'Blocked'
      : atMax
        ? (isOneTime ? 'Unlocked' : 'Maxed')
        : (isOneTime ? `Unlock (${cost} TP)` : 'Buy');
  }

  private updateAutomationRow(key: AutomationKey): void {
    const row = this.autoRows[key];
    const sw = this.autoSwitches[key];
    const status = this.autoStatusEls[key];
    if (!row || !sw || !status) return;
    const unlocked = this.handlers.isAutomationUnlocked(key);
    const enabled = this.handlers.isAutomationEnabled(key);
    row.classList.toggle('is-locked', !unlocked);
    row.classList.toggle('is-unlocked', unlocked);
    sw.disabled = !unlocked;
    sw.checked = unlocked && enabled;
    status.textContent = !unlocked
      ? 'Locked — purchase the matching perk to unlock'
      : enabled
      ? 'Active'
      : 'Inactive';
    status.classList.toggle('automation-status-on', unlocked && enabled);
    status.classList.toggle('automation-status-off', unlocked && !enabled);
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
    this.autoSwitches = {};
    this.autoRows = {};
    this.autoStatusEls = {};
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
    parent.appendChild(this.renderAutomationSection());
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
    headHint.textContent = `Unlocks at ${TRANSCENDENCE_UNLOCK_AP} AP. Resets EVERYTHING for permanent TP multipliers and automation.`;
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

    const targetLabel = document.createElement('div');
    targetLabel.className = 'transcend-target-line';
    this.targetWaveLabel = targetLabel;
    targetLabel.textContent = `Auto-Ascend target wave: ${this.handlers.targetAscendWave}`;
    card.appendChild(targetLabel);

    const targetRow = document.createElement('div');
    targetRow.className = 'transcend-target-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(ASCENSION_UNLOCK_WAVE);
    input.max = '10000';
    input.step = '5';
    input.value = String(this.handlers.targetAscendWave);
    input.className = 'transcend-target-input';
    input.addEventListener('change', () => {
      const next = Math.max(ASCENSION_UNLOCK_WAVE, Math.floor(Number(input.value) || ASCENSION_UNLOCK_WAVE));
      input.value = String(next);
      this.handlers.onTargetWaveChange(next);
    });
    const inputNote = document.createElement('span');
    inputNote.className = 'transcend-target-note';
    inputNote.textContent = 'Used by auto-Ascend (requires matching perk).';
    targetRow.appendChild(input);
    targetRow.appendChild(inputNote);
    card.appendChild(targetRow);

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
      { key: 'wrath', title: 'Wrath', color: '#d04848', icon: '⚔' },
      { key: 'fortune', title: 'Fortune', color: '#3ec46d', icon: '✦' },
      { key: 'dominion', title: 'Dominion', color: '#5b8def', icon: '⚙' },
    ];

    for (const bm of branchMeta) {
      const branch = document.createElement('div');
      branch.className = `tp-branch tp-branch--${bm.key}`;

      const bHeader = document.createElement('div');
      bHeader.className = 'tp-branch-header';
      bHeader.style.setProperty('--branch-color', bm.color);
      bHeader.innerHTML = `<span class="tp-branch-icon">${bm.icon}</span> ${bm.title}`;
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
    row.setAttribute('data-tp-level', '0');
    if (p.exclusive && p.exclusive.length > 0) row.classList.add('tp-node--exclusive-choice');
    this.tpRowById.set(p.id, row);

    const icon = document.createElement('div');
    icon.className = 'perk-icon';
    icon.style.setProperty('--perk-color', p.color);
    icon.textContent = p.glyph;
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

  private renderAutomationSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'automation-section';
    const header = document.createElement('h3');
    header.className = 'perk-section-title';
    header.textContent = 'Automation';
    section.appendChild(header);

    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'Each automation requires the matching perk (AP or TP). Toggle them on once unlocked.';
    section.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'automation-list';
    const entries: Array<[AutomationKey, string, string]> = [
      ['autoBuy', 'Auto-Upgrade', 'Auto-buys the cheapest available upgrade every 10s (unlocked by Auto-Upgrader AP perk or Auto-Purchaser TP perk)'],
      ['autoAbilities', 'Auto-Cast', 'Auto-casts ready abilities when mana is sufficient'],
      ['autoAscend', 'Auto-Ascend', 'Auto-Ascends once you reach the target wave'],
      ['autoTranscend', 'Auto-Transcend', 'Auto-Transcends once 100 AP is reached'],
    ];
    for (const [key, name, desc] of entries) {
      list.appendChild(this.renderAutomationRow(key, name, desc));
    }
    section.appendChild(list);
    return section;
  }

  private renderAutomationRow(key: AutomationKey, name: string, desc: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'automation-row is-locked';
    this.autoRows[key] = row;

    const info = document.createElement('div');
    info.className = 'automation-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'automation-name';
    nameEl.textContent = name;
    const descEl = document.createElement('div');
    descEl.className = 'automation-desc';
    descEl.textContent = desc;
    const status = document.createElement('div');
    status.className = 'automation-status';
    status.textContent = 'Locked';
    this.autoStatusEls[key] = status;
    info.appendChild(nameEl);
    info.appendChild(descEl);
    info.appendChild(status);
    row.appendChild(info);

    const switchWrap = document.createElement('label');
    switchWrap.className = 'automation-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.disabled = true;
    input.addEventListener('change', () => this.handlers.onToggleAutomation(key, input.checked));
    const slider = document.createElement('span');
    slider.className = 'automation-switch-slider';
    switchWrap.appendChild(input);
    switchWrap.appendChild(slider);
    row.appendChild(switchWrap);

    this.autoSwitches[key] = input;
    return row;
  }
}
