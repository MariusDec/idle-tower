import type { BossPattern } from '../types';
import {
  BOSS_ENCOUNTER,
  BOSS_PATTERN_HINTS,
  BOSS_PATTERN_NAMES,
} from '../data/enemies';
import type { IconId } from '../data/icons';
import { formatNumber } from '../utils/bigNumber';
import { setStyle, setText, toggleClass } from '../utils/dom';
import { icon, setIcon } from './Icon';

/**
 * The mark for each pattern (UI plan §7).
 *
 * Lives here rather than beside `BOSS_PATTERN_NAMES` because it is a
 * presentation choice about this bar, not a property of the encounter — and
 * every id is already pinned in the manifest, so the sprite does not grow.
 *
 * Reuse is deliberate, per `docs/icon-system.md`: a bulwark is the same concept
 * as a shielded enemy's shield, so it is the same mark, and the player learns
 * one symbol rather than two synonyms.
 */
const PATTERN_ICONS: Record<BossPattern, IconId> = {
  bulwark: 'surrounded-shield',
  summon: 'star-gate',
  slam: 'punch-blast',
  siphon: 'extraction-orb',
};

/**
 * Everything the bar shows, resolved by `Game` from the lead boss.
 *
 * A plain data object rather than an `Enemy` reference on purpose: the bar is
 * presentation, and handing it the live simulation object is how a renderer
 * ends up owning gameplay state.
 */
export interface BossBarData {
  /** `Wave 40 Warden`. */
  name: string;
  hp: number;
  maxHp: number;
  /** Bulwark shield in front of the HP bar; 0 when no shield is up. */
  shield: number;
  shieldMax: number;
  /** Seconds until an un-broken shield heals the boss. 0 once it has been broken. */
  shieldTimer: number;
  phase: number;
  pattern: BossPattern | null;
  /**
   * HP fractions this encounter changes phase at (progress-steps A.2).
   *
   * Carried on the data rather than read from `BOSS_ENCOUNTER` because an
   * Ordeal has more of them than an ordinary boss, so the number of dividers
   * is a property of *this* encounter.
   */
  thresholds: readonly number[];
  /** True on an Ordeal wave — the bar takes its own colour. */
  ordeal: boolean;
  /** Seconds of slam telegraph left, and its full duration. 0 when not slamming. */
  slamRemaining: number;
  slamTotal: number;
  /** True once the boss has been slowed or shoved during the current telegraph. */
  slamMitigated: boolean;
  /** True during a phase-transition flash. */
  invulnerable: boolean;
  /** §3.3 enrage stacks and the seconds until the next one. */
  enrageStacks: number;
  enrageIn: number;
  /** Seconds this boss has been on the field. */
  elapsed: number;
  /** Bosses still alive on this wave. */
  count: number;
  /** True while the encounter is still inside the swift-kill window. */
  swiftWindow: boolean;
}

/**
 * The boss encounter readout (gameplay plan §3.5).
 *
 * The plan calls this "the single biggest readability win", and it means it
 * literally: every mechanic Part 3 adds is invisible without it. A shield that
 * heals back in ten seconds is a bug report unless the player can see the ten
 * seconds; a slam is a random burst of damage unless the countdown is on
 * screen; the enrage timer is only a threat if it reads as a clock.
 *
 * Built once and then updated through the caching `dom` helpers, so a frame in
 * which nothing changed writes nothing to the DOM.
 */
export class BossBar {
  private readonly root: HTMLElement;
  private wrap: HTMLElement | null = null;
  private nameEl: HTMLElement | null = null;
  private countEl: HTMLElement | null = null;
  private hpFill: HTMLElement | null = null;
  private shieldFill: HTMLElement | null = null;
  private hpText: HTMLElement | null = null;
  private patternEl: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private timerEl: HTMLElement | null = null;
  private telegraphWrap: HTMLElement | null = null;
  private telegraphFill: HTMLElement | null = null;
  private telegraphLabel: HTMLElement | null = null;
  private enrageEl: HTMLElement | null = null;
  private patternIcon: SVGSVGElement | null = null;
  private rim: HTMLElement | null = null;
  /** Last phase seen, so a crossing fires the flash exactly once. */
  private lastPhase = 0;
  private track: HTMLElement | null = null;
  /** Dividers currently in the DOM, so they are only rebuilt when they change. */
  private dividers: HTMLElement[] = [];
  private dividerKey = '';
  /** Alternates so a repeat flash restarts without forcing a reflow. */
  private flashPhase = false;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Pass `null` while no boss is alive; the bar hides itself. */
  /**
   * Rebuild the phase dividers when the encounter's threshold list changes.
   *
   * Keyed on the list itself, so the common case — the same boss, frame after
   * frame — touches no DOM at all. The thresholds cut the track into one
   * segment per phase, so the bar reads as a sequence of fights rather than
   * one long one: a pip was a 2px hairline over a continuous fill; a divider
   * that reaches past both edges says "this is a boundary".
   */
  private syncDividers(thresholds: readonly number[]): void {
    const key = thresholds.join(',');
    if (key === this.dividerKey) return;
    this.dividerKey = key;
    for (const d of this.dividers) d.remove();
    this.dividers = [];
    if (!this.track) return;
    thresholds.forEach((threshold, i) => {
      const div = document.createElement('div');
      div.className = 'boss-bar-divider';
      // The boundary index, not an `nth-of-type` position: a positional
      // selector would quietly match the fill elements instead.
      div.dataset.boundary = String(i + 1);
      div.style.left = `${threshold * 100}%`;
      this.track!.appendChild(div);
      this.dividers.push(div);
    });
  }

