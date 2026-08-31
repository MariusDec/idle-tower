import {
  CODEX_BY_STAT,
  CODEX_CATEGORIES,
  CODEX_CATEGORY_ICONS,
  CODEX_CATEGORY_LABELS,
  CODEX_ENTRIES,
  type CodexCategory,
  type CodexEntry,
} from '../data/codex';
import type { StatKey } from '../stats/keys';
import type { GameState } from '../types';
import { setText, toggleClass } from '../utils/dom';
import { friendlyTermName, setProse } from './codexProse';
import { renderIcon } from './Icon';

/**
 * In-game glossary that explains every tower, ability, and run mechanic.
 *
 * Designed as a panel (not a modal) so it can stay open while the player
 * watches the game. Two-column layout: entry list on the left, detail pane
 * on the right. On narrow viewports the columns stack and the detail pane
 * moves below the list.
 *
 * The panel is fully static — no live state — so it does not subscribe to
 * the game loop. The optional `update(state)` is a no-op kept to match the
 * other panels' contract; `focusEntry(id)` is the only public mutator.
 */
/**
 * Tab strip selection: a real category, or the synthetic "All" tab that drops
 * the category filter entirely. Search always lands on `all` so a query is
 * never silently narrowed to whatever tab happened to be open.
 */
type CodexFilter = CodexCategory | 'all';

