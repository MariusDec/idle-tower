import type { GameState } from '../types';
import type { MilestoneDef } from '../data/milestones';
import { PROGRESSION_ENTRIES, progressionEntries, milestoneKindColor, milestoneKindLabel } from '../data/milestones';
import { TRANSCENDENCE_UNLOCK_AP, abilityUnlockOffset } from '../data/prestige';
import {
  BLESSING_MAX_PICKS,
  BLESSING_RARITY_COLORS,
  describeBlessing,
  type BlessingDef,
} from '../data/blessings';
import { rewardParts, type RewardPart } from '../data/contracts';
import { formatInt } from '../utils/bigNumber';
import { setText, setStyle, toggleClass } from '../utils/dom';
import { renderIcon } from './Icon';

/** What the panel needs to know about the run's blessing draft (plan §1.4). */
export interface ProgressionBlessingInfo {
  held: ReadonlyArray<{ def: BlessingDef; stacks: number }>;
  picksTaken: number;
  rerolls: number;
  /** Wave the next draft lands on, or null once the pick cap is reached. */
  nextDraftWave: number | null;
}

/** What the panel needs to know about the run's contracts (plan §5.3). */
export interface ProgressionContractInfo {
  live: ReadonlyArray<{
    uid: number;
    name: string;
    label: string;
    progress: string;
    fill: number;
    reward: string;
  }>;
  /**
   * Completions this run, oldest first, with what each one paid.
   *
   * The payout is carried as numbers rather than a formatted blurb so the
   * history can both chip each part and total the column — a run's contract
   * gold is the figure the section exists to make visible.
   */
  history: ReadonlyArray<{
    name: string;
    wave: number;
    gold: number;
    rerolls: number;
    rp: number;
    apBonusPct: number;
  }>;
  completed: number;
  /** Contract AP bonus banked this run, as a fraction. */
  apBonusPct: number;
  apCapPct: number;
}

export interface ProgressionPanelDeps {
  /** AP banked in the current transcendence cycle, for the AP-gated entries. */
  apThisCycle: () => number;
  /** The run's blessings. Absent before the game wires its API in. */
  blessings?: () => ProgressionBlessingInfo;
  /** The run's contracts. Absent before the game wires its API in. */
  contracts?: () => ProgressionContractInfo;
}

interface RowEls {
  wrap: HTMLElement;
  status: HTMLElement;
  /** Held so the wave label can move with Attunement (prestige-abs §5). */
  gate: HTMLElement;
  detail: HTMLElement;
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
  private deps: ProgressionPanelDeps;
  private root: HTMLElement | null = null;
  private rows = new Map<string, RowEls>();
  private summaryEl: HTMLElement | null = null;
  private blessingSummaryEl: HTMLElement | null = null;
  private blessingListEl: HTMLElement | null = null;
  /** Last rendered signature, so the list is only rebuilt when it changes. */
  private blessingSignature = '';
  private contractSummaryEl: HTMLElement | null = null;
  private contractListEl: HTMLElement | null = null;
  private contractHistoryEl: HTMLElement | null = null;
  private contractHistoryToggleEl: HTMLElement | null = null;
  private contractHistoryCountEl: HTMLElement | null = null;
  private contractHistoryBodyEl: HTMLElement | null = null;
  private contractSignature = '';
  /**
   * Whether the completed list is expanded. Collapsed by default — the run's
   * *live* contracts are what the section is for, and by wave 60 the history
   * is forty rows that push everything below it off the screen.
   *
   * Deliberately **not** cleared by `unmount`: switching tabs and coming back
   * remounts the panel, and a disclosure that forgets it was open is a worse
   * bug than the one this field costs.
   */
  private contractHistoryOpen = false;

  constructor(deps: ProgressionPanelDeps) {
    this.deps = deps;
  }

