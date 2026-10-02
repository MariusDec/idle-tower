import type { MotionSetting, Profile } from '../meta/profile';
import { TEXT_SCALES } from '../meta/profile';
import type { QualityTier } from '../render/quality';
import { formatNumber } from '../core/format';
import { importProfile, type BackupInfo } from '../meta/save/transfer';
import { segmented, type Choice } from './controls';

type Settings = Profile['settings'];

/** Everything the settings can ask the app to do. */
export interface SettingsActions {
  /**
   * Change the profile's settings: the app applies them, and saves them
   * unless `save` is false (a slider mid-drag; it saves when let go).
   */
  change(edit: (s: Settings) => void, save?: boolean): void;
  /** The stored quality preference and the tier in force. */
  quality(): { pref: 'auto' | QualityTier; tier: QualityTier };
  setQuality(pref: 'auto' | QualityTier): void;
  /** Erase the profile and start over (P9). Only offered between runs. */
  reset(): void;
  /** Copy the profile to the clipboard as text (U12); false if the platform refused. */
  copySave(): Promise<boolean>;
  /** Save the profile to a file (U12); where it went, in words. */
  saveFile(): Promise<string>;
  /** Ask for a save file and read it (U12); null if none was chosen. */
  pickFile(): Promise<string | null>;
  /** The rolling backups kept (U12), newest first, and one read back. */
  backups(): Promise<BackupInfo[]>;
  readBackup(slot: number): Promise<Profile | null>;
  /** Replace the profile with `profile` (an import or a backup) and start from it. Between runs only. */
  replace(profile: Profile): void;
  /** The panel closed. */
  closed(): void;
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

/** A loaded profile waiting for the player's word, and where it came from. */
interface Pending {
  profile: Profile;
  from: string;
}

/** How long ago a wall-clock time was, in a few words. */
function ago(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/**
 * Settings (§10.1: behind the hub's gear, and in the pause menu): sound
 * and its three levels (§10.4), quality, text size, colours, screen shake
 * and reduced motion, a Stats page (§10.2: the numbers the HUD leaves
 * out), and, between runs, the save (U12: copy, file, load, backups) and a
 * reset that asks twice.
 */
export class SettingsPanel {
  private el: HTMLElement | null = null;
  private page: 'options' | 'stats' = 'options';
  private profile: Profile | null = null;
  private canReset = false;
  private confirming = false;
  /** U12: the paste box is open, with what is in it. */
  private loading: { text: string } | null = null;
  /** U12: a profile read from a paste, a file or a backup, waiting to replace this one. */
  private pending: Pending | null = null;
  /** U12: the last thing the save controls did, or what went wrong. */
  private message = '';
  private backupList: BackupInfo[] = [];

  constructor(private readonly host: HTMLElement, private readonly actions: SettingsActions) {}

  get open(): boolean {
    return this.el !== null;
  }

  show(profile: Profile, canReset: boolean): void {
    this.profile = profile;
    this.canReset = canReset;
    this.confirming = false;
    this.loading = null;
    this.pending = null;
    this.message = '';
    this.page = 'options';
    if (canReset) {
      void this.actions.backups().then((list) => {
        this.backupList = list;
        if (this.open) this.render();
      });
    }
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
        row('Master', slider(s.volume.master, (v, save) => this.actions.change((x) => { x.volume.master = v; }, save), 'Master volume')),
        row('Effects', slider(s.volume.sfx, (v, save) => this.actions.change((x) => { x.volume.sfx = v; }, save), 'Effects volume')),
        row('Music', slider(s.volume.music, (v, save) => this.actions.change((x) => { x.volume.music = v; }, save), 'Music volume')),
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
    body.append(section('Save', this.transfer()));
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

  /** The save (U12): take the profile elsewhere as text or a file, bring one back, or restore a backup. */
  private transfer(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'settings-transfer';
    const say = (text: string): void => {
      this.message = text;
      this.render();
    };
    const take = (text: string, from: string): void => {
      try {
        this.pending = { profile: importProfile(text), from };
        this.loading = null;
        this.message = '';
      } catch (err) {
        this.message = err instanceof Error ? err.message : 'That is not a saved profile.';
      }
      this.render();
    };
    if (this.pending) {
      const p = this.pending.profile;
      box.append(
        note(`Replace this profile with ${this.pending.from}? ${formatNumber(p.records.runs)} run${p.records.runs === 1 ? '' : 's'}, ${formatNumber(p.shards)} shards, best wave ${p.records.bestWave}. This one is lost unless you saved it.`),
        button('Keep mine', 'btn', () => { this.pending = null; this.render(); }),
        button('Replace', 'btn btn-danger', () => this.actions.replace(p)),
      );
      return box;
    }
    if (this.loading) {
      const area = document.createElement('textarea');
      area.className = 'settings-paste';
      area.rows = 3;
      area.placeholder = 'Paste a saved profile here';
      area.setAttribute('aria-label', 'Saved profile');
      area.value = this.loading.text;
      area.addEventListener('input', () => { if (this.loading) this.loading.text = area.value; });
      box.append(
        area,
        button('Check', 'btn btn-primary', () => take(area.value, 'the pasted one')),
        button('Choose file', 'btn', () => void this.actions.pickFile().then((text) => {
          if (text !== null) take(text, 'the one in the file');
        })),
        button('Cancel', 'btn', () => { this.loading = null; this.message = ''; this.render(); }),
        note(this.message),
      );
      return box;
    }
    box.append(
      note('Take your progress to another install, or bring it back.'),
      button('Copy save', 'btn', () => void this.actions.copySave().then((ok) => say(ok ? 'Copied. Paste it somewhere safe.' : 'The clipboard said no. Try Save file.'))),
      button('Save file', 'btn', () => void this.actions.saveFile().then((where) => say(`Saved to ${where}.`), () => say('The file could not be saved.'))),
      button('Load save', 'btn', () => { this.loading = { text: '' }; this.message = ''; this.render(); }),
      note(this.message),
    );
    if (this.backupList.length > 0) {
      const list = document.createElement('ul');
      list.className = 'settings-backups';
      list.setAttribute('aria-label', 'Backups');
      for (const b of this.backupList) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `Run ${formatNumber(b.runs)} · ${formatNumber(b.shards)} shards · ${ago(b.savedAt)}`;
        li.append(label, button('Restore', 'btn', () => void this.actions.readBackup(b.slot).then((profile) => {
          if (!profile) return say('That backup does not read any more.');
          this.pending = { profile, from: `the backup from ${ago(b.savedAt)}` };
          this.render();
        })));
        list.append(li);
      }
      box.append(note('Kept at the end of each of your last runs:'), list);
    }
    return box;
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

/**
 * A 0–1 level as a 0–100 slider. It reports while dragging, to be heard at
 * once, and again when let go, to be saved; it never re-renders under the thumb.
 */
function slider(value: number, change: (v: number, save: boolean) => void, label: string): HTMLElement {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'settings-slider';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.value = String(Math.round(value * 100));
  input.setAttribute('aria-label', label);
  input.addEventListener('input', () => change(Number(input.value) / 100, false));
  input.addEventListener('change', () => change(Number(input.value) / 100, true));
  return input;
}
