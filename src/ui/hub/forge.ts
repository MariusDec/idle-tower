import { BOSS_BY_ID } from '../../content/bosses';
import { BRANCH_NAME, FORGE } from '../../content/forge';
import type { IconId } from '../../content/icons';
import { CONSTELLATION_NAME, STARS } from '../../content/stars';
import type { ForgeNodeDef, StarNodeDef, StatKey, StatMod, WebNodeDef } from '../../content/types';
import { scaleMod } from '../../sim/pacts';
import { resolveStat } from '../../sim/stats';
import { STAT_LABEL } from '../build';
import { formatNumber } from '../../core/format';
import { FORGE_WEB, canAfford } from '../../meta/forge';
import type { Profile } from '../../meta/profile';
import { STAR_WEB } from '../../meta/stars';
import type { NodeState, Web } from '../../meta/web';
import { motionReduced, setText } from '../dom';
import { icon, iconMarkup, iconUse } from '../icon';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Radius of ring n: wide enough that neighbours 12° apart on ring 2 never touch. */
const ringRadius = (ring: number): number => 40 + 160 * ring;
/** Node radii by type, world units. */
const RADIUS = { minor: 26, notable: 32, keystone: 36, mastery: 38 } as const;
/** Each node's tap area, world units: ≥ 42 px across at the default zoom. */
const HIT_RADIUS = 30;
/** The root's radius: the tower glyph the web grows from. */
const ROOT_RADIUS = 30;
const ZOOM = { min: 0.5, max: 2.2 };
/** A press that moves less than this is a tap, not a pan. */
const TAP_SLOP = 8;
/** Delay per link step as a purchase ripples out over the web, ms. */
const RIPPLE_STEP_MS = 70;
/** The fit never zooms out past this, so a node stays easy to tap (42 px at `HIT_RADIUS`); nor in past `FIT_MAX`. */
const FIT_MIN = 0.7;
const FIT_MAX = 1.2;
/** Room kept around the fitted nodes, px: a node's level label sits just outside it. */
const FIT_PAD = 32;
/** Gap between a node's edge and its level label, world units. */
const LABEL_GAP = 12;

export interface ForgeActions {
  buy(id: string): boolean;
  refund(id: string): boolean;
}

/** What a web view draws, and what it calls the things it draws (§5.1, §9). */
export interface WebViewSource<N extends WebNodeDef> {
  readonly web: Web<N>;
  /** The root's class: `forge` for the Forge, `forge stars` for the Constellations. */
  readonly className: string;
  readonly title: string;
  readonly currencyIcon: IconId;
  readonly currencyName: string;
  wallet(profile: Profile): number;
  /** The first-visit line (§7.1). */
  readonly hint: string;
  readonly rootIcon: IconId;
  branchName(branch: N['branch']): string;
  /** Why a sealed node waits, in words. */
  sealLine(node: N): string;
}

/** A node's level, out of its last: a mastery (§9) has no last. */
function levelText(level: number, max: number): string {
  return max === Infinity ? `${level}` : `${level}/${max}`;
}

