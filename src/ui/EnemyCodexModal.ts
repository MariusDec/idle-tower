import type { BossPattern, EnemyType, EnemyWaveStatsEntry } from '../types';
import {
  ENEMY_CODEX,
  ENEMY_DEFS,
  ENEMY_LABELS,
  armorDamageMultiplier,
  bossPatternsForWave,
  BOSS_PATTERN_NAMES,
  BOSS_PATTERN_HINTS,
} from '../data/enemies';
import { ENEMY_THREAT_CLASS } from '../data/pacing';
import { formatNumber, formatWithOptionalDecimal } from '../utils/bigNumber';
import { setAriaLabel, setStyle, setText, toggleClass } from '../utils/dom';
import { renderIcon } from './Icon';
import { Modal } from './Modal';

/**
 * The three codex entries the enemy pages link out to. Closed union so a
 * `handlers.onOpenCodex` call that misspells an id is a compile error rather
 * than a no-op that never tells anyone.
 */
const CODEX_LINK_IDS = ['enemy-armor', 'elites', 'boss-phases'] as const;
type CodexLinkId = typeof CODEX_LINK_IDS[number];

interface CodexLink {
  id: CodexLinkId;
  label: string;
}

function isCodexLinkId(id: string): id is CodexLinkId {
  return (CODEX_LINK_IDS as readonly string[]).includes(id);
}

/**
 * The links a given type's page advertises.
 *
 * - Any type with `armor > 0` (tank / siege / warden / boss) → armour codex.
 * - `boss` only → boss-phases codex.
 * - Any *threat* or the boss → elites codex.
 *
 * `normal` has no links — the page would have nothing to point at.
 */
function linksForType(type: EnemyType): readonly CodexLink[] {
  const out: CodexLink[] = [];
  const def = ENEMY_DEFS[type];
  if (def.armor > 0) out.push({ id: 'enemy-armor', label: 'Armour' });
  if (type === 'boss') out.push({ id: 'boss-phases', label: 'Boss Phases' });
  if (ENEMY_THREAT_CLASS[type] !== 'trash') out.push({ id: 'elites', label: 'Elites' });
  return out;
}

export interface EnemyCodexHandlers {
  onOpenCodex: (entryId: string) => void;
  /**
   * Opens the Journal tab. A codex mastery row's only action — the player
   * reads "412 / 400" and wants to see the whole chapter card the line
   * belongs to (plan §7.3).
   */
  onOpenJournal: () => void;
}

/**
 * The enemy bestiary dialog (plans/stats.md Part D).
 *
 * Replaces the old HUD-side tooltip + popup pair with a roster+detail layout
 * modelled on the tower Stats dialog: a column of type buttons on the left, a
 * detail page on the right, keyboard navigation between them. The roster is
 * derived from `spawnPoolForWave(wave)` — never from a hand-rolled unlock-wave
 * ladder — and `boss` is always listed because boss waves have their own
 * dedicated readout elsewhere on the canvas.
 */
export class EnemyCodexModal {
  private readonly modal: Modal;
  private readonly bodyEl: HTMLElement;
  private readonly rosterEl: HTMLElement;
  private readonly pageEl: HTMLElement;
  private readonly handlers: EnemyCodexHandlers;

  /** All entries the modal currently knows about, in roster order. */
  private entries: EnemyWaveStatsEntry[] = [];
  /** The type currently shown on the page, or null while no entry is selected. */
  private selectedType: EnemyType | null = null;
  /** Buttons keyed by their type, for `.is-active` and keyboard nav. */
  private readonly rosterBtns = new Map<EnemyType, HTMLButtonElement>();

  constructor(handlers: EnemyCodexHandlers) {
    this.handlers = handlers;
    this.modal = new Modal({
      id: 'enemy-codex',
      title: 'Enemies',
      width: 620,
      dismissible: true,
    });

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'enemy-codex';

    this.rosterEl = document.createElement('div');
    this.rosterEl.className = 'enemy-codex-roster';
    this.rosterEl.setAttribute('role', 'tablist');
    this.rosterEl.setAttribute('aria-label', 'Enemy types');
    this.bodyEl.appendChild(this.rosterEl);

    this.pageEl = document.createElement('div');
    this.pageEl.className = 'enemy-codex-page';
    this.pageEl.setAttribute('role', 'tabpanel');
    this.pageEl.setAttribute('aria-live', 'polite');
    this.bodyEl.appendChild(this.pageEl);

    // Up/Down keyboard nav across roster buttons.
    this.rosterEl.addEventListener('keydown', e => this.onRosterKeydown(e));

    this.modal.body.appendChild(this.bodyEl);
  }

