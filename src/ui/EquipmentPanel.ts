import type { GameState, EquipmentSlot, Equipment, EquipmentStatType } from '../types';
import { EQUIPMENT_DEF_BY_ID, RARITY_COLORS, RARITY_NAMES, SLOT_ICONS } from '../data/equipment';
import { icon as iconSvg, iconFrame, setIcon } from './Icon';
import { formatNumber } from '../utils/bigNumber';
import { setText, toggleClass, setStyle, setDisplay } from '../utils/dom';

export interface EquipmentAPIDeps {
  inventory: Equipment[];
  equipped: Partial<Record<EquipmentSlot, Equipment>>;
  equip: (slot: EquipmentSlot, id: string) => boolean;
  unequip: (slot: EquipmentSlot) => boolean;
  getSellValue: (id: string) => number;
  onSell: (id: string) => void;
}

const SLOT_ORDER: EquipmentSlot[] = [
  'turret', 'bulwark', 'arsenal', 'brazier',
  'vault', 'machinery', 'banner', 'core',
];

const STAT_LABELS: Record<EquipmentStatType, string> = {
  damage_pct: 'Damage',
  fire_rate_pct: 'Fire rate',
  crit_chance_pct: 'Crit chance',
  crit_damage_pct: 'Crit damage',
  range_pct: 'Range',
  max_hp_pct: 'Max HP',
  defense_pct: 'Defense',
  armor_pct: 'Armor',
  gold_mult_pct: 'Gold',
  mana_regen_pct: 'Mana regen',
  lifesteal_pct: 'Lifesteal',
  thorns_pct: 'Thorns',
  knockback_pct: 'Knockback',
  all_damage_pct: 'All damage',
};

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  turret: 'Turret',
  bulwark: 'Bulwark',
  arsenal: 'Arsenal',
  brazier: 'Brazier',
  vault: 'Vault',
  machinery: 'Machinery',
  banner: 'Banner',
  core: 'Core',
};

const DRAG_THRESHOLD = 5;
const SCROLL_ZONE = 40;
const SCROLL_SPEED = 6;
const HOVER_DELAY_MS = 200;
/** §8.C.3: the touch route to the compare tooltip. */
const LONG_PRESS_MS = 350;

/** The tower the eight slots sit around — the sprite, not a port of `Renderer`'s painter. */
const TOWER_ICON = 'heart-tower' as const;

type SortMode = 'rarity' | 'name' | 'slot';
const RARITY_ORDER: Record<string, number> = { legendary: 4, epic: 3, rare: 2, uncommon: 1, common: 0 };
const SLOT_ORDER_INDEX: Record<EquipmentSlot, number> = {
  turret: 0, bulwark: 1, arsenal: 2, brazier: 3,
  vault: 4, machinery: 5, banner: 6, core: 7,
};

interface DragState {
  type: 'equip' | 'unequip';
  itemId: string;
  slot: EquipmentSlot;
  source: HTMLElement;
  clone: HTMLElement;
  offsetX: number;
  offsetY: number;
}

export class EquipmentPanel {
  private deps: EquipmentAPIDeps;
  private root: HTMLElement | null = null;
  private slotCards = new Map<EquipmentSlot, HTMLElement>();
  private slotIconEls = new Map<EquipmentSlot, SVGSVGElement>();
  private slotBadgeEls = new Map<EquipmentSlot, HTMLElement>();
  private slotNameEls = new Map<EquipmentSlot, HTMLElement>();
  private slotStatEls = new Map<EquipmentSlot, HTMLElement>();
  private slotUnequipBtnEls = new Map<EquipmentSlot, HTMLElement>();
  private inventoryEl!: HTMLElement;
  private inventoryRows = new Map<string, HTMLElement>();
  private dragState: DragState | null = null;
  private sortMode: SortMode = 'rarity';
  private scrollInterval: ReturnType<typeof setInterval> | null = null;
  private emptyNoteEl: HTMLElement | null = null;
  private prevInventoryIds = '';
  private prevSortMode: SortMode = 'rarity';
  private compareTooltip: HTMLElement | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** §8.C.3: the tap-to-select half of the touch route. */
  private selectedItemId: string | null = null;
  /** A drag ends in a `click`; that click must not also be read as a tap. */
  private suppressTapUntil = 0;

  constructor(deps: EquipmentAPIDeps) {
    this.deps = deps;
  }

