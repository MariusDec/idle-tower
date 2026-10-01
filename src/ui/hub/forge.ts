import { BRANCH_NAME, FORGE, FORGE_BY_ID } from '../../content/forge';
import type { ForgeNodeDef } from '../../content/types';
import { formatNumber } from '../../core/format';
import {
  canAfford, canRefund, isBuyable, levelOf, neighbours, nodeCost, nodeStates, nextGoal, type NodeState,
} from '../../meta/forge';
import type { Profile } from '../../meta/profile';
import { setText } from '../dom';
import { icon, iconMarkup, iconUse } from '../icon';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Radius of ring n: wide enough that ring 1's close neighbours never touch. */
const ringRadius = (ring: number): number => 30 + 120 * ring;
/** Node radii by type, world units. */
const RADIUS = { minor: 26, notable: 32, keystone: 36 } as const;
/** Each node's tap area, world units: ≥ 42 px across at the default zoom. */
const HIT_RADIUS = 30;
/** The root's radius: the tower glyph the web grows from. */
const ROOT_RADIUS = 30;
const ZOOM = { min: 0.5, max: 2.2 };
/** A press that moves less than this is a tap, not a pan. */
const TAP_SLOP = 8;
/** Delay per link step as a purchase ripples out over the web, ms. */
const RIPPLE_STEP_MS = 70;

export interface ForgeActions {
  buy(id: string): boolean;
  refund(id: string): boolean;
}

