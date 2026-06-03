import type { AbilityId, GameState } from '../types';
import type { AbilityDef } from '../data/abilities';
import { ABILITIES } from '../data/abilities';
import { formatInt } from '../utils/bigNumber';

export interface AbilityPanelHandlers {
  onCast: (id: AbilityId) => void;
  canCast: (id: AbilityId, wave: number) => boolean;
  reasonBlocked: (id: AbilityId, wave: number) => string | null;
}

export class AbilityPanel {
  private readonly handlers: AbilityPanelHandlers;
  private root: HTMLElement | null = null;
  private buttonsById = new Map<AbilityId, HTMLButtonElement>();
  private overlayById = new Map<AbilityId, HTMLElement>();
  private activeBadgeById = new Map<AbilityId, HTMLElement>();
  private labelById = new Map<AbilityId, HTMLElement>();
  private statusById = new Map<AbilityId, HTMLElement>();

  constructor(handlers: AbilityPanelHandlers) {
    this.handlers = handlers;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.buttonsById.clear();
    this.overlayById.clear();
    this.activeBadgeById.clear();
    this.labelById.clear();
    this.statusById.clear();
    this.renderInto(parent);
  }

  update(state: GameState): void {
    if (!this.root) return;
    const mana = state.resources.mana;
    for (const def of ABILITIES) {
      const btn = this.buttonsById.get(def.id);
      const overlay = this.overlayById.get(def.id);
      const badge = this.activeBadgeById.get(def.id);
      const status = this.statusById.get(def.id);
      if (!btn || !overlay || !badge || !status) continue;
      const abState = state.abilities[def.id];
      const onCd = abState.cooldown > 0;
      const reason = this.handlers.reasonBlocked(def.id, state.wave.highestWave);
      const canCast = reason === null;

      btn.disabled = !canCast;
      btn.classList.toggle('is-ready', canCast);
      btn.classList.toggle('is-cooldown', onCd);
      btn.classList.toggle('is-locked', reason === 'Locked' || (reason?.startsWith('Unlocks at') ?? false));
      btn.classList.toggle('is-active', abState.active);

      if (onCd) {
        const ratio = Math.max(0, Math.min(1, abState.cooldown / def.cooldown));
        overlay.style.height = `${ratio * 100}%`;
        overlay.style.opacity = '1';
      } else {
        overlay.style.height = '0%';
        overlay.style.opacity = '0';
      }

      if (abState.active && abState.activeTimer > 0) {
        badge.style.display = 'flex';
        badge.textContent = `${abState.activeTimer.toFixed(1)}s`;
      } else {
        badge.style.display = 'none';
      }

      if (reason) {
        status.textContent = reason;
        status.classList.add('ability-status-blocked');
      } else {
        status.textContent = `Ready · ${formatInt(mana)}/${def.manaCost} mana`;
        status.classList.remove('ability-status-blocked');
      }

      const label = this.labelById.get(def.id);
      if (label) {
        const cdTxt = onCd ? ` · ${abState.cooldown.toFixed(1)}s` : '';
        label.textContent = `${def.name}${cdTxt}`;
      }
    }
  }

  flashCast(id: AbilityId): void {
    const btn = this.buttonsById.get(id);
    if (!btn) return;
    btn.classList.add('is-flash');
    setTimeout(() => btn.classList.remove('is-flash'), 220);
  }

  private unmount(): void {
    this.root = null;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'ability-panel';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Abilities';
    parent.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'panel-note';
    intro.textContent = 'Active abilities. Spend mana to cast, then wait for the cooldown. Press the hotkey or click.';
    parent.appendChild(intro);

    const grid = document.createElement('div');
    grid.className = 'ability-grid';
    for (const def of ABILITIES) {
      grid.appendChild(this.renderCard(def));
    }
    parent.appendChild(grid);

    const footer = document.createElement('p');
    footer.className = 'panel-note';
    footer.textContent = 'Mana unlocks at wave 10. Berserk doubles fire rate. Frost Nova slows enemies. Gold Rush triples gold. Rain of Arrows hits all.';
    parent.appendChild(footer);
  }

  private renderCard(def: AbilityDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'ability-card';
    card.dataset.abilityId = def.id;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ability-btn';
    btn.style.setProperty('--ability-color', def.color);
    btn.addEventListener('click', () => this.handlers.onCast(def.id));
    btn.setAttribute('aria-label', `${def.name}, ${def.manaCost} mana, ${def.cooldown}s cooldown`);

    const overlay = document.createElement('div');
    overlay.className = 'ability-cooldown-overlay';
    btn.appendChild(overlay);

    const icon = document.createElement('div');
    icon.className = 'ability-icon';
    icon.textContent = def.glyph;
    btn.appendChild(icon);

    const hotkey = document.createElement('div');
    hotkey.className = 'ability-hotkey';
    hotkey.textContent = def.hotkey;
    btn.appendChild(hotkey);

    const badge = document.createElement('div');
    badge.className = 'ability-active-badge';
    badge.style.display = 'none';
    btn.appendChild(badge);

    const mana = document.createElement('div');
    mana.className = 'ability-mana';
    mana.textContent = `${def.manaCost}`;
    btn.appendChild(mana);

    card.appendChild(btn);

    const info = document.createElement('div');
    info.className = 'ability-info';
    const label = document.createElement('div');
    label.className = 'ability-name';
    label.textContent = def.name;
    const desc = document.createElement('div');
    desc.className = 'ability-desc';
    desc.textContent = def.description;
    const status = document.createElement('div');
    status.className = 'ability-status';
    status.textContent = 'Ready';
    info.appendChild(label);
    info.appendChild(desc);
    info.appendChild(status);
    card.appendChild(info);

    this.buttonsById.set(def.id, btn);
    this.overlayById.set(def.id, overlay);
    this.activeBadgeById.set(def.id, badge);
    this.labelById.set(def.id, label);
    this.statusById.set(def.id, status);
    return card;
  }
}
