import type { IconId } from '../data/icons';
import {
  STAT_GROUPS,
  STAT_ROW_BY_KEY,
  formatStatValue,
  type StatGroupDef,
  type StatGroupId,
  type StatRowDef,
} from '../data/statDisplay';
import type { StatKey } from '../stats/keys';
import { TARGETING_MODES } from '../data/tower';
import { CODEX_ENTRIES, type CodexEntry } from '../data/codex';
import type { GoldSourceEntry, StatsInfo } from '../types';
import { setAriaLabel, setText, toggleClass } from '../utils/dom';
import { formatNumber, formatWithOptionalDecimal } from '../utils/bigNumber';
import { renderIcon } from './Icon';
import { Modal } from './Modal';

/**
 * Fast id → entry lookup for the row "?" affordance. Built once at module
 * load (entries are static), so the row click handler never has to walk the
 * 50-entry array.
 */
const CODEX_BY_ID: ReadonlyMap<string, CodexEntry> = (() => {
  const out = new Map<string, CodexEntry>();
  for (const entry of CODEX_ENTRIES) out.set(entry.id, entry);
  return out;
})();

/** The six stat groups plus the moved-over "Sources" tab. */
type ActiveTab = StatGroupId | 'sources';

const TAB_IDS: readonly ActiveTab[] = [...STAT_GROUPS.map(g => g.id), 'sources'];

const TAB_ICONS: Record<ActiveTab, IconId> = {
  offense: 'crossed-swords',
  defense: 'bordered-shield',
  kit: 'arrow-cluster',
  economy: 'two-coins',
  magic: 'magic-swirl',
  meta: 'swords-emblem',
  sources: 'two-coins',
};

const TAB_LABELS: Record<ActiveTab, string> = {
  offense: 'Offense',
  defense: 'Defense',
  kit: 'Shot & Kit',
  economy: 'Economy',
  magic: 'Magic',
  meta: 'Run',
  sources: 'Sources',
};

const EMPTY_GROUP = 'Nothing here yet — these unlock through talents, passives and blessings.';
const EMPTY_SOURCES = 'No gold sources yet.';
const SOURCES_NOTE = 'Additive sources are summed first, then the flat multipliers apply.';

