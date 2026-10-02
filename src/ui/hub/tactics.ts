import { PASSIVE_BY_ID } from '../../content/passives';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { CardItemId, ContentEntry, PassiveId, WeaponId } from '../../content/types';
import { TACTICS_ALL, hasOwnTactics, tacticsFor, tacticsScopes } from '../../meta/automation';
import { selectedFrame, selectedRegion } from '../../meta/collection';
import type { Profile } from '../../meta/profile';
import { buildRunConfig } from '../../meta/runConfig';
import { segmented } from '../controls';
import { icon } from '../icon';

export interface TacticsActions {
  /**
   * Write the lists under `key` (the shared one, a frame's, or a frame's in
   * one region). Null lists drop the key's own, so it follows the next less
   * specific one again.
   */
  setTactics(key: string, lists: { order: readonly string[]; never: readonly string[] } | null): void;
  /** Leave for the home view. */
  done(): void;
}

function entryOf(id: string): ContentEntry | null {
  return WEAPON_BY_ID[id as WeaponId] ?? PASSIVE_BY_ID[id as PassiveId] ?? null;
}

/**
 * The Tactician's priority editor (§6.2). Every weapon and passive the next
 * run's draft can offer sits in one of three lists: the player's priority,
 * best first, which the suggested card follows; Never (U7), which is never
 * suggested while anything else is offered; and the rest, which the tower's
 * own scorer ranks below the list. Drag a row by its grip, or use the
 * arrows. With Tactician II the lists are the frame's, and may be kept for
 * one region alone.
 */
export class TacticsView {
  readonly root: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly scope: HTMLElement;
  private readonly ranked: HTMLOListElement;
  private readonly never: HTMLUListElement;
  private readonly neverEmpty: HTMLElement;
  private readonly rest: HTMLUListElement;
  private readonly empty: HTMLElement;
  private readonly reset: HTMLButtonElement;
  private profile: Profile | null = null;
  /** The key the editor writes. */
  private key = TACTICS_ALL;
  private list: string[] = [];
  private banned: string[] = [];

  constructor(host: HTMLElement, private readonly actions: TacticsActions) {
    this.root = document.createElement('div');
    this.root.className = 'tactics';
    this.root.innerHTML = `
      <header class="view-head">
        <h2 class="view-title">Tactics</h2>
        <span class="tactics-sub"></span>
      </header>
      <div class="tactics-scope"></div>
      <p class="collection-note">The suggested card takes the highest item on your list. Unlisted items rank below it, by the tower's judgement.</p>
      <div class="tactics-body">
        <h3 class="tactics-head">Priority</h3>
        <p class="tactics-empty">Nothing listed: the tower decides alone.</p>
        <ol class="entry-list tactics-ranked"></ol>
        <h3 class="tactics-head">Never</h3>
        <p class="tactics-empty tactics-never-empty">Never suggested while anything else is offered.</p>
        <ul class="entry-list tactics-never"></ul>
        <h3 class="tactics-head">Not listed</h3>
        <ul class="entry-list tactics-rest"></ul>
      </div>
      <button type="button" class="btn tactics-reset" hidden>Use the all-regions lists here</button>
      <button type="button" class="btn tactics-done">Done</button>`;
    this.sub = this.root.querySelector('.tactics-sub')!;
    this.scope = this.root.querySelector('.tactics-scope')!;
    this.ranked = this.root.querySelector('.tactics-ranked')!;
    this.never = this.root.querySelector('.tactics-never')!;
    this.neverEmpty = this.root.querySelector('.tactics-never-empty')!;
    this.rest = this.root.querySelector('.tactics-rest')!;
    this.empty = this.root.querySelector('.tactics-empty')!;
    this.reset = this.root.querySelector('.tactics-reset')!;
    this.reset.addEventListener('click', () => {
      this.actions.setTactics(this.key, null);
      this.load();
    });
    this.root.querySelector('.tactics-done')!.addEventListener('click', () => actions.done());
    host.appendChild(this.root);
  }

  show(profile: Profile): void {
    this.profile = profile;
    const scopes = tacticsScopes(profile);
    // With Tactician II: the region's own lists if it has them, else the frame's.
    this.key = scopes.length === 3 && !hasOwnTactics(profile, scopes[0]) ? scopes[1] : scopes[0] ?? TACTICS_ALL;
    this.load();
  }

