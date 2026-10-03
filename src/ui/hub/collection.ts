import { BOSS_BY_ID } from '../../content/bosses';
import { ENEMY_BY_ID } from '../../content/enemies';
import { REGIONS } from '../../content/regions';
import { RELIC_SETS, eliteRelics } from '../../content/relics';
import { BALANCE } from '../../content/balance';
import { PASSIVE_BY_ID } from '../../content/passives';
import { WEAPON_BY_ID } from '../../content/weapons';
import { EVOLUTION_OF } from '../../content/evolutions';
import type { BossId, EnemyId, FrameUnlock, RelicDef, RelicId, TrimId } from '../../content/types';
import { formatNumber } from '../../core/format';
import {
  activeSets, bestiary, collectionPages, frameUnlocked, listedFrames, listedRelics, relicRank, relicSlots, selectedFrame, setRank,
} from '../../meta/collection';
import type { Profile } from '../../meta/profile';
import { levelOf } from '../../meta/forge';
import { fusionBook, recipeBook } from '../../meta/recipes';
import { wonTrims } from '../../meta/trials';
import { toggleClass } from '../dom';
import { icon } from '../icon';

/** How a locked frame is earned, in words (§11.6). */
function lockedLine(u: FrameUnlock): string {
  switch (u.kind) {
    case 'start':
      return '';
    case 'boss':
      return `Defeat ${BOSS_BY_ID[u.boss].name}.`;
    case 'feat':
      return 'Earned by a secret feat.';
    case 'star':
      return 'Lit in the Constellations.';
    default: {
      const exhaustive: never = u;
      return exhaustive;
    }
  }
}

/** Where a relic drops, in words, for its silhouette (§5.3). */
function relicWhere(r: RelicDef): string {
  const s = r.source;
  switch (s.kind) {
    case 'boss':
      return BOSS_BY_ID[s.boss].name;
    case 'elite':
      return `${REGIONS.find((x) => x.index === s.region)?.name ?? 'Unknown'} elites`;
    case 'abyss':
      return `the Abyss's elites, once Lantern ${['I', 'II', 'III', 'IV'][s.set - 1] ?? s.set} is lit`;
    default: {
      const exhaustive: never = s;
      return exhaustive;
    }
  }
}

export type CollectionPage = 'bestiary' | 'relics' | 'recipes' | 'frames';

export interface CollectionActions {
  toggleRelic(id: RelicId): boolean;
  selectFrame(id: string): void;
  toggleTrim(trim: TrimId): void;
}

const PAGE_NAME: Record<CollectionPage, string> = { bestiary: 'Bestiary', relics: 'Relics', recipes: 'Recipes', frames: 'Frames' };

/**
 * The Collection (§5.3): one tab, its pages appearing as they fill. The
 * Bestiary (every enemy and boss, revealed on first sight), Relics (worn
 * into the next run, up to the slots the bosses opened), Recipes (the
 * evolutions, "??? + ???" until found) and Frames.
 */
export class CollectionView {
  readonly root: HTMLElement;
  private readonly pages: HTMLElement;
  private readonly body: HTMLElement;
  private page: CollectionPage = 'bestiary';
  private profile: Profile | null = null;

