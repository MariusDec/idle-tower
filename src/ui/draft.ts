import { BALANCE } from '../content/balance';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import { FALLBACKS, PASSIVE_BY_ID } from '../content/passives';
import { WEAPON_BY_ID } from '../content/weapons';
import type { ContentEntry } from '../content/types';
import type { Card } from '../sim/state';
import { cardKey } from '../sim/systems/draft';
import { icon } from './icon';
import { bindLongPress } from './longPress';
import { setStyle } from './dom';

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
}

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

  constructor(
    host: HTMLElement,
    private readonly onPick: (index: number) => void,
    onReroll: () => void,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'draft';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Level up');
    this.root.innerHTML = `
      <h2 class="draft-title"></h2>
      <p class="draft-hint"></p>
      <div class="draft-row"></div>
      <button type="button" class="btn draft-reroll" hidden></button>
      <div class="draft-timer" aria-hidden="true"><div class="draft-timer-fill"></div></div>`;
    this.reroll = this.root.querySelector('.draft-reroll')!;
    this.reroll.addEventListener('click', onReroll);
    this.title = this.root.querySelector('.draft-title')!;
    this.hint = this.root.querySelector('.draft-hint')!;
    this.row = this.root.querySelector('.draft-row')!;
    this.timer = this.root.querySelector('.draft-timer')!;
    this.timerFill = this.root.querySelector('.draft-timer-fill')!;
    this.row.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>('.draft-card');
      if (el) this.onPick(Number(el.dataset.index));
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
    this.title.textContent = `Level ${view.level}`;
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
    this.row.replaceChildren(...view.cards.map((c, i) => this.card(c, i, i === view.suggested, !view.seen(cardKey(c)))));
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.holding = false;
  }

  /** Run the timer on the wall clock. True when it has just run out. */
  tick(realDt: number): boolean {
    if (!this.open || !this.timed || this.holding) return false;
    this.remaining = Math.max(0, this.remaining - realDt);
    setStyle(this.timerFill, 'transform', `scaleX(${(this.remaining / this.seconds).toFixed(3)})`);
    return this.remaining === 0;
  }

  private card(card: Card, index: number, suggested: boolean, isNew: boolean): HTMLElement {
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
      k.textContent = 'level' in card && card.level === 1 ? `New ${kind.toLowerCase()}` : kind;
      el.appendChild(k);
    }

    el.appendChild(lineWithNumber(line));

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
    for (const d of details(card)) {
      const p = document.createElement('p');
      p.textContent = d;
      more.appendChild(p);
    }
    el.appendChild(more);
    return el;
  }
}
