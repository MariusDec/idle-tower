import { BALANCE } from '../content/balance';
import { EVOLUTION_BY_ID, EVOLUTION_OF } from '../content/evolutions';
import { FUSION_BY_ID } from '../content/fusions';
import { FALLBACKS, PASSIVE_BY_ID } from '../content/passives';
import { WEAPON_BY_ID } from '../content/weapons';
import type { ContentEntry } from '../content/types';
import type { Card } from '../sim/state';
import type { CardBadge } from '../sim/suggest';
import { cardKey } from '../sim/systems/draft';
import { icon } from './icon';
import { bindLongPress } from './longPress';
import { setStyle, setText, toggleClass } from './dom';

export interface DraftView {
  /** The level this draft was earned at. */
  level: number;
  cards: readonly Card[];
  suggested: number;
  /** False only for the first draft of the game, which waits for the player. */
  timed: boolean;
  /** Seconds before the suggestion is taken (shorter once the Tactician writes it, §6.2). */
  seconds: number;
  /** True for a card the player has seen before (no NEW stamp). */
  seen: (key: string) => boolean;
  /** Rerolls left this run; the button shows only when there are some. */
  rerolls: number;
  /** Banish charges left this run (N1); the button shows only when there are some. */
  banishes?: number;
  /** Which cards Banish may strike (new items only), by index. */
  banishable?: readonly boolean[];
  /** Drafts banked, this one included: from two, one tap takes every suggestion (U2). */
  banked?: number;
  /** The Opening (U2): the run started with drafts banked; this is draft `at` of `of`. */
  opening?: { at: number; of: number } | null;
  /** Wall seconds before the Opening takes every suggestion by itself (the Tactician); null: it waits. */
  autoTake?: number | null;
  /** How each card fits the build (U4), by card index. */
  badges?: readonly (readonly CardBadge[])[];
}

/** A badge's word on the card, and its line in the long-press details (R4). */
function badgeText(b: CardBadge): { short: string; long: string } {
  switch (b.kind) {
    case 'recipe': {
      const name = EVOLUTION_BY_ID[b.evolution].name;
      return b.completes ? { short: 'Completes', long: `Completes ${name}.` } : { short: 'Recipe', long: `A step toward ${name}.` };
    }
    case 'counter':
      return { short: 'Strong here', long: 'Strong against what walks in this region.' };
    case 'slot':
      return { short: `Slot ${b.slot}/${b.of}`, long: `Fills slot ${b.slot} of ${b.of}.` };
    default: {
      const exhaustive: never = b;
      return exhaustive;
    }
  }
}

/** What the draft's wall clock did this frame. */
export type DraftTick = 'timeout' | 'take-all' | null;

/** The first number-ish token in a card line, highlighted (§10.1). */
const KEY_NUMBER = /[+×]?\d+(?:\.\d+)?%?(?: s\b)?/;

/** The card's content entry and its one line for the level it leads to. */
function describe(card: Card): { entry: ContentEntry; line: string; kind: string } {
  switch (card.kind) {
    case 'weapon': {
      const def = WEAPON_BY_ID[card.id];
      return { entry: def, line: card.level === 1 ? def.text : def.steps[card.level - 2].text, kind: 'Weapon' };
    }
    case 'passive':
      return { entry: PASSIVE_BY_ID[card.id], line: PASSIVE_BY_ID[card.id].text, kind: 'Passive' };
    case 'evolution':
      return { entry: EVOLUTION_BY_ID[card.id], line: EVOLUTION_BY_ID[card.id].text, kind: 'Evolution' };
    case 'fusion':
      return { entry: FUSION_BY_ID[card.id], line: FUSION_BY_ID[card.id].text, kind: 'Fusion' };
    case 'fallback': {
      const def = FALLBACKS.find((f) => f.id === card.id)!;
      return { entry: def, line: def.text, kind: '' };
    }
    default: {
      const exhaustive: never = card;
      return exhaustive;
    }
  }
}

