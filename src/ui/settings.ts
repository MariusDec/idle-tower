import type { MotionSetting, Profile } from '../meta/profile';
import { TEXT_SCALES } from '../meta/profile';
import type { QualityTier } from '../render/quality';
import { formatNumber } from '../core/format';

type Settings = Profile['settings'];

/** Everything the settings can ask the app to do. */
export interface SettingsActions {
  /** Change the profile's settings: the app applies and saves them. */
  change(edit: (s: Settings) => void): void;
  /** The stored quality preference and the tier in force. */
  quality(): { pref: 'auto' | QualityTier; tier: QualityTier };
  setQuality(pref: 'auto' | QualityTier): void;
  /** Erase the profile and start over (P9). Only offered between runs. */
  reset(): void;
  /** The panel closed. */
  closed(): void;
}

interface Choice<T> {
  value: T;
  label: string;
}

const QUALITY_CHOICES: readonly Choice<'auto' | QualityTier>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const MOTION_CHOICES: readonly Choice<MotionSetting>[] = [
  { value: 'system', label: 'Device' },
  { value: 'reduce', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];
const PALETTE_CHOICES: readonly Choice<Settings['palette']>[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'safe', label: 'Colourblind' },
];
const ON_OFF: readonly Choice<boolean>[] = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
];

/**
 * Settings (§10.1: behind the hub's gear, and in the pause menu): sound
 * and its three levels (§10.4), quality, text size, colours, screen shake
 * and reduced motion, a Stats page (§10.2: the numbers the HUD leaves
 * out), and, between runs, a reset that asks twice.
 */
export class SettingsPanel {
  private el: HTMLElement | null = null;
  private page: 'options' | 'stats' = 'options';
  private profile: Profile | null = null;
  private canReset = false;
  private confirming = false;

  constructor(private readonly host: HTMLElement, private readonly actions: SettingsActions) {}

  get open(): boolean {
    return this.el !== null;
  }

  show(profile: Profile, canReset: boolean): void {
    this.profile = profile;
    this.canReset = canReset;
    this.confirming = false;
    this.page = 'options';
    if (!this.el) {
      const scrim = document.createElement('div');
      scrim.className = 'modal-scrim';
      this.host.appendChild(scrim);
      this.el = scrim;
    }
    this.render();
    this.el.querySelector<HTMLElement>('.settings-done')?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.actions.closed();
  }

  private render(): void {
    const p = this.profile;
    if (!p || !this.el) return;
    const card = document.createElement('div');
    card.className = 'modal-card settings';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Settings');
    const title = document.createElement('h2');
    title.className = 'modal-title';
    title.textContent = 'Settings';
    const pages = segmented<'options' | 'stats'>(
      [{ value: 'options', label: 'Options' }, { value: 'stats', label: 'Stats' }],
      this.page,
      (v) => { this.page = v; this.render(); },
      'Page',
    );
    const body = document.createElement('div');
    body.className = 'settings-body';
    if (this.page === 'options') this.options(body, p.settings);
    else this.stats(body, p);
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn btn-primary settings-done';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.close());
    card.append(title, pages, body, done);
    // A redraw keeps the player's place in the list.
    const scroll = this.el.querySelector('.settings')?.scrollTop ?? 0;
    this.el.replaceChildren(card);
    card.scrollTop = scroll;
  }

