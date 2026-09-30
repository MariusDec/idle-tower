import type { GameState } from '../types';
import type { IconId } from '../data/icons';
import type { WatchChapterView, WatchInfo } from './UIManager';
import { setStyle, setText } from '../utils/dom';
import { renderIcon } from './Icon';

export interface JournalPanelDeps {
  /** Plan §6.2: the view model. One snapshot per UI tick. */
  watch: () => WatchInfo;
  /**
   * Plan §6.3: stubbed. Step 9 will wire this to the Codex focus — for now
   * the click handler on an objective row simply routes through this callback
   * so Step 9 has a single, stable seam to attach to.
   */
  onOpenCodex: (entryId: string) => void;
}

/**
 * The Long Watch — the campaign's home tab (plan §6).
 *
 * Five surfaces, top to bottom:
 *   1. Header — campaign name + completed/total.
 *   2. Active chapter card — large, accent border, three objective rows,
 *      reward strip.
 *   3. Next up — the chapter after the active one, half prominence.
 *   4. Completed — a compact list, newest first.
 *   5. The road ahead — the remaining chapters as one-line rows.
 *
 * The DOM is rebuilt only when the *signature* changes — the goal-met flags
 * and which chapter is active. Bars and progress numbers update in place every
 * UI tick.
 */
export class JournalPanel {
  private readonly deps: JournalPanelDeps;
  private root: HTMLElement | null = null;
  /** Last signature so the rebuild path early-outs on no-op frames. */
  private signature = '';

  // Header
  private headerCountEl: HTMLElement | null = null;

  // Active chapter card
  private activeCard: HTMLElement | null = null;
  private activeGoalEls: GoalRowEls[] = [];

  // Next up
  private nextCard: HTMLElement | null = null;

  // Completed
  private completedListEl: HTMLElement | null = null;

  // Road ahead
  private roadListEl: HTMLElement | null = null;

  constructor(deps: JournalPanelDeps) {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.renderInto(parent);
  }

  unmount(): void {
    this.root = null;
    this.signature = '';
    this.headerCountEl = null;
    this.activeCard = null;
    this.activeGoalEls = [];
    this.nextCard = null;
    this.completedListEl = null;
    this.roadListEl = null;
  }

  update(_state: GameState): void {
    if (!this.root) return;
    const info = this.deps.watch();
    const next = this.computeSignature(info);
    if (next !== this.signature) {
      this.signature = next;
      this.rebuild(info);
    }
    this.refreshNumbers(info);
  }

  // ── signature ──

  /**
   * The thing that decides whether to rebuild the DOM. Combines every input
   * the render tree depends on that isn't a progress number — chapter order,
   * completion state, and the goal-met flags per chapter. Progress numbers
   * update in place on every tick and never enter the signature.
   */
  private computeSignature(info: WatchInfo): string {
    const parts: string[] = [];
    parts.push(String(info.activeIndex));
    parts.push(String(info.completed));
    for (const ch of info.chapters) {
      parts.push(`${ch.state}:${ch.goals.map((g) => (g.met ? '1' : '0')).join(',')}`);
    }
    return parts.join('|');
  }

  // ── first render + rebuild ──

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'journal-panel';

    const header = document.createElement('div');
    header.className = 'journal-header';
    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'The Long Watch';
    header.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'journal-header-sub';
    this.headerCountEl = sub;
    header.appendChild(sub);
    parent.appendChild(header);

    // Active chapter card.
    this.activeCard = document.createElement('div');
    this.activeCard.className = 'journal-active';
    parent.appendChild(this.activeCard);

    // Next-up teaser.
    this.nextCard = document.createElement('div');
    this.nextCard.className = 'journal-next';
    parent.appendChild(this.nextCard);

    // Completed list.
    const completedHeading = document.createElement('h3');
    completedHeading.className = 'journal-section-heading';
    completedHeading.textContent = 'Completed';
    parent.appendChild(completedHeading);
    this.completedListEl = document.createElement('div');
    this.completedListEl.className = 'journal-completed';
    parent.appendChild(this.completedListEl);