/** The long-press details (R4): everything the one line leaves out. */
function details(card: Card): string[] {
  switch (card.kind) {
    case 'weapon': {
      const def = WEAPON_BY_ID[card.id];
      return [def.text, ...def.steps.map((s) => s.text)].map((t, i) => `${i + 1 === card.level ? '▸' : ' '} L${i + 1}  ${t}`);
    }
    case 'passive':
      return [`Level ${card.level} of ${BALANCE.maxLevel}.`, `Each level: ${PASSIVE_BY_ID[card.id].text}`];
    case 'evolution': {
      const e = EVOLUTION_BY_ID[card.id];
      return [`${WEAPON_BY_ID[e.weapon].name} + ${PASSIVE_BY_ID[e.passive].name}.`, e.text, 'Found recipes are kept in the Recipe Book.'];
    }
    case 'fusion': {
      const f = FUSION_BY_ID[card.id];
      const [a, b] = f.weapons.map((id) => EVOLUTION_OF[id].name);
      const more = Math.round((BALANCE.fusions.damage - 1) * 100);
      return [`${a} + ${b}: one mount, a slot freed, both +${more}% damage.`, f.text, 'Found fusions are kept in the Recipe Book.'];
    }
    case 'fallback':
      return [describe(card).line];
    default: {
      const exhaustive: never = card;
      return exhaustive;
    }
  }
}

function lineWithNumber(line: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'draft-card-text';
  const m = KEY_NUMBER.exec(line);
  if (!m) {
    p.textContent = line;
    return p;
  }
  const b = document.createElement('b');
  b.className = 'draft-card-num';
  b.textContent = m[0];
  p.append(line.slice(0, m.index), b, line.slice(m.index + m[0].length));
  return p;
}

/**
 * The level-up draft (§4.5, §10.1): three tall cards, one suggested. The
 * arena keeps running behind it; the timer takes the suggested card when it
 * runs out. Tap to pick, hold for details.
 */