  constructor(host: HTMLElement, private readonly actions: CollectionActions) {
    this.root = document.createElement('div');
    this.root.className = 'collection';
    this.root.innerHTML = `
      <header class="view-head"><h2 class="view-title">Collection</h2></header>
      <div class="segmented" role="tablist"></div>
      <div class="collection-body"></div>`;
    this.pages = this.root.querySelector('.segmented')!;
    this.body = this.root.querySelector('.collection-body')!;
    this.pages.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-page]');
      if (b) {
        this.page = b.dataset.page as CollectionPage;
        this.render();
      }
    });
    host.appendChild(this.root);
  }

  show(profile: Profile, page?: CollectionPage): void {
    this.profile = profile;
    if (page) this.page = page;
    this.render();
  }

  private render(): void {
    const p = this.profile;
    if (!p) return;
    // Trims (N5) are worn on the Frames page, so a won trim opens it too.
    const open = collectionPages(p);
    open.frames ||= wonTrims(p).length > 0;
    if (!open[this.page]) this.page = 'bestiary';
    this.pages.replaceChildren(...(Object.keys(PAGE_NAME) as CollectionPage[]).filter((k) => open[k]).map((k) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'segmented-btn';
      b.dataset.page = k;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(k === this.page));
      toggleClass(b, 'is-active', k === this.page);
      b.textContent = PAGE_NAME[k];
      return b;
    }));
    this.pages.hidden = this.pages.childElementCount < 2;
    switch (this.page) {
      case 'bestiary':
        this.body.replaceChildren(this.bestiary(p));
        break;
      case 'relics':
        this.body.replaceChildren(...this.relics(p));
        break;
      case 'recipes':
        this.body.replaceChildren(...this.recipes(p));
        break;
      case 'frames':
        this.body.replaceChildren(this.frames(p), ...this.trims(p));
        break;
      default: {
        const exhaustive: never = this.page;
        return exhaustive;
      }
    }
  }

  private bestiary(p: Profile): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'entry-list';
    for (const row of bestiary(p)) {
      const def = row.boss ? BOSS_BY_ID[row.id as BossId] : ENEMY_BY_ID[row.id as EnemyId];
      const li = document.createElement('li');
      li.className = `entry${row.seen ? '' : ' is-unknown'}${row.boss ? ' is-boss' : ''}`;
      const head = document.createElement('div');
      head.className = 'entry-head';
      const name = document.createElement('span');
      name.className = 'entry-name';
      name.textContent = row.seen ? def.name : '???';
      const count = document.createElement('span');
      count.className = 'entry-count';
      count.textContent = row.seen ? `${formatNumber(row.kills)} slain` : '';
      head.append(icon(row.seen ? def.icon : 'locked-chest'), name, count);
      li.append(head);
      if (row.seen) {
        const verb = document.createElement('p');
        verb.className = 'entry-text';
        verb.textContent = def.text;
        const lore = document.createElement('p');
        lore.className = 'entry-lore';
        lore.textContent = def.lore;
        li.append(verb, lore);
      }
      list.append(li);
    }
    return list;
  }

  private relics(p: Profile): HTMLElement[] {
    const slots = relicSlots(p);
    const head = document.createElement('p');
    head.className = 'collection-note';
    head.textContent = `Worn ${p.equipped.length}/${slots}. Tap a relic to wear it into your next run.`;
    const list = document.createElement('ul');
    list.className = 'entry-list';
    for (const r of listedRelics(p)) {
      const rank = relicRank(p, r.id);
      const worn = p.equipped.includes(r.id);
      const li = document.createElement('li');
      li.className = `entry${rank === 0 ? ' is-unknown' : ''}${worn ? ' is-worn' : ''}`;
      const where = relicWhere(r);
      if (rank === 0) {
        // Undiscovered: a silhouette naming where it drops (§5.3).
        const h = document.createElement('div');
        h.className = 'entry-head';
        const n = document.createElement('span');
        n.className = 'entry-name';
        n.textContent = '???';
        h.append(icon('locked-chest'), n);
        const t = document.createElement('p');
        t.className = 'entry-text';
        t.textContent = `Drops from ${where}.`;
        li.append(h, t);
        list.append(li);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'entry-btn';
      btn.setAttribute('aria-pressed', String(worn));
      const h = document.createElement('div');
      h.className = 'entry-head';
      const n = document.createElement('span');
      n.className = 'entry-name';
      n.textContent = r.name;
      const pips = document.createElement('span');
      pips.className = 'entry-count';
      pips.textContent = `${'I'.repeat(rank)}${rank >= BALANCE.relics.maxRank ? ' · max' : ''}${worn ? ' · worn' : ''}`;
      h.append(icon(r.icon), n, pips);
      const t = document.createElement('p');
      t.className = 'entry-text';
      t.textContent = r.text;
      btn.append(h, t);
      btn.addEventListener('click', () => {
        if (this.actions.toggleRelic(r.id)) this.render();
      });
      btn.disabled = !worn && p.equipped.length >= slots;
      li.append(btn);
      list.append(li);
    }
    return [head, list, ...this.sets(p)];
  }

  /** Relic sets (N6): a region's three elite relics, worn together for a bonus. Shown once one of a set is found. */
  private sets(p: Profile): HTMLElement[] {
    const shown = RELIC_SETS.filter((set) => eliteRelics(set.region).some((id) => relicRank(p, id) > 0));
    if (shown.length === 0) return [];
    const head = document.createElement('p');
    head.className = 'collection-note';
    head.textContent = 'Sets: wear all three of a region\'s elite relics for its bonus. Duplicates past III rank it up.';
    const list = document.createElement('ul');
    list.className = 'entry-list';
    const active = new Set(activeSets(p).map((x) => x.set.id));
    for (const set of shown) {
      const owned = eliteRelics(set.region).filter((id) => relicRank(p, id) > 0).length;
      const rank = setRank(p, set.region);
      const li = document.createElement('li');
      li.className = `entry${active.has(set.id) ? ' is-worn' : ''}${owned < 3 ? ' is-unknown' : ''}`;
      const h = document.createElement('div');
      h.className = 'entry-head';
      const n = document.createElement('span');
      n.className = 'entry-name';
      n.textContent = set.name;
      const count = document.createElement('span');
      count.className = 'entry-count';
      const progress = p.sets[set.region] ?? 0;
      const next = rank < BALANCE.sets.maxRank ? ` · ${progress % BALANCE.sets.perRank}/${BALANCE.sets.perRank}` : ' · max';
      count.textContent = owned < 3 ? `${owned}/3 found` : `${'I'.repeat(rank)}${next}${active.has(set.id) ? ' · worn' : ''}`;
      h.append(icon(set.icon), n, count);
      const t = document.createElement('p');
      t.className = 'entry-text';
      t.textContent = set.text;
      li.append(h, t);
      list.append(li);
    }
    return [head, list];
  }

  /** The Recipe Book (§5.3): each half shows as it is earned, the riddle before the find. */
  private recipes(p: Profile): HTMLElement[] {
    // Without Alchemy nothing evolves, however the Book reads: say so first.
    const head = document.createElement('p');
    head.className = 'collection-note';
    head.textContent = levelOf(p, 'alchemy') > 0
      ? `A weapon at level ${BALANCE.evolutions.evolveAt} with its partner passive at level ${BALANCE.evolutions.passiveAt} can evolve: its card joins the draft.`
      : 'Evolutions need Alchemy from the Forge (Arsenal). Until then, no weapon evolves.';
    const list = document.createElement('ul');
    list.className = 'entry-list';
    for (const r of recipeBook(p)) {
      const e = r.evolution;
      const li = document.createElement('li');
      li.className = `entry${r.found ? ' is-evolution' : ' is-unknown'}`;
      const h = document.createElement('div');
      h.className = 'entry-head';
      const n = document.createElement('span');
      n.className = 'entry-name';
      n.textContent = r.found ? e.name : '???';
      h.append(icon(r.found ? e.icon : r.weapon ? WEAPON_BY_ID[e.weapon].icon : 'locked-chest'), n);
      const recipe = document.createElement('p');
      recipe.className = 'entry-text';
      const weapon = r.weapon ? `${WEAPON_BY_ID[e.weapon].name} (level ${BALANCE.evolutions.evolveAt})` : '???';
      const passive = r.found ? `${PASSIVE_BY_ID[e.passive].name} (level ${BALANCE.evolutions.passiveAt})` : '???';
      recipe.textContent = `${weapon} + ${passive}`;
      li.append(h, recipe);
      if (r.found || r.hint) {
        const line = document.createElement('p');
        line.className = 'entry-lore';
        line.textContent = r.found ? e.text : e.hint;
        li.append(line);
      }
      list.append(li);
    }
    return [head, list, ...this.fusions(p)];
  }

  /** The Book's second page (N9): fusions, their halves once their star is lit, the riddle once both are evolved. */
  private fusions(p: Profile): HTMLElement[] {
    const book = fusionBook(p);
    if (book.length === 0) return [];
    const head = document.createElement('h3');
    head.className = 'collection-heading';
    head.textContent = 'Fusions';
    const note = document.createElement('p');
    note.className = 'collection-note';
    note.textContent = 'Two evolved weapons, once a Smith star lights their fusion, become one card: one mount, a slot freed.';
    const list = document.createElement('ul');
    list.className = 'entry-list';
    for (const r of book) {
      const f = r.fusion;
      const li = document.createElement('li');
      li.className = `entry${r.found ? ' is-evolution' : ' is-unknown'}`;
      const h = document.createElement('div');
      h.className = 'entry-head';
      const n = document.createElement('span');
      n.className = 'entry-name';
      n.textContent = r.found || r.lit ? f.name : '???';
      h.append(icon(r.found || r.lit ? f.icon : 'locked-chest'), n);
      const recipe = document.createElement('p');
      recipe.className = 'entry-text';
      recipe.textContent = r.lit ? f.weapons.map((w) => EVOLUTION_OF[w].name).join(' + ') : '??? + ???';
      li.append(h, recipe);
      if (r.found || r.hint) {
        const line = document.createElement('p');
        line.className = 'entry-lore';
        line.textContent = r.found ? f.text : f.hint;
        li.append(line);
      }
      list.append(li);
    }
    return [head, note, list];
  }

  private frames(p: Profile): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'entry-list';
    const chosen = selectedFrame(p).id;
    for (const f of listedFrames(p)) {
      const open = frameUnlocked(p, f);
      const li = document.createElement('li');
      li.className = `entry${open ? '' : ' is-unknown'}${f.id === chosen ? ' is-worn' : ''}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'entry-btn';
      btn.disabled = !open;
      btn.setAttribute('aria-pressed', String(f.id === chosen));
      const h = document.createElement('div');
      h.className = 'entry-head';
      const n = document.createElement('span');
      n.className = 'entry-name';
      n.textContent = f.name;
      const tag = document.createElement('span');
      tag.className = 'entry-count';
      tag.textContent = f.id === chosen ? 'Next run' : '';
      h.append(icon(open ? f.icon : 'locked-chest'), n, tag);
      const t = document.createElement('p');
      t.className = 'entry-text';
      t.textContent = open ? f.text : lockedLine(f.unlock);
      const u = document.createElement('p');
      u.className = 'entry-lore';
      u.textContent = `${f.ultimate.name}: ${f.ultimate.text}`;
      btn.append(h, t, u);
      btn.addEventListener('click', () => {
        this.actions.selectFrame(f.id);
        this.render();
      });
      li.append(btn);
      list.append(li);
    }
    return list;
  }

  /** Trims the Trials paid (N5): each worn on the tower until tapped off. Shown once one is won. */
  private trims(p: Profile): HTMLElement[] {
    const won = wonTrims(p);
    if (won.length === 0) return [];
    const head = document.createElement('p');
    head.className = 'collection-note';
    head.textContent = 'Trims: tap one to take it off the tower, or put it back on.';
    const list = document.createElement('ul');
    list.className = 'entry-list';
    for (const t of won) {
      const worn = !p.trimsOff.includes(t.trim);
      const li = document.createElement('li');
      li.className = `entry${worn ? ' is-worn' : ''}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'entry-btn';
      btn.setAttribute('aria-pressed', String(worn));
      const h = document.createElement('div');
      h.className = 'entry-head';
      const n = document.createElement('span');
      n.className = 'entry-name';
      n.textContent = t.name;
      const tag = document.createElement('span');
      tag.className = 'entry-count';
      tag.textContent = worn ? 'Worn' : 'Off';
      h.append(icon('checkered-flag'), n, tag);
      btn.append(h);
      btn.addEventListener('click', () => {
        this.actions.toggleTrim(t.trim);
        this.render();
      });
      li.append(btn);
      list.append(li);
    }
    return [head, list];
  }
}
