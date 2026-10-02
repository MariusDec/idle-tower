import { FORGE_BY_ID } from '../content/forge';
import { BALANCE } from '../content/balance';
import { EVOLUTION_OF } from '../content/evolutions';
import type { IconId } from '../content/icons';
import { PASSIVE_BY_ID } from '../content/passives';
import { WEAPON_BY_ID } from '../content/weapons';
import type { StatKey, WeaponId } from '../content/types';
import { formatNumber } from '../core/format';
import type { BuildSummary } from '../meta/results';
import type { RunState } from '../sim/state';
import { allMods, resolveStat } from '../sim/stats';
import { icon } from './icon';

/**
 * The build, drawn (U3, U5): one icon per weapon and passive with its level
 * as pips. An evolved weapon shows its evolution and glows; a weapon a
 * Harbinger has silenced is slashed. The HUD strip, the pause menu and the
 * results all draw it this way.
 */

/** A stable key for a build as drawn, so a per-frame view redraws only when it changes. */
export function buildKey(build: BuildSummary, silenced: ReadonlySet<WeaponId> = new Set()): string {
  const w = build.weapons.map((x) => `${x.id}:${x.level}:${x.evolved ? 1 : 0}:${silenced.has(x.id) ? 1 : 0}`);
  const p = build.passives.map((x) => `${x.id}:${x.level}`);
  return `${w.join(',')}|${p.join(',')}`;
}

function chip(iconId: IconId, name: string, level: number, cls: string): HTMLElement {
  const el = document.createElement('li');
  el.className = `build-chip ${cls}`;
  el.setAttribute('aria-label', `${name}, level ${level}`);
  el.append(icon(iconId));
  const pips = document.createElement('span');
  pips.className = 'build-pips';
  pips.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= BALANCE.maxLevel; i++) {
    const pip = document.createElement('span');
    pip.className = i <= level ? 'build-pip is-owned' : 'build-pip';
    pips.append(pip);
  }
  el.append(pips);
  return el;
}

/** The build's chips: weapons first, a gap, then passives. */
export function buildChips(build: BuildSummary, silenced: ReadonlySet<WeaponId> = new Set()): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const w of build.weapons) {
    const evo = w.evolved ? EVOLUTION_OF[w.id] : null;
    const def = evo ?? WEAPON_BY_ID[w.id];
    const cls = ['is-weapon', w.evolved ? 'is-evolved' : '', silenced.has(w.id) ? 'is-silenced' : ''].filter(Boolean).join(' ');
    const el = chip(def.icon, def.name, w.level, cls);
    if (silenced.has(w.id)) el.setAttribute('aria-label', `${def.name}, level ${w.level}, silenced`);
    out.push(el);
  }
  for (const p of build.passives) out.push(chip(PASSIVE_BY_ID[p.id].icon, PASSIVE_BY_ID[p.id].name, p.level, 'is-passive'));
  return out;
}

/** The build as a list, for the pause menu and the results. */
export function buildList(build: BuildSummary): HTMLElement {
  const ul = document.createElement('ul');
  ul.className = 'build-list';
  ul.setAttribute('aria-label', 'Build');
  ul.append(...buildChips(build));
  return ul;
}

/** What each stat is called on screen. */
export const STAT_LABEL: Readonly<Record<StatKey, string>> = {
  damage: 'Damage',
  attackSpeed: 'Attack speed',
  critChance: 'Crit chance',
  critDamage: 'Crit damage',
  range: 'Range',
  maxHp: 'Max HP',
  regen: 'Regen',
  armor: 'Armour',
  xpGain: 'XP',
  shardGain: 'Shards',
  ultCharge: 'Ultimate charge',
  area: 'Area',
  duration: 'Duration',
  projectileSpeed: 'Projectile speed',
  pierce: 'Pierce',
};

const times = (v: number): string => `×${v.toFixed(2)}`;
const whole = (v: number): string => formatNumber(Math.round(v));

/** The stats the pause menu lists (U3), with what this run's passives add to each. */
const STATS: readonly { key: StatKey; show: (v: number) => string }[] = [
  { key: 'damage', show: times },
  { key: 'attackSpeed', show: times },
  { key: 'critChance', show: (v) => `${Math.round(Math.min(1, v) * 100)}%` },
  { key: 'critDamage', show: times },
  { key: 'range', show: whole },
  { key: 'maxHp', show: whole },
  { key: 'armor', show: whole },
  { key: 'area', show: times },
  { key: 'xpGain', show: times },
  { key: 'shardGain', show: times },
];

/** The tower's stats now: each value, and the share this run's passives add (the `run` bucket, S1). */
export function statsList(run: RunState): HTMLElement {
  const mods = allMods(run.mods, run.passives);
  const dl = document.createElement('dl');
  dl.className = 'build-stats';
  for (const s of STATS) {
    const b = resolveStat(s.key, mods);
    const dt = document.createElement('dt');
    dt.textContent = STAT_LABEL[s.key];
    const dd = document.createElement('dd');
    dd.textContent = s.show(b.value);
    if (b.runPct > 0) {
      const run = document.createElement('span');
      run.className = 'build-stat-run';
      run.textContent = ` +${Math.round(b.runPct * 100)}% this run`;
      dd.append(run);
    }
    dl.append(dt, dd);
  }
  return dl;
}

/** One row of a tally: a label and what it came to. */
export interface TallyRow {
  label: string;
  icon?: IconId;
  value: number;
}

/**
 * Bars for a tally (U5): one per row, largest first, each with its share of
 * the whole. Rows worth under 1% are left out, so the list stays short.
 */
export function tallyBars(rows: readonly TallyRow[], label: string): HTMLElement {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const shown = rows.filter((r) => total > 0 && r.value / total >= 0.01).sort((a, b) => b.value - a.value);
  const top = shown[0]?.value ?? 1;
  const ul = document.createElement('ul');
  ul.className = 'tally';
  ul.setAttribute('aria-label', label);
  for (const r of shown) {
    const li = document.createElement('li');
    li.className = 'tally-row';
    const share = Math.round((r.value / total) * 100);
    li.setAttribute('aria-label', `${r.label}: ${share}%`);
    const head = document.createElement('span');
    head.className = 'tally-label';
    if (r.icon) head.append(icon(r.icon));
    head.append(r.label);
    const bar = document.createElement('span');
    bar.className = 'tally-bar';
    const fill = document.createElement('span');
    fill.className = 'tally-fill';
    fill.style.transform = `scaleX(${(r.value / top).toFixed(3)})`;
    bar.append(fill);
    const n = document.createElement('span');
    n.className = 'tally-value';
    n.textContent = `${share}%`;
    li.append(head, bar, n);
    ul.append(li);
  }
  return ul;
}

/** What the Foreman bought (N7), in words: "Sharpened ×2, Banish". */
export function foremanLine(ids: readonly string[]): string {
  const names = ids.map((id) => FORGE_BY_ID[id]?.name ?? id);
  return [...new Set(names)].map((n) => {
    const k = names.filter((x) => x === n).length;
    return k > 1 ? `${n} ×${k}` : n;
  }).join(', ');
}