    // Road ahead.
    const roadHeading = document.createElement('h3');
    roadHeading.className = 'journal-section-heading';
    roadHeading.textContent = 'The road ahead';
    parent.appendChild(roadHeading);
    this.roadListEl = document.createElement('div');
    this.roadListEl.className = 'journal-road';
    parent.appendChild(this.roadListEl);
  }

  private rebuild(info: WatchInfo): void {
    this.rebuildHeader(info);
    this.rebuildActive(info);
    this.rebuildNext(info);
    this.rebuildCompleted(info);
    this.rebuildRoad(info);
  }

  private rebuildHeader(info: WatchInfo): void {
    if (this.headerCountEl) {
      setText(this.headerCountEl, `${info.completed} / ${info.total} chapters`);
    }
  }

  private rebuildActive(info: WatchInfo): void {
    const card = this.activeCard;
    if (!card) return;
    card.innerHTML = '';
    this.activeGoalEls = [];

    if (info.activeIndex < 0) {
      // No live chapter — either nothing started or all twelve done. The card
      // collapses to a single line so the rest of the panel still renders.
      const done = document.createElement('div');
      done.className = 'journal-active-empty';
      done.textContent = info.completed >= info.total
        ? 'The Watch is kept. Every chapter complete.'
        : 'The Watch begins…';
      card.appendChild(done);
      return;
    }

    const view = info.chapters[info.activeIndex];
    card.classList.toggle('is-locked', view.state === 'locked');
    // The accent colour arrives as data (plan §6.3 / palette test §5.E).
    setStyle(card, 'borderColor', view.color);

    const top = document.createElement('div');
    top.className = 'journal-active-top';
    const iconWrap = document.createElement('div');
    iconWrap.className = 'journal-active-icon';
    renderIcon(iconWrap, view.icon, { size: 32, tone: 'inherit' });
    setStyle(iconWrap, 'color', view.color);
    top.appendChild(iconWrap);
    const heading = document.createElement('div');
    heading.className = 'journal-active-heading';
    const number = document.createElement('div');
    number.className = 'journal-active-number';
    number.textContent = `CHAPTER ${view.number}`;
    heading.appendChild(number);
    const name = document.createElement('div');
    name.className = 'journal-active-name';
    name.textContent = view.name;
    heading.appendChild(name);
    top.appendChild(heading);
    card.appendChild(top);

    const flavour = document.createElement('p');
    flavour.className = 'journal-active-flavour';
    flavour.textContent = view.flavour;
    card.appendChild(flavour);

    const goals = document.createElement('div');
    goals.className = 'journal-active-goals';
    for (let i = 0; i < view.goals.length; i++) {
      const row = this.renderActiveGoal(view.goals[i], view.icon, view.color, i, info.activeIndex);
      goals.appendChild(row.wrap);
      this.activeGoalEls.push(row);
    }
    card.appendChild(goals);

    const reward = document.createElement('div');
    reward.className = 'journal-active-reward';
    const rIcon = document.createElement('div');
    rIcon.className = 'journal-active-reward-icon';
    renderIcon(rIcon, view.reward.icon, { size: 22, tone: 'inherit' });
    setStyle(rIcon, 'color', view.color);
    reward.appendChild(rIcon);
    const rBody = document.createElement('div');
    rBody.className = 'journal-active-reward-body';
    const rName = document.createElement('div');
    rName.className = 'journal-active-reward-name';
    rName.textContent = view.reward.name;
    rBody.appendChild(rName);
    const rDesc = document.createElement('div');
    rDesc.className = 'journal-active-reward-desc';
    rDesc.textContent = view.reward.description;
    rBody.appendChild(rDesc);
    reward.appendChild(rBody);
    card.appendChild(reward);
  }

  private renderActiveGoal(
    goal: WatchChapterView['goals'][number],
    _fallbackIcon: IconId,
    accent: string,
    index: number,
    chapterIndex: number,
  ): GoalRowEls {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'journal-goal';
    // Stub for the Codex link (Step 9). A unique, deterministic id keeps
    // Step 9's wiring to one line per row.
    wrap.dataset.codexTarget = `watch:${chapterIndex}:${index}`;
    wrap.addEventListener('click', () => this.deps.onOpenCodex(wrap.dataset.codexTarget ?? ''));

    const labelRow = document.createElement('div');
    labelRow.className = 'journal-goal-row';
    const label = document.createElement('div');
    label.className = 'journal-goal-label';
    label.textContent = goal.label;
    labelRow.appendChild(label);
    const progress = document.createElement('div');
    progress.className = 'journal-goal-progress';
    progress.textContent = goal.progress;
    labelRow.appendChild(progress);
    wrap.appendChild(labelRow);

    const fill = document.createElement('div');
    fill.className = 'journal-goal-fill-track';
    const fillBar = document.createElement('div');
    fillBar.className = 'journal-goal-fill';
    setStyle(fillBar, 'width', `${(Math.max(0, Math.min(1, goal.fill)) * 100).toFixed(1)}%`);
    setStyle(fillBar, 'background', accent);
    fill.appendChild(fillBar);
    wrap.appendChild(fill);

    const check = document.createElement('div');
    check.className = 'journal-goal-check';
    check.textContent = goal.met ? '✓' : '';
    wrap.appendChild(check);

    return {
      wrap,
      progress,
      fill: fillBar,
      check,
    };
  }

  private rebuildNext(info: WatchInfo): void {
    const card = this.nextCard;
    if (!card) return;
    card.innerHTML = '';

    const nextIdx = info.activeIndex >= 0 ? info.activeIndex + 1 : -1;
    if (nextIdx < 0 || nextIdx >= info.chapters.length) {
      card.style.display = 'none';
      return;
    }
    card.style.display = '';
    const view = info.chapters[nextIdx];
    card.classList.toggle('is-locked', view.state === 'locked');
    setStyle(card, 'borderColor', view.color);

    const heading = document.createElement('div');
    heading.className = 'journal-next-heading';
    const iconWrap = document.createElement('div');
    iconWrap.className = 'journal-next-icon';
    renderIcon(iconWrap, view.icon, { size: 22, tone: 'inherit' });
    setStyle(iconWrap, 'color', view.color);
    heading.appendChild(iconWrap);
    const name = document.createElement('div');
    name.className = 'journal-next-name';
    name.textContent = `${view.number}. ${view.name}`;
    heading.appendChild(name);
    card.appendChild(heading);

    const reward = document.createElement('div');
    reward.className = 'journal-next-reward';
    reward.textContent = `Next reward: ${view.reward.name}`;
    card.appendChild(reward);
  }

  private rebuildCompleted(info: WatchInfo): void {
    const list = this.completedListEl;
    if (!list) return;
    list.innerHTML = '';

    // Newest first. The view model preserves order so we just walk the
    // completed chapters in reverse.
    const doneViews: WatchChapterView[] = [];
    for (const ch of info.chapters) if (ch.state === 'done') doneViews.push(ch);
    for (let i = doneViews.length - 1; i >= 0; i--) {
      const ch = doneViews[i];
      const row = document.createElement('div');
      row.className = 'journal-completed-row';
      const num = document.createElement('div');
      num.className = 'journal-completed-num';
      num.textContent = `${ch.number}`;
      row.appendChild(num);
      const iconWrap = document.createElement('div');
      iconWrap.className = 'journal-completed-icon';
      renderIcon(iconWrap, ch.icon, { size: 18, tone: 'inherit' });
      setStyle(iconWrap, 'color', ch.color);
      row.appendChild(iconWrap);
      const name = document.createElement('div');
      name.className = 'journal-completed-name';
      name.textContent = ch.name;
      row.appendChild(name);
      const unlock = document.createElement('div');
      unlock.className = 'journal-completed-unlock';
      const unlockIcon = document.createElement('div');
      unlockIcon.className = 'journal-completed-unlock-icon';
      renderIcon(unlockIcon, ch.reward.icon, { size: 16, tone: 'inherit' });
      setStyle(unlockIcon, 'color', ch.color);
      unlock.appendChild(unlockIcon);
      const unlockText = document.createElement('span');
      unlockText.textContent = ch.reward.name;
      unlock.appendChild(unlockText);
      row.appendChild(unlock);
      list.appendChild(row);
    }
    if (doneViews.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'journal-empty';
      empty.textContent = 'No chapters completed yet.';
      list.appendChild(empty);
    }
  }

  private rebuildRoad(info: WatchInfo): void {
    const list = this.roadListEl;
    if (!list) return;
    list.innerHTML = '';

    // Everything past the "next up" card. Newest (i.e. closest) first.
    const startIdx = info.activeIndex >= 0 ? info.activeIndex + 2 : 0;
    const upcoming: WatchChapterView[] = [];
    for (let i = startIdx; i < info.chapters.length; i++) upcoming.push(info.chapters[i]);
    for (const ch of upcoming) {
      const row = document.createElement('div');
      row.className = 'journal-road-row';
      row.classList.toggle('is-locked', ch.state === 'locked');
      const num = document.createElement('div');
      num.className = 'journal-road-num';
      num.textContent = `${ch.number}`;
      row.appendChild(num);
      const name = document.createElement('div');
      name.className = 'journal-road-name';
      name.textContent = ch.name;
      row.appendChild(name);
      const reward = document.createElement('div');
      reward.className = 'journal-road-reward';
      reward.textContent = `→ ${ch.reward.name}`;
      row.appendChild(reward);
      list.appendChild(row);
    }
    if (upcoming.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'journal-empty';
      empty.textContent = 'Nothing left on the road.';
      list.appendChild(empty);
    }
  }

  // ── in-place refresh ──

  /**
   * Push the live progress numbers into the DOM without rebuilding it. The
   * only writes here are progress strings, fill widths and the check glyph;
   * every other element is owned by `rebuild*` and not touched.
   */
  private refreshNumbers(info: WatchInfo): void {
    if (this.headerCountEl) {
      setText(this.headerCountEl, `${info.completed} / ${info.total} chapters`);
    }
    if (info.activeIndex >= 0 && this.activeCard) {
      const view = info.chapters[info.activeIndex];
      for (let i = 0; i < this.activeGoalEls.length; i++) {
        const els = this.activeGoalEls[i];
        const goal = view.goals[i];
        if (!els || !goal) continue;
        setText(els.progress, goal.progress);
        setStyle(els.fill, 'width', `${(Math.max(0, Math.min(1, goal.fill)) * 100).toFixed(1)}%`);
        setText(els.check, goal.met ? '✓' : '');
        els.wrap.classList.toggle('is-met', goal.met);
      }
    }
  }
}

interface GoalRowEls {
  wrap: HTMLElement;
  progress: HTMLElement;
  fill: HTMLElement;
  check: HTMLElement;
}