  setDeps(deps: ProgressionPanelDeps): void {
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
    this.blessingSummaryEl = null;
    this.blessingListEl = null;
    this.blessingSignature = '';
    this.contractSummaryEl = null;
    this.contractListEl = null;
    this.contractHistoryEl = null;
    this.contractHistoryToggleEl = null;
    this.contractHistoryCountEl = null;
    this.contractHistoryBodyEl = null;
    this.contractSignature = '';
  }

  update(state: GameState): void {
    if (!this.root) return;
    this.updateBlessings();
    this.updateContracts();
    const highest = state.wave.highestWave;
    const apThisCycle = this.deps.apThisCycle();
    // Attunement (prestige-abs §5) moves the ability gates, so the wave shown
    // on a row is derived per update rather than baked at render time. The row
    // *set* never changes — only the numbers on it — so the DOM is untouched.
    const entries = progressionEntries(abilityUnlockOffset(state.prestige.apSpent));
    let unlocked = 0;
    for (const entry of entries) {
      const els = this.rows.get(entry.id);
      if (!els) continue;
      const isUnlocked = this.isUnlocked(entry, highest, apThisCycle);
      if (isUnlocked) unlocked += 1;
      toggleClass(els.wrap, 'is-unlocked', isUnlocked);
      toggleClass(els.wrap, 'is-locked', !isUnlocked);
      setText(els.gate, entry.wave > 0 ? `Wave ${entry.wave}` : `${TRANSCENDENCE_UNLOCK_AP} AP`);
      setText(els.detail, entry.detail);
      setText(els.status, isUnlocked ? 'Unlocked' : this.remainingLabel(entry, highest, apThisCycle));
    }
    if (this.summaryEl) {
      setText(
        this.summaryEl,
        `${unlocked} / ${entries.length} unlocked · deepest wave ${formatInt(highest)}`,
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

    if (this.deps.contracts) parent.appendChild(this.renderContractSection());
    if (this.deps.blessings) parent.appendChild(this.renderBlessingSection());

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

  /**
   * The held-blessing list (plan §1.4).
   *
   * It lives here rather than in a tab of its own: blessings are run-scoped
   * progression, which is exactly what this panel is already about, and a
   * twelfth tab for a list that is empty for the first three waves is a worse
   * trade than a section that appears in context.
   */
  private renderBlessingSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'blessing-section';

    const title = document.createElement('h3');
    title.className = 'blessing-section-title';
    title.textContent = 'Blessings — this run';
    section.appendChild(title);

    const summary = document.createElement('div');
    summary.className = 'blessing-section-summary';
    this.blessingSummaryEl = summary;
    section.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'blessing-held-list';
    this.blessingListEl = list;
    section.appendChild(list);

    return section;
  }

  private updateBlessings(): void {
    const get = this.deps.blessings;
    if (!get || !this.blessingListEl || !this.blessingSummaryEl) return;
    const info = get();
    if (this.blessingSummaryEl) {
      const next = info.nextDraftWave === null
        ? 'pick cap reached'
        : `next draft after wave ${formatInt(info.nextDraftWave)}`;
      setText(
        this.blessingSummaryEl,
        `${info.picksTaken} / ${BLESSING_MAX_PICKS} picks · ${formatInt(info.rerolls)} reroll`
        + `${info.rerolls === 1 ? '' : 's'} · ${next}`,
      );
    }
    // Rebuilding the list every UI frame would churn the DOM for a list that
    // only changes a few times a run, so it is keyed on its own contents.
    const signature = info.held.map(h => `${h.def.id}:${h.stacks}`).join('|');
    if (signature === this.blessingSignature) return;
    this.blessingSignature = signature;
    this.blessingListEl.innerHTML = '';
    if (info.held.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'blessing-held-none';
      empty.textContent = info.nextDraftWave === null
        ? 'No blessings this run.'
        : `No blessings yet — the first draft lands after wave ${formatInt(info.nextDraftWave)}.`;
      this.blessingListEl.appendChild(empty);
      return;
    }
    for (const { def, stacks } of info.held) {
      const row = document.createElement('div');
      row.className = 'blessing-held-row';
      setStyle(row, '--bl-color', BLESSING_RARITY_COLORS[def.rarity]);

      const name = document.createElement('div');
      name.className = 'blessing-held-name';
      name.textContent = stacks > 1 ? `${def.name} ×${stacks}` : def.name;
      row.appendChild(name);

      const desc = document.createElement('div');
      desc.className = 'blessing-held-desc';
      desc.textContent = describeBlessing(def, stacks);
      row.appendChild(desc);

      const rarity = document.createElement('div');
      rarity.className = 'blessing-held-rarity';
      rarity.textContent = def.rarity;
      row.appendChild(rarity);

      this.blessingListEl.appendChild(row);
    }
  }

  /**
   * The contracts section (plan §5.3): the three live rows in full, plus what
   * the run has already banked.
   *
   * The tracker in the corner is deliberately terse — a name and `12 / 40` —
   * so this is where the *goal* text and the reward live. Above the blessing
   * list because contracts turn over every few waves and blessings do not.
   */
  private renderContractSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'contract-section';

    const title = document.createElement('h3');
    title.className = 'blessing-section-title';
    title.textContent = 'Contracts — this run';
    section.appendChild(title);

    const summary = document.createElement('div');
    summary.className = 'blessing-section-summary';
    this.contractSummaryEl = summary;
    section.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'contract-live-list';
    this.contractListEl = list;
    section.appendChild(list);

    section.appendChild(this.renderContractHistory());

    return section;
  }

  /**
   * The completed list, behind a disclosure.
   *
   * The header and the body are built once and only their *contents* are
   * rebuilt, so toggling the disclosure never has to wait for the next update
   * tick and the open state cannot be lost to a signature-driven redraw.
   */
  private renderContractHistory(): HTMLElement {
    const history = document.createElement('div');
    history.className = 'contract-history';
    this.contractHistoryEl = history;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'contract-history-toggle';
    toggle.setAttribute('aria-expanded', String(this.contractHistoryOpen));

    const caret = document.createElement('span');
    caret.className = 'contract-history-caret';
    caret.textContent = '▸';
    toggle.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'contract-history-label';
    label.textContent = 'Completed';
    toggle.appendChild(label);

    const count = document.createElement('span');
    count.className = 'contract-history-count';
    this.contractHistoryCountEl = count;
    toggle.appendChild(count);

    toggle.addEventListener('click', () => {
      this.contractHistoryOpen = !this.contractHistoryOpen;
      this.applyHistoryOpen();
    });
    this.contractHistoryToggleEl = toggle;
    history.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'contract-history-body';
    this.contractHistoryBodyEl = body;
    history.appendChild(body);

    this.applyHistoryOpen();
    return history;
  }

  private applyHistoryOpen(): void {
    if (!this.contractHistoryEl || !this.contractHistoryToggleEl) return;
    toggleClass(this.contractHistoryEl, 'is-open', this.contractHistoryOpen);
    this.contractHistoryToggleEl.setAttribute('aria-expanded', String(this.contractHistoryOpen));
  }

  private updateContracts(): void {
    const get = this.deps.contracts;
    if (!get || !this.contractListEl || !this.contractSummaryEl || !this.contractHistoryEl) return;
    const info = get();
    const apPct = Math.round(info.apBonusPct * 100);
    const capPct = Math.round(info.apCapPct * 100);
    setText(
      this.contractSummaryEl,
      `${formatInt(info.completed)} completed · +${apPct}% AP this run`
      + `${apPct >= capPct ? ` (capped at +${capPct}%)` : ` / +${capPct}% cap`}`,
    );

    // Same treatment the blessing list gets: the rows only change a few dozen
    // times a run, so the DOM is keyed on its own contents rather than rebuilt
    // every UI tick.
    const signature = info.live.map(c => `${c.uid}:${c.progress}`).join('|')
      + `#${info.history.length}`;
    if (signature === this.contractSignature) return;
    this.contractSignature = signature;

    this.contractListEl.innerHTML = '';
    for (const c of info.live) {
      const row = document.createElement('div');
      row.className = 'contract-live-row';

      const fill = document.createElement('div');
      fill.className = 'contract-live-fill';
      setStyle(fill, 'width', `${(Math.max(0, Math.min(1, c.fill)) * 100).toFixed(1)}%`);
      row.appendChild(fill);

      const body = document.createElement('div');
      body.className = 'contract-live-body';
      const name = document.createElement('div');
      name.className = 'contract-live-name';
      name.textContent = c.name;
      body.appendChild(name);
      const detail = document.createElement('div');
      detail.className = 'contract-live-detail';
      detail.textContent = c.label;
      body.appendChild(detail);
      row.appendChild(body);

      const right = document.createElement('div');
      right.className = 'contract-live-right';
      const progress = document.createElement('div');
      progress.className = 'contract-live-progress';
      progress.textContent = c.progress;
      right.appendChild(progress);
      const reward = document.createElement('div');
      reward.className = 'contract-live-reward';
      reward.textContent = c.reward;
      right.appendChild(reward);
      row.appendChild(right);

      this.contractListEl.appendChild(row);
    }

    this.renderHistoryContents(info);
  }

  /**
   * Fill the disclosure: a totals line, then one card per completion.
   *
   * Newest first — the tail of the ring buffer is the interesting end, and it
   * is the one the player just watched flourish out of the corner tracker.
   */
  private renderHistoryContents(info: ProgressionContractInfo): void {
    const body = this.contractHistoryBodyEl;
    if (!body) return;
    if (this.contractHistoryCountEl) {
      setText(this.contractHistoryCountEl, formatInt(info.history.length));
    }
    body.innerHTML = '';
    if (info.history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'blessing-held-none';
      empty.textContent = 'No contracts completed yet this run.';
      body.appendChild(empty);
      return;
    }

    // The run's take, summed from the same numbers the cards show. Gold is the
    // reason the totals row exists: one payout reads as small, and twenty of
    // them are a meaningful share of a run's income.
    const totals = { gold: 0, rerolls: 0, rp: 0, apBonusPct: 0 };
    for (const entry of info.history) {
      totals.gold += entry.gold;
      totals.rerolls += entry.rerolls;
      totals.rp += entry.rp;
      totals.apBonusPct += entry.apBonusPct;
    }
    const totalParts = rewardParts(totals);
    if (totalParts.length > 0) {
      const row = document.createElement('div');
      row.className = 'contract-history-totals';
      const label = document.createElement('span');
      label.className = 'contract-history-totals-label';
      label.textContent = 'Earned this run';
      row.appendChild(label);
      row.appendChild(this.renderRewardChips(totalParts));
      body.appendChild(row);
    }

    for (let i = info.history.length - 1; i >= 0; i--) {
      const entry = info.history[i];
      const card = document.createElement('div');
      card.className = 'contract-history-card';

      const wave = document.createElement('div');
      wave.className = 'contract-history-wave';
      // A pre-`log` save restores its completions without a wave; the slot
      // keeps its width so the column of names stays aligned either way.
      wave.textContent = entry.wave > 0 ? `W${formatInt(entry.wave)}` : '—';
      card.appendChild(wave);

      const name = document.createElement('div');
      name.className = 'contract-history-name';
      name.textContent = entry.name;
      card.appendChild(name);

      const parts = rewardParts(entry);
      if (parts.length > 0) {
        card.appendChild(this.renderRewardChips(parts));
      } else {
        const none = document.createElement('div');
        none.className = 'contract-reward-chips';
        card.appendChild(none);
      }
      body.appendChild(card);
    }
  }

  private renderRewardChips(parts: ReadonlyArray<RewardPart>): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'contract-reward-chips';
    for (const part of parts) {
      const chip = document.createElement('span');
      chip.className = `contract-reward-chip is-${part.kind}`;
      chip.textContent = part.text;
      wrap.appendChild(chip);
    }
    return wrap;
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
    renderIcon(glyph, entry.icon);
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

    this.rows.set(entry.id, { wrap, status, gate, detail });
    return wrap;
  }
}