export class CodexPanel {
  private root: HTMLElement | null = null;
  private tabEls = new Map<CodexFilter, HTMLElement>();
  private entryEls = new Map<string, HTMLElement>();
  private detailEl: HTMLElement | null = null;
  private detailTermEl: HTMLElement | null = null;
  private detailSummaryEl: HTMLElement | null = null;
  private detailDetailEl: HTMLElement | null = null;
  private detailSeeAlsoEl: HTMLElement | null = null;
  private detailStatsEl: HTMLElement | null = null;
  private detailGlyphEl: HTMLElement | null = null;
  private emptyEl: HTMLElement | null = null;
  private activeCategory: CodexFilter = 'offense';
  private activeEntryId: string | null = null;
  private searchTerm = '';

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.entryEls.clear();
    this.tabEls.clear();
    this.renderInto(parent);
    this.applyFilter();
    this.focusEntry(this.activeEntryId ?? CODEX_ENTRIES[0].id);
  }

  unmount(): void {
    if (this.root) {
      this.root.innerHTML = '';
      this.root = null;
    }
  }

  /**
   * Game-state updates are not relevant to a static glossary — the panel
   * exists purely to explain mechanics, not to reflect them. Kept on the
   * interface to match the other panels.
   */
  update(_state: GameState): void {
    /* no-op: the Codex is static */
  }

  /**
   * Open the panel onto a specific entry by id. Useful for "explain" links
   * from the Stats panel or any future tooltip that wants to deep-link into
   * the Codex. Falls back to the first entry if the id is unknown so a stale
   * link never lands the player on a blank pane.
   */
  focusEntry(id: string): void {
    const target = CODEX_ENTRIES.find((e) => e.id === id);
    if (!target) {
      this.focusEntry(CODEX_ENTRIES[0].id);
      return;
    }
    // Staying on "All" keeps a search result list intact when the player
    // clicks through it; any other tab follows the entry to its category.
    if (this.activeCategory !== 'all') this.activeCategory = target.category;
    this.activeEntryId = target.id;
    this.refreshTabs();
    this.applyFilter();
    this.renderDetail(target);
    const row = this.entryEls.get(target.id);
    row?.scrollIntoView({ block: 'nearest' });
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.classList.add('codex-panel');

    const header = document.createElement('div');
    header.className = 'codex-header';
    const title = document.createElement('h3');
    title.className = 'panel-header';
    title.textContent = 'Codex';
    header.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'panel-note codex-header-note';
    sub.textContent =
      'Every tower stat, ability knob, and run mechanic in one place. Click a row for the full breakdown.';
    header.appendChild(sub);

    const searchRow = document.createElement('div');
    searchRow.className = 'codex-search-row';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'codex-search';
    input.placeholder = 'Search the codex…';
    input.setAttribute('aria-label', 'Search the codex');
    input.addEventListener('input', () => {
      this.searchTerm = input.value.trim().toLowerCase();
      // A query searches the whole codex, not the open tab: jump to "All" so
      // the player sees every hit rather than the subset in one category.
      if (this.searchTerm) this.activeCategory = 'all';
      this.refreshTabs();
      this.applyFilter();
      // Keep the detail pane on something the list still shows.
      const first = CODEX_ENTRIES.find(
        (e) =>
          (this.activeCategory === 'all' || e.category === this.activeCategory) &&
          this.matchesSearch(e),
      );
      if (first && !this.isVisibleEntry(this.activeEntryId)) this.focusEntry(first.id);
    });
    searchRow.appendChild(input);
    header.appendChild(searchRow);

    const tabs = document.createElement('div');
    tabs.className = 'codex-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const category of ['all', ...CODEX_CATEGORIES] as CodexFilter[]) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `codex-tab codex-tab-${category}`;
      tab.dataset.category = category;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => this.selectCategory(category));

      const tabIcon = document.createElement('span');
      tabIcon.className = 'codex-tab-icon';
      renderIcon(tabIcon, category === 'all' ? 'book-pile' : CODEX_CATEGORY_ICONS[category]);
      tab.appendChild(tabIcon);

      const tabLabel = document.createElement('span');
      tabLabel.className = 'codex-tab-label';
      tabLabel.textContent = category === 'all' ? 'All' : CODEX_CATEGORY_LABELS[category];
      tab.appendChild(tabLabel);

      tabs.appendChild(tab);
      this.tabEls.set(category, tab);
    }
    header.appendChild(tabs);

    parent.appendChild(header);

    const body = document.createElement('div');
    body.className = 'codex-body';

    const list = document.createElement('div');
    list.className = 'codex-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Codex entries');

    for (const entry of CODEX_ENTRIES) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'codex-entry';
      row.dataset.id = entry.id;
      row.dataset.category = entry.category;
      row.setAttribute('role', 'option');
      row.addEventListener('click', () => this.focusEntry(entry.id));

      const glyph = document.createElement('span');
      glyph.className = 'codex-entry-icon';
      renderIcon(glyph, entry.icon);
      row.appendChild(glyph);

      const body2 = document.createElement('span');
      body2.className = 'codex-entry-body';
      const term = document.createElement('span');
      term.className = 'codex-entry-term';
      term.textContent = entry.term;
      body2.appendChild(term);
      const summary = document.createElement('span');
      summary.className = 'codex-entry-summary';
      summary.textContent = entry.summary;
      body2.appendChild(summary);
      row.appendChild(body2);

      list.appendChild(row);
      this.entryEls.set(entry.id, row);
    }

    const empty = document.createElement('div');
    empty.className = 'codex-empty';
    empty.textContent = 'No entries match that search.';
    list.appendChild(empty);
    this.emptyEl = empty;

    body.appendChild(list);

    const detail = document.createElement('article');
    detail.className = 'codex-detail';

    const detailHead = document.createElement('header');
    detailHead.className = 'codex-detail-head';
    const detailGlyph = document.createElement('span');
    detailGlyph.className = 'codex-detail-glyph';
    detailHead.appendChild(detailGlyph);
    this.detailGlyphEl = detailGlyph;

    const detailHeadBody = document.createElement('div');
    detailHeadBody.className = 'codex-detail-head-body';
    const detailTerm = document.createElement('h4');
    detailTerm.className = 'codex-detail-term';
    detailHeadBody.appendChild(detailTerm);
    this.detailTermEl = detailTerm;

    const detailSummary = document.createElement('p');
    detailSummary.className = 'codex-detail-summary';
    detailHeadBody.appendChild(detailSummary);
    this.detailSummaryEl = detailSummary;
    detailHead.appendChild(detailHeadBody);
    detail.appendChild(detailHead);

    const detailBody = document.createElement('div');
    detailBody.className = 'codex-detail-body';
    const detailDetail = document.createElement('p');
    detailDetail.className = 'codex-detail-detail';
    detailBody.appendChild(detailDetail);
    this.detailDetailEl = detailDetail;

    const statsBlock = document.createElement('div');
    statsBlock.className = 'codex-detail-stats';
    this.detailStatsEl = statsBlock;
    detailBody.appendChild(statsBlock);

    const seeAlsoBlock = document.createElement('div');
    seeAlsoBlock.className = 'codex-detail-seealso';
    this.detailSeeAlsoEl = seeAlsoBlock;
    detailBody.appendChild(seeAlsoBlock);

    detail.appendChild(detailBody);
    body.appendChild(detail);
    this.detailEl = detail;

    parent.appendChild(body);
  }

  private selectCategory(category: CodexFilter): void {
    if (this.activeCategory === category && !this.searchTerm) return;
    this.activeCategory = category;
    this.refreshTabs();
    this.applyFilter();
    // Pick the first still-visible entry as the active one so the detail pane
    // never lands empty after a tab switch — respecting the search, since the
    // category's own first entry may be filtered out by it.
    const first = CODEX_ENTRIES.find(
      (e) => (category === 'all' || e.category === category) && this.matchesSearch(e),
    );
    if (first) this.focusEntry(first.id);
  }

  private refreshTabs(): void {
    for (const [category, tab] of this.tabEls) {
      toggleClass(tab, 'is-active', category === this.activeCategory);
      tab.setAttribute('aria-selected', category === this.activeCategory ? 'true' : 'false');
    }
  }

  private applyFilter(): void {
    let visibleCount = 0;
    for (const entry of CODEX_ENTRIES) {
      const row = this.entryEls.get(entry.id);
      if (!row) continue;
      const matchesCategory = this.activeCategory === 'all' || entry.category === this.activeCategory;
      const matchesSearch = this.matchesSearch(entry);
      const visible = matchesCategory && matchesSearch;
      row.hidden = !visible;
      if (visible) visibleCount++;
    }
    if (this.emptyEl) {
      this.emptyEl.hidden = visibleCount > 0;
    }
  }

  /** True when the given entry id is currently shown by the list filter. */
  private isVisibleEntry(id: string | null): boolean {
    if (!id) return false;
    const entry = CODEX_ENTRIES.find((e) => e.id === id);
    if (!entry) return false;
    if (this.activeCategory !== 'all' && entry.category !== this.activeCategory) return false;
    return this.matchesSearch(entry);
  }

  private matchesSearch(entry: CodexEntry): boolean {
    if (!this.searchTerm) return true;
    const haystack = [
      entry.term,
      entry.summary,
      entry.detail,
      ...(entry.aliases ?? []),
      ...(entry.stats ?? []),
      // Players search the name they can see ("Focus Bonus"), not the key.
      ...(entry.stats ?? []).map(friendlyTermName),
    ]
      .join(' ')
      .toLowerCase();
    // Naive multi-term AND search: every whitespace-separated query token must
    // match somewhere in the haystack. Players search "armor pen" or
    // "crit chance" and expect both terms to be respected.
    const tokens = this.searchTerm.split(/\s+/).filter(Boolean);
    return tokens.every((t) => haystack.includes(t));
  }

  private renderDetail(entry: CodexEntry): void {
    if (!this.detailEl) return;
    if (this.detailTermEl) setText(this.detailTermEl, entry.term);
    if (this.detailSummaryEl) setProse(this.detailSummaryEl, entry.summary);
    if (this.detailDetailEl) setProse(this.detailDetailEl, entry.detail);
    if (this.detailGlyphEl) {
      this.detailGlyphEl.replaceChildren();
      renderIcon(this.detailGlyphEl, entry.icon, { tone: 'inherit' });
    }
    toggleClass(this.detailEl, 'is-active', true);

    // Highlight the active row.
    for (const [id, row] of this.entryEls) {
      toggleClass(row, 'is-active', id === entry.id);
    }

    this.renderStatList(entry);
    this.renderSeeAlso(entry);
  }

  private renderStatList(entry: CodexEntry): void {
    if (!this.detailStatsEl) return;
    const host = this.detailStatsEl;
    host.replaceChildren();
    if (!entry.stats || entry.stats.length === 0) return;

    const heading = document.createElement('h5');
    heading.className = 'codex-detail-stats-heading';
    heading.textContent = 'Resolves these stats';
    host.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'codex-detail-stats-list';
    for (const stat of entry.stats) {
      const li = document.createElement('li');
      li.className = 'codex-detail-stat';
      li.dataset.stat = stat;
      const name = document.createElement('span');
      name.className = 'codex-detail-stat-name';
      name.textContent = friendlyTermName(stat);
      // The engine key stays reachable on hover for anyone cross-referencing
      // a save file or the wiki, but never occupies the row itself.
      name.title = stat;
      li.appendChild(name);
      const refs = CODEX_BY_STAT[stat as StatKey];
      if (refs && refs.length > 1) {
        const warning = document.createElement('span');
        warning.className = 'codex-detail-stat-warning';
        // Entry ids are internal too — quote the entries by their titles.
        const others = refs
          .filter((r) => r !== entry.id)
          .map((r) => CODEX_ENTRIES.find((e) => e.id === r)?.term ?? friendlyTermName(r));
        warning.textContent = 'also referenced by: ' + others.join(', ');
        li.appendChild(warning);
      }
      list.appendChild(li);
    }
    host.appendChild(list);
  }

  private renderSeeAlso(entry: CodexEntry): void {
    if (!this.detailSeeAlsoEl) return;
    const host = this.detailSeeAlsoEl;
    host.replaceChildren();
    if (!entry.seeAlso || entry.seeAlso.length === 0) return;

    const heading = document.createElement('h5');
    heading.className = 'codex-detail-seealso-heading';
    heading.textContent = 'See also';
    host.appendChild(heading);

    const chips = document.createElement('div');
    chips.className = 'codex-seealso-chips';
    for (const id of entry.seeAlso) {
      const target = CODEX_ENTRIES.find((e) => e.id === id);
      if (!target) continue;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'codex-chip';
      chip.dataset.id = id;
      const chipIcon = document.createElement('span');
      chipIcon.className = 'codex-chip-icon';
      renderIcon(chipIcon, target.icon);
      chip.appendChild(chipIcon);
      const chipLabel = document.createElement('span');
      chipLabel.className = 'codex-chip-label';
      chipLabel.textContent = target.term;
      chip.appendChild(chipLabel);
      chip.addEventListener('click', () => this.focusEntry(id));
      chips.appendChild(chip);
    }
    host.appendChild(chips);
  }
}
