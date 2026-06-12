import type { GameState, EquipmentSlot, Equipment, EquipmentStatType } from '../types';
import { EQUIPMENT_DEF_BY_ID, RARITY_COLORS, RARITY_NAMES } from '../data/equipment';
import { formatNumber } from '../utils/bigNumber';
import { setText, toggleClass, setStyle, setSrc, setDisplay } from '../utils/dom';

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
  private slotIconEls = new Map<EquipmentSlot, HTMLImageElement>();
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
    this.root = null;
    this.inventoryRows.clear();
    this.emptyNoteEl = null;
    this.prevInventoryIds = '';
    this.prevSortMode = this.sortMode;
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
        setSrc(iconEl, def.sprite);
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
        setSrc(iconEl, '');
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
    const rarityColor = RARITY_COLORS[item.rarity] ?? '#888';
    setStyle(row, '--eq-rarity-color', rarityColor);
    setStyle(row, 'border-color', rarityColor);

    const def = EQUIPMENT_DEF_BY_ID[item.defId];
    const name = def?.name ?? item.defId;

    const icon = row.querySelector('.eq-inv-card-icon') as HTMLImageElement;
    if (icon) setSrc(icon, def?.sprite ?? '');

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
    const rarityColor = RARITY_COLORS[item.rarity] ?? '#888';
    setStyle(card, '--eq-rarity-color', rarityColor);
    setStyle(card, 'border-color', rarityColor);

    const def = EQUIPMENT_DEF_BY_ID[item.defId];
    const name = def?.name ?? item.defId;

    const icon = document.createElement('img');
    icon.className = 'eq-inv-card-icon';
    icon.src = def?.sprite ?? '';
    icon.alt = def?.name ?? '';
    icon.draggable = false;
    card.appendChild(icon);

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
    equipBtn.addEventListener('click', () => this.deps.equip(item.slot, item.id));
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

    const slotsGrid = document.createElement('div');
    slotsGrid.className = 'eq-slots';
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

    const icon = document.createElement('img');
    icon.className = 'eq-slot-icon';
    icon.alt = '';
    icon.draggable = false;
    this.slotIconEls.set(slot, icon);
    card.appendChild(icon);

    const badge = document.createElement('div');
    badge.className = 'eq-slot-rarity-badge';
    this.slotBadgeEls.set(slot, badge);
    card.appendChild(badge);

    const name = document.createElement('div');
    name.className = 'eq-slot-name';
    name.textContent = SLOT_LABELS[slot];
    this.slotNameEls.set(slot, name);
    card.appendChild(name);

    const stats = document.createElement('div');
    stats.className = 'eq-slot-stats';
    this.slotStatEls.set(slot, stats);
    card.appendChild(stats);

    const unequipBtn = document.createElement('button');
    unequipBtn.type = 'button';
    unequipBtn.className = 'eq-unequip-btn';
    unequipBtn.textContent = 'Unequip';
    unequipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deps.unequip(slot);
    });
    this.slotUnequipBtnEls.set(slot, unequipBtn);
    card.appendChild(unequipBtn);

    card.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      const eq = this.deps.equipped[slot];
      if (!eq) return;
      this.onDragStart(e, 'unequip', eq.id, slot, card);
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
