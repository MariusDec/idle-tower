import { frameById } from '../../content/frames';
import { regionByIndex } from '../../content/regions';
import { WEAPON_BY_ID } from '../../content/weapons';
import {
  bandDots, compareLine, digits, findResult, omenBand, omenDay, omenHistory, omenLabel, omenMods, resultLine, rollOmen, scoredFree,
  scoredNow, type OmenResult,
} from '../../meta/omen';
import type { Profile } from '../../meta/profile';
import { buildChips } from '../build';
import { icon } from '../icon';

export interface OmenActions {
  /** Start day `n`'s Omen: its scored try if still free, else practice. */
  begin(n: number): void;
  /** Put a line on the clipboard; true when it landed. */
  copy(text: string): Promise<boolean>;
  /** Leave for the home view. */
  done(): void;
}

/** The rank a bane is at, as the card says it: "Hordes II". */
const RANKS = ['', 'I', 'II', 'III'];

/**
 * The Daily Omen's view (plans/late-game/11 §2): today's card, the scored
 * try or its score, yesterday's grace, the player's last seven days, and a
 * field to paste a friend's result into. A view like the Pacts: no tab,
 * opened from the home view.
 */
export class OmenView {
  readonly root: HTMLElement;
  private readonly date: HTMLElement;
  private readonly body: HTMLElement;
  private profile: Profile | null = null;
  /** The friend's result last pasted, while the view stays open. */
  private theirs: OmenResult | null = null;
  private pasteOpen = false;

  constructor(host: HTMLElement, private readonly actions: OmenActions) {
    this.root = document.createElement('div');
    this.root.className = 'pacts omen';
    this.root.innerHTML = `
      <header class="view-head">
        <h2 class="view-title">The Daily Omen</h2>
        <span class="omen-date"></span>
      </header>
      <div class="omen-body"></div>
      <button type="button" class="btn tactics-done">Done</button>`;
    this.date = this.root.querySelector('.omen-date')!;
    this.body = this.root.querySelector('.omen-body')!;
    this.root.querySelector('.tactics-done')!.addEventListener('click', () => actions.done());
    host.appendChild(this.root);
  }

  show(profile: Profile): void {
    this.profile = profile;
    this.render();
  }

  private render(): void {
    const p = this.profile;
    if (!p) return;
    const today = omenDay(Date.now());
    this.date.textContent = omenLabel(today);
    const parts: HTMLElement[] = [this.card(today), ...this.status(p, today)];
    const yesterday = this.yesterday(p, today - 1);
    if (yesterday) parts.push(yesterday);
    parts.push(this.strip(p, today), ...this.paste(p, today));
    this.body.replaceChildren(...parts);
  }

  /** The day's card: region, frame, pool, then the boon, twist and banes. */
  private card(n: number): HTMLElement {
    const roll = rollOmen(n);
    const region = regionByIndex(roll.region);
    const frame = frameById(roll.frame);
    const el = document.createElement('div');
    el.className = 'entry omen-card';
    const head = document.createElement('div');
    head.className = 'entry-head';
    const name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = region.name;
    head.append(icon(region.icon), name);
    const who = document.createElement('p');
    who.className = 'entry-text omen-frame';
    who.textContent = `${frame.name} · starts ${WEAPON_BY_ID[frame.startingWeapon].name}.`;
    // Hold a weapon for its card (src/ui/peek.ts): the hub binds the peek.
    const pool = document.createElement('div');
    pool.className = 'omen-pool';
    const label = document.createElement('span');
    label.className = 'omen-pool-label';
    label.textContent = 'Pool';
    pool.append(label, ...buildChips({ weapons: roll.pool.map((id) => ({ id, level: 1, evolved: false, fusion: null })), passives: [] }));
    const mods = document.createElement('ul');
    mods.className = 'omen-mods';
    const banes: string[] = [];
    for (const { def, rank } of omenMods(roll)) {
      if (def.slot === 'bane') {
        banes.push(`${def.name} ${RANKS[rank] ?? rank}`);
        continue;
      }
      mods.append(modLine(def.slot === 'boon' ? '▲' : '◆', def.text, `is-${def.slot}`));
    }
    if (banes.length > 0) mods.append(modLine('▼', banes.join(' · '), 'is-bane'));
    el.append(head, who, pool, mods);
    return el;
  }

  /** Today's scored try, or its score with Copy and Practise. */
  private status(p: Profile, n: number): HTMLElement[] {
    const score = p.omen.days[n]?.score;
    const note = document.createElement('p');
    note.className = 'entry-text omen-note';
    if (!score) {
      note.textContent = scoredFree(p, n) ? 'Not played yet. Your first try counts.' : 'Practice: today pays nothing.';
      const begin = button('Begin the Omen', 'btn btn-primary btn-big omen-begin', () => this.actions.begin(n));
      return [note, begin];
    }
    note.classList.add('omen-score');
    note.textContent = `Wave ${score.wave} · ${digits(score.kills)} slain  ${bandDots(omenBand(score.wave))}`;
    const best = p.omen.days[n]?.practice;
    const extra: HTMLElement[] = [];
    if (best) {
      const b = document.createElement('p');
      b.className = 'entry-text omen-practice';
      b.textContent = `Practice best: wave ${best.wave} · ${digits(best.kills)} slain`;
      extra.push(b);
    }
    const row = document.createElement('div');
    row.className = 'omen-actions';
    row.append(
      this.copyButton('Copy result', resultLine(n, score.wave, score.kills, score.resumes, false)),
      button('Practise', 'btn btn-primary omen-practise', () => this.actions.begin(n)),
    );
    return [note, ...extra, row];
  }