  /** Read the lists the current key stands for. */
  private load(): void {
    if (!this.profile) return;
    const lists = tacticsFor(this.profile, this.key);
    this.list = lists.order;
    this.banned = lists.never;
    this.render();
  }

  /** Items the next run's draft can offer, weapons first. */
  private pool(): string[] {
    if (!this.profile) return [];
    const pool = buildRunConfig(this.profile).pool;
    return [...pool.filter((id) => id in WEAPON_BY_ID), ...pool.filter((id) => !(id in WEAPON_BY_ID))];
  }

  private commit(list: string[], banned = this.banned): void {
    this.list = list;
    this.banned = banned;
    this.actions.setTactics(this.key, { order: list, never: banned });
    this.render();
  }

  private render(): void {
    const p = this.profile;
    if (!p) return;
    const scopes = tacticsScopes(p);
    const perRegion = scopes.length === 3;
    this.sub.textContent = scopes[0] === TACTICS_ALL || scopes.length === 0 ? 'Every frame' : selectedFrame(p).name;
    // Tactician II (U7): the frame's lists everywhere, or kept for this region alone.
    this.scope.replaceChildren();
    this.scope.hidden = !perRegion;
    if (perRegion) {
      this.scope.append(segmented(
        [{ value: scopes[1], label: 'All regions' }, { value: scopes[0], label: selectedRegion(p).name }],
        this.key,
        (k) => {
          this.key = k;
          this.load();
        },
        'Where these lists apply',
      ));
    }
    this.reset.hidden = !perRegion || this.key !== scopes[0] || !hasOwnTactics(p, scopes[0]);

    const pool = this.pool();
    // Items no longer offered (a refunded notable) stay listed but are skipped by the run.
    const listed = this.list.filter((id) => entryOf(id));
    const banned = this.banned.filter((id) => entryOf(id));
    this.empty.hidden = listed.length > 0;
    this.neverEmpty.hidden = banned.length > 0;
    this.ranked.replaceChildren(...listed.map((id, i) => this.rankedRow(id, i, listed.length, pool.includes(id as CardItemId))));
    this.never.replaceChildren(...banned.map((id) => this.neverRow(id, pool.includes(id as CardItemId))));
    this.rest.replaceChildren(...pool.filter((id) => !listed.includes(id) && !banned.includes(id)).map((id) => this.restRow(id)));
  }

  private btn(label: string, aria: string, disabled: boolean, fn: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tactics-btn';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.disabled = disabled;
    b.addEventListener('click', fn);
    return b;
  }

  private nameOf(def: ContentEntry): HTMLElement {
    const name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = def.name;
    return name;
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
    const move = (to: number): void => {
      const next = [...this.list];
      next.splice(i, 1);
      next.splice(to, 0, id);
      this.commit(next);
    };
    li.append(
      grip, rank, icon(def.icon), this.nameOf(def),
      this.btn('▲', `Raise ${def.name}`, i === 0, () => move(i - 1)),
      this.btn('▼', `Lower ${def.name}`, i === n - 1, () => move(i + 1)),
      this.btn('✕', `Unlist ${def.name}`, false, () => this.commit(this.list.filter((x) => x !== id))),
    );
    this.bindDrag(grip, li);
    return li;
  }

  /** A Never row: back to Not listed with one tap. */
  private neverRow(id: string, offered: boolean): HTMLLIElement {
    const def = entryOf(id)!;
    const li = document.createElement('li');
    li.className = `entry tactics-row is-never${offered ? '' : ' is-unknown'}`;
    li.append(
      icon(def.icon), this.nameOf(def),
      this.btn('✕', `Allow ${def.name} again`, false, () => this.commit(this.list, this.banned.filter((x) => x !== id))),
    );
    return li;
  }

  private restRow(id: string): HTMLLIElement {
    const def = entryOf(id)!;
    const li = document.createElement('li');
    li.className = 'entry tactics-row is-rest';
    const add = this.btn('+ List', `List ${def.name}`, false, () => this.commit([...this.list, id]));
    add.classList.add('tactics-btn-wide');
    const ban = this.btn('Never', `Never take ${def.name}`, false, () => this.commit(this.list, [...this.banned, id]));
    ban.classList.add('tactics-btn-wide');
    li.append(icon(def.icon), this.nameOf(def), add, ban);
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
