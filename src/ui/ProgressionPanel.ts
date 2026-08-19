import type { GameState } from '../types';
import type { MilestoneDef } from '../data/milestones';
import { PROGRESSION_ENTRIES, milestoneKindColor, milestoneKindLabel } from '../data/milestones';
import { TRANSCENDENCE_UNLOCK_AP } from '../data/prestige';
import { formatInt } from '../utils/bigNumber';
import { setText, setStyle, toggleClass } from '../utils/dom';

export interface ProgressionPanelDeps {
  /** AP banked in the current transcendence cycle, for the AP-gated entries. */
  apThisCycle: () => number;
}

interface RowEls {
  wrap: HTMLElement;
  status: HTMLElement;
}

/**
 * The full "what unlocks when" screen (plan §4.6).
 *
 * The milestone strip only ever shows the next three unlocks, so a player has
 * no way to see the shape of the game ahead of them — which ability is worth
 * pushing for, when the next enemy type shows up, how far off the next
 * passive is. This lists every wave-gated unlock at once, earned ones
 * included, built from the same definitions the strip uses so the two cannot
 * drift apart.
 */
export class ProgressionPanel {
  private readonly deps: ProgressionPanelDeps;
  private root: HTMLElement | null = null;
  private rows = new Map<string, RowEls>();
  private summaryEl: HTMLElement | null = null;

  constructor(deps: ProgressionPanelDeps) {
    this.deps = deps;
  }

  mount(parent: HTMLElement): void {
    this.unmount();
    this.root = parent;
    this.rows.clear();
    this.renderInto(parent);
  }

  unmount(): void {
    this.root = null;
    this.rows.clear();
    this.summaryEl = null;
  }

  update(state: GameState): void {
    if (!this.root) return;
    const highest = state.wave.highestWave;
    const apThisCycle = this.deps.apThisCycle();
    let unlocked = 0;
    for (const entry of PROGRESSION_ENTRIES) {
      const els = this.rows.get(entry.id);
      if (!els) continue;
      const isUnlocked = this.isUnlocked(entry, highest, apThisCycle);
      if (isUnlocked) unlocked += 1;
      toggleClass(els.wrap, 'is-unlocked', isUnlocked);
      toggleClass(els.wrap, 'is-locked', !isUnlocked);
      setText(els.status, isUnlocked ? 'Unlocked' : this.remainingLabel(entry, highest, apThisCycle));
    }
    if (this.summaryEl) {
      setText(
        this.summaryEl,
        `${unlocked} / ${PROGRESSION_ENTRIES.length} unlocked · deepest wave ${formatInt(highest)}`,
      );
    }
  }

  /**
   * Wave-gated entries unlock at their wave; the AP-gated transcendence entry
   * is the one exception and is measured against the current cycle's AP.
   */
  private isUnlocked(entry: MilestoneDef, highestWave: number, apThisCycle: number): boolean {
    if (entry.wave === 0) return apThisCycle >= TRANSCENDENCE_UNLOCK_AP;
    return highestWave >= entry.wave;
  }

  private remainingLabel(entry: MilestoneDef, highestWave: number, apThisCycle: number): string {
    if (entry.wave === 0) {
      return `${formatInt(Math.max(0, TRANSCENDENCE_UNLOCK_AP - apThisCycle))} AP to go`;
    }
    return `${formatInt(Math.max(0, entry.wave - highestWave))} waves to go`;
  }

  private renderInto(parent: HTMLElement): void {
    parent.innerHTML = '';
    parent.className = 'progression-panel';

    const title = document.createElement('h2');
    title.className = 'panel-title';
    title.textContent = 'Progression';
    parent.appendChild(title);

    const summary = document.createElement('div');
    summary.className = 'progression-summary';
    this.summaryEl = summary;
    parent.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'progression-list';
    for (const entry of PROGRESSION_ENTRIES) {
      list.appendChild(this.renderRow(entry));
    }
    parent.appendChild(list);

    const note = document.createElement('p');
    note.className = 'panel-note';
    note.textContent = 'Unlocks are gated on your deepest wave, so they persist through an ascension '
      + 'even though the run itself restarts.';
    parent.appendChild(note);
  }

  private renderRow(entry: MilestoneDef): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'progression-row is-locked';
    wrap.dataset.milestoneId = entry.id;

    const gate = document.createElement('div');
    gate.className = 'progression-gate';
    gate.textContent = entry.wave > 0 ? `Wave ${entry.wave}` : `${TRANSCENDENCE_UNLOCK_AP} AP`;
    wrap.appendChild(gate);

    const glyph = document.createElement('div');
    glyph.className = 'progression-glyph';
    glyph.textContent = entry.glyph;
    setStyle(glyph, 'color', entry.color);
    wrap.appendChild(glyph);

    const body = document.createElement('div');
    body.className = 'progression-body';
    const label = document.createElement('div');
    label.className = 'progression-label';
    label.textContent = entry.label;
    const kind = document.createElement('span');
    kind.className = 'progression-kind';
    kind.textContent = milestoneKindLabel(entry.kind);
    kind.dataset.kind = entry.kind;
    // The badge is tinted by *kind* rather than by the entry's own colour, so
    // the categories read as groups down the list.
    setStyle(kind, '--kind-color', milestoneKindColor(entry.kind));
    label.appendChild(kind);
    body.appendChild(label);
    const detail = document.createElement('div');
    detail.className = 'progression-detail';
    detail.textContent = entry.detail;
    body.appendChild(detail);
    wrap.appendChild(body);

    const status = document.createElement('div');
    status.className = 'progression-status';
    wrap.appendChild(status);

    this.rows.set(entry.id, { wrap, status });
    return wrap;
  }
}
