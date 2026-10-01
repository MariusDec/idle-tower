import { PASSIVE_BY_ID } from '../../content/passives';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { CardItemId, ContentEntry, PassiveId, WeaponId } from '../../content/types';
import { TACTICS_ALL, tacticsKey } from '../../meta/automation';
import { selectedFrame } from '../../meta/collection';
import type { Profile } from '../../meta/profile';
import { buildRunConfig } from '../../meta/runConfig';
import { icon } from '../icon';

export interface TacticsActions {
  /** Write the list the next run follows (the shared one, or the frame's). */
  setTactics(list: readonly string[]): void;
  /** Leave for the home view. */
  done(): void;
}

function entryOf(id: string): ContentEntry | null {
  return WEAPON_BY_ID[id as WeaponId] ?? PASSIVE_BY_ID[id as PassiveId] ?? null;
}

/**
 * The Tactician's priority editor (§6.2). Every weapon and passive the next
 * run's draft can offer sits in one of two lists: the player's priority, best
 * first, which the suggested card follows; and the rest, which the tower's own
 * scorer ranks below the list. Drag a row by its grip, or use the arrows; tap
 * an unlisted item to add it at the bottom.
 */
export class TacticsView {
  readonly root: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly ranked: HTMLOListElement;
  private readonly rest: HTMLUListElement;
  private readonly empty: HTMLElement;
  private profile: Profile | null = null;
  private list: string[] = [];

  constructor(host: HTMLElement, private readonly actions: TacticsActions) {
    this.root = document.createElement('div');
    this.root.className = 'tactics';
    this.root.innerHTML = `
      <header class="view-head">
        <h2 class="view-title">Tactics</h2>
        <span class="tactics-sub"></span>
      </header>
      <p class="collection-note">The suggested card takes the highest item on your list. Unlisted items rank below it, by the tower's judgement.</p>
      <div class="tactics-body">
        <h3 class="tactics-head">Priority</h3>
        <p class="tactics-empty">Nothing listed: the tower decides alone.</p>
        <ol class="entry-list tactics-ranked"></ol>
        <h3 class="tactics-head">Not listed</h3>
        <ul class="entry-list tactics-rest"></ul>
      </div>
      <button type="button" class="btn tactics-done">Done</button>`;
    this.sub = this.root.querySelector('.tactics-sub')!;
    this.ranked = this.root.querySelector('.tactics-ranked')!;
    this.rest = this.root.querySelector('.tactics-rest')!;
    this.empty = this.root.querySelector('.tactics-empty')!;
    this.root.querySelector('.tactics-done')!.addEventListener('click', () => actions.done());
    host.appendChild(this.root);
  }

  show(profile: Profile): void {
    this.profile = profile;
    const key = tacticsKey(profile);
    this.list = key === null ? [] : [...(profile.tactics[key] ?? profile.tactics[TACTICS_ALL] ?? [])];
    this.sub.textContent = key === null || key === TACTICS_ALL ? 'Every frame' : selectedFrame(profile).name;
    this.render();
  }

  /** Items the next run's draft can offer, weapons first. */
  private pool(): string[] {
    if (!this.profile) return [];
    const pool = buildRunConfig(this.profile).pool;
    return [...pool.filter((id) => id in WEAPON_BY_ID), ...pool.filter((id) => !(id in WEAPON_BY_ID))];
  }

  private commit(list: string[]): void {
    this.list = list;
    this.actions.setTactics(list);
    this.render();
  }

  private render(): void {
    const pool = this.pool();
    // Items no longer offered (a refunded notable) stay listed but are skipped by the run.
    const listed = this.list.filter((id) => entryOf(id));
    this.empty.hidden = listed.length > 0;
    this.ranked.replaceChildren(...listed.map((id, i) => this.rankedRow(id, i, listed.length, pool.includes(id as CardItemId))));
    this.rest.replaceChildren(...pool.filter((id) => !listed.includes(id)).map((id) => this.restRow(id)));
  }

  private rankedRow(id: string, i: number, n: number, offered: boolean): HTMLLIElement {
    const def = entryOf(id)!;
    const li = document.createElement('li');
    li.className = `entry tactics-row${offered ? '' : ' is-unknown'}`;
    li.dataset.id = id;
    const grip = document.createElement('span');
    grip.className = 'tactics-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.textContent = '⠿';
    const rank = document.createElement('span');
    rank.className = 'tactics-rank';
    rank.textContent = String(i + 1);
    const name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = def.name;
    const btn = (label: string, aria: string, disabled: boolean, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tactics-btn';
      b.textContent = label;
      b.setAttribute('aria-label', `${aria} ${def.name}`);
      b.disabled = disabled;
      b.addEventListener('click', fn);
      return b;
    };
    const move = (to: number): void => {
      const next = [...this.list];
      next.splice(i, 1);
      next.splice(to, 0, id);
      this.commit(next);
    };
    li.append(
      grip, rank, icon(def.icon), name,
      btn('▲', 'Raise', i === 0, () => move(i - 1)),
      btn('▼', 'Lower', i === n - 1, () => move(i + 1)),
      btn('✕', 'Unlist', false, () => this.commit(this.list.filter((x) => x !== id))),
    );
    this.bindDrag(grip, li);
    return li;
  }

  private restRow(id: string): HTMLLIElement {
    const def = entryOf(id)!;
    const li = document.createElement('li');
    li.className = 'entry';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'entry-btn';
    const head = document.createElement('span');
    head.className = 'entry-head';
    const name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = def.name;
    const add = document.createElement('span');
    add.className = 'entry-count';
    add.textContent = '+ List';
    head.append(icon(def.icon), name, add);
    b.append(head);
    b.addEventListener('click', () => this.commit([...this.list, id]));
    li.append(b);
    return li;
  }

  /** Drag by the grip: the row follows the pointer through its siblings, and the order commits on release. */
  private bindDrag(grip: HTMLElement, li: HTMLLIElement): void {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      li.classList.add('is-dragging');
      // Window listeners, not pointer capture: the row moves under the
      // pointer as it is re-inserted, and capture is lost on some WebViews.
      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== e.pointerId) return;
        const rows = [...this.ranked.children].filter((r) => r !== li) as HTMLElement[];
        const before = rows.find((r) => {
          const box = r.getBoundingClientRect();
          return ev.clientY < box.top + box.height / 2;
        });
        if (before) this.ranked.insertBefore(li, before);
        else this.ranked.appendChild(li);
      };
      const up = (ev: PointerEvent): void => {
        if (ev.pointerId !== e.pointerId) return;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        li.classList.remove('is-dragging');
        const order = [...this.ranked.children].map((r) => (r as HTMLElement).dataset.id!);
        if (order.join() !== this.list.join()) this.commit(order);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }
}