  /** Yesterday: its score with a Copy, or "Play yesterday's" while its grace holds. Older days don't show. */
  private yesterday(p: Profile, n: number): HTMLElement | null {
    const score = p.omen.days[n]?.score;
    if (score) {
      const row = document.createElement('div');
      row.className = 'omen-yesterday';
      const text = document.createElement('span');
      text.textContent = `Yesterday · ${regionByIndex(rollOmen(n).region).name} · wave ${score.wave} ${bandDots(omenBand(score.wave))}`;
      row.append(text, this.copyButton('Copy', resultLine(n, score.wave, score.kills, score.resumes, false)));
      return row;
    }
    if (!scoredFree(p, n)) return null;
    return button('Play yesterday’s', 'btn omen-grace', () => this.actions.begin(n));
  }

  /** The last seven days: a wave, or "—" for a day not played. A missed day looks like a day off. */
  private strip(p: Profile, today: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'omen-strip';
    const head = document.createElement('p');
    head.className = 'omen-strip-head';
    head.textContent = 'Last 7 days';
    const list = document.createElement('ol');
    list.className = 'omen-strip-days';
    for (const d of omenHistory(p, today)) {
      const li = document.createElement('li');
      li.textContent = d.day === today && d.wave === null ? 'today' : d.wave === null ? '—' : String(d.wave);
      li.setAttribute('aria-label', `${omenLabel(d.day)}: ${d.wave === null ? 'not played' : `wave ${d.wave}`}`);
      list.append(li);
    }
    el.append(head, list);
    return el;
  }

  /** Paste a friend's result: the whole message; only the code in it is read. */
  private paste(p: Profile, today: number): HTMLElement[] {
    if (!this.pasteOpen) return [button('Paste a friend’s result', 'btn omen-paste-open', () => { this.pasteOpen = true; this.render(); })];
    const field = document.createElement('textarea');
    field.className = 'omen-paste';
    field.rows = 3;
    field.placeholder = 'Paste their message here';
    field.setAttribute('aria-label', 'A friend’s result');
    const err = document.createElement('p');
    err.className = 'entry-text omen-paste-error';
    err.hidden = true;
    const go = button('Compare', 'btn btn-primary omen-compare', () => {
      const r = findResult(field.value);
      if (!r) {
        err.textContent = 'No result code found in that.';
        err.hidden = false;
        return;
      }
      this.theirs = r;
      this.render();
    });
    const out: HTMLElement[] = [field, err, go];
    if (this.theirs) out.push(this.compare(p, this.theirs, today));
    return out;
  }

  /** Theirs against yours on their date (§2), and the way to play it. */
  private compare(p: Profile, r: OmenResult, today: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'entry omen-compare-card';
    const head = document.createElement('p');
    head.className = 'entry-name';
    head.textContent = `${omenLabel(r.day)} · ${regionByIndex(rollOmen(r.day).region).name}`;
    const mine = p.omen.days[r.day]?.score ?? null;
    const theirs = document.createElement('p');
    theirs.className = 'entry-text';
    theirs.textContent = `Theirs  wave ${r.wave} · ${digits(r.kills)} slain${r.practice ? ' (practice)' : ''}  resumed ${r.resumes >= 7 ? '7+' : r.resumes}×`;
    const yours = document.createElement('p');
    yours.className = 'entry-text';
    yours.textContent = mine ? `Yours   wave ${mine.wave} · ${digits(mine.kills)} slain` : 'Yours   not played';
    el.append(head, theirs, yours);
    if (mine) {
      const line = document.createElement('p');
      line.className = 'entry-text omen-verdict';
      line.textContent = compareLine(mine, r);
      el.append(line);
    }
    if (!r.sameRules) {
      const v = document.createElement('p');
      v.className = 'entry-text omen-version';
      v.textContent = 'Made with a different version of the game: the runs may differ.';
      el.append(v);
    }
    const now = Date.now();
    if (r.day > today) {
      const wait = document.createElement('p');
      wait.className = 'entry-text';
      wait.textContent = 'That day hasn’t come yet here.';
      el.append(wait);
    } else if (scoredNow(p, r.day, now)) {
      el.append(button('Play this day', 'btn btn-primary omen-play', () => this.actions.begin(r.day)));
    } else {
      el.append(button('Play as practice', 'btn omen-play', () => this.actions.begin(r.day)));
    }
    return el;
  }

  private copyButton(label: string, line: string): HTMLButtonElement {
    const b = button(label, 'btn omen-copy', () => {
      void this.actions.copy(line).then((ok) => {
        b.textContent = ok ? 'Copied' : 'Couldn’t copy';
        window.setTimeout(() => { b.textContent = label; }, 1600);
      });
    });
    return b;
  }
}

function modLine(mark: string, text: string, cls: string): HTMLElement {
  const li = document.createElement('li');
  li.className = `omen-mod ${cls}`;
  const m = document.createElement('span');
  m.className = 'omen-mark';
  m.setAttribute('aria-hidden', 'true');
  m.textContent = mark;
  const t = document.createElement('span');
  t.textContent = text;
  li.append(m, t);
  return li;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