  isOpen(): boolean {
    return this.modal.isOpen();
  }

  open(): void {
    this.modal.open();
  }

  close(): void {
    this.modal.close();
  }

  toggle(): void {
    if (this.isOpen()) this.close();
    else this.open();
  }

  /**
   * Replace the roster with a fresh wave's entries. The roster buttons are
   * built once per entry-shape change — once the entry list matches length
   * the buttons stay and only their text + active state update. That keeps a
   * high-frequency push (every 6 ticks) from rebuilding the DOM.
   */
  setInfo(entries: EnemyWaveStatsEntry[]): void {
    this.entries = entries;
    if (this.rosterEl.childElementCount !== entries.length) {
      this.buildRoster();
    }
    // Preserve the player's current selection across re-pushes; fall back to
    // the first in-wave entry (or just the first entry if none are in wave).
    if (!this.selectedType || !entries.some(e => e.type === this.selectedType)) {
      this.selectedType = entries.find(e => e.inWave)?.type ?? entries[0]?.type ?? null;
    }
    this.refreshRoster();
    this.renderPage();
  }

  // ── roster ───────────────────────────────────────────────────────────

  private buildRoster(): void {
    this.rosterEl.replaceChildren();
    this.rosterBtns.clear();
    for (const entry of this.entries) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'enemy-roster-btn';
      btn.dataset.type = entry.type;
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => this.select(entry.type));

      const iconWrap = document.createElement('span');
      iconWrap.className = 'enemy-roster-icon';
      renderIcon(iconWrap, ENEMY_DEFS[entry.type].icon, { size: 20 });
      setStyle(iconWrap, 'color', ENEMY_DEFS[entry.type].color);
      btn.appendChild(iconWrap);

      const labelWrap = document.createElement('span');
      labelWrap.className = 'enemy-roster-label';

      const name = document.createElement('span');
      name.className = 'enemy-roster-name';
      setText(name, ENEMY_LABELS[entry.type]);
      labelWrap.appendChild(name);

      const flag = document.createElement('span');
      flag.className = 'enemy-roster-flag';
      labelWrap.appendChild(flag);