  setDeps(deps: EquipmentAPIDeps): void {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.renderInto(parent);
  }

  private unmount(): void {
    this.cancelDrag();
    this.destroyCompareTooltip();
    this.root = null;
    this.selectedItemId = null;
    this.inventoryRows.clear();
    this.emptyNoteEl = null;
    this.prevInventoryIds = '';
    this.prevSortMode = this.sortMode;
  }

  /**
   * The touch route (§8.C.3): the drag path is `mousedown`-based and a phone
   * never sends one, so a tap selects an inventory item and a second tap on its
   * slot equips it. Selection is the same affordance the drag highlight uses.
   */
  private selectItem(itemId: string | null): void {
    this.selectedItemId = itemId;
    for (const [id, row] of this.inventoryRows) {
      toggleClass(row, 'is-selected', id === itemId);
    }
    const item = itemId ? this.deps.inventory.find(i => i.id === itemId) : undefined;
    for (const [slot, card] of this.slotCards) {
      toggleClass(card, 'eq-slot-target', !!item && item.slot === slot);
    }
  }

  private onSlotTap(slot: EquipmentSlot): void {
    if (performance.now() < this.suppressTapUntil) return;
    const itemId = this.selectedItemId;
    if (!itemId) return;
    const item = this.deps.inventory.find(i => i.id === itemId);
    this.selectItem(null);
    if (!item || item.slot !== slot) return;
    this.hideCompareTooltip();
    this.deps.equip(slot, itemId);
  }

  private onInventoryTap(itemId: string): void {
    if (performance.now() < this.suppressTapUntil) return;
    this.selectItem(this.selectedItemId === itemId ? null : itemId);
  }

