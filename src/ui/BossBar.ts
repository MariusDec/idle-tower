import type { BossPattern } from '../types';
import {
  BOSS_ENCOUNTER,
  BOSS_PATTERN_HINTS,
  BOSS_PATTERN_NAMES,
} from '../data/enemies';
import { formatNumber } from '../utils/bigNumber';
import { setStyle, setText, toggleClass } from '../utils/dom';

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

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /** Pass `null` while no boss is alive; the bar hides itself. */
  update(data: BossBarData | null): void {
    if (!data) {
      if (this.wrap) toggleClass(this.wrap, 'is-visible', false);
      return;
    }
    if (!this.wrap) this.render();
    if (!this.wrap) return;
    toggleClass(this.wrap, 'is-visible', true);

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

    const pattern = data.pattern;
    setText(this.patternEl!, pattern ? `Phase ${data.phase} · ${BOSS_PATTERN_NAMES[pattern]}` : `Phase ${data.phase}`);
    setText(this.hintEl!, pattern ? BOSS_PATTERN_HINTS[pattern] : '');

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
    // Phase pips: static markers at the two thresholds, so the player can see
    // how far the next transition is rather than being surprised by it.
    for (const threshold of BOSS_ENCOUNTER.phaseThresholds) {
      const pip = document.createElement('div');
      pip.className = 'boss-bar-pip';
      pip.style.left = `${threshold * 100}%`;
      track.appendChild(pip);
    }
    const hpText = document.createElement('span');
    hpText.className = 'boss-bar-hptext';
    track.appendChild(hpText);
    wrap.appendChild(track);

    const meta = document.createElement('div');
    meta.className = 'boss-bar-meta';
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

    this.root.appendChild(wrap);
    this.wrap = wrap;
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