      btn.appendChild(labelWrap);
      this.rosterEl.appendChild(btn);
      this.rosterBtns.set(entry.type, btn);
    }
  }

  private refreshRoster(): void {
    for (const entry of this.entries) {
      const btn = this.rosterBtns.get(entry.type);
      if (!btn) continue;
      const isActive = entry.type === this.selectedType;
      toggleClass(btn, 'is-active', isActive);
      toggleClass(btn, 'is-preview', !entry.inWave);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      const flag = btn.querySelector<HTMLSpanElement>('.enemy-roster-flag');
      if (flag) {
        // The flag is the *preview* marker only. An in-wave entry's wave is
        // the wave the player is on, so printing it under every button just
        // repeats the same number down the roster (and the page header already
        // carries it in the modal sub-title).
        setText(flag, entry.inWave ? '' : `from W${ENEMY_DEFS[entry.type].unlockWave}`);
        toggleClass(flag, 'is-hidden', entry.inWave);
        toggleClass(flag, 'is-preview', !entry.inWave);
      }
    }
  }

  private select(type: EnemyType): void {
    if (this.selectedType === type) return;
    this.selectedType = type;
    this.refreshRoster();
    this.renderPage();
  }

  private onRosterKeydown(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (this.entries.length === 0) return;
    const idx = this.entries.findIndex(en => en.type === this.selectedType);
    if (idx < 0) {
      this.select(this.entries[0].type);
      return;
    }
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = (idx + dir + this.entries.length) % this.entries.length;
    const nextType = this.entries[next].type;
    this.select(nextType);
    this.rosterBtns.get(nextType)?.focus();
  }

  // ── page ─────────────────────────────────────────────────────────────

  private renderPage(): void {
    if (!this.selectedType) {
      this.pageEl.replaceChildren();
      return;
    }
    const entry = this.entries.find(e => e.type === this.selectedType);
    if (!entry) {
      this.pageEl.replaceChildren();
      return;
    }
    this.modal.setSub(`Wave ${entry.wave}`);
    this.pageEl.replaceChildren();
    toggleClass(this.pageEl, 'enemy-page-preview', !entry.inWave);
    this.pageEl.appendChild(this.renderHeader(entry));
    this.pageEl.appendChild(this.renderTagline(entry));
    this.pageEl.appendChild(this.renderDescription(entry));
    this.pageEl.appendChild(this.renderAnswer(entry));
    this.pageEl.appendChild(this.renderStats(entry));
    // The mastery track sits between the stat block and the gameplay tips
    // (effects / patterns / links) — same mechanical density as the stats
    // above it, and reading order matches the rest of the pane.
    const watch = this.renderWatch(entry);
    if (watch) this.pageEl.appendChild(watch);
    const effects = this.renderEffects(entry);
    if (effects) this.pageEl.appendChild(effects);
    if (entry.type === 'boss') {
      const patterns = this.renderPatterns(entry);
      if (patterns) this.pageEl.appendChild(patterns);
    }
    const links = this.renderLinks(entry);
    if (links) this.pageEl.appendChild(links);
  }

  private renderHeader(entry: EnemyWaveStatsEntry): HTMLElement {
    const head = document.createElement('div');
    head.className = 'enemy-page-head';

    const iconWrap = document.createElement('span');
    iconWrap.className = 'enemy-page-icon';
    renderIcon(iconWrap, ENEMY_DEFS[entry.type].icon, { size: 40 });
    setStyle(iconWrap, 'color', ENEMY_DEFS[entry.type].color);
    head.appendChild(iconWrap);

    const meta = document.createElement('div');
    meta.className = 'enemy-page-meta';

    const name = document.createElement('h3');
    name.className = 'enemy-page-name';
    setText(name, ENEMY_LABELS[entry.type]);
    meta.appendChild(name);

    const badge = document.createElement('span');
    const threatClass = ENEMY_THREAT_CLASS[entry.type];
    badge.className = `enemy-page-badge is-${threatClass}`;
    const threatLabel = threatClass === 'boss'
      ? 'Boss'
      : threatClass === 'threat'
        ? 'Threat'
        : 'Trash';
    setText(badge, threatLabel);
    meta.appendChild(badge);

    head.appendChild(meta);
    return head;
  }

  private renderTagline(entry: EnemyWaveStatsEntry): HTMLElement {
    const p = document.createElement('p');
    p.className = 'enemy-page-tagline';
    setText(p, ENEMY_CODEX[entry.type].tagline);
    return p;
  }

  private renderDescription(entry: EnemyWaveStatsEntry): HTMLElement {
    const p = document.createElement('p');
    p.className = 'enemy-page-desc';
    setText(p, ENEMY_CODEX[entry.type].description);
    return p;
  }

  private renderAnswer(entry: EnemyWaveStatsEntry): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'enemy-page-answer';
    const label = document.createElement('span');
    label.className = 'enemy-page-answer-label';
    setText(label, 'Answer:');
    const body = document.createElement('span');
    body.className = 'enemy-page-answer-body';
    setText(body, ENEMY_CODEX[entry.type].answer);
    wrap.appendChild(label);
    wrap.appendChild(body);
    return wrap;
  }

  /** The stat rows for one type. Per-type extras are appended by `appendExtras`. */
  private renderStats(entry: EnemyWaveStatsEntry): HTMLElement {
    const def = ENEMY_DEFS[entry.type];
    const list = document.createElement('dl');
    list.className = 'enemy-page-stats';

    this.appendStat(list, 'HP', formatNumber(entry.hp));
    this.appendStat(list, 'Speed', `${entry.speed.toFixed(0)} px/s`);
    this.appendStat(list, 'Damage', `${formatWithOptionalDecimal(entry.damage)} / swing`);
    if (entry.fireRate > 0) {
      this.appendStat(list, 'Fire Rate', `${entry.fireRate.toFixed(2)} /s`);
    }
    if (def.armor > 0) {
      this.appendStat(list, 'Armour', `${def.armor}`);
      this.appendStat(list,
        'Hit kept',
        `${(armorDamageMultiplier(def.armor) * 100).toFixed(0)}% of a physical hit`);
    }
    if (def.magicResist > 0) {
      this.appendStat(list, 'Magic Resist', `${(def.magicResist * 100).toFixed(0)}%`);
    }
    if (entry.gold > 0) {
      this.appendStat(list, 'Gold drop', `${formatNumber(entry.gold)}`);
    }
    this.appendExtras(list, entry);

    // Show multipliers only when something has actually moved off 1.0; a plain
    // wave would print "×1.00" three times and tell the player nothing.
    const m = entry.multipliers;
    const multsShown = (m.hp !== 1 || m.speed !== 1 || m.damage !== 1);
    if (multsShown) {
      const mrow = document.createElement('div');
      mrow.className = 'enemy-page-multipliers';
      const mlabel = document.createElement('span');
      mlabel.className = 'enemy-page-multipliers-label';
      setText(mlabel, 'Wave multipliers');
      mrow.appendChild(mlabel);
      const mvals = document.createElement('span');
      mvals.className = 'enemy-page-multipliers-vals';
      setText(mvals,
        `HP ×${m.hp.toFixed(2)}  ·  Speed ×${m.speed.toFixed(2)}  ·  Damage ×${m.damage.toFixed(2)}`);
      mrow.appendChild(mvals);
      list.appendChild(mrow);
    }
    return list;
  }

  private appendStat(list: HTMLElement, label: string, value: string): void {
    const row = document.createElement('div');
    row.className = 'enemy-page-stat';
    const dt = document.createElement('dt');
    setText(dt, label);
    const dd = document.createElement('dd');
    setText(dd, value);
    row.appendChild(dt);
    row.appendChild(dd);
    list.appendChild(row);
  }

  /**
   * Per-type extras the stat block needs but the def table does not summarise.
   * Each guard keeps the row out when the value would be zero.
   */
  private appendExtras(list: HTMLElement, entry: EnemyWaveStatsEntry): void {
    const def = ENEMY_DEFS[entry.type];
    switch (entry.type) {
      case 'healer':
        if (def.healFraction !== undefined) {
          this.appendStat(list, 'Field heal', `${(def.healFraction * 100).toFixed(0)}% max HP`);
        }
        if (def.healRange !== undefined) {
          this.appendStat(list, 'Heal range', `${def.healRange.toFixed(0)} px`);
        }
        if (def.healCooldown !== undefined) {
          this.appendStat(list, 'Heal every', `${def.healCooldown.toFixed(1)} s`);
        }
        break;
      case 'shielded':
        if (def.shieldCharges !== undefined) {
          this.appendStat(list, 'Shield charges', `${def.shieldCharges}`);
        }
        break;
      case 'splitter':
        if (def.splitChildren !== undefined) {
          this.appendStat(list, 'Splits into', `${def.splitChildren}`);
        }
        if (def.splitHpFraction !== undefined) {
          this.appendStat(list, 'Child HP', `${(def.splitHpFraction * 100).toFixed(0)}%`);
        }
        break;
      default:
        break;
    }
  }

  /** The mechanical bullets for one type. Header is hidden when the array is empty. */
  private renderEffects(entry: EnemyWaveStatsEntry): HTMLElement | null {
    const effects = ENEMY_CODEX[entry.type].effects;
    if (effects.length === 0) return null;
    const wrap = document.createElement('section');
    wrap.className = 'enemy-page-effects';

    const heading = document.createElement('h4');
    heading.className = 'enemy-page-section-heading';
    setText(heading, 'Effects');
    wrap.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'enemy-page-effect-list';
    for (const eff of effects) {
      const li = document.createElement('li');
      li.className = 'enemy-page-effect';

      const name = document.createElement('span');
      name.className = 'enemy-page-effect-name';
      setText(name, eff.name);
      li.appendChild(name);

      const body = document.createElement('span');
      body.className = 'enemy-page-effect-body';
      setText(body, eff.text);
      li.appendChild(body);

      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }

  /** Boss-only: one bullet per pattern the tier actually draws. */
  private renderPatterns(entry: EnemyWaveStatsEntry): HTMLElement | null {
    if (entry.type !== 'boss') return null;
    const wrap = document.createElement('section');
    wrap.className = 'enemy-page-patterns';

    const heading = document.createElement('h4');
    heading.className = 'enemy-page-section-heading';
    setText(heading, 'Patterns');
    wrap.appendChild(heading);

    const patterns: BossPattern[] = bossPatternsForWave(entry.wave);
    const list = document.createElement('ol');
    list.className = 'enemy-page-pattern-list';
    for (const pattern of patterns) {
      const li = document.createElement('li');
      li.className = 'enemy-page-pattern';

      const name = document.createElement('span');
      name.className = 'enemy-page-pattern-name';
      setText(name, BOSS_PATTERN_NAMES[pattern]);
      li.appendChild(name);

      const body = document.createElement('span');
      body.className = 'enemy-page-pattern-body';
      setText(body, BOSS_PATTERN_HINTS[pattern]);
      li.appendChild(body);

      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }

  /**
   * The mastery track (plan §7). One row per chapter that names this enemy
   * with a `kills_of` goal; absent when no chapter names it. Returns `null`
   * on the empty array — an empty section reads worse than a missing one,
   * and a "no objectives" placeholder would lie about the chapter state.
   */
  private renderWatch(entry: EnemyWaveStatsEntry): HTMLElement | null {
    if (entry.watch.length === 0) return null;
    const wrap = document.createElement('section');
    wrap.className = 'enemy-page-watch';

    const heading = document.createElement('h4');
    heading.className = 'enemy-page-section-heading';
    setText(heading, 'The Long Watch');
    wrap.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'enemy-page-watch-list';
    for (const line of entry.watch) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'enemy-page-watch-row';
      if (line.met) row.classList.add('is-met');
      row.setAttribute('aria-label',
        `Open the Long Watch chapter ${line.chapterName}: ${line.progress}${line.met ? ', complete' : ''}`);
      row.addEventListener('click', () => this.handlers.onOpenJournal());

      const name = document.createElement('span');
      name.className = 'enemy-page-watch-name';
      setText(name, `The Long Watch · ${line.chapterName}`);
      row.appendChild(name);

      const progress = document.createElement('span');
      progress.className = 'enemy-page-watch-progress';
      setText(progress, line.progress);
      row.appendChild(progress);

      // The check is decorative; the row (without it) is the hit target so a
      // tap on the check still reads as a tap on the chapter (plan §7.3).
      const check = document.createElement('span');
      check.className = 'enemy-page-watch-check';
      check.textContent = line.met ? '✓' : '';
      row.appendChild(check);

      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }

  /** "See also" codex chips, if the type has any. */
  private renderLinks(entry: EnemyWaveStatsEntry): HTMLElement | null {
    const links = linksForType(entry.type);
    if (links.length === 0) return null;
    const wrap = document.createElement('section');
    wrap.className = 'enemy-page-links';

    const heading = document.createElement('h4');
    heading.className = 'enemy-page-section-heading';
    setText(heading, 'See also');
    wrap.appendChild(heading);

    const chips = document.createElement('div');
    chips.className = 'enemy-page-chips';
    for (const link of links) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'enemy-page-chip';
      setText(btn, link.label);
      setAriaLabel(btn, `Open codex entry: ${link.label}`);
      btn.addEventListener('click', () => {
        if (isCodexLinkId(link.id)) this.handlers.onOpenCodex(link.id);
      });
      chips.appendChild(btn);
    }
    wrap.appendChild(chips);
    return wrap;
  }

  // ── teardown ────────────────────────────────────────────────────────

  destroy(): void {
    this.rosterEl.replaceChildren();
    this.rosterBtns.clear();
    this.modal.destroy();
  }
}