function position(n: ForgeNodeDef): { x: number; y: number } {
  const a = (n.angle * Math.PI) / 180;
  const r = ringRadius(n.ring);
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/**
 * The Forge (§5.1): a radial web around the tower, with fog, three node
 * types and costs. Drag to pan, pinch or wheel to zoom, tap a node for its
 * card. A purchase ripples out along the owned web.
 */
export class ForgeView {
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

  constructor(host: HTMLElement, private readonly actions: ForgeActions) {
    this.root = document.createElement('div');
    this.root.className = 'forge';
    this.root.innerHTML = `
      <header class="forge-head">
        <h2 class="forge-title">Forge</h2>
        <span class="forge-shards" aria-label="Shards">${iconMarkup('crystal-cluster')}<span class="forge-shards-n">0</span></span>
      </header>
      <p class="forge-hint" hidden>Spend shards on the web. Every node applies from your next run.</p>
      <div class="forge-detail" hidden></div>`;
    this.shards = this.root.querySelector('.forge-shards-n')!;
    this.hint = this.root.querySelector('.forge-hint')!;
    this.detail = this.root.querySelector('.forge-detail')!;
    this.svg = el('svg', { class: 'forge-web', role: 'application', 'aria-label': 'Forge web' });
    this.world = el('g', { class: 'forge-world' });
    this.svg.appendChild(this.world);
    this.root.insertBefore(this.svg, this.hint);
    this.bindGestures();
    host.appendChild(this.root);
  }

  /** Draw the web for `profile`. `intro` highlights a first node to buy (§7.1). */
  show(profile: Profile, intro: boolean): void {
    this.profile = profile;
    this.hinted = intro ? nextGoal(profile)?.node.id ?? null : null;
    this.hint.hidden = !intro;
    this.selected = null;
    this.fitted = false;
    this.redraw();
    this.renderDetail();
    // Fit once the view has a size (it may only just have been unhidden).
    requestAnimationFrame(() => this.fit());
  }

  /** Centre the root and zoom so ring 2 fits the narrow side, within limits. */
  private fit(): void {
    const w = this.svg.clientWidth;
    const h = this.svg.clientHeight;
    if (w === 0 || h === 0) return;
    const outer = ringRadius(2) + RADIUS.notable;
    const scale = Math.min(w, h) / 2 / outer;
    // Never so small that a node is hard to tap; pan and pinch show the rest.
    this.view = { x: 0, y: 0, scale: Math.min(1.2, Math.max(0.7, scale)) };
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
    setText(this.shards, formatNumber(p.shards));
    const states = nodeStates(p);
    const links = el('g', { class: 'forge-links' });
    const nodes = el('g', { class: 'forge-nodes' });

    const linkClass = (a: NodeState, b: NodeState): string => {
      if (a === 'owned' && b === 'owned') return 'is-owned';
      if (a === 'fog' || b === 'fog') return 'is-fog';
      return 'is-open';
    };
    for (const n of FORGE) {
      const s = states.get(n.id)!;
      if (s === 'hidden') continue;
      const at = position(n);
      if (n.links.length === 0) {
        links.appendChild(el('line', { class: `forge-link ${linkClass('owned', s)}`, x1: 0, y1: 0, x2: at.x, y2: at.y, 'data-a': 'root', 'data-b': n.id }));
      }
      for (const l of n.links) {
        const other = FORGE_BY_ID[l];
        const so = states.get(l)!;
        if (so === 'hidden') continue;
        const to = position(other);
        links.appendChild(el('line', { class: `forge-link ${linkClass(s, so)}`, x1: at.x, y1: at.y, x2: to.x, y2: to.y, 'data-a': l, 'data-b': n.id }));
      }
      nodes.appendChild(this.node(n, s, p));
    }

    const root = el('g', { class: 'forge-root' });
    root.appendChild(el('circle', { r: ROOT_RADIUS }));
    root.appendChild(iconUse('heart-tower', ROOT_RADIUS * 1.2));
    nodes.appendChild(root);
    this.world.replaceChildren(links, nodes);
    if (this.fitted) this.applyView();
  }

  private node(n: ForgeNodeDef, state: NodeState, p: Profile): SVGGElement {
    const at = position(n);
    const r = RADIUS[n.type];
    const level = levelOf(p, n.id);
    const classes = ['forge-node', `is-${state}`, `type-${n.type}`, `branch-${n.branch}`];
    if (state !== 'fog' && canAfford(p, n.id)) classes.push('is-affordable');
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
    } else {
      g.appendChild(el('circle', { class: 'forge-shape', r }));
      if (n.type === 'notable') g.appendChild(el('circle', { class: 'forge-ring', r: r - 5 }));
    }
    if (state === 'fog') {
      const t = el('text', { class: 'forge-unknown', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = '?';
      g.appendChild(t);
    } else {
      g.appendChild(iconUse(n.icon, r * 1.1));
      if (n.maxLevel > 1) {
        const t = el('text', { class: 'forge-level', y: r + 13, 'text-anchor': 'middle' });
        t.textContent = `${level}/${n.maxLevel}`;
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
    const n = FORGE_BY_ID[id];
    const state = nodeStates(p).get(id)!;
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
      kind.textContent = BRANCH_NAME[n.branch];
      head.append(name);
      const text = document.createElement('p');
      text.className = 'forge-detail-text';
      text.textContent = 'Buy a node next to it to reveal it.';
      this.detail.append(head, kind, text);
      this.detail.hidden = false;
      return;
    }
    const level = levelOf(p, id);
    head.append(icon(n.icon));
    name.textContent = n.name;
    head.append(name);
    kind.textContent = `${BRANCH_NAME[n.branch]} · ${typeName}${n.maxLevel > 1 ? ` · Level ${level}/${n.maxLevel}` : ''}`;
    const text = document.createElement('p');
    text.className = 'forge-detail-text';
    text.textContent = n.text;
    const actions = document.createElement('div');
    actions.className = 'forge-detail-actions';
    if (level < n.maxLevel) {
      const cost = nodeCost(n, level);
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'btn btn-primary forge-buy';
      const affordable = canAfford(p, id);
      buy.disabled = !affordable;
      buy.innerHTML = `${iconMarkup('crystal-cluster')}<span>${formatNumber(cost)}</span>`;
      buy.setAttribute('aria-label', `${level > 0 ? 'Upgrade' : 'Buy'} for ${cost} shards`);
      buy.addEventListener('click', () => this.buy(id));
      if (!isBuyable(p, id)) buy.disabled = true;
      actions.append(buy);
    } else {
      const done = document.createElement('span');
      done.className = 'forge-detail-done';
      done.textContent = n.maxLevel > 1 ? 'Maxed' : 'Owned';
      actions.append(done);
    }
    if (canRefund(p, id)) {
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
    this.detail.append(head, kind, text, actions);
    this.detail.hidden = false;
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
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const at = position(FORGE_BY_ID[id]);
    const ring = el('circle', { class: 'forge-ripple', cx: at.x, cy: at.y, r: RADIUS.notable });
    this.world.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
    // Breadth-first over owned nodes, so the flash travels along the web.
    const p = this.profile!;
    const dist = new Map<string, number>([[id, 0]]);
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of neighbours(cur)) {
        if (dist.has(nb) || levelOf(p, nb) === 0) continue;
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

/** True when some node can be bought now: the Forge tab shows a dot. */
export function forgeBadge(profile: Profile): boolean {
  return FORGE.some((n) => canAfford(profile, n.id));
}
