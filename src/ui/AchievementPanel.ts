import { ACHIEVEMENTS, type AchievementDef, type AchievementCategory } from '../data/achievements';
import type { GameState } from '../types';
import { setText, toggleClass } from '../utils/dom';

export interface AchievementPanelHandlers {
  getProgress: (def: AchievementDef) => number;
}

const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  combat: 'Combat',
  wave: 'Waves',
  economy: 'Economy',
  prestige: 'Prestige',
  mastery: 'Mastery',
};

export class AchievementPanel {
  private root: HTMLElement | null = null;
  private cardEls = new Map<string, HTMLElement>();
  private progressEls = new Map<string, HTMLElement>();
  private readonly handlers: AchievementPanelHandlers;

  constructor(handlers: AchievementPanelHandlers) {
    this.handlers = handlers;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.cardEls.clear();
    this.progressEls.clear();
    this.renderInto(parent);
  }

  unmount(): void {
    if (this.root) {
      this.root.innerHTML = '';
      this.root = null;
    }
  }

  private renderInto(parent: HTMLElement): void {
    const header = document.createElement('h3');
    header.textContent = 'Achievements';
    header.className = 'panel-header';
    parent.appendChild(header);

    const categories: AchievementCategory[] = ['combat', 'wave', 'economy', 'prestige', 'mastery'];
    for (const cat of categories) {
      const defs = ACHIEVEMENTS.filter(a => a.category === cat);
      if (defs.length === 0) continue;

      const section = document.createElement('div');
      section.className = 'achievement-section';
      const catLabel = document.createElement('h4');
      catLabel.className = 'achievement-category';
      catLabel.textContent = CATEGORY_LABELS[cat];
      section.appendChild(catLabel);

      const grid = document.createElement('div');
      grid.className = 'achievement-grid';
      for (const def of defs) {
        grid.appendChild(this.renderCard(def));
      }
      section.appendChild(grid);
      parent.appendChild(section);
    }
  }

  private renderCard(def: AchievementDef): HTMLElement {
    const card = document.createElement('div');
    card.className = 'achievement-card';
    card.dataset.id = def.id;
    this.cardEls.set(def.id, card);

    const glyph = document.createElement('div');
    glyph.className = 'achievement-glyph';
    glyph.textContent = def.glyph;

    const info = document.createElement('div');
    info.className = 'achievement-info';
    const name = document.createElement('div');
    name.className = 'achievement-name';
    name.textContent = def.name;
    const desc = document.createElement('div');
    desc.className = 'achievement-desc';
    desc.textContent = def.description;
    const reward = document.createElement('div');
    reward.className = 'achievement-reward';
    reward.textContent = def.reward.description;
    const progress = document.createElement('div');
    progress.className = 'achievement-progress';
    this.progressEls.set(def.id, progress);

    info.appendChild(name);
    info.appendChild(desc);
    info.appendChild(reward);
    info.appendChild(progress);
    card.appendChild(glyph);
    card.appendChild(info);
    return card;
  }

  update(state: GameState): void {
    if (!this.root) return;
    for (const def of ACHIEVEMENTS) {
      const card = this.cardEls.get(def.id);
      const progressEl = this.progressEls.get(def.id);
      if (!card) continue;
      const unlocked = state.achievements?.includes(def.id) ?? false;
      toggleClass(card, 'achievement-unlocked', unlocked);
      toggleClass(card, 'achievement-locked', !unlocked);
      if (progressEl) {
        if (unlocked) {
          setText(progressEl, '✓ Complete');
        } else {
          const current = this.handlers.getProgress(def);
          const pct = Math.min(100, Math.floor((current / def.threshold) * 100));
          setText(progressEl, `${current.toLocaleString()} / ${def.threshold.toLocaleString()} (${pct}%)`);
        }
      }
    }
  }
}