  update(data: BossBarData | null): void {
    if (!data) {
      if (this.wrap) toggleClass(this.wrap, 'is-visible', false);
      // A new encounter must not inherit the last one's phase, or a boss that
      // opens on phase 1 after one that died in phase 3 would flash on arrival.
      this.lastPhase = 0;
      return;
    }
    if (!this.wrap) this.render();
    if (!this.wrap) return;
    toggleClass(this.wrap, 'is-visible', true);

    this.syncDividers(data.thresholds);
    toggleClass(this.wrap, 'is-ordeal', data.ordeal);
    setText(this.nameEl!, data.name);
    setText(this.countEl!, data.count > 1 ? `${data.count} alive` : '');
    toggleClass(this.countEl!, 'is-visible', data.count > 1);

    const hpRatio = data.maxHp > 0 ? Math.max(0, Math.min(1, data.hp / data.maxHp)) : 0;
    setStyle(this.hpFill!, 'width', `${(hpRatio * 100).toFixed(2)}%`);
    // The shield is drawn as an overlay starting at the HP front, so "how much
    // more do I have to chew through" is one continuous read.
    const shieldRatio = data.maxHp > 0 ? Math.max(0, Math.min(1 - hpRatio, data.shield / data.maxHp)) : 0;
    setStyle(this.shieldFill!, 'left', `${(hpRatio * 100).toFixed(2)}%`);
    setStyle(this.shieldFill!, 'width', `${(shieldRatio * 100).toFixed(2)}%`);
    toggleClass(this.shieldFill!, 'is-visible', data.shield > 0);
    setText(
      this.hpText!,
      data.shield > 0
        ? `${formatNumber(Math.ceil(data.hp))} / ${formatNumber(Math.ceil(data.maxHp))}  +${formatNumber(Math.ceil(data.shield))} shield`
        : `${formatNumber(Math.ceil(data.hp))} / ${formatNumber(Math.ceil(data.maxHp))}`,
    );

    toggleClass(this.wrap, 'is-invulnerable', data.invulnerable);
    toggleClass(this.wrap, 'is-enraged', data.enrageStacks > 0);

    // A phase crossing is the single most consequential thing that happens
    // inside an encounter — the boss changes what it is doing — and it used to
    // be a border colour change during the 0.7s invulnerability window, which a
    // player watching the battlefield could miss entirely.
    if (data.phase !== this.lastPhase) {
      if (this.lastPhase !== 0) {
        this.flashPhase = !this.flashPhase;
        toggleClass(this.wrap, 'is-phase-flash-a', this.flashPhase);
        toggleClass(this.wrap, 'is-phase-flash-b', !this.flashPhase);
      }
      this.lastPhase = data.phase;
    }
    // Which of the three segments the fight is in, so the track can dim the
    // ones already spent.
    this.wrap.dataset.phase = String(data.phase);

    const pattern = data.pattern;
    setText(this.patternEl!, pattern ? `Phase ${data.phase} · ${BOSS_PATTERN_NAMES[pattern]}` : `Phase ${data.phase}`);
    setText(this.hintEl!, pattern ? BOSS_PATTERN_HINTS[pattern] : '');
    if (pattern) setIcon(this.patternIcon, PATTERN_ICONS[pattern]);
    toggleClass(this.patternIcon as unknown as HTMLElement, 'is-visible', pattern !== null);

    // The enrage clock as a rim that drains around the whole panel. As text it
    // was a number in a corner competing with four other numbers; as a ring it
    // is peripheral vision — the player sees it shortening without reading it.
    const span = data.enrageStacks > 0
      ? BOSS_ENCOUNTER.enrageInterval
      : BOSS_ENCOUNTER.enrageDelay;
    const rimFraction = span > 0 ? Math.max(0, Math.min(1, data.enrageIn / span)) : 0;
    setStyle(this.rim!, '--rim-angle', `${(rimFraction * 360).toFixed(1)}deg`);

    // The bulwark clock. It only exists while the shield is standing — once it
    // is broken there is nothing left to race, and showing a dead countdown
    // would suggest otherwise.
    if (pattern === 'bulwark' && data.shieldTimer > 0 && data.shield > 0) {
      setText(this.timerEl!, `Heals in ${data.shieldTimer.toFixed(1)}s`);
      toggleClass(this.timerEl!, 'is-visible', true);
      toggleClass(this.timerEl!, 'is-urgent', data.shieldTimer < 4);
    } else if (pattern === 'bulwark') {
      setText(this.timerEl!, 'Shield broken');
      toggleClass(this.timerEl!, 'is-visible', true);
      toggleClass(this.timerEl!, 'is-urgent', false);
    } else {
      toggleClass(this.timerEl!, 'is-visible', false);
    }

    const slamming = data.slamRemaining > 0 && data.slamTotal > 0;
    toggleClass(this.telegraphWrap!, 'is-visible', slamming);
    if (slamming) {
      const progress = 1 - data.slamRemaining / data.slamTotal;
      setStyle(this.telegraphFill!, 'width', `${(progress * 100).toFixed(1)}%`);
      toggleClass(this.telegraphWrap!, 'is-mitigated', data.slamMitigated);
      setText(
        this.telegraphLabel!,
        data.slamMitigated
          ? `SLAM BLUNTED — ${data.slamRemaining.toFixed(1)}s`
          : `SLAM INCOMING — ${data.slamRemaining.toFixed(1)}s`,
      );
    }

    if (data.enrageStacks > 0) {
      setText(this.enrageEl!, `Enraged ×${data.enrageStacks} · next in ${Math.max(0, data.enrageIn).toFixed(0)}s`);
    } else if (data.swiftWindow) {
      // Before enrage there is a different clock worth watching: the swift-kill
      // window is a reward the player can only chase if they can see it.
      const left = BOSS_ENCOUNTER.swiftKillSeconds - data.elapsed;
      setText(this.enrageEl!, `Swift kill: ${Math.max(0, left).toFixed(0)}s`);
    } else {
      setText(this.enrageEl!, `Enrages in ${Math.max(0, data.enrageIn).toFixed(0)}s`);
    }
    toggleClass(this.enrageEl!, 'is-hot', data.enrageStacks > 0);
    toggleClass(this.enrageEl!, 'is-swift', data.enrageStacks === 0 && data.swiftWindow);
  }