function position(n: WebNodeDef): { x: number; y: number } {
  const a = (n.angle * Math.PI) / 180;
  const r = ringRadius(n.ring);
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

/**
 * What a stat's total from one web looks like (U8): a percentage for what
 * multiplies, points for a chance, and a plain number for what adds.
 */
function statTotal(key: StatKey, mods: readonly StatMod[]): string {
  const b = resolveStat(key, mods);
  if (b.add !== 0 && b.pct === 0 && b.mult === 1) {
    if (key === 'critChance' || key === 'regen') return `+${(b.add * 100).toFixed(1).replace(/\.0$/, '')}%`;
    if (key === 'critDamage') return `+${b.add.toFixed(2)}×`;
    return `+${formatNumber(Math.round(b.add))}`;
  }
  return `+${formatNumber(Math.round(((1 + b.pct) * b.mult - 1) * 100))}%`;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * A web (§5.1): radial, around a glyph, with fog, node types and costs.
 * Drag to pan, pinch or wheel to zoom, tap a node for its card. A purchase
 * ripples out along the owned web. The Forge and the Constellations (§9)
 * are both one.
 */
export class WebView<N extends WebNodeDef> {
  readonly root: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly world: SVGGElement;
  private readonly shards: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly detail: HTMLElement;
  private profile: Profile | null = null;
  private selected: string | null = null;
  private hinted: string | null = null;
  private view = { x: 0, y: 0, scale: 1 };
  private fitted = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private press: { x: number; y: number; moved: boolean } | null = null;
  private pinch: { d: number; scale: number } | null = null;

  constructor(host: HTMLElement, private readonly actions: ForgeActions, private readonly src: WebViewSource<N>) {
    this.root = document.createElement('div');
    this.root.className = src.className;
    this.root.innerHTML = `
      <header class="forge-head">
        <h2 class="forge-title">${src.title}</h2>
        <span class="forge-shards" aria-label="${src.currencyName}">${iconMarkup(src.currencyIcon)}<span class="forge-shards-n">0</span></span>
      </header>
      <p class="forge-hint" hidden>${src.hint}</p>
      <button type="button" class="forge-recentre" aria-label="Recentre the web">⌖</button>
      <div class="forge-detail" hidden></div>`;
    this.shards = this.root.querySelector('.forge-shards-n')!;
    this.hint = this.root.querySelector('.forge-hint')!;
    this.detail = this.root.querySelector('.forge-detail')!;
    this.root.querySelector('.forge-recentre')!.addEventListener('click', () => this.fit());
    this.svg = el('svg', { class: 'forge-web', role: 'application', 'aria-label': `${src.title} web` });
    this.world = el('g', { class: 'forge-world' });
    this.svg.appendChild(this.world);
    this.root.insertBefore(this.svg, this.hint);
    this.bindGestures();
    host.appendChild(this.root);
  }

  /** Draw the web for `profile`. `intro` highlights a first node to buy (§7.1). */
  show(profile: Profile, intro: boolean): void {
    this.profile = profile;
    this.hinted = intro ? this.src.web.nextGoal(profile)?.node.id ?? null : null;
    this.hint.hidden = !intro;
    this.selected = null;
    this.fitted = false;
    this.redraw();
    this.renderDetail();
    // Fit once the view has a size (it may only just have been unhidden).
    requestAnimationFrame(() => this.fit());
  }

  /**
   * Fit what matters into view (U8): every node on show if they fit at a
   * tappable zoom; else everything but the fog; else what can be bought
   * now. Centred on what is fitted, never zoomed out past `FIT_MIN`: pan
   * and pinch show the rest.
   */
  private fit(): void {
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    if (w === 0 || h === 0 || !this.profile) return;
    const states = this.src.web.states(this.profile);
    const shown = this.src.web.nodes.filter((n) => states.get(n.id) !== 'hidden');
    const sets = [
      shown,
      shown.filter((n) => states.get(n.id) !== 'fog'),
      shown.filter((n) => states.get(n.id) === 'open'),
    ];
    let box = { x0: -ROOT_RADIUS, y0: -ROOT_RADIUS, x1: ROOT_RADIUS, y1: ROOT_RADIUS };
    let scale = FIT_MAX;
    for (const set of sets) {
      const b = { x0: -ROOT_RADIUS, y0: -ROOT_RADIUS, x1: ROOT_RADIUS, y1: ROOT_RADIUS };
      for (const n of set) {
        const at = position(n);
        const r = RADIUS[n.type];
        b.x0 = Math.min(b.x0, at.x - r);
        b.x1 = Math.max(b.x1, at.x + r);
        b.y0 = Math.min(b.y0, at.y - r);
        b.y1 = Math.max(b.y1, at.y + r);
      }
      box = b;
      scale = Math.min((w - FIT_PAD * 2) / (b.x1 - b.x0), (h - FIT_PAD * 2) / (b.y1 - b.y0));
      if (scale >= FIT_MIN) break;
    }
    const s = Math.min(FIT_MAX, Math.max(FIT_MIN, scale));
    this.view = { x: -((box.x0 + box.x1) / 2) * s, y: -((box.y0 + box.y1) / 2) * s, scale: s };
    this.fitted = true;
    this.applyView();
  }

  private applyView(): void {
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    const v = this.view;
    this.world.setAttribute('transform', `translate(${w / 2 + v.x} ${h / 2 + v.y}) scale(${v.scale})`);
  }

  private redraw(): void {
    const p = this.profile;
    if (!p) return;
    setText(this.shards, formatNumber(this.src.wallet(p)));
    const web = this.src.web;
    const states = web.states(p);
    const links = el('g', { class: 'forge-links' });
    const nodes = el('g', { class: 'forge-nodes' });

    const linkClass = (a: NodeState, b: NodeState): string => {
      if (a === 'owned' && b === 'owned') return 'is-owned';
      if (a === 'fog' || b === 'fog' || a === 'sealed' || b === 'sealed') return 'is-fog';
      return 'is-open';
    };
    for (const n of web.nodes) {
      const s = states.get(n.id)!;
      if (s === 'hidden') continue;
      const at = position(n);
      if (n.links.length === 0) {
        links.appendChild(el('line', { class: `forge-link ${linkClass('owned', s)}`, x1: 0, y1: 0, x2: at.x, y2: at.y, 'data-a': 'root', 'data-b': n.id }));
      }
      for (const l of n.links) {
        const other = web.node(l)!;
        const so = states.get(l)!;
        if (so === 'hidden') continue;
        const to = position(other);
        links.appendChild(el('line', { class: `forge-link ${linkClass(s, so)}`, x1: at.x, y1: at.y, x2: to.x, y2: to.y, 'data-a': l, 'data-b': n.id }));
      }
      nodes.appendChild(this.node(n, s, p));
    }

    const root = el('g', { class: 'forge-root' });
    root.appendChild(el('circle', { r: ROOT_RADIUS }));
    root.appendChild(iconUse(this.src.rootIcon, ROOT_RADIUS * 1.2));
    nodes.appendChild(root);
    this.world.replaceChildren(links, nodes);
    if (this.fitted) this.applyView();
  }

  private node(n: N, state: NodeState, p: Profile): SVGGElement {
    const at = position(n);
    const r = RADIUS[n.type];
    const level = this.src.web.levelOf(p, n.id);
    const classes = ['forge-node', `is-${state}`, `type-${n.type}`, `branch-${n.branch}`];
    if (state !== 'fog' && state !== 'sealed' && this.src.web.canAfford(p, n.id)) classes.push('is-affordable');
    if (level >= n.maxLevel) classes.push('is-maxed');
    if (n.id === this.selected) classes.push('is-selected');
    if (n.id === this.hinted) classes.push('is-hinted');
    const g = el('g', { class: classes.join(' '), transform: `translate(${at.x} ${at.y})`, 'data-id': n.id });
    g.appendChild(el('circle', { class: 'forge-hit', r: Math.max(r, HIT_RADIUS) }));
    if (n.type === 'keystone') {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`;
      }).join(' ');
      g.appendChild(el('polygon', { class: 'forge-shape', points: pts }));
    } else if (n.type === 'mastery') {
      // A mastery (§9): an eight-pointed star, endless.
      const pts = Array.from({ length: 16 }, (_, i) => {
        const a = (Math.PI / 8) * i - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.72;
        return `${(Math.cos(a) * rr).toFixed(1)},${(Math.sin(a) * rr).toFixed(1)}`;
      }).join(' ');
      g.appendChild(el('polygon', { class: 'forge-shape', points: pts }));
    } else {
      g.appendChild(el('circle', { class: 'forge-shape', r }));
      if (n.type === 'notable') g.appendChild(el('circle', { class: 'forge-ring', r: r - 5 }));
    }
    if (state === 'fog') {
      const t = el('text', { class: 'forge-unknown', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = '?';
      g.appendChild(t);
    } else if (state === 'sealed') {
      g.appendChild(iconUse('locked-chest', r * 1.1));
    } else {
      g.appendChild(iconUse(n.icon, r * 1.1));
      if (n.maxLevel > 1) {
        // On the side away from the root: the ring's neighbours sit to either
        // side, and the next ring is a full step out.
        const a = (n.angle * Math.PI) / 180;
        const d = r + LABEL_GAP * (1 + 0.4 * Math.abs(Math.sin(a)));
        const t = el('text', {
          class: 'forge-level', x: (Math.sin(a) * d).toFixed(1), y: (-Math.cos(a) * d).toFixed(1),
          'text-anchor': 'middle', 'dominant-baseline': 'central',
        });
        t.textContent = levelText(level, n.maxLevel);
        g.appendChild(t);
      }
    }
    return g;
  }

  /** The card for the selected node: what it does, what it costs, Buy or Refund. */
  private renderDetail(): void {
    const p = this.profile;
    const id = this.selected;
    if (!p || !id) {
      this.detail.hidden = true;
      return;
    }
    const web = this.src.web;
    const n = web.node(id)!;
    const state = web.states(p).get(id)!;
    this.detail.replaceChildren();
    this.detail.className = `forge-detail branch-${n.branch}`;
    const head = document.createElement('div');
    head.className = 'forge-detail-head';
    const name = document.createElement('h3');
    const kind = document.createElement('p');
    kind.className = 'forge-detail-kind';
    const typeName = n.type[0].toUpperCase() + n.type.slice(1);
    if (state === 'fog') {
      head.append(icon('locked-chest'));
      name.textContent = `Unknown ${n.type}`;
      kind.textContent = this.src.branchName(n.branch);
      head.append(name);
      const text = document.createElement('p');
      text.className = 'forge-detail-text';
      text.textContent = 'Buy a node next to it to reveal it.';
      this.detail.append(head, kind, text);
      this.detail.hidden = false;
      return;
    }
    if (state === 'sealed') {
      // Sealed (§5.1): what it is shows; it waits for its boss, or its star (§9).
      head.append(icon('locked-chest'));
      name.textContent = n.name;
      head.append(name);
      kind.textContent = `${this.src.branchName(n.branch)} · ${typeName}`;
      const text = document.createElement('p');
      text.className = 'forge-detail-text';
      text.textContent = n.text;
      const seal = document.createElement('p');
      seal.className = 'forge-detail-seal';
      seal.textContent = this.src.sealLine(n);
      this.detail.append(head, kind, text, seal);
      this.detail.hidden = false;
      return;
    }
    const level = web.levelOf(p, id);
    head.append(icon(n.icon));
    name.textContent = n.name;
    head.append(name);
    kind.textContent = `${this.src.branchName(n.branch)} · ${typeName}${n.maxLevel > 1 ? ` · Level ${levelText(level, n.maxLevel)}` : ''}`;
    const text = document.createElement('p');
    text.className = 'forge-detail-text';
    text.textContent = n.text;
    const total = this.totals(p, n, level);
    const actions = document.createElement('div');
    actions.className = 'forge-detail-actions';
    if (level < n.maxLevel) {
      const cost = web.cost(n, level);
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'btn btn-primary forge-buy';
      const affordable = web.canAfford(p, id);
      buy.disabled = !affordable;
      buy.innerHTML = `${iconMarkup(this.src.currencyIcon)}<span>${formatNumber(cost)}</span>`;
      buy.setAttribute('aria-label', `${level > 0 ? 'Upgrade' : 'Buy'} for ${formatNumber(cost)} ${this.src.currencyName.toLowerCase()}`);
      buy.addEventListener('click', () => this.buy(id));
      if (!web.isBuyable(p, id)) buy.disabled = true;
      actions.append(buy);
    } else {
      const done = document.createElement('span');
      done.className = 'forge-detail-done';
      done.textContent = n.maxLevel > 1 ? 'Maxed' : 'Owned';
      actions.append(done);
    }
    if (web.canRefund(p, id)) {
      const refund = document.createElement('button');
      refund.type = 'button';
      refund.className = 'btn forge-refund';
      refund.textContent = 'Refund';
      refund.addEventListener('click', () => {
        if (this.actions.refund(id)) {
          this.redraw();
          this.renderDetail();
        }
      });
      actions.append(refund);
    }
    this.detail.append(head, kind, text, ...(total ? [total] : []), actions);
    this.detail.hidden = false;
  }

  /**
   * The web's total on each stat this node raises (U8), now and after its
   * next level: "Forge total · Damage +60% → +75%". Null for a node with no
   * stat.
   */
  private totals(p: Profile, n: N, level: number): HTMLElement | null {
    const keys = [...new Set(n.effects.flatMap((e) => (e.kind === 'stat' ? [e.mod.key] : [])))];
    if (keys.length === 0) return null;
    const mods = (extra: number): StatMod[] => {
      const out: StatMod[] = [];
      for (const { node, level: l } of this.src.web.ownedNodes(p)) {
        for (const e of node.effects) if (e.kind === 'stat') out.push(scaleMod(e.mod, l + (node.id === n.id ? extra : 0)));
      }
      if (level === 0 && extra > 0) for (const e of n.effects) if (e.kind === 'stat') out.push(scaleMod(e.mod, extra));
      return out;
    };
    const now = mods(0);
    const next = level < n.maxLevel ? mods(1) : null;
    const line = document.createElement('p');
    line.className = 'forge-detail-total';
    line.textContent = `${this.src.title} total · ` + keys.map((k) => {
      const a = statTotal(k, now);
      return `${STAT_LABEL[k]} ${next ? `${a} → ${statTotal(k, next)}` : a}`;
    }).join(' · ');
    return line;
  }

  private buy(id: string): void {
    if (!this.actions.buy(id)) return;
    if (this.hinted) {
      this.hinted = null;
      this.hint.hidden = true;
    }
    this.redraw();
    this.renderDetail();
    this.ripple(id);
  }

  /** The purchase ripple (§10.3): a ring from the node, then the owned web lights outward. */
  private ripple(id: string): void {
    if (motionReduced()) return;
    const at = position(this.src.web.node(id)!);
    const ring = el('circle', { class: 'forge-ripple', cx: at.x, cy: at.y, r: RADIUS.notable });
    this.world.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
    // Breadth-first over owned nodes, so the flash travels along the web.
    const p = this.profile!;
    const dist = new Map<string, number>([[id, 0]]);
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of this.src.web.neighbours(cur)) {
        if (dist.has(nb) || this.src.web.levelOf(p, nb) === 0) continue;
        dist.set(nb, dist.get(cur)! + 1);
        queue.push(nb);
      }
    }
    for (const line of this.world.querySelectorAll<SVGLineElement>('.forge-link.is-owned')) {
      const a = dist.get(line.dataset.a ?? '');
      const b = dist.get(line.dataset.b ?? '');
      if (a === undefined && b === undefined) continue;
      line.style.animationDelay = `${Math.min(a ?? Infinity, b ?? Infinity) * RIPPLE_STEP_MS}ms`;
      line.classList.add('is-flash');
    }
  }

  private select(id: string | null): void {
    this.selected = id;
    for (const g of this.world.querySelectorAll<SVGGElement>('.forge-node')) {
      g.classList.toggle('is-selected', g.dataset.id === id);
    }
    this.renderDetail();
  }

  // ── Gestures: one pointer pans (or taps), two pinch ─────────────────────

  private bindGestures(): void {
    const svg = this.svg;
    svg.addEventListener('pointerdown', (e) => {
      svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.press = { x: e.clientX, y: e.clientY, moved: false };
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: this.view.scale };
        if (this.press) this.press.moved = true;
      }
    });
    svg.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, next);
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.zoomTo(this.pinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.d)));
        return;
      }
      if (this.press && !this.press.moved && Math.hypot(next.x - this.press.x, next.y - this.press.y) > TAP_SLOP) {
        this.press.moved = true;
      }
      if (this.press?.moved) {
        this.view.x += next.x - prev.x;
        this.view.y += next.y - prev.y;
        this.applyView();
      }
    });
    const end = (e: PointerEvent): void => {
      if (!this.pointers.delete(e.pointerId)) return;
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size > 0) return;
      const press = this.press;
      this.press = null;
      if (!press || press.moved || e.type === 'pointercancel') return;
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGGElement>('.forge-node');
      this.select(hit?.dataset.id ?? null);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomTo(this.view.scale * Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener('resize', () => { if (this.fitted) this.applyView(); });
  }

  private zoomTo(scale: number): void {
    const s = Math.min(ZOOM.max, Math.max(ZOOM.min, scale));
    // Zoom about the view centre: the pan offset scales with it.
    const k = s / this.view.scale;
    this.view = { x: this.view.x * k, y: this.view.y * k, scale: s };
    this.applyView();
  }
}

/** The Forge (§5.1): paid in shards, sealed by bosses and, for a mastery, by its star. */
export class ForgeView extends WebView<ForgeNodeDef> {
  constructor(host: HTMLElement, actions: ForgeActions) {
    super(host, actions, {
      web: FORGE_WEB,
      className: 'forge',
      title: 'Forge',
      currencyIcon: 'crystal-cluster',
      currencyName: 'Shards',
      wallet: (p) => p.shards,
      hint: 'Spend shards on the web. Every node applies from your next run.',
      rootIcon: 'heart-tower',
      branchName: (b) => BRANCH_NAME[b],
      sealLine: (n) => (n.type === 'mastery'
        ? `Sealed — light ${n.name} in the Crown.`
        : `Sealed — defeat ${n.sealed ? BOSS_BY_ID[n.sealed].name : 'its boss'}.`),
    });
  }
}

/** The Constellations (§9): Act 2's web, paid in Starlight. */
export class StarsView extends WebView<StarNodeDef> {
  constructor(host: HTMLElement, actions: ForgeActions) {
    super(host, actions, {
      web: STAR_WEB,
      className: 'forge stars',
      title: 'Constellations',
      currencyIcon: 'round-star',
      currencyName: 'Starlight',
      wallet: (p) => p.starlight,
      hint: 'Clear regions at new heat, and descend the Abyss, for Starlight. Spend it here.',
      rootIcon: 'star-swirl',
      branchName: (b) => CONSTELLATION_NAME[b],
      sealLine: () => 'Sealed.',
    });
  }
}

/** True when some node can be bought now: the Forge tab shows a dot. */
export function forgeBadge(profile: Profile): boolean {
  return FORGE.some((n) => canAfford(profile, n.id));
}

/** True when some star can be lit now: the Stars tab shows a dot. */
export function starsBadge(profile: Profile): boolean {
  return STARS.some((n) => STAR_WEB.canAfford(profile, n.id));
}