/** `?` is data, not markup, but the breakdown is `setInnerHTML` so escape it. */
function escapeText(s: string): string {
  return s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/**
 * The tower's Stats dialog (plans/stats.md Part C).
 *
 * Adopts the shared `Modal` shell so Escape, the focus trap, the backdrop and
 * the `Modal.anyOpen()` stack are inherited — the latter is what stops the
 * Space key from calling a wave while the popup is up.
 *
 * The popup rebuilds its body only on a group change or a filter toggle; on a
 * per-tick `setInfo` it walks the cached row elements and `setText`s the value
 * span, relying on the dom helper's no-op skip to keep the layout path cold.
 */
export class StatsPopup {
  private readonly modal: Modal;
  private tabsContainer!: HTMLDivElement;
  private bodyContainer!: HTMLDivElement;
  private filterCheckbox!: HTMLInputElement;

  private info: StatsInfo | null = null;
  private activeGroup: ActiveTab = TAB_IDS[0];
  private showAll = false;
  /** What the DOM currently reflects; `null` means "never rendered". */
  private renderedGroup: ActiveTab | null = null;
  private renderedShowAll = false;

  private readonly tabEls = new Map<ActiveTab, HTMLButtonElement>();
  /** Stat-row containers keyed by `data-key` (= StatKey). */
  private readonly rowEls = new Map<string, HTMLDivElement>();
  private readonly rowValueEls = new Map<string, HTMLSpanElement>();
  /** Derived-row containers keyed by `data-derived` (e.g. `derived:dps`). */
  private readonly derivedEls = new Map<string, HTMLDivElement>();
  private readonly derivedValueEls = new Map<string, HTMLSpanElement>();
  /** Closure that re-reads the current value at update time. */
  private readonly derivedGetters = new Map<string, () => string>();

  /**
   * Single floating Codex tooltip element owned by the class and reused across
   * opens. Lives on `document.body` so it sits in the modal's stacking context
   * (z-tooltip < z-modal) — the modal-card chrome stays on top, but the
   * tooltip renders above stat-row content as required.
   */
  private tooltipEl: HTMLDivElement | null = null;
  /** Help button that opened the current tooltip, for ARIA and toggle. */
  private activeHelpBtn: HTMLButtonElement | null = null;

  constructor() {
    // localStorage first so the initial tab/checkbox reflect the saved state
    // before the shell is built; the spec's order (modal → build → reads) is
    // functionally equivalent but harder to keep correct.
    try {
      const saved = localStorage.getItem('stats.group');
      if (saved && (TAB_IDS as readonly string[]).includes(saved)) {
        this.activeGroup = saved as ActiveTab;
      }
    } catch { /* private mode, quota, etc. */ }
    try {
      this.showAll = localStorage.getItem('stats.showAll') === '1';
    } catch { /* private mode, quota, etc. */ }

    this.modal = new Modal({
      id: 'tower-stats',
      title: 'Tower Stats',
      width: 560,
      dismissible: true,
    });

    this.buildShell();

    // Document-level listeners are registered once, in capture, so the
    // tooltip's Escape handler runs before `Modal.onKeydown` (registered
    // later, bubble phase) and stops propagation before the modal closes.
    document.addEventListener('keydown', this.onDocKeydown, true);
    document.addEventListener('click', this.onDocClick, true);
    // The modal card scrolls independently of the page; a fixed-position
    // tooltip would be stranded mid-scroll if the row moves under it. Closing
    // is cheaper than tracking and looks less surprising.
    this.modal.cardElement.addEventListener('scroll', this.closeTooltip);
  }

  isOpen(): boolean {
    return this.modal.isOpen();
  }

  open(): void {
    this.modal.open();
    this.renderActiveGroup();
  }

  close(): void {
    // Hide the tooltip whenever the modal goes away — the help button it was
    // anchored to may not exist on the next open, and leaving it visible
    // would orphan the ARIA wiring.
    this.closeTooltip();
    this.modal.close();
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  /** Push fresh numbers; re-renders only while open. */
  setInfo(info: StatsInfo): void {
    this.info = info;
    if (this.isOpen()) this.renderActiveGroup();
  }

  destroy(): void {
    this.closeTooltip();
    document.removeEventListener('keydown', this.onDocKeydown, true);
    document.removeEventListener('click', this.onDocClick, true);
    this.modal.cardElement.removeEventListener('scroll', this.closeTooltip);
    this.tooltipEl?.remove();
    this.tooltipEl = null;
    this.modal.destroy();
  }

  // ── shell ─────────────────────────────────────────────────────────────

  private buildShell(): void {
    const root = document.createElement('div');
    root.className = 'stats-modal';

    // Tab strip
    this.tabsContainer = document.createElement('div');
    this.tabsContainer.className = 'stats-modal-tabs';
    this.tabsContainer.setAttribute('role', 'tablist');

    for (const tabId of TAB_IDS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'stats-modal-tab';
      tab.dataset.tab = tabId;
      tab.setAttribute('role', 'tab');
      const isActive = tabId === this.activeGroup;
      if (isActive) tab.classList.add('is-active');
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.addEventListener('click', () => this.setActiveGroup(tabId));

      const tabIcon = document.createElement('span');
      tabIcon.className = 'stats-modal-tab-icon';
      renderIcon(tabIcon, TAB_ICONS[tabId], { size: 16 });
      tab.appendChild(tabIcon);

      const tabLabel = document.createElement('span');
      tabLabel.className = 'stats-modal-tab-label';
      tabLabel.textContent = TAB_LABELS[tabId];
      tab.appendChild(tabLabel);

      this.tabsContainer.appendChild(tab);
      this.tabEls.set(tabId, tab);
    }

    this.tabsContainer.addEventListener('keydown', e => this.onTabsKeydown(e));
    root.appendChild(this.tabsContainer);

    // Filter
    const filterLabel = document.createElement('label');
    filterLabel.className = 'stats-modal-filter';
    this.filterCheckbox = document.createElement('input');
    this.filterCheckbox.type = 'checkbox';
    this.filterCheckbox.checked = this.showAll;
    this.filterCheckbox.addEventListener('change', () => {
      this.toggleFilter(this.filterCheckbox.checked);
    });
    filterLabel.appendChild(this.filterCheckbox);
    const filterText = document.createElement('span');
    filterText.textContent = 'Show every stat';
    filterLabel.appendChild(filterText);
    root.appendChild(filterLabel);

    // Body
    this.bodyContainer = document.createElement('div');
    this.bodyContainer.className = 'stats-modal-body';
    root.appendChild(this.bodyContainer);

    this.modal.body.appendChild(root);
  }

  // ── tab + filter state ──────────────────────────────────────────────

  private setActiveGroup(id: ActiveTab): void {
    if (this.activeGroup === id) return;
    this.activeGroup = id;
    try { localStorage.setItem('stats.group', id); } catch { /* ignore */ }
    this.refreshTabs();
    this.renderActiveGroup();
  }

  private toggleFilter(value: boolean): void {
    if (this.showAll === value) return;
    this.showAll = value;
    try { localStorage.setItem('stats.showAll', value ? '1' : '0'); } catch { /* ignore */ }
    this.renderActiveGroup();
  }

  private refreshTabs(): void {
    for (const [id, tab] of this.tabEls) {
      const isActive = id === this.activeGroup;
      toggleClass(tab, 'is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
  }

  private onTabsKeydown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const target = e.target as HTMLElement | null;
    if (!target || !target.classList.contains('stats-modal-tab')) return;
    e.preventDefault();
    const idx = TAB_IDS.indexOf(this.activeGroup);
    if (idx < 0) return;
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = (idx + dir + TAB_IDS.length) % TAB_IDS.length;
    const newTab = TAB_IDS[next];
    this.setActiveGroup(newTab);
    this.tabEls.get(newTab)?.focus();
  }

  // ── render ───────────────────────────────────────────────────────────

  private renderActiveGroup(): void {
    if (!this.info) return;

    const groupChanged = this.activeGroup !== this.renderedGroup;
    const filterChanged = this.showAll !== this.renderedShowAll;

    // The Sources tab has no reuse strategy defined in the plan (and uses
    // setInnerHTML for the breakdown), so it always rebuilds. Stat groups
    // reuse the cached rows when the group and filter are both unchanged.
    if (this.activeGroup === 'sources' || groupChanged || filterChanged) {
      this.rebuildBody();
    } else {
      this.updateRowValues();
    }
  }

  private rebuildBody(): void {
    // The cached row DOM (and its help buttons) is about to be replaced. If
    // the tooltip is open it is anchored to a soon-to-be-orphan button, so
    // hide it first and let the next open rebuild the wiring cleanly.
    this.closeTooltip();
    this.bodyContainer.replaceChildren();
    this.rowEls.clear();
    this.rowValueEls.clear();
    this.derivedEls.clear();
    this.derivedValueEls.clear();
    this.derivedGetters.clear();

    if (this.activeGroup === 'sources') {
      this.renderSourcesTab();
    } else {
      const group = STAT_GROUPS.find(g => g.id === this.activeGroup);
      if (group) this.renderGroupTab(group);
    }

    this.renderedGroup = this.activeGroup;
    this.renderedShowAll = this.showAll;
  }

  private renderGroupTab(group: StatGroupDef): void {
    if (!this.info) return;
    const info = this.info;
    const resolved = info.resolved;

    const section = document.createElement('section');
    section.className = 'stat-group';

    // Derived rows go at their fixed position in the group (per spec C.3.1).
    const derivedIds: string[] = [];
    if (group.id === 'offense') derivedIds.push('derived:dps');
    else if (group.id === 'defense') derivedIds.push('derived:health', 'derived:healthRegen');
    else if (group.id === 'economy') derivedIds.push('derived:rpGain');
    else if (group.id === 'meta') derivedIds.push('derived:targeting');

    // Filter out hidden-at-default rows when the filter is off.
    const visibleStatRows: Array<{ key: string; def: StatRowDef }> = [];
    for (const row of group.rows) {
      if (!this.showAll && resolved && row.hideAt !== undefined
          && resolved[row.key] === row.hideAt) {
        continue;
      }
      visibleStatRows.push({ key: row.key, def: row });
    }

    for (const id of derivedIds) {
      this.appendDerivedRow(section, id);
    }
    for (const { key, def } of visibleStatRows) {
      this.appendStatRow(section, key, def, resolved);
    }

    if (derivedIds.length === 0 && visibleStatRows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stats-modal-empty';
      empty.textContent = EMPTY_GROUP;
      section.appendChild(empty);
    }

    this.bodyContainer.appendChild(section);
  }

  private appendStatRow(
    section: HTMLElement,
    key: string,
    def: StatRowDef,
    resolved: Readonly<Record<StatKey, number>> | null,
  ): void {
    const rowEl = document.createElement('div');
    rowEl.className = 'stat-row';
    rowEl.dataset.key = key;

    const labelEl = document.createElement('span');
    labelEl.className = 'stat-row-label';
    labelEl.textContent = def.label;

    const codexId = def.codexId;
    if (codexId) {
      const helpBtn = document.createElement('button');
      helpBtn.type = 'button';
      helpBtn.className = 'stat-row-help';
      helpBtn.textContent = '?';
      setAriaLabel(helpBtn, `Show codex entry for ${def.label}`);
      helpBtn.dataset.codexId = codexId;
      // The document-level click handler (capture) runs first and skips its
      // "outside click → close" path when the target is any .stat-row-help.
      // We then decide toggle vs switch here in the bubble phase.
      helpBtn.addEventListener('click', () => {
        if (this.activeHelpBtn === helpBtn) {
          this.closeTooltip();
        } else {
          this.openTooltip(helpBtn, codexId);
        }
      });
      labelEl.appendChild(helpBtn);
    }
    rowEl.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'stat-row-value';
    if (resolved) {
      const value = resolved[key as StatKey];
      setText(valueEl, formatStatValue(value, def.format));
      if (this.showAll && def.hideAt !== undefined && value === def.hideAt) {
        toggleClass(rowEl, 'is-default', true);
      }
    }
    rowEl.appendChild(valueEl);

    section.appendChild(rowEl);
    this.rowEls.set(key, rowEl);
    this.rowValueEls.set(key, valueEl);
  }

  private appendDerivedRow(section: HTMLElement, id: string): void {
    if (!this.info) return;
    const info = this.info;

    let label: string;
    let getter: () => string;

    switch (id) {
      case 'derived:dps':
        label = 'DPS';
        getter = () => formatWithOptionalDecimal(info.dps, 1, { keepTrailingZeros: true });
        break;
      case 'derived:health':
        label = 'Health';
        getter = () => `${Math.floor(info.hp)} / ${Math.floor(info.maxHp)}`;
        break;
      case 'derived:healthRegen':
        // healthRegen is a fraction of max HP per second; printing the raw
        // stat would be a lie, so multiply through (matches the old popup).
        label = 'Health Regen';
        getter = () => `${formatWithOptionalDecimal(info.maxHp * info.healthRegen)}/s`;
        break;
      case 'derived:rpGain':
        label = 'RP Gain';
        getter = () => `${formatNumber(info.rpGainRate, 3)}/s`;
        break;
      case 'derived:targeting':
        label = 'Targeting';
        getter = () => TARGETING_MODES.find(m => m.id === info.targetingMode)?.label
          ?? String(info.targetingMode);
        break;
      default:
        return;
    }

    const rowEl = document.createElement('div');
    rowEl.className = 'stat-row';
    rowEl.dataset.derived = id;

    const labelEl = document.createElement('span');
    labelEl.className = 'stat-row-label';
    labelEl.textContent = label;
    rowEl.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'stat-row-value';
    setText(valueEl, getter());
    rowEl.appendChild(valueEl);

    section.appendChild(rowEl);
    this.derivedEls.set(id, rowEl);
    this.derivedValueEls.set(id, valueEl);
    this.derivedGetters.set(id, getter);
  }

  /** Hot path: walk the cached rows and `setText` the value span. */
  private updateRowValues(): void {
    if (!this.info) return;
    const resolved = this.info.resolved;

    if (resolved) {
      for (const [key, valueEl] of this.rowValueEls) {
        const rowDef = STAT_ROW_BY_KEY[key as StatKey];
        if (!rowDef) continue;
        const value = resolved[key as StatKey];
        setText(valueEl, formatStatValue(value, rowDef.format));

        const rowEl = this.rowEls.get(key);
        if (rowEl) {
          const isDefault = this.showAll
            && rowDef.hideAt !== undefined
            && value === rowDef.hideAt;
          toggleClass(rowEl, 'is-default', isDefault);
        }
      }
    }

    for (const [id, valueEl] of this.derivedValueEls) {
      const getter = this.derivedGetters.get(id);
      if (getter) setText(valueEl, getter());
    }
  }

  // ── Sources tab (C.3.2) ──────────────────────────────────────────────

  private renderSourcesTab(): void {
    if (!this.info) return;
    const info = this.info;

    // Headline: the composed gold multiplier
    const headline = document.createElement('div');
    headline.className = 'stat-row';
    const headlineLabel = document.createElement('span');
    headlineLabel.className = 'stat-row-label';
    headlineLabel.textContent = 'Gold Multiplier';
    headline.appendChild(headlineLabel);
    const headlineValue = document.createElement('span');
    headlineValue.className = 'stat-row-value';
    headlineValue.textContent = `x${info.goldMultiplier.toFixed(2)}`;
    headline.appendChild(headlineValue);
    this.bodyContainer.appendChild(headline);

    const note = document.createElement('p');
    note.className = 'stats-modal-note';
    note.textContent = SOURCES_NOTE;
    this.bodyContainer.appendChild(note);

    const sources = info.goldSources ?? [];
    if (sources.length === 0) {
      this.appendSourcesEmpty();
      return;
    }

    // Verbatim port of HUD.renderGoldBreakdown (sources are loop-built into a
    // string, then `setInnerHTML`-ed — no per-row DOM nodes here).
    const rows: string[] = [];
    let additiveTotal = 0;
    for (const s of sources) {
      if (s.kind === 'additive') {
        additiveTotal += s.additive;
        rows.push(
          `<div class="stat-subrow"><span>${escapeText(s.label)}</span>`
          + `<span>+${Math.round(s.additive * 100)}%</span></div>`,
        );
      }
    }
    const multiplicative = sources.filter(
      (s): s is Extract<GoldSourceEntry, { kind: 'multiplicative' }> =>
        s.kind === 'multiplicative',
    );
    if (rows.length > 0 && multiplicative.length > 0) {
      rows.push(
        `<div class="stat-subrow stat-subtotal"><span>subtotal</span>`
        + `<span>×${(1 + additiveTotal).toFixed(2)}</span></div>`,
      );
    }
    for (const s of multiplicative) {
      rows.push(
        `<div class="stat-subrow"><span>${escapeText(s.label)}</span>`
        + `<span>×${s.factor.toFixed(2)}</span></div>`,
      );
    }

    if (rows.length === 0) {
      this.appendSourcesEmpty();
      return;
    }

    const breakdown = document.createElement('div');
    breakdown.className = 'stat-breakdown';
    breakdown.innerHTML = rows.join('');
    this.bodyContainer.appendChild(breakdown);
  }

  private appendSourcesEmpty(): void {
    const empty = document.createElement('div');
    empty.className = 'stats-modal-empty';
    empty.textContent = EMPTY_SOURCES;
    this.bodyContainer.appendChild(empty);
  }

  // ── Codex tooltip (Part C — row "?" affordance) ───────────────────────

  /**
   * Build the single floating tooltip element. Lazily created on first open
   * and reused afterwards; the panel is appended to `document.body` so it
   * escapes the modal-card scroll viewport; its z-index sits one rung above
   * `--z-modal` so it paints over the modal card instead of behind it.
   */
  private buildTooltip(): HTMLDivElement {
    const tooltip = document.createElement('div');
    tooltip.className = 'stats-codex-tooltip';
    tooltip.id = 'stats-codex-tooltip';
    tooltip.setAttribute('role', 'tooltip');

    const head = document.createElement('div');
    head.className = 'stats-codex-tooltip-head';

    const iconHost = document.createElement('span');
    iconHost.className = 'stats-codex-tooltip-icon';
    head.appendChild(iconHost);

    const term = document.createElement('h4');
    term.className = 'stats-codex-tooltip-term';
    head.appendChild(term);

    tooltip.appendChild(head);

    const summary = document.createElement('p');
    summary.className = 'stats-codex-tooltip-summary';
    tooltip.appendChild(summary);

    const detail = document.createElement('div');
    detail.className = 'stats-codex-tooltip-detail';
    tooltip.appendChild(detail);

    return tooltip;
  }

  private openTooltip(helpBtn: HTMLButtonElement, entryId: string): void {
    const entry = CODEX_BY_ID.get(entryId);
    if (!entry) return;

    if (!this.tooltipEl) {
      this.tooltipEl = this.buildTooltip();
      document.body.appendChild(this.tooltipEl);
    }

    this.renderTooltipContent(entry);

    // Position first (with the tooltip invisible) so the entrance animation
    // starts at the final coordinate rather than at (0,0) and slides in.
    this.tooltipEl.classList.add('is-visible');
    this.positionTooltip(helpBtn);

    // ARIA: tie the button to its described tooltip. The document-level click
    // handler strips these on close; the button click handler toggles when the
    // active button is clicked again.
    helpBtn.setAttribute('aria-expanded', 'true');
    helpBtn.setAttribute('aria-describedby', this.tooltipEl.id);
    this.activeHelpBtn = helpBtn;
  }

  private closeTooltip = (): void => {
    if (this.tooltipEl) {
      this.tooltipEl.classList.remove('is-visible');
      this.tooltipEl.removeAttribute('data-placement');
    }
    if (this.activeHelpBtn) {
      this.activeHelpBtn.removeAttribute('aria-expanded');
      this.activeHelpBtn.removeAttribute('aria-describedby');
      this.activeHelpBtn = null;
    }
  };

  private renderTooltipContent(entry: CodexEntry): void {
    const tooltip = this.tooltipEl;
    if (!tooltip) return;

    const iconHost = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-icon');
    if (iconHost) renderIcon(iconHost, entry.icon, { size: 18, tone: 'inherit' });

    const term = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-term');
    if (term) setText(term, entry.term);

    const summary = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-summary');
    if (summary) setText(summary, entry.summary);

    const detail = tooltip.querySelector<HTMLElement>('.stats-codex-tooltip-detail');
    if (detail) {
      detail.replaceChildren();
      // Split on blank lines so multi-paragraph detail copy from the Codex
      // data layer renders as a stack of <p>s. A single paragraph (no \n\n)
      // produces one <p>, which is the shape that matches today's entries.
      const paragraphs = entry.detail.split(/\n\n+/);
      for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed) continue;
        const p = document.createElement('p');
        setText(p, trimmed);
        detail.appendChild(p);
      }
    }
  }

  /**
   * Anchor the tooltip to the help button. Default placement is to the right
   * of the button at vertical centre. If that would clip the modal-card's
   * right edge, flip left; if the row is near the bottom of the popup body
   * and the tooltip would overflow the card vertically, flip above; final
   * clamp keeps the tooltip inside the card on every axis.
   */
  private positionTooltip(btn: HTMLButtonElement): void {
    const tooltip = this.tooltipEl;
    if (!tooltip) return;

    // Force a layout pass so the measured rect reflects the new content.
    // `void offsetHeight` reads without writing — cheaper than getBoundingClientRect
    // alone when the element has just been repopulated.
    void tooltip.offsetHeight;
    const tooltipRect = tooltip.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const cardRect = this.modal.cardElement.getBoundingClientRect();
    const margin = 8;

    let placement: 'right' | 'left' | 'above' | 'below' = 'right';
    let top = btnRect.top + (btnRect.height - tooltipRect.height) / 2;
    let left = btnRect.right + margin;

    // Horizontal: prefer right of button; flip left if it would clip the card.
    if (left + tooltipRect.width > cardRect.right - margin) {
      placement = 'left';
      left = btnRect.left - tooltipRect.width - margin;
      if (left < cardRect.left + margin) {
        // Both sides overflow horizontally — centre on the button and flip
        // vertically instead.
        placement = 'above';
        left = btnRect.left + (btnRect.width - tooltipRect.width) / 2;
        left = Math.max(
          cardRect.left + margin,
          Math.min(left, cardRect.right - tooltipRect.width - margin),
        );
      }
    }

    // Vertical: if centred placement would clip the card bottom, place above.
    if (top + tooltipRect.height > cardRect.bottom - margin) {
      top = btnRect.top - tooltipRect.height - margin;
      placement = 'above';
      if (top < cardRect.top + margin) {
        top = btnRect.bottom + margin;
        placement = 'below';
      }
    } else if (top < cardRect.top + margin) {
      top = btnRect.bottom + margin;
      placement = 'below';
    }

    // Final clamp — no matter which branch ran, the tooltip must stay inside
    // the card so it never escapes the modal chrome.
    top = Math.max(cardRect.top + margin, Math.min(top, cardRect.bottom - tooltipRect.height - margin));
    left = Math.max(cardRect.left + margin, Math.min(left, cardRect.right - tooltipRect.width - margin));

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
    tooltip.dataset.placement = placement;
  }

  private onDocKeydown = (e: KeyboardEvent): void => {
    if (!this.tooltipEl?.classList.contains('is-visible')) return;
    if (e.key !== 'Escape') return;
    // Capture phase, registered before Modal.onKeydown — stopPropagation keeps
    // the modal from also closing on this keypress so a second Escape is
    // available for the user to dismiss the dialog itself.
    e.stopPropagation();
    e.preventDefault();
    this.closeTooltip();
  };

  private onDocClick = (e: MouseEvent): void => {
    if (!this.tooltipEl?.classList.contains('is-visible')) return;
    const target = e.target as Element | null;
    if (!target) return;
    if (this.tooltipEl.contains(target)) return;
    // Any "?" button — active or not — is allowed to handle its own click in
    // the bubble phase (toggle / switch). Skip the close path so the button's
    // listener can do its work without racing ours.
    if (target.closest('.stat-row-help')) return;
    this.closeTooltip();
  };
}