  private render(): void {
    const wrap = document.createElement('div');
    wrap.className = 'boss-bar';
    wrap.setAttribute('role', 'status');

    const head = document.createElement('div');
    head.className = 'boss-bar-head';
    const name = document.createElement('span');
    name.className = 'boss-bar-name';
    head.appendChild(name);
    const count = document.createElement('span');
    count.className = 'boss-bar-count';
    head.appendChild(count);
    const enrage = document.createElement('span');
    enrage.className = 'boss-bar-enrage';
    head.appendChild(enrage);
    wrap.appendChild(head);

    const track = document.createElement('div');
    track.className = 'boss-bar-track';
    const hpFill = document.createElement('div');
    hpFill.className = 'boss-bar-hp';
    track.appendChild(hpFill);
    const shieldFill = document.createElement('div');
    shieldFill.className = 'boss-bar-shield';
    track.appendChild(shieldFill);
    // The dividers are built in `syncDividers` rather than here: an Ordeal has
    // more thresholds than an ordinary boss (progress-steps A.2), so how many
    // there are is a property of the encounter on screen, not of the class.
    this.track = track;
    const hpText = document.createElement('span');
    hpText.className = 'boss-bar-hptext';
    track.appendChild(hpText);
    wrap.appendChild(track);

    const meta = document.createElement('div');
    meta.className = 'boss-bar-meta';
    const patternIcon = icon(PATTERN_ICONS.bulwark, { tone: 'inherit', className: 'boss-bar-pattern-icon' });
    meta.appendChild(patternIcon);
    const pattern = document.createElement('span');
    pattern.className = 'boss-bar-pattern';
    meta.appendChild(pattern);
    const hint = document.createElement('span');
    hint.className = 'boss-bar-hint';
    meta.appendChild(hint);
    const timer = document.createElement('span');
    timer.className = 'boss-bar-timer';
    meta.appendChild(timer);
    wrap.appendChild(meta);

    const telegraph = document.createElement('div');
    telegraph.className = 'boss-bar-telegraph';
    const telegraphLabel = document.createElement('span');
    telegraphLabel.className = 'boss-bar-telegraph-label';
    telegraph.appendChild(telegraphLabel);
    const telegraphTrack = document.createElement('div');
    telegraphTrack.className = 'boss-bar-telegraph-track';
    const telegraphFill = document.createElement('div');
    telegraphFill.className = 'boss-bar-telegraph-fill';
    telegraphTrack.appendChild(telegraphFill);
    telegraph.appendChild(telegraphTrack);
    wrap.appendChild(telegraph);

    // The draining rim, last so it sits over the panel's own border.
    const rim = document.createElement('div');
    rim.className = 'boss-bar-rim';
    wrap.appendChild(rim);

    this.root.appendChild(wrap);
    this.wrap = wrap;
    this.patternIcon = patternIcon;
    this.rim = rim;
    this.nameEl = name;
    this.countEl = count;
    this.hpFill = hpFill;
    this.shieldFill = shieldFill;
    this.hpText = hpText;
    this.patternEl = pattern;
    this.hintEl = hint;
    this.timerEl = timer;
    this.telegraphWrap = telegraph;
    this.telegraphFill = telegraphFill;
    this.telegraphLabel = telegraphLabel;
    this.enrageEl = enrage;
  }
}