export class DraftPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly row: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly timerFill: HTMLElement;
  private remaining = 0;
  private timed = false;
  private seconds: number = BALANCE.draft.seconds;
  private holding = false;

  private readonly reroll: HTMLButtonElement;
  private readonly banish: HTMLButtonElement;
  private readonly take: HTMLButtonElement;
  /** True while a tap on a card banishes it instead of taking it (N1). */
  private banishing = false;
  /** Seconds left before the Opening takes every suggestion; null when it waits. */
  private autoTake: number | null = null;
  private takeLabel = '';

  constructor(
    host: HTMLElement,
    private readonly onPick: (index: number) => void,
    onReroll: () => void,
    onTakeAll: () => void,
    /** Banish card `index` (N1). */
    private readonly onBanish: (index: number) => void,
    /** The player touched the Opening: it stops counting down, to be reviewed. */
    private readonly onReview: () => void = () => {},
  ) {
    this.root = document.createElement('section');
    this.root.className = 'draft';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Level up');
    this.root.innerHTML = `
      <h2 class="draft-title"></h2>
      <p class="draft-hint"></p>
      <div class="draft-row"></div>
      <div class="draft-actions">
        <button type="button" class="btn draft-reroll" hidden></button>
        <button type="button" class="btn draft-banish" hidden aria-pressed="false"></button>
        <button type="button" class="btn draft-take" hidden></button>
      </div>
      <div class="draft-timer" aria-hidden="true"><div class="draft-timer-fill"></div></div>`;
    this.reroll = this.root.querySelector('.draft-reroll')!;
    this.reroll.addEventListener('click', onReroll);
    this.banish = this.root.querySelector('.draft-banish')!;
    this.banish.addEventListener('click', () => this.setBanishing(!this.banishing));
    this.take = this.root.querySelector('.draft-take')!;
    this.take.addEventListener('click', () => {
      this.autoTake = null;
      onTakeAll();
    });
    // Any other touch on the panel stops the Opening's count: the player is reading.
    this.root.addEventListener('pointerdown', (ev) => {
      if (this.autoTake === null || (ev.target as HTMLElement).closest('.draft-take')) return;
      this.autoTake = null;
      this.paintTake();
      this.onReview();
    });
    this.title = this.root.querySelector('.draft-title')!;
    this.hint = this.root.querySelector('.draft-hint')!;
    this.row = this.root.querySelector('.draft-row')!;
    this.timer = this.root.querySelector('.draft-timer')!;
    this.timerFill = this.root.querySelector('.draft-timer-fill')!;
    this.row.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>('.draft-card');
      if (!el) return;
      if (!this.banishing) {
        this.onPick(Number(el.dataset.index));
        return;
      }
      // Banish mode (N1): a card it may strike goes; any other tap leaves the mode.
      const index = Number(el.dataset.index);
      this.setBanishing(false);
      if (el.classList.contains('is-banishable')) this.onBanish(index);
    });
    bindLongPress(this.row, {
      selector: '.draft-card',
      onLongPress: (el) => {
        el.classList.add('is-detail');
        this.holding = true;
      },
      onRelease: (el) => {
        el.classList.remove('is-detail');
        this.holding = false;
      },
    });
    host.appendChild(this.root);
    this.hide();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(view: DraftView): void {
    const opening = view.opening ?? null;
    this.title.textContent = opening ? `Opening · ${opening.at} of ${opening.of}` : `Level ${view.level}`;
    this.hint.textContent = view.timed ? '' : 'Pick one. Every level-up offers new cards.';
    this.hint.hidden = view.timed;
    this.timed = view.timed;
    this.seconds = view.seconds;
    this.remaining = view.seconds;
    this.holding = false;
    this.timer.hidden = !view.timed;
    setStyle(this.timerFill, 'transform', 'scaleX(1)');
    this.reroll.hidden = view.rerolls <= 0 || !view.timed;
    this.reroll.textContent = `Reroll · ${view.rerolls}`;
    const banishes = view.banishes ?? 0;
    this.banish.hidden = banishes <= 0 || !view.timed || !(view.banishable ?? []).some(Boolean);
    this.banish.textContent = `Banish · ${banishes}`;
    this.setBanishing(false);
    // Two or more banked (U2): one tap takes every suggestion. In the Opening it leads.
    const banked = view.banked ?? 1;
    this.take.hidden = banked < 2 || !view.timed;
    toggleClass(this.take, 'btn-primary', opening !== null);
    this.takeLabel = opening ? `Take all ${banked} suggested` : `Take suggested ×${banked}`;
    this.autoTake = opening && view.timed ? view.autoTake ?? null : null;
    this.paintTake();
    this.row.replaceChildren(...view.cards.map((c, i) => {
      const el = this.card(c, i, i === view.suggested, !view.seen(cardKey(c)), view.badges?.[i] ?? []);
      toggleClass(el, 'is-banishable', banishes > 0 && (view.banishable?.[i] ?? false));
      return el;
    }));
    // Past four cards (Choice, Foresight, Jackpot), the hand wraps into rows of three.
    toggleClass(this.row, 'is-many', view.cards.length > 4);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.holding = false;
    this.autoTake = null;
    this.setBanishing(false);
  }

  /** Banish mode (N1): the cards it may strike wear a mark, and the next tap on one strikes it. */
  private setBanishing(on: boolean): void {
    this.banishing = on;
    this.banish.setAttribute('aria-pressed', String(on));
    toggleClass(this.banish, 'is-active', on);
    toggleClass(this.row, 'is-banishing', on);
    this.hint.hidden = !on && this.timed;
    if (on) this.hint.textContent = 'Tap a new card to banish it for this run.';
    else if (this.timed) this.hint.textContent = '';
  }

  /** Run the timers on the wall clock: the draft's own, and the Opening's take-all (U2). */
  tick(realDt: number): DraftTick {
    // Holding a card, or choosing what to banish, stops the clock.
    if (!this.open || !this.timed || this.holding || this.banishing) return null;
    if (this.autoTake !== null) {
      this.autoTake = Math.max(0, this.autoTake - realDt);
      this.paintTake();
      if (this.autoTake === 0) {
        this.autoTake = null;
        return 'take-all';
      }
    }
    this.remaining = Math.max(0, this.remaining - realDt);
    setStyle(this.timerFill, 'transform', `scaleX(${(this.remaining / this.seconds).toFixed(3)})`);
    return this.remaining === 0 ? 'timeout' : null;
  }

  private paintTake(): void {
    setText(this.take, this.autoTake === null ? this.takeLabel : `${this.takeLabel} · ${Math.ceil(this.autoTake)}`);
  }

  private card(card: Card, index: number, suggested: boolean, isNew: boolean, badges: readonly CardBadge[]): HTMLElement {
    const { entry, line, kind } = describe(card);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `draft-card draft-card-${card.kind}${suggested ? ' is-suggested' : ''}`;
    el.dataset.index = String(index);
    el.setAttribute('aria-label', `${entry.name}. ${line}`);

    const head = document.createElement('div');
    head.className = 'draft-card-head';
    if (isNew) {
      const stamp = document.createElement('span');
      stamp.className = 'draft-card-new';
      stamp.textContent = 'New';
      head.appendChild(stamp);
    }
    if (suggested) {
      const tag = document.createElement('span');
      tag.className = 'draft-card-suggested';
      tag.textContent = 'Suggested';
      head.appendChild(tag);
    }
    el.appendChild(head);

    const art = document.createElement('div');
    art.className = 'draft-card-icon';
    art.appendChild(icon(entry.icon));
    el.appendChild(art);

    const name = document.createElement('h3');
    name.className = 'draft-card-name';
    name.textContent = entry.name;
    el.appendChild(name);

    if (kind) {
      const k = document.createElement('p');
      k.className = 'draft-card-kind';
      const fresh = 'level' in card && card.level === 1 && (kind === 'Weapon' || kind === 'Passive');
      k.textContent = fresh ? `New ${kind.toLowerCase()}` : kind;
      el.appendChild(k);
    }

    el.appendChild(lineWithNumber(line));

    // How it fits the build (U4): a word each; the details say the rest.
    if (badges.length > 0) {
      const row = document.createElement('div');
      row.className = 'draft-card-badges';
      for (const b of badges) {
        const tag = document.createElement('span');
        tag.className = `draft-card-badge is-${b.kind}${b.kind === 'recipe' && b.completes ? ' is-complete' : ''}`;
        if (b.kind === 'recipe') tag.append(icon(EVOLUTION_BY_ID[b.evolution].icon));
        tag.append(badgeText(b).short);
        row.appendChild(tag);
      }
      el.appendChild(row);
      el.setAttribute('aria-label', `${entry.name}. ${line} ${badges.map((b) => badgeText(b).long).join(' ')}`);
    }

    if (card.kind === 'weapon' || card.kind === 'passive') {
      const pips = document.createElement('div');
      pips.className = 'draft-card-pips';
      for (let i = 1; i <= BALANCE.maxLevel; i++) {
        const pip = document.createElement('span');
        pip.className = i < card.level ? 'pip is-owned' : i === card.level ? 'pip is-next' : 'pip';
        pips.appendChild(pip);
      }
      el.appendChild(pips);
    }

    const more = document.createElement('div');
    more.className = 'draft-card-details';
    for (const d of [...details(card), ...badges.map((b) => badgeText(b).long)]) {
      const p = document.createElement('p');
      p.textContent = d;
      more.appendChild(p);
    }
    el.appendChild(more);
    return el;
  }
}