  private cancelDrag(): void {
    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }
    if (!this.dragState) return;
    document.removeEventListener('mousemove', this.onDragMove);
    document.removeEventListener('mouseup', this.onDragEnd);
    this.dragState.clone.remove();
    this.dragState.source.classList.remove('eq-dragging');
    document.body.classList.remove('eq-dragging');
    for (const card of this.slotCards.values()) {
      card.classList.remove('eq-drag-over');
    }
    this.inventoryEl?.classList.remove('eq-drag-over');
    this.dragState = null;
  }

  private ensureCompareTooltip(): void {
    if (this.compareTooltip) return;
    const el = document.createElement('div');
    el.className = 'eq-compare-tooltip';
    el.style.display = 'none';
    document.body.appendChild(el);
    this.compareTooltip = el;
  }

  private showCompareTooltip(item: Equipment, anchor: HTMLElement): void {
    this.ensureCompareTooltip();
    const tooltip = this.compareTooltip!;
    const equipped = this.deps.equipped[item.slot];
    tooltip.textContent = '';
    tooltip.appendChild(this.buildCompareBody(item, equipped));
    tooltip.style.display = 'block';
    tooltip.style.visibility = 'hidden';
    this.positionCompareTooltip(anchor);
    void tooltip.offsetHeight;
    tooltip.style.visibility = '';
    tooltip.classList.add('is-visible');
  }

  private hideCompareTooltip(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (this.compareTooltip) {
      this.compareTooltip.classList.remove('is-visible');
      const el = this.compareTooltip;
      setTimeout(() => { el.style.display = 'none'; }, 120);
    }
  }

  private destroyCompareTooltip(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    if (this.longPressTimer !== null) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    if (this.compareTooltip) {
      this.compareTooltip.remove();
      this.compareTooltip = null;
    }
  }

  private positionCompareTooltip(anchor: HTMLElement): void {
    const tooltip = this.compareTooltip!;
    const rect = anchor.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const vw = window.innerWidth;
    let left = rect.left - gap - tipRect.width;
    if (left < margin) {
      left = rect.right + gap;
    }
    let top = rect.top + rect.height / 2 - tipRect.height / 2;
    top = Math.max(margin, Math.min(window.innerHeight - tipRect.height - margin, top));
    left = Math.max(margin, Math.min(vw - tipRect.width - margin, left));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  /**
   * The compare tooltip, built as DOM rather than markup.
   *
   * §8.C.2: the rarity tint arrives through `iconFrame(..., { variant: 'item',
   * rarity })` and a `data-rarity` attribute the stylesheet reads, so the badge
   * and the name no longer carry an inline colour — §0.3 rule 4.
   */
  private buildCompareBody(inventory: Equipment, equipped: Equipment | undefined): HTMLElement {
    const eqStatMap = new Map<string, number>();
    if (equipped) {
      for (const s of equipped.stats) eqStatMap.set(s.type, s.value);
    }
    const invStatMap = new Map<string, number>();
    for (const s of inventory.stats) invStatMap.set(s.type, s.value);
    const allTypes = new Set([...invStatMap.keys(), ...eqStatMap.keys()]);

    const appendStats = (
      host: HTMLElement,
      statMap: Map<string, number>,
      otherMap: Map<string, number>,
    ): void => {
      for (const type of allTypes) {
        const label = STAT_LABELS[type as EquipmentStatType] ?? type.replace(/_pct$/, '');
        const myVal = statMap.get(type);
        const otherVal = otherMap.get(type);
        const row = document.createElement('div');
        row.className = 'eq-compare-stat-row';
        const name = document.createElement('span');
        name.textContent = label;
        const value = document.createElement('span');
        if (myVal === undefined) {
          value.className = 'stat-missing';
          value.textContent = '—';
        } else {
          value.textContent = `+${myVal}%`;
          if (otherVal === undefined || myVal > otherVal) value.className = 'stat-better';
          else if (myVal < otherVal) value.className = 'stat-worse';
        }
        row.append(name, value);
        host.appendChild(row);
      }
    };

    const buildCard = (
      label: string,
      item: Equipment | undefined,
      statMap: Map<string, number>,
      otherMap: Map<string, number>,
    ): HTMLElement => {
      const card = document.createElement('div');
      card.className = 'eq-compare-card';

      const slotLabel = document.createElement('div');
      slotLabel.className = 'eq-compare-slot-label';
      slotLabel.textContent = label;
      card.appendChild(slotLabel);

      if (!item) {
        const empty = document.createElement('div');
        empty.className = 'eq-compare-empty';
        empty.textContent = 'Slot empty';
        card.appendChild(empty);
        return card;
      }

      card.dataset.rarity = item.rarity;

      const def = EQUIPMENT_DEF_BY_ID[item.defId];
      const row = document.createElement('div');
      row.className = 'eq-compare-item-row';
      row.appendChild(iconFrame(def?.icon ?? SLOT_ICONS[item.slot], {
        variant: 'item',
        rarity: item.rarity,
        className: 'eq-compare-icon',
      }));

      const info = document.createElement('div');
      info.className = 'eq-compare-item-info';
      const badge = document.createElement('span');
      badge.className = 'eq-compare-rarity-badge';
      badge.textContent = RARITY_NAMES[item.rarity];
      const name = document.createElement('span');
      name.className = 'eq-compare-name';
      name.textContent = def?.name ?? item.defId;
      info.append(badge, name);
      row.appendChild(info);
      card.appendChild(row);

      const stats = document.createElement('div');
      stats.className = 'eq-compare-card-stats';
      appendStats(stats, statMap, otherMap);
      card.appendChild(stats);
      return card;
    };

    const body = document.createElement('div');
    body.className = 'eq-compare-body';
    body.appendChild(buildCard('Inventory', inventory, invStatMap, eqStatMap));
    const vs = document.createElement('div');
    vs.className = 'eq-compare-vs';
    vs.textContent = 'VS';
    body.appendChild(vs);
    body.appendChild(buildCard('Equipped', equipped, eqStatMap, invStatMap));
    return body;
  }

  update(_state: GameState): void {
    if (!this.root) return;
    this.updateSlots();
    this.updateInventory();
  }

  private updateSlots(): void {
    for (const slot of SLOT_ORDER) {
      const card = this.slotCards.get(slot);
      const iconEl = this.slotIconEls.get(slot);
      const badgeEl = this.slotBadgeEls.get(slot);
      const nameEl = this.slotNameEls.get(slot);
      const statEl = this.slotStatEls.get(slot);
      const unequipBtn = this.slotUnequipBtnEls.get(slot);
      if (!card || !iconEl || !badgeEl || !nameEl || !statEl || !unequipBtn) continue;

      const eq = this.deps.equipped[slot];
      const def = eq ? EQUIPMENT_DEF_BY_ID[eq.defId] : null;

      if (def && eq) {
        const color = RARITY_COLORS[eq.rarity];
        toggleClass(card, 'eq-empty', false);
        setStyle(card, '--eq-rarity-color', color);
        setStyle(card, 'border-color', color);
        setIcon(iconEl, def.icon);
        setText(badgeEl, RARITY_NAMES[eq.rarity]);
        setStyle(badgeEl, 'background', color);
        setText(nameEl, def.name);
        setStyle(nameEl, 'color', color);
        const existing = statEl.children;
        for (let i = 0; i < eq.stats.length; i++) {
          const s = eq.stats[i];
          const label = STAT_LABELS[s.type] ?? s.type.replace(/_pct$/, '');
          let line = existing[i] as HTMLDivElement | undefined;
          if (line) {
            setText(line, `${label} +${s.value}%`);
          } else {
            line = document.createElement('div');
            line.className = 'eq-slot-stat';
            setText(line, `${label} +${s.value}%`);
            statEl.appendChild(line);
          }
        }
        for (let i = existing.length - 1; i >= eq.stats.length; i--) {
          existing[i].remove();
        }
        card.style.cursor = 'grab';
      } else {
        toggleClass(card, 'eq-empty', true);
        setStyle(card, 'border-color', '');
        setIcon(iconEl, SLOT_ICONS[slot]);
        setText(badgeEl, '');
        setText(nameEl, SLOT_LABELS[slot]);
        setStyle(nameEl, 'color', '');
        while (statEl.firstChild) statEl.removeChild(statEl.firstChild);
        card.style.cursor = '';
      }
    }
  }

  private updateInventory(): void {
    const ids = new Set(this.deps.inventory.map(i => i.id));

    for (const [id, row] of this.inventoryRows) {
      if (!ids.has(id)) {
        row.remove();
        this.inventoryRows.delete(id);
      }
    }
    if (this.selectedItemId && !ids.has(this.selectedItemId)) {
      this.selectItem(null);
    }

    if (ids.size === 0) {
      if (!this.emptyNoteEl) {
        this.emptyNoteEl = document.createElement('p');
        this.emptyNoteEl.className = 'panel-note';
        this.emptyNoteEl.textContent = 'No equipment in inventory. Kill bosses for drops!';
        this.inventoryEl.appendChild(this.emptyNoteEl);
      }
      setDisplay(this.emptyNoteEl, '');
      return;
    }
    if (this.emptyNoteEl) {
      setDisplay(this.emptyNoteEl, 'none');
    }

    for (const item of this.deps.inventory) {
      const existing = this.inventoryRows.get(item.id);
      if (existing) {
        this.updateInventoryRow(existing, item);
      } else {
        this.inventoryRows.set(item.id, this.createInventoryRow(item));
      }
    }

    const currentIds = this.deps.inventory.map(i => i.id).join(',');
    if (currentIds === this.prevInventoryIds && this.sortMode === this.prevSortMode) return;
    this.prevInventoryIds = currentIds;
    this.prevSortMode = this.sortMode;

    const sorted = [...this.deps.inventory].sort((a, b) => {
      if (this.sortMode === 'rarity') {
        return (RARITY_ORDER[b.rarity] ?? 0) - (RARITY_ORDER[a.rarity] ?? 0);
      }
      if (this.sortMode === 'name') {
        const nameA = EQUIPMENT_DEF_BY_ID[a.defId]?.name ?? a.defId;
        const nameB = EQUIPMENT_DEF_BY_ID[b.defId]?.name ?? b.defId;
        return nameA.localeCompare(nameB);
      }
      return (SLOT_ORDER_INDEX[a.slot] ?? 0) - (SLOT_ORDER_INDEX[b.slot] ?? 0);
    });

    for (const item of sorted) {
      const row = this.inventoryRows.get(item.id);
      if (row) this.inventoryEl.appendChild(row);
    }
  }

  private updateInventoryRow(row: HTMLElement, item: Equipment): void {
    const rarityColor = RARITY_COLORS[item.rarity];
    setStyle(row, '--eq-rarity-color', rarityColor);
    setStyle(row, 'border-color', rarityColor);

    const def = EQUIPMENT_DEF_BY_ID[item.defId];
    const name = def?.name ?? item.defId;

    const icon = row.querySelector('.eq-inv-card-icon') as SVGSVGElement | null;
    setIcon(icon, def?.icon ?? SLOT_ICONS[item.slot]);

    const rarityBadge = row.querySelector('.eq-inv-rarity-badge') as HTMLElement;
    if (rarityBadge) {
      setText(rarityBadge, RARITY_NAMES[item.rarity]);
      setStyle(rarityBadge, 'background', rarityColor);
    }

    const nameEl = row.querySelector('.eq-inv-card-name') as HTMLElement;
    if (nameEl) {
      setText(nameEl, name);
      setStyle(nameEl, 'color', rarityColor);
    }

    const statsEl = row.querySelector('.eq-inv-card-stats');
    if (statsEl) {
      const existing = statsEl.querySelectorAll('.eq-inv-card-stat');
      const stats = item.stats;
      for (let i = 0; i < stats.length; i++) {
        let line = existing[i] as HTMLDivElement | undefined;
        if (line) {
          const label = STAT_LABELS[stats[i].type] ?? stats[i].type.replace(/_pct$/, '');
          setText(line, `${label} +${stats[i].value}%`);
        } else {
          line = document.createElement('div');
          toggleClass(line, 'eq-inv-card-stat', true);
          const label = STAT_LABELS[stats[i].type] ?? stats[i].type.replace(/_pct$/, '');
          setText(line, `${label} +${stats[i].value}%`);
          statsEl.appendChild(line);
        }
      }
      for (let i = existing.length - 1; i >= stats.length; i--) {
        existing[i].remove();
      }
    }

    const sellBtn = row.querySelector('.btn.btn-sell') as HTMLElement;
    if (sellBtn) setText(sellBtn, `Sell (${formatNumber(this.deps.getSellValue(item.id))}g)`);
  }

  private createInventoryRow(item: Equipment): HTMLElement {
    const card = document.createElement('div');
    card.className = 'eq-inv-card';
    card.dataset.eqId = item.id;
    const rarityColor = RARITY_COLORS[item.rarity];
    setStyle(card, '--eq-rarity-color', rarityColor);
    setStyle(card, 'border-color', rarityColor);

    const def = EQUIPMENT_DEF_BY_ID[item.defId];
    const name = def?.name ?? item.defId;

    const icon = iconSvg(def?.icon ?? SLOT_ICONS[item.slot], { className: 'eq-inv-card-icon' });
    card.appendChild(icon);

    const rarityBadge = document.createElement('div');
    rarityBadge.className = 'eq-inv-rarity-badge';
    setText(rarityBadge, RARITY_NAMES[item.rarity]);
    setStyle(rarityBadge, 'background', rarityColor);
    card.appendChild(rarityBadge);

    const nameEl = document.createElement('div');
    nameEl.className = 'eq-inv-card-name';
    nameEl.textContent = name;
    setStyle(nameEl, 'color', rarityColor);
    card.appendChild(nameEl);

    const statsEl = document.createElement('div');
    statsEl.className = 'eq-inv-card-stats';
    for (const stat of item.stats) {
      const statLine = document.createElement('div');
      statLine.className = 'eq-inv-card-stat';
      const label = STAT_LABELS[stat.type] ?? stat.type.replace(/_pct$/, '');
      statLine.textContent = `${label} +${stat.value}%`;
      statsEl.appendChild(statLine);
    }
    card.appendChild(statsEl);

    const actions = document.createElement('div');
    actions.className = 'eq-inv-card-actions';

    const equipBtn = document.createElement('button');
    equipBtn.type = 'button';
    equipBtn.className = 'btn btn-buy';
    equipBtn.textContent = 'Equip';
    equipBtn.addEventListener('click', () => {
      this.hideCompareTooltip();
      this.selectItem(null);
      this.deps.equip(item.slot, item.id);
    });
    equipBtn.addEventListener('mouseenter', () => {
      if (this.longPressTimer !== null) return;
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = null;
        this.showCompareTooltip(item, equipBtn);
      }, HOVER_DELAY_MS);
    });
    equipBtn.addEventListener('mouseleave', () => { this.hideCompareTooltip(); });
    actions.appendChild(equipBtn);

    const sellBtn = document.createElement('button');
    sellBtn.type = 'button';
    sellBtn.className = 'btn btn-sell';
    sellBtn.textContent = `Sell (${formatNumber(this.deps.getSellValue(item.id))}g)`;
    sellBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.deps.onSell(item.id);
    });
    actions.appendChild(sellBtn);

    card.style.cursor = 'grab';
    card.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.onDragStart(e, 'equip', item.id, item.slot, card);
    });

    // §8.C.3: tap to select, then tap the slot to equip; long-press for compare.
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.onInventoryTap(item.id);
    });
    const endLongPress = (): void => {
      if (this.longPressTimer !== null) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
      card.classList.remove('is-long-press');
      this.hideCompareTooltip();
    };
    card.addEventListener('touchstart', () => {
      this.longPressTimer = setTimeout(() => {
        this.longPressTimer = null;
        card.classList.add('is-long-press');
        this.showCompareTooltip(item, card);
      }, LONG_PRESS_MS);
    }, { passive: true });
    card.addEventListener('touchend', endLongPress);
    card.addEventListener('touchcancel', endLongPress);
    card.addEventListener('touchmove', endLongPress, { passive: true });

    card.appendChild(actions);
    this.inventoryEl.appendChild(card);
    return card;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'equipment-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Equipment';
    parent.appendChild(title);

    // §8.C.1: the eight slots sit around a central tower rather than in a flat
    // grid. The tower is the icon sprite plus CSS masonry — `Renderer`'s tower
    // painter stays on the canvas where it belongs.
    const slotsGrid = document.createElement('div');
    slotsGrid.className = 'eq-slots';
    const tower = document.createElement('div');
    tower.className = 'eq-tower';
    tower.setAttribute('aria-hidden', 'true');
    const towerBody = document.createElement('div');
    towerBody.className = 'eq-tower-body';
    towerBody.appendChild(iconSvg(TOWER_ICON, { className: 'eq-tower-icon' }));
    tower.appendChild(towerBody);
    slotsGrid.appendChild(tower);
    for (const slot of SLOT_ORDER) {
      slotsGrid.appendChild(this.renderSlotCard(slot));
    }
    parent.appendChild(slotsGrid);

    const invHeader = document.createElement('div');
    invHeader.className = 'eq-inv-header';

    const invTitle = document.createElement('h3');
    invTitle.textContent = 'Inventory';
    invHeader.appendChild(invTitle);

    const sortBar = document.createElement('div');
    sortBar.className = 'eq-sort-bar';
    for (const mode of ['rarity', 'name', 'slot'] as SortMode[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'eq-sort-btn' + (mode === this.sortMode ? ' eq-sort-active' : '');
      btn.textContent = mode === 'slot' ? 'Type' : mode.charAt(0).toUpperCase() + mode.slice(1);
      btn.addEventListener('click', () => {
        this.sortMode = mode;
        sortBar.querySelectorAll('.eq-sort-btn').forEach(b => b.classList.remove('eq-sort-active'));
        btn.classList.add('eq-sort-active');
        this.updateInventory();
      });
      sortBar.appendChild(btn);
    }
    invHeader.appendChild(sortBar);
    parent.appendChild(invHeader);

    this.inventoryEl = document.createElement('div');
    this.inventoryEl.className = 'eq-inventory';
    parent.appendChild(this.inventoryEl);
  }

  private renderSlotCard(slot: EquipmentSlot): HTMLElement {
    const card = document.createElement('div');
    card.className = 'eq-slot-card eq-empty';
    card.dataset.slot = slot;
    this.slotCards.set(slot, card);

    const icon = iconSvg(SLOT_ICONS[slot], { className: 'eq-slot-icon' });
    this.slotIconEls.set(slot, icon);
    card.appendChild(icon);

    // The text column, so the card can lay out as icon-beside-text on the
    // tower flank without the icon competing with four stacked lines.
    const body = document.createElement('div');
    body.className = 'eq-slot-body';
    card.appendChild(body);

    const badge = document.createElement('div');
    badge.className = 'eq-slot-rarity-badge';
    this.slotBadgeEls.set(slot, badge);
    body.appendChild(badge);

    const name = document.createElement('div');
    name.className = 'eq-slot-name';
    name.textContent = SLOT_LABELS[slot];
    this.slotNameEls.set(slot, name);
    body.appendChild(name);

    const stats = document.createElement('div');
    stats.className = 'eq-slot-stats';
    this.slotStatEls.set(slot, stats);
    body.appendChild(stats);

    const unequipBtn = document.createElement('button');
    unequipBtn.type = 'button';
    unequipBtn.className = 'eq-unequip-btn';
    unequipBtn.textContent = 'Unequip';
    unequipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deps.unequip(slot);
    });
    this.slotUnequipBtnEls.set(slot, unequipBtn);
    body.appendChild(unequipBtn);

    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      const eq = this.deps.equipped[slot];
      if (!eq) return;
      this.onDragStart(e, 'unequip', eq.id, slot, card);
    });

    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.onSlotTap(slot);
    });

    return card;
  }

  private onDragStart(e: MouseEvent, type: 'equip' | 'unequip', itemId: string, slot: EquipmentSlot, source: HTMLElement): void {
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragStarted = false;

    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (!dragStarted && (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD)) {
        dragStarted = true;
        const rect = source.getBoundingClientRect();
        const offsetX = startX - rect.left;
        const offsetY = startY - rect.top;

        const clone = source.cloneNode(true) as HTMLElement;
        clone.className = source.className + ' eq-drag-clone';
        clone.style.position = 'fixed';
        clone.style.width = `${rect.width}px`;
        clone.style.left = `${startX - offsetX}px`;
        clone.style.top = `${startY - offsetY}px`;
        clone.style.margin = '0';
        clone.style.pointerEvents = 'none';
        clone.style.zIndex = '10000';
        clone.style.cursor = 'grabbing';
        document.body.appendChild(clone);

        source.classList.add('eq-dragging');
        document.body.classList.add('eq-dragging');

        this.dragState = { type, itemId, slot, source, clone, offsetX, offsetY };

        if (type === 'equip') {
          const target = this.slotCards.get(slot);
          if (target) target.classList.add('eq-drag-over');
        }

        document.addEventListener('mousemove', this.onDragMove);
        document.addEventListener('mouseup', this.onDragEnd);
      }

      if (dragStarted && this.dragState) {
        this.dragState.clone.style.left = `${moveEvent.clientX - this.dragState.offsetX}px`;
        this.dragState.clone.style.top = `${moveEvent.clientY - this.dragState.offsetY}px`;
      }
    };

    const onUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);

      if (!dragStarted) return;

      // The browser fires a `click` after the mouseup that ended the drag.
      this.suppressTapUntil = performance.now() + 250;

      if (this.dragState) {
        this.dropAt(upEvent);
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private onDragMove = (e: MouseEvent): void => {
    if (!this.dragState) return;

    this.dragState.clone.style.left = `${e.clientX - this.dragState.offsetX}px`;
    this.dragState.clone.style.top = `${e.clientY - this.dragState.offsetY}px`;

    this.dragState.clone.style.display = 'none';
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    this.dragState.clone.style.display = '';

    const targetCard = this.dragState.type === 'equip'
      ? this.slotCards.get(this.dragState.slot) ?? null
      : null;

    for (const card of this.slotCards.values()) {
      if (card !== targetCard) card.classList.remove('eq-drag-over');
    }
    if (this.dragState.type === 'unequip') {
      this.inventoryEl.classList.remove('eq-drag-over');
    }

    if (targetCard) targetCard.classList.add('eq-drag-over');
    if (!elementUnder) return;

    if (this.dragState.type === 'unequip') {
      if (elementUnder.closest('.eq-inventory')) {
        this.inventoryEl.classList.add('eq-drag-over');
      }
    }

    if (this.scrollInterval) {
      clearInterval(this.scrollInterval);
      this.scrollInterval = null;
    }

    const panelEl = this.inventoryEl.parentElement;
    if (panelEl) {
      const panelRect = panelEl.getBoundingClientRect();
      if (e.clientY >= panelRect.top && e.clientY <= panelRect.bottom) {
        if (e.clientY < panelRect.top + SCROLL_ZONE) {
          this.scrollInterval = setInterval(() => {
            panelEl.scrollBy(0, -SCROLL_SPEED);
          }, 16);
        } else if (e.clientY > panelRect.bottom - SCROLL_ZONE) {
          this.scrollInterval = setInterval(() => {
            panelEl.scrollBy(0, SCROLL_SPEED);
          }, 16);
        }
      }
    }
  };

  private onDragEnd = (): void => {
    this.cancelDrag();
  };

  private dropAt(e: MouseEvent): void {
    if (!this.dragState) return;

    this.dragState.clone.style.display = 'none';
    const elementUnder = document.elementFromPoint(e.clientX, e.clientY);
    this.dragState.clone.style.display = '';

    const ds = this.dragState;
    this.cancelDrag();

    if (ds.type === 'equip') {
      const slotCard = elementUnder?.closest('.eq-slot-card') as HTMLElement | null;
      const targetSlot = slotCard?.dataset.slot as EquipmentSlot | undefined;
      if (targetSlot === ds.slot) {
        this.deps.equip(ds.slot, ds.itemId);
      }
    } else {
      if (elementUnder?.closest('.eq-inventory')) {
        this.deps.unequip(ds.slot);
      }
    }
  }
}