  private options(body: HTMLElement, s: Settings): void {
    const set = (edit: (s: Settings) => void): void => {
      this.actions.change(edit);
      this.render();
    };
    const q = this.actions.quality();
    body.append(
      section('Sound',
        row('Sound', segmented(ON_OFF, s.sound, (v) => set((x) => { x.sound = v; }), 'Sound')),
        row('Master', slider(s.volume.master, (v) => this.actions.change((x) => { x.volume.master = v; }), 'Master volume')),
        row('Effects', slider(s.volume.sfx, (v) => this.actions.change((x) => { x.volume.sfx = v; }), 'Effects volume')),
        row('Music', slider(s.volume.music, (v) => this.actions.change((x) => { x.volume.music = v; }), 'Music volume')),
      ),
      section('Display',
        row('Quality', segmented(QUALITY_CHOICES, q.pref, (v) => { this.actions.setQuality(v); this.render(); }, 'Quality')),
        note(q.pref === 'auto' ? `Running at ${q.tier}.` : ''),
        row('Text size', segmented(TEXT_SCALES.map((k) => ({ value: k, label: `${Math.round(k * 100)}%` })), s.textScale,
          (v) => set((x) => { x.textScale = v; }), 'Text size')),
        row('Colours', segmented(PALETTE_CHOICES, s.palette, (v) => set((x) => { x.palette = v; }), 'Weapon colours')),
      ),
      section('Motion',
        row('Screen shake', segmented(ON_OFF, s.shake, (v) => set((x) => { x.shake = v; }), 'Screen shake')),
        row('Motion', segmented(MOTION_CHOICES, s.motion, (v) => set((x) => { x.motion = v; }), 'Reduced motion')),
      ),
    );
    if (!this.canReset) {
      body.append(section('Progress', note('Reset is in the hub\'s settings, between runs.')));
      return;
    }
    const reset = document.createElement('div');
    reset.className = 'settings-reset';
    if (this.confirming) {
      reset.append(
        note('Erase every shard, node, relic and record? This cannot be undone.'),
        button('Keep it', 'btn', () => { this.confirming = false; this.render(); }),
        button('Erase', 'btn btn-danger', () => this.actions.reset()),
      );
    } else {
      reset.append(button('Reset progress', 'btn', () => { this.confirming = true; this.render(); }));
    }
    body.append(section('Progress', reset));
  }

  private stats(body: HTMLElement, p: Profile): void {
    const r = p.records;
    const bossKills = Object.values(p.bosses).reduce((n, b) => n + b.kills, 0);
    const feats = Object.keys(p.feats).length;
    const days = Math.max(1, Math.ceil((Date.now() - p.createdAt) / 86_400_000));
    const lines: [string, string][] = [
      ['Runs', formatNumber(r.runs)],
      ['Best wave', r.bestWave > 0 ? String(r.bestWave) : '—'],
      ['Enemies slain', formatNumber(r.kills)],
      ['Elites slain', formatNumber(r.elites)],
      ['Bosses felled', formatNumber(bossKills)],
      ['Most shards in a run', formatNumber(r.bestShards)],
      ['Relics found', String(Object.keys(p.relics).length)],
      ['Evolutions found', String(p.recipes.found.length)],
      ['Feats earned', String(feats)],
      ['Deepest Abyss floor', p.abyss.best > 0 ? String(p.abyss.best) : '—'],
      ['Days since the first light', String(days)],
    ];
    const dl = document.createElement('dl');
    dl.className = 'settings-stats';
    for (const [k, v] of lines) {
      const div = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      div.append(dt, dd);
      dl.append(div);
    }
    body.append(dl);
  }
}

function section(label: string, ...children: HTMLElement[]): HTMLElement {
  const s = document.createElement('section');
  s.className = 'settings-section';
  const h = document.createElement('h3');
  h.className = 'settings-heading';
  h.textContent = label;
  s.append(h, ...children);
  return s;
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = document.createElement('div');
  r.className = 'settings-row';
  const l = document.createElement('span');
  l.className = 'settings-label';
  l.textContent = label;
  r.append(l, control);
  return r;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'settings-note';
  p.textContent = text;
  p.hidden = text === '';
  return p;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** A row of mutually exclusive buttons, the current one marked. */
function segmented<T>(choices: readonly Choice<T>[], current: T, pick: (v: T) => void, label: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'segmented';
  g.setAttribute('role', 'radiogroup');
  g.setAttribute('aria-label', label);
  for (const c of choices) {
    const b = document.createElement('button');
    b.type = 'button';
    const on = c.value === current;
    b.className = `segmented-btn${on ? ' is-active' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    b.textContent = c.label;
    b.addEventListener('click', () => {
      if (!on) pick(c.value);
    });
    g.append(b);
  }
  return g;
}

/** A 0–1 level as a 0–100 slider. It reports while dragging and never re-renders under the thumb. */
function slider(value: number, change: (v: number) => void, label: string): HTMLElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'settings-slider';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.value = String(Math.round(value * 100));
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => change(Number(input.value) / 100));
  return input;
}
