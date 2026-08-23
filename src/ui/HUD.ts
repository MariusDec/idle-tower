import type { GameState, StatsInfo, EnemyWaveStatsEntry } from '../types';
import { formatNumber, formatInt, formatWithOptionalDecimal } from '../utils/bigNumber';
import type { SpeedAPI, TargetingAPI, WaveControlAPI } from './UIManager';
import type { PacingHudData } from './PacingOverlay';
import { TARGETING_MODES } from '../data/tower';
import { TOWER_XP_TABLE, xpForNextLevel, xpToLevel } from '../data/xpTables';
import { STAT_ICONS, type StatIconKey } from '../data/iconMap';
import { ENEMY_DEFS, ENEMY_LABELS } from '../data/enemies';
import { isBossWave } from '../data/formulas';
import { icon, iconMarkup } from './Icon';
import {
  hasClass,
  setDisplay,
  setDisabled,
  setInnerHTML,
  setStyle,
  setText,
  setTitle,
  toggleClass,
} from '../utils/dom';

const MANA_UNLOCK_WAVE = 10;

/**
 * A resource chip (UI plan §7).
 *
 * Gold, kills and DPS used to be bare `<span>`s: a label and a number, with no
 * mark to find them by and no feedback when they moved. The chip adds both —
 * the icon is what the eye lands on, and the tick/flare is what turns "the
 * number is different now" into "you just earned that".
 */
interface PillRefs {
  wrap: HTMLElement;
  valueEl: HTMLElement;
  /** Last *authoritative* (untweened) value, so a gain is detected exactly once. */
  last: number;
  /**
   * Alternates between two identical animation classes so a repeat gain
   * restarts the tick. The usual trick — remove the class, read `offsetWidth`,
   * add it back — forces a synchronous layout on every gold pickup, which is
   * exactly the kind of per-frame reflow the rest of this UI is careful about.
   */
  tickPhase: boolean;
}

/**
 * A gain has to be worth this fraction of what is already there before it earns
 * a flare. Proportional rather than absolute because "a lot of gold" means
 * something different at wave 3 and at wave 300.
 */
const PILL_FLARE_FRACTION = 0.12;

/**
 * A HUD bar (UI plan §7).
 *
 * Three things beyond the fill, and each answers a question the old flat bar
 * could not:
 *
 * - **The ghost** trails behind a *falling* value, so "how much did that hit
 *   take" is a length on screen instead of two numbers a frame apart.
 * - **The segments** at 25% intervals give the bar a scale. Without them a bar
 *   at 61% and a bar at 74% look the same at HUD size.
 * - **The threshold pulse** fires when the fill crosses a quarter, which is the
 *   moment the reading actually changed meaning.
 */
interface BarRefs {
  block: HTMLElement;
  fill: HTMLElement;
  ghost: HTMLElement;
  valueEl: HTMLElement;
  /** Live 0..1. */
  ratio: number;
  ratioPrev: number;
  /** The lagging 0..1 the ghost is drawn at. */
  ghostRatio: number;
  /** Seconds the ghost still holds its position before it starts draining. */
  ghostHold: number;
  /** Quarter the fill was last in, for the crossing pulse. */
  quarter: number;
  pulsePhase: boolean;
  /** XP wraps to 0 on a level-up; a "you just lost that" ghost would be a lie. */
  suppressGhostOnDrop: boolean;
  /**
   * False until the first real reading. Without it a bar that starts empty —
   * mana on a fresh save, XP at level 1 — opens the run with a full-width ghost
   * draining away and a threshold pulse for a crossing that never happened.
   */
  seeded: boolean;
}

/**
 * How long the ghost holds before it drains, and how fast it drains once it
 * does. The hold is re-armed by every further drop, so sustained damage keeps
 * the ghost pinned at the pre-damage level and it only pays out once the tower
 * stops being hit — which is the read the player wants: total damage taken in
 * *this* exchange, not in the last frame.
 */
const BAR_GHOST_HOLD = 0.3;
const BAR_GHOST_TAU = 0.28;

/** Below this XP/sec the time-to-level estimate is noise, so it is hidden. */
const MIN_XP_RATE_FOR_ETA = 0.05;

/** Compact "time until" string for the XP-to-next-level hint. */
function formatEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function formatSpeed(v: number): string {
  if (Number.isInteger(v)) return `${v}x`;
  return `${v.toFixed(1).replace(/\.0$/, '')}x`;
}

export class HUD {
  private readonly root: HTMLElement;
  private manaEl!: HTMLElement;
  private manaBar!: BarRefs;
  private manaWrap!: HTMLElement;
  private xpBar!: BarRefs;
  private xpPctEl!: HTMLElement;
  private xpLevelEl!: HTMLElement;
  private xpWrapEl!: HTMLElement;
  /** Rolling XP/sec estimate, for the time-to-next-level readout. */
  private xpRate = 0;
  private lastTotalXp = -1;
  private waveEl!: HTMLElement;
  private waveFocal!: HTMLElement;
  private waveCaptionEl!: HTMLElement;
  private threatRow!: HTMLElement;
  /** Composition signature, so an unchanged preview never rebuilds its icons. */
  private threatSig = '';
  private dpsPill!: PillRefs;
  private goldPill!: PillRefs;
  private killsPill!: PillRefs;
  /** Every chip, so a reduced-motion / reset sweep has one list to walk. */
  private readonly pills: PillRefs[] = [];
  private hpEl!: HTMLElement;
  private hpWrap!: HTMLElement;
  private hpBar!: BarRefs;
  private statsBtn!: HTMLButtonElement;
  private statsTooltip!: HTMLElement;
  private statsPopup!: HTMLElement;
  private statsPopupBody!: HTMLElement;
  private statsInfo: StatsInfo | null = null;
  private enemyStatsBtn!: HTMLButtonElement;
  private enemyStatsTooltip!: HTMLElement;
  private enemyStatsPopup!: HTMLElement;
  private enemyStatsPopupBody!: HTMLElement;
  private enemyStatsInfo: EnemyWaveStatsEntry[] = [];
  // Tweened display values (P3: smooth number transitions)
  private displayGold = 0;
  private displayMana = 0;
  private displayHP = 0;
  private displayMaxHP = 0;
  private displayWave = 1;
  private displayDps = 0;
  private tweenInitialized = false;
  private dps = 0;
  private speedApi: SpeedAPI = { speeds: [], currentIndex: 0, maxIndex: 0 };
  private waveApi: WaveControlAPI = { autoProgress: true, currentWave: 1, isIntermission: false };
  private targetingApi: TargetingAPI = { currentMode: 'priority', setMode: () => {} };
  private onSpeedChange: (index: number) => void = () => {};
  private onRestartWave: () => void = () => {};
  private onToggleAutoProgress: () => void = () => {};
  private displayXpProgress = 0;
  private displayXpNeeded = 1;
  private speedLabelEl!: HTMLElement;
  private speedDecBtn!: HTMLButtonElement;
  private speedIncBtn!: HTMLButtonElement;
  private restartWaveBtn!: HTMLButtonElement;
  private autoProgressBtn!: HTMLButtonElement;
  private targetingSelect!: HTMLSelectElement;
  private waveStatusEl!: HTMLElement;
  private moreBtn!: HTMLButtonElement;
  private moreSpeedDecBtn!: HTMLButtonElement;
  private moreSpeedIncBtn!: HTMLButtonElement;
  private moreSpeedLabelEl!: HTMLElement;
  private moreDpsEl!: HTMLElement;
  private keybindsBtn!: HTMLButtonElement;
  private onShowKeybinds: () => void = () => {};
  private moreStatsBtn!: HTMLButtonElement;
  private moreEnemyStatsBtn!: HTMLButtonElement;
  // ── Pacing controls (gameplay plan §7.1 / §7.4) ──
  private callWaveBtn!: HTMLButtonElement;
  private riskWrap!: HTMLElement;
  private riskValueEl!: HTMLElement;
  private riskDecBtn!: HTMLButtonElement;
  private riskIncBtn!: HTMLButtonElement;
  private momentumEl!: HTMLElement;
  private pacing: PacingHudData | null = null;
  private onCallWaveEarly: () => void = () => {};
  private onRiskChange: (level: number) => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
  }

  setDPS(value: number): void {
    this.dps = value;
    if (this.moreDpsEl) setText(this.moreDpsEl, formatNumber(value));
  }


  setSpeedAPI(api: SpeedAPI): void {
    this.speedApi = api;
  }

  setWaveControlAPI(api: WaveControlAPI): void {
    this.waveApi = api;
  }

  /** Pacing readout for this frame (plan §7), pushed via `UIManager`. */
  setPacingData(data: PacingHudData): void {
    this.pacing = data;
  }

  setOnCallWaveEarly(cb: () => void): void {
    this.onCallWaveEarly = cb;
  }

  setOnRiskChange(cb: (level: number) => void): void {
    this.onRiskChange = cb;
  }

  /**
   * Plan §2.3: targeting moved out of Settings and next to the wave controls.
   *
   * With the behavioural roster on the field it is a live tactical choice — a
   * warden walking in wants `Priority`, a thief already loaded wants it dead
   * now — and a live choice does not belong three tabs away under a heading
   * called "preferences".
   */
  setTargetingAPI(api: TargetingAPI): void {
    this.targetingApi = api;
    if (this.targetingSelect) this.targetingSelect.value = api.currentMode;
  }

  /** Push a mode change made elsewhere (the Settings panel) into the HUD. */
  syncTargetingMode(mode: string): void {
    this.targetingApi.currentMode = mode;
    if (this.targetingSelect) this.targetingSelect.value = mode;
  }

  setOnSpeedChange(handler: (index: number) => void): void {
    this.onSpeedChange = handler;
  }

  setOnRestartWave(handler: () => void): void {
    this.onRestartWave = handler;
  }

  setOnToggleAutoProgress(handler: () => void): void {
    this.onToggleAutoProgress = handler;
  }

  setOnShowKeybinds(handler: () => void): void {
    this.onShowKeybinds = handler;
  }

  setStatsInfo(info: StatsInfo): void {
    this.statsInfo = info;
    if (this.statsTooltip.style.display !== 'none') {
      this.renderStatsContent(this.statsTooltip, info);
    }
    if (hasClass(this.statsPopup, 'is-open')) {
      this.renderStatsContent(this.statsPopupBody, info);
    }
  }

  private renderStatsContent(el: HTMLElement, info: StatsInfo): void {
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    setInnerHTML(el, `
      <div class="stat-row"><span>Damage</span><span>${formatWithOptionalDecimal(info.damage)}</span></div>
      <div class="stat-row"><span>Fire Rate</span><span>${info.fireRate.toFixed(2)}/s</span></div>
      <div class="stat-row"><span>DPS</span><span>${formatWithOptionalDecimal(info.dps)}</span></div>
      <div class="stat-row"><span>Crit Rate</span><span>${pct(info.critChance)}</span></div>
      <div class="stat-row"><span>Crit Damage</span><span>${(info.critDamage * 100).toFixed(0)}%</span></div>
      <div class="stat-row"><span>Range</span><span>${info.range.toFixed(0)}</span></div>
      <div class="stat-row"><span>Health</span><span>${Math.floor(info.hp)} / ${Math.floor(info.maxHp)}</span></div>
      <div class="stat-row"><span>Health Regen</span><span>${formatWithOptionalDecimal(info.maxHp * info.healthRegen, 2)}/s</span></div>
      <div class="stat-row"><span>Defense</span><span>${info.defense.toFixed(0)}</span></div>
      <div class="stat-row"><span>Armor</span><span>${info.armor.toFixed(0)}</span></div>
      <div class="stat-row"><span>Lifesteal</span><span>${pct(info.lifesteal)}</span></div>
      <div class="stat-row"><span>Thorns</span><span>${pct(info.thorns)}</span></div>
      <div class="stat-row"><span>Mana Regen</span><span>${formatWithOptionalDecimal(info.manaRegen)}/s</span></div>
      <div class="stat-row"><span>Max Mana</span><span>${info.maxMana}</span></div>
      <div class="stat-row"><span>Gold Multiplier</span><span>${info.goldMultiplier.toFixed(2)}x</span></div>
      ${this.renderGoldBreakdown(info)}
      <div class="stat-row"><span>RP Gain</span><span>${formatNumber(info.rpGainRate, 3)}/s</span></div>
    `);
  }

  /**
   * Per-source attribution under the gold multiplier (plan §4.2), so the
   * player can see *why* it is what it is instead of taking one opaque
   * number on faith. Sources come from the same pass that composes the
   * multiplier, so the two cannot disagree.
   */
  private renderGoldBreakdown(info: StatsInfo): string {
    const sources = info.goldSources ?? [];
    if (sources.length === 0) return '';
    const rows: string[] = [];
    let additiveTotal = 0;
    for (const s of sources) {
      if (s.kind !== 'additive') continue;
      additiveTotal += s.additive;
      rows.push(`<div class="stat-subrow"><span>${s.label}</span><span>+${(s.additive * 100).toFixed(0)}%</span></div>`);
    }
    const multiplicative = sources.filter(s => s.kind === 'multiplicative');
    // The subtotal line is what turns the summed percentages above into the
    // factor the multiplicative sources below build on — without it the two
    // halves of the composition look unrelated.
    if (rows.length > 0 && multiplicative.length > 0) {
      rows.push(`<div class="stat-subrow stat-subtotal"><span>subtotal</span><span>×${(1 + additiveTotal).toFixed(2)}</span></div>`);
    }
    for (const s of multiplicative) {
      if (s.kind !== 'multiplicative') continue;
      rows.push(`<div class="stat-subrow"><span>${s.label}</span><span>×${s.factor.toFixed(2)}</span></div>`);
    }
    if (rows.length === 0) return '';
    return `<div class="stat-breakdown">${rows.join('')}</div>`;
  }

  private openStatsPopup(): void {
    if (!this.statsInfo) return;
    this.renderStatsContent(this.statsPopupBody, this.statsInfo);
    toggleClass(this.statsPopup, 'is-open', true);
    toggleClass(this.statsBtn, 'is-active', true);
  }

  private closeStatsPopup(): void {
    toggleClass(this.statsPopup, 'is-open', false);
    toggleClass(this.statsBtn, 'is-active', false);
  }

  setEnemyStatsInfo(entries: EnemyWaveStatsEntry[]): void {
    this.enemyStatsInfo = entries;
    if (this.enemyStatsTooltip.style.display !== 'none') {
      this.renderEnemyStatsContent(this.enemyStatsTooltip, entries);
    }
    if (hasClass(this.enemyStatsPopup, 'is-open')) {
      this.renderEnemyStatsContent(this.enemyStatsPopupBody, entries);
    }
  }

  private renderEnemyStatsContent(el: HTMLElement, entries: EnemyWaveStatsEntry[]): void {
    if (entries.length === 0) {
      setInnerHTML(el, '<div class="stat-row"><span>No enemies this wave</span><span></span></div>');
      return;
    }
    const cols = entries.map(e => {
      const label = e.type.charAt(0).toUpperCase() + e.type.slice(1);
      return `<div class="enemy-stats-col">
        <div class="enemy-stats-type-header">${label}</div>
        <div class="stat-row"><span>Gold</span><span>${formatNumber(e.gold)}</span></div>
        <div class="stat-row"><span>HP</span><span>${formatNumber(e.hp)}</span></div>
        <div class="stat-row"><span>Damage</span><span>${formatNumber(e.damage)}</span></div>
        <div class="stat-row"><span>Fire Rate</span><span>${e.fireRate.toFixed(2)}/s</span></div>
        <div class="stat-row"><span>Armor</span><span>${e.armor.toFixed(0)}</span></div>
        <div class="stat-row"><span>Magic Resist</span><span>${(e.magicResist * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span>Speed</span><span>${e.speed.toFixed(0)}</span></div>
      </div>`;
    }).join('');
    const wide = entries.length > 3 ? ' enemy-stats-grid-wide' : '';
    setInnerHTML(el, `<div class="enemy-stats-grid${wide}">${cols}</div>`);
  }

  private openEnemyStatsPopup(): void {
    if (this.enemyStatsInfo.length === 0) return;
    this.renderEnemyStatsContent(this.enemyStatsPopupBody, this.enemyStatsInfo);
    toggleClass(this.enemyStatsPopup, 'is-open', true);
    toggleClass(this.enemyStatsBtn, 'is-active', true);
  }

  private closeEnemyStatsPopup(): void {
    toggleClass(this.enemyStatsPopup, 'is-open', false);
    toggleClass(this.enemyStatsBtn, 'is-active', false);
  }

  /**
   * Per-frame tween for smooth number transitions. Called from Game.update()
   * every frame (not throttled). Updates display float values that HUD.update()
   * later renders via textContent.
   */
  tickDisplay(dt: number, state: GameState): void {
    // Initialize display values on first call to avoid giant snap from 0
    if (!this.tweenInitialized) {
      this.displayGold = state.resources.gold;
      this.displayMana = state.resources.mana;
      this.displayHP = state.tower.hp;
      this.displayMaxHP = state.tower.maxHp;
      this.displayWave = state.wave.number;
      this.displayDps = this.dps;
      this.tweenInitialized = true;
    }
    // Time-constant smoothing: 1 - exp(-dt/tau). Lower tau = snappier.
    const goldTau = 0.18;
    const manaTau = 0.12;
    const hpTau = 0.15;
    const waveTau = 0.25;
    const goldAlpha = 1 - Math.exp(-dt / goldTau);
    const manaAlpha = 1 - Math.exp(-dt / manaTau);
    const hpAlpha = 1 - Math.exp(-dt / hpTau);
    const waveAlpha = 1 - Math.exp(-dt / waveTau);
    this.displayGold += (state.resources.gold - this.displayGold) * goldAlpha;
    this.displayMana += (state.resources.mana - this.displayMana) * manaAlpha;
    this.displayHP += (state.tower.hp - this.displayHP) * hpAlpha;
    this.displayMaxHP += (state.tower.maxHp - this.displayMaxHP) * hpAlpha;
      this.displayWave += (state.wave.number - this.displayWave) * waveAlpha;
    const dpsAlpha = 1 - Math.exp(-dt / 0.2);
    this.displayDps += (this.dps - this.displayDps) * dpsAlpha;
    const tx = state.towerXp;
    if (tx) {
      // Exponentially-smoothed XP rate. Seeded on the first frame so a loaded
      // save's lifetime total is not mistaken for one frame's worth of gain.
      if (this.lastTotalXp < 0) {
        this.lastTotalXp = tx.totalXpEarned;
      } else if (dt > 0) {
        const gained = Math.max(0, tx.totalXpEarned - this.lastTotalXp);
        this.lastTotalXp = tx.totalXpEarned;
        const rateAlpha = 1 - Math.exp(-dt / 5);
        this.xpRate += (gained / dt - this.xpRate) * rateAlpha;
      }
      this.displayXpNeeded = xpForNextLevel(tx.level);
      if (xpToLevel(tx.xp) > tx.level) {
        this.displayXpProgress = 1;
      } else {
        const xpIntoLevel = tx.xp - TOWER_XP_TABLE[tx.level];
        this.displayXpProgress = this.displayXpNeeded > 0 && this.displayXpNeeded !== Infinity
          ? Math.min(1, xpIntoLevel / this.displayXpNeeded)
          : 1;
      }
    }
    this.tickBars(dt, state);
  }

  /**
   * Fills, ghosts and threshold pulses, every frame.
   *
   * Reads the tweened display values rather than the raw state, so the ghost
   * trails the number the player is actually looking at.
   */
  private tickBars(dt: number, state: GameState): void {
    const maxHp = Math.max(1, this.displayMaxHP);
    this.tickBar(this.hpBar, Math.max(0, this.displayHP) / maxHp, dt);

    const manaUnlocked = state.wave.highestWave >= MANA_UNLOCK_WAVE;
    const maxMana = state.resources.maxMana;
    this.tickBar(
      this.manaBar,
      manaUnlocked && maxMana > 0 ? this.displayMana / maxMana : 0,
      dt,
    );

    const tx = state.towerXp;
    this.tickBar(this.xpBar, tx && tx.level >= 1999 ? 1 : this.displayXpProgress, dt);
  }

  update(state: GameState): void {
    const manaUnlocked = state.wave.highestWave >= MANA_UNLOCK_WAVE;
    this.updateXpBar(state);
    this.updatePacingControls();
    toggleClass(this.manaWrap, 'is-locked', !manaUnlocked);
    this.setPillValue(this.goldPill, formatNumber(this.displayGold), state.resources.gold);
    if (manaUnlocked) {
      const manaDisplay = Math.floor(this.displayMana);
      setText(this.manaEl, `${manaDisplay} / ${state.resources.maxMana}`);
    } else {
      setText(this.manaEl, `Locked · wave ${MANA_UNLOCK_WAVE}`);
    }
    // The caption says "Wave"; the number no longer has to repeat the word.
    const waveShown = Math.round(this.displayWave);
    setText(this.waveEl, String(waveShown));
    // A boss wave is the one wave the player must not walk into unprepared, so
    // the focal element says so in its own right rather than leaving it to a
    // status line under it. Reads off `isBossWave`, the same predicate
    // `WaveManager` spawns from, so the two cannot disagree.
    const boss = isBossWave(waveShown);
    toggleClass(this.waveFocal, 'is-boss', boss);
    setText(this.waveCaptionEl, boss ? 'Boss Wave' : 'Wave');
    // The chip carries the label, so the value no longer has to repeat it —
    // "1.2K DPS" under a heading reading "DPS" was saying it twice. No tick:
    // DPS is a *rate*, and a rate that drifts up every frame would flicker
    // continuously rather than marking anything the player did.
    setText(this.dpsPill.valueEl, formatWithOptionalDecimal(this.displayDps));
    this.setPillValue(
      this.killsPill,
      formatNumber(state.stats.enemiesKilled),
      state.stats.enemiesKilled,
    );
    const hpDisplay = Math.max(0, this.displayHP);
    const maxHpDisplay = Math.max(1, this.displayMaxHP);
    setText(this.hpEl, `${formatNumber(hpDisplay)} / ${formatNumber(maxHpDisplay)}`);
    const hpRatio = maxHpDisplay > 0 ? hpDisplay / maxHpDisplay : 0;
    toggleClass(this.hpWrap, 'is-critical', hpRatio > 0 && hpRatio <= 0.4);
    toggleClass(this.hpWrap, 'is-dead', hpRatio <= 0);
    this.syncControls(state);
  }

  private syncControls(state: GameState): void {
    const speeds = this.speedApi.speeds;
    const cur = Math.max(0, Math.min(speeds.length - 1, this.speedApi.currentIndex));
    const max = Math.max(0, Math.min(speeds.length - 1, this.speedApi.maxIndex));
    const currentSpeed = speeds[cur] ?? 1;
    setText(this.speedLabelEl, formatSpeed(currentSpeed));
    setDisabled(this.speedDecBtn, cur <= 0);
    setDisabled(this.speedIncBtn, cur >= max);
    setTitle(this.speedDecBtn, cur > 0 ? `Slow to ${formatSpeed(speeds[cur - 1])}` : 'Already slowest');
    setTitle(this.speedIncBtn, cur < max ? `Speed up to ${formatSpeed(speeds[cur + 1])}` : 'Max speed reached');

    // Mirror speed state into the "more" popup (mobile).
    if (this.moreSpeedLabelEl) {
      setText(this.moreSpeedLabelEl, formatSpeed(currentSpeed));
      setDisabled(this.moreSpeedDecBtn, cur <= 0);
      setDisabled(this.moreSpeedIncBtn, cur >= max);
    }
    const wave = state.wave.number;
    // Restarting replays the wave you are on — enemies, mines and all — so it
    // is the honest answer to "I want another shot at this wave", where the
    // old step controls let a run hop backwards to re-farm or forwards past a
    // wave it never survived.
    setTitle(this.restartWaveBtn, `Restart wave ${wave}`);
    toggleClass(this.autoProgressBtn, 'is-on', this.waveApi.autoProgress);
    toggleClass(this.autoProgressBtn, 'is-off', !this.waveApi.autoProgress);
    setText(this.autoProgressBtn, this.waveApi.autoProgress ? 'Auto' : 'Paused');
    setTitle(this.autoProgressBtn, this.waveApi.autoProgress
      ? 'Auto-Progress is ON. Click to auto-restart current wave.'
      : 'Auto-Progress is OFF. Click to resume auto-advancing waves.');

    // Enrage outranks the intermission label: it is the one thing the player
    // needs to react to, and a wave can only be enraged while it is live.
    const enrageStacks = state.wave.enrageStacks ?? 0;
    toggleClass(this.waveStatusEl, 'wave-enrage', enrageStacks > 0);
    if (enrageStacks > 0) {
      setText(this.waveStatusEl, `ENRAGED ×${enrageStacks}`);
      setTitle(this.waveStatusEl, 'This wave has overrun. Enemies get stronger until it ends.');
      toggleClass(this.waveStatusEl, 'is-warning', true);
    } else if (this.waveApi.isIntermission && !this.waveApi.autoProgress) {
      setText(this.waveStatusEl, '');
      setTitle(this.waveStatusEl, '');
      toggleClass(this.waveStatusEl, 'is-warning', true);
    } else if (this.waveApi.isIntermission) {
      setText(this.waveStatusEl, 'Intermission');
      setTitle(this.waveStatusEl, '');
      toggleClass(this.waveStatusEl, 'is-warning', false);
    } else {
      setText(this.waveStatusEl, '');
      setTitle(this.waveStatusEl, '');
      toggleClass(this.waveStatusEl, 'is-warning', false);
    }
  }

  private updateXpBar(state: GameState): void {
    const tx = state.towerXp;
    if (!tx) return;
    setText(this.xpLevelEl, `Lv.${tx.level + 1}`);
    const needed = this.displayXpNeeded;
    if (needed > 0 && needed !== Infinity) {
      const xpIntoLevel = Math.max(0, tx.xp - TOWER_XP_TABLE[tx.level]);
      const currentXp = Math.min(xpIntoLevel, needed);
      setText(this.xpPctEl, `${formatInt(currentXp)} / ${formatInt(needed)} XP`);
      // Plan §2.4: say how far off the next level is, and how long that is at
      // the current rate — without it the bar is a number with no scale.
      const remaining = Math.max(0, needed - currentXp);
      // Only quote an ETA once the rate is high enough to be meaningful —
      // otherwise a near-idle tower reports "75 days at 0 XP/s", which is both
      // useless and alarming.
      const hasRate = this.xpRate >= MIN_XP_RATE_FOR_ETA;
      setTitle(
        this.xpWrapEl,
        `Tower level ${tx.level}. ${formatInt(remaining)} XP to level ${tx.level + 1}`
        + (hasRate ? ` (~${formatEta(remaining / this.xpRate)} at ${formatNumber(this.xpRate)} XP/s).` : '.')
        + ` ${formatInt(tx.unspentTalentPoints)} unspent talent point${tx.unspentTalentPoints === 1 ? '' : 's'}.`,
      );
    } else {
      setText(this.xpPctEl, `MAX LEVEL`);
      setTitle(this.xpWrapEl, 'Tower is at max level.');
    }
  }

  private render(): void {
    this.root.innerHTML = '';
    this.root.classList.add('hud');

    const groupLeft = document.createElement('div');
    groupLeft.className = 'hud-group';
    this.goldPill = this.addPill(groupLeft, 'Gold', '0', 'gold', 'gold');
    this.killsPill = this.addPill(groupLeft, 'Kills', '0', 'kills', 'blood');
    groupLeft.appendChild(this.renderWaveBlock());
    const statsWrap = document.createElement('div');
    statsWrap.className = 'hud-stats-wrap';

    this.statsBtn = document.createElement('button');
    this.statsBtn.type = 'button';
    this.statsBtn.className = 'hud-stats-btn';
    this.statsBtn.textContent = 'Stats';
    this.statsBtn.addEventListener('mouseenter', () => {
      if (this.statsInfo) {
        this.renderStatsContent(this.statsTooltip, this.statsInfo);
        setDisplay(this.statsTooltip, 'block');
      }
    });
    this.statsBtn.addEventListener('mouseleave', () => {
      setDisplay(this.statsTooltip, 'none');
    });
    this.statsBtn.addEventListener('click', () => {
      if (hasClass(this.statsPopup, 'is-open')) {
        this.closeStatsPopup();
      } else {
        this.openStatsPopup();
      }
    });
    statsWrap.appendChild(this.statsBtn);

    this.statsTooltip = document.createElement('div');
    this.statsTooltip.className = 'hud-stats-tooltip';
    this.statsTooltip.style.display = 'none';
    statsWrap.appendChild(this.statsTooltip);

    this.enemyStatsBtn = document.createElement('button');
    this.enemyStatsBtn.type = 'button';
    this.enemyStatsBtn.className = 'hud-stats-btn';
    this.enemyStatsBtn.textContent = 'Enemies';
    this.enemyStatsBtn.addEventListener('mouseenter', () => {
      if (this.enemyStatsInfo.length > 0) {
        this.renderEnemyStatsContent(this.enemyStatsTooltip, this.enemyStatsInfo);
        setDisplay(this.enemyStatsTooltip, 'block');
      }
    });
    this.enemyStatsBtn.addEventListener('mouseleave', () => {
      setDisplay(this.enemyStatsTooltip, 'none');
    });
    this.enemyStatsBtn.addEventListener('click', () => {
      if (hasClass(this.enemyStatsPopup, 'is-open')) {
        this.closeEnemyStatsPopup();
      } else {
        this.openEnemyStatsPopup();
      }
    });
    statsWrap.appendChild(this.enemyStatsBtn);

    this.enemyStatsTooltip = document.createElement('div');
    this.enemyStatsTooltip.className = 'hud-stats-tooltip';
    this.enemyStatsTooltip.style.display = 'none';
    statsWrap.appendChild(this.enemyStatsTooltip);

    this.root.appendChild(statsWrap);

    this.statsPopup = document.createElement('div');
    this.statsPopup.className = 'hud-stats-popup';
    const popupInner = document.createElement('div');
    popupInner.className = 'hud-stats-popup-inner';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'hud-stats-popup-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', () => this.closeStatsPopup());
    popupInner.appendChild(closeBtn);
    const popupTitle = document.createElement('h3');
    popupTitle.className = 'hud-stats-popup-title';
    popupTitle.textContent = 'Tower Stats';
    popupInner.appendChild(popupTitle);
    const popupBody = document.createElement('div');
    popupBody.className = 'hud-stats-popup-body';
    this.statsPopupBody = popupBody;
    popupInner.appendChild(popupBody);
    this.statsPopup.appendChild(popupInner);
    this.statsPopup.addEventListener('click', (e) => {
      if (e.target === this.statsPopup) this.closeStatsPopup();
    });
    document.body.appendChild(this.statsPopup);

    this.enemyStatsPopup = document.createElement('div');
    this.enemyStatsPopup.className = 'hud-stats-popup';
    const enemyPopupInner = document.createElement('div');
    enemyPopupInner.className = 'hud-stats-popup-inner enemy-stats-popup-inner';
    const enemyCloseBtn = document.createElement('button');
    enemyCloseBtn.type = 'button';
    enemyCloseBtn.className = 'hud-stats-popup-close';
    enemyCloseBtn.textContent = '\u00d7';
    enemyCloseBtn.addEventListener('click', () => this.closeEnemyStatsPopup());
    enemyPopupInner.appendChild(enemyCloseBtn);
    const enemyPopupTitle = document.createElement('h3');
    enemyPopupTitle.className = 'hud-stats-popup-title';
    enemyPopupTitle.textContent = 'Enemy Stats';
    enemyPopupInner.appendChild(enemyPopupTitle);
    const enemyPopupBody = document.createElement('div');
    enemyPopupBody.className = 'hud-stats-popup-body';
    this.enemyStatsPopupBody = enemyPopupBody;
    enemyPopupInner.appendChild(enemyPopupBody);
    this.enemyStatsPopup.appendChild(enemyPopupInner);
    this.enemyStatsPopup.addEventListener('click', (e) => {
      if (e.target === this.enemyStatsPopup) this.closeEnemyStatsPopup();
    });
    document.body.appendChild(this.enemyStatsPopup);

    this.root.appendChild(groupLeft);

    this.hpBar = this.makeBar('hp', 'Tower HP', 'hp', 'critical');
    this.hpWrap = this.hpBar.block;
    this.hpEl = this.hpBar.valueEl;
    setText(this.hpEl, '5 / 5');
    this.root.appendChild(this.hpBar.block);

    this.manaBar = this.makeBar('mana', 'Mana', 'mana', 'mana');
    this.manaWrap = this.manaBar.block;
    this.manaEl = this.manaBar.valueEl;
    setText(this.manaEl, '0 / 100');
    this.root.appendChild(this.manaBar.block);

    // Tower XP. The level badge sits between the label and the value because
    // "Lv.7" is the headline the bar is filling towards, not a footnote to it.
    this.xpBar = this.makeBar('xp', 'Tower XP', 'xp', 'gold');
    this.xpWrapEl = this.xpBar.block;
    this.xpPctEl = this.xpBar.valueEl;
    setText(this.xpPctEl, '0 / 0 XP');
    this.xpLevelEl = document.createElement('span');
    this.xpLevelEl.className = 'hud-bar-level u-display u-tabular';
    this.xpLevelEl.textContent = 'Lv.1';
    this.xpPctEl.parentElement?.insertBefore(this.xpLevelEl, this.xpPctEl);
    this.root.appendChild(this.xpBar.block);

    const groupRight = document.createElement('div');
    groupRight.className = 'hud-group right';
    this.keybindsBtn = document.createElement('button');
    this.keybindsBtn.type = 'button';
    this.keybindsBtn.className = 'hud-keybinds-btn';
    this.keybindsBtn.textContent = '?';
    this.keybindsBtn.title = 'Keyboard shortcuts (?)';
    this.keybindsBtn.setAttribute('aria-label', 'Keyboard shortcuts');
    this.keybindsBtn.addEventListener('click', () => this.onShowKeybinds());
    groupRight.appendChild(this.keybindsBtn);
    this.dpsPill = this.addPill(groupRight, 'DPS', '0', 'dps', 'ember');
    groupRight.appendChild(this.renderSpeedBlock());
    this.root.appendChild(groupRight);

    // Mobile-only "More" button — appended to groupLeft so it sits inline with
    // the wave controls in the top row. CSS pushes it to the right edge with
    // margin-left: auto. Opens a popup with the elements hidden by the
    // compact mobile HUD (DPS, FPS, speed, stats & enemies buttons).
    this.moreBtn = document.createElement('button');
    this.moreBtn.type = 'button';
    this.moreBtn.className = 'hud-more-btn';
    this.moreBtn.textContent = '\u2026';
    this.moreBtn.setAttribute('aria-label', 'More controls');
    groupLeft.appendChild(this.moreBtn);
    this.installMorePopup();
  }

  /**
   * Returns a container element the host can use to render the milestone
   * strip. Appended next to the HUD root in the document so it can use the
   * full screen width without conflicting with the HUD bar layout.
   */
  renderMilestoneStripSlot(): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'milestone-strip-slot';
    document.body.appendChild(slot);
    return slot;
  }

  /**
   * Container for the contract tracker (gameplay plan §5.3).
   *
   * Owns the bottom-left corner; the milestone strip's `bottom` is offset by
   * `--contract-tracker-height` so the strip sits directly above it, which is
   * the "under the milestone strip" the plan asks for. Same reason as the
   * milestone slot for living next to the HUD root rather than inside it: the
   * HUD bar's layout has nothing to say about a corner overlay.
   */
  renderContractTrackerSlot(): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'contract-tracker-slot';
    document.body.appendChild(slot);
    return slot;
  }

  private renderWaveBlock(): HTMLElement {
    const block = document.createElement('div');
    block.className = 'hud-wave-block';

    // \u2500\u2500 The focal element \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // The wave number is the one figure in the HUD that names where the run
    // *is*, and it used to be a 18px span reading "Wave 1" under a caption
    // reading "Wave". It is now the display face at four times the size, with the restart
    // control beside it rather than sharing a button row with the targeting
    // dropdown and a "..." menu.
    const focal = document.createElement('div');
    focal.className = 'hud-wave-focal';
    this.waveFocal = focal;

    // Restart replaces the old ‹ › step controls: free wave navigation let a
    // run re-farm earlier waves or skip past one it never survived, which
    // fights the risk dial, contracts, and anything else priced per wave.
    // Replaying the wave you are on has no such loophole.
    this.restartWaveBtn = document.createElement('button');
    this.restartWaveBtn.type = 'button';
    this.restartWaveBtn.className = 'hud-wave-restart';
    this.restartWaveBtn.textContent = '↻';
    this.restartWaveBtn.setAttribute('aria-label', 'Restart wave');
    this.restartWaveBtn.addEventListener('click', () => this.onRestartWave());
    focal.appendChild(this.restartWaveBtn);

    const numWrap = document.createElement('div');
    numWrap.className = 'hud-wave-numwrap';
    this.waveCaptionEl = document.createElement('span');
    this.waveCaptionEl.className = 'hud-wave-caption';
    this.waveCaptionEl.textContent = 'Wave';
    numWrap.appendChild(this.waveCaptionEl);
    this.waveEl = document.createElement('span');
    this.waveEl.className = 'hud-wave-number u-display u-tabular';
    this.waveEl.textContent = '1';
    numWrap.appendChild(this.waveEl);
    focal.appendChild(numWrap);

    block.appendChild(focal);

    // \u2500\u2500 Everything arranged around it \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const side = document.createElement('div');
    side.className = 'hud-wave-side';

    this.waveStatusEl = document.createElement('div');
    this.waveStatusEl.className = 'hud-wave-status';
    side.appendChild(this.waveStatusEl);

    // Threat preview, as marks rather than a sentence. The arena overlay keeps
    // the named, readable version next to the spawn-lane arrows; this is the
    // glance in the persistent chrome, which is where the player is already
    // looking at the wave number the threat belongs to.
    this.threatRow = document.createElement('div');
    this.threatRow.className = 'hud-wave-threat';
    side.appendChild(this.threatRow);

    const controls = document.createElement('div');
    controls.className = 'hud-wave-controls';

    this.autoProgressBtn = document.createElement('button');
    this.autoProgressBtn.type = 'button';
    this.autoProgressBtn.className = 'hud-ctrl-btn hud-ctrl-toggle is-on';
    this.autoProgressBtn.textContent = 'Auto';
    this.autoProgressBtn.setAttribute('aria-label', 'Toggle auto-progress');
    this.autoProgressBtn.addEventListener('click', () => this.onToggleAutoProgress());
    controls.appendChild(this.autoProgressBtn);

    this.targetingSelect = document.createElement('select');
    this.targetingSelect.className = 'hud-targeting-select';
    this.targetingSelect.setAttribute('aria-label', 'Targeting mode');
    for (const m of TARGETING_MODES) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      opt.title = m.hint;
      this.targetingSelect.appendChild(opt);
    }
    this.targetingSelect.value = this.targetingApi.currentMode;
    this.targetingSelect.addEventListener('change', () => {
      this.targetingApi.setMode(this.targetingSelect.value);
      this.targetingApi.currentMode = this.targetingSelect.value;
      this.syncTargetingHint();
    });
    controls.appendChild(this.targetingSelect);
    this.syncTargetingHint();

    // Plan §7.1: calling the wave early is a *play*, so it belongs next to the
    // wave controls rather than three tabs away. It is only enabled during an
    // intermission, and its label carries the bonus so the decision is priced
    // on the button rather than in a tooltip nobody opens.
    this.callWaveBtn = document.createElement('button');
    this.callWaveBtn.type = 'button';
    this.callWaveBtn.className = 'hud-ctrl-btn hud-call-wave-btn';
    this.callWaveBtn.textContent = 'Call';
    this.callWaveBtn.setAttribute('aria-label', 'Call the next wave early');
    this.callWaveBtn.addEventListener('click', () => this.onCallWaveEarly());
    controls.appendChild(this.callWaveBtn);

    // §7.4's dial belongs *here*, beside the wave it prices, not filed away in
    // the right-hand group with the speed stepper. Raising risk is a statement
    // about the next wave; the number it changes should be on screen with it.
    controls.appendChild(this.renderRiskBlock());

    this.momentumEl = document.createElement('div');
    this.momentumEl.className = 'hud-momentum';
    side.appendChild(this.momentumEl);

    // `focal`, `side` and `controls` are all direct children of the block so
    // one grid can place them: the desktop arrangement stacks the state and the
    // controls beside the number, and the phone one drops the controls to a
    // full-width row underneath. Nesting the controls inside `side` would put
    // them outside that grid's reach.
    block.appendChild(side);
    block.appendChild(controls);
    return block;
  }

  /**
   * The coming wave's named threats, as icons with counts.
   *
   * Rebuilt only when the composition actually changes — the signature check
   * is what keeps an intermission from re-creating a dozen `<svg>`s ten times a
   * second. Trash is counted, never named, for the same reason the arena
   * overlay does it: "31 enemies" tells the player nothing they can act on,
   * "4 Siege" tells them to change targeting mode.
   */
  private updateThreatRow(): void {
    const preview = this.pacing?.preview ?? null;
    if (!preview) {
      if (this.threatSig !== '') {
        this.threatSig = '';
        this.threatRow.textContent = '';
      }
      toggleClass(this.threatRow, 'is-visible', false);
      return;
    }
    toggleClass(this.threatRow, 'is-visible', true);
    const sig = `${preview.wave}|${preview.count}|`
      + preview.threats.map(t => `${t.type}:${t.count}`).join(',')
      + '|' + preview.elites.map(e => `${e.aura}:${e.count}`).join(',');
    if (sig === this.threatSig) return;
    this.threatSig = sig;

    const parts: string[] = [
      `<span class="hud-threat-chip" title="${preview.count} enemies in the coming wave">`
      + iconMarkup(STAT_ICONS.kills, { tone: 'inherit' })
      + `<span class="u-tabular">${preview.count}</span></span>`,
    ];
    for (const t of preview.threats) {
      const def = ENEMY_DEFS[t.type];
      parts.push(
        `<span class="hud-threat-chip is-named" title="${t.count} × ${ENEMY_LABELS[t.type]}">`
        + iconMarkup(def.icon, { tone: 'inherit' })
        + `<span class="u-tabular">${t.count}</span></span>`,
      );
    }
    for (const e of preview.elites) {
      parts.push(
        `<span class="hud-threat-chip is-elite" title="${e.count} × Elite (${e.aura})">`
        + iconMarkup(STAT_ICONS.talentPoints, { tone: 'inherit' })
        + `<span class="u-tabular">${e.count}</span></span>`,
      );
    }
    setInnerHTML(this.threatRow, parts.join(''));
  }

  /**
   * The risk dial (plan §7.4).
   *
   * A stepper rather than a slider: six discrete levels, each with a stated
   * price, and the tooltip says what the *next* step costs so raising it is
   * never a guess.
   *
   * Part 7 moves it out of the right-hand group, where it sat next to the speed
   * stepper and read as a preference, and puts it in the wave header. Risk is a
   * statement about the *next wave*; the wave number it prices should be on
   * screen beside it.
   */
  private renderRiskBlock(): HTMLElement {
    const block = document.createElement('div');
    block.className = 'hud-risk-block';

    const label = document.createElement('span');
    label.className = 'hud-risk-label';
    label.textContent = 'Risk';
    block.appendChild(label);

    const group = document.createElement('div');
    group.className = 'hud-risk-group';

    this.riskDecBtn = document.createElement('button');
    this.riskDecBtn.type = 'button';
    this.riskDecBtn.className = 'hud-ctrl-btn';
    this.riskDecBtn.textContent = '\u2212';
    this.riskDecBtn.setAttribute('aria-label', 'Lower risk');
    this.riskDecBtn.addEventListener('click', () => {
      this.onRiskChange((this.pacing?.risk ?? 0) - 1);
    });
    group.appendChild(this.riskDecBtn);

    this.riskValueEl = document.createElement('span');
    this.riskValueEl.className = 'hud-risk-value u-tabular';
    this.riskValueEl.textContent = '0';
    group.appendChild(this.riskValueEl);

    this.riskIncBtn = document.createElement('button');
    this.riskIncBtn.type = 'button';
    this.riskIncBtn.className = 'hud-ctrl-btn';
    this.riskIncBtn.textContent = '+';
    this.riskIncBtn.setAttribute('aria-label', 'Raise risk');
    this.riskIncBtn.addEventListener('click', () => {
      this.onRiskChange((this.pacing?.risk ?? 0) + 1);
    });
    group.appendChild(this.riskIncBtn);

    block.appendChild(group);
    this.riskWrap = block;
    return block;
  }

  /** Repaint the §7.1/§7.4 controls from this frame's pacing snapshot. */
  private updatePacingControls(): void {
    const p = this.pacing;
    if (!p || !this.callWaveBtn) return;

    setDisabled(this.callWaveBtn, !p.canCallEarly);
    toggleClass(this.callWaveBtn, 'is-armed', p.canCallEarly);
    setText(
      this.callWaveBtn,
      p.canCallEarly ? `Call +${Math.round(p.callBonus * 100)}%` : 'Call',
    );
    setTitle(this.callWaveBtn, p.canCallEarly
      ? `Space — start wave now. ${p.intermissionRemaining.toFixed(1)}s skipped`
        + ` is +${Math.round(p.callBonus * 100)}% gold, banked into momentum`
        + ` (capped at +${Math.round(p.momentumCap * 100)}%).`
      : `Available during the intermission (${p.intermissionLength}s at this depth).`);

    const hasMomentum = p.momentum > 0;
    toggleClass(this.momentumEl, 'is-visible', hasMomentum);
    setText(
      this.momentumEl,
      hasMomentum ? `Momentum +${Math.round(p.momentum * 100)}% gold x${p.momentumStreak}` : '',
    );
    setTitle(this.momentumEl, hasMomentum
      ? 'Held while you keep calling waves early. Resets when the tower takes damage.'
      : '');

    this.updateThreatRow();

    setText(this.riskValueEl, p.riskPending ? `${p.activeRisk}\u2192${p.risk}` : String(p.risk));
    setDisabled(this.riskDecBtn, p.risk <= 0);
    setDisabled(this.riskIncBtn, p.risk >= p.maxRisk);
    toggleClass(this.riskWrap, 'is-hot', p.activeRisk > 0);
    setTitle(this.riskWrap, p.risk === 0
      ? 'Risk 0 — the standard curve. Raise it for more gold and AP at the cost of tougher waves.'
      : `Risk ${p.risk}: +${p.risk * 18}% enemy HP, +${p.risk * 8}% enemy speed`
        + ` for +${p.risk * 25}% gold and +${p.risk * 10}% AP.`
        + (p.riskPending ? ` Takes effect next wave (running ${p.activeRisk}).` : ''));
  }

  /** Keep the dropdown's tooltip in step with what is selected. */
  private syncTargetingHint(): void {
    if (!this.targetingSelect) return;
    const mode = TARGETING_MODES.find(m => m.id === this.targetingSelect.value);
    setTitle(this.targetingSelect, mode ? `Targeting: ${mode.hint}` : 'Targeting mode');
  }

  private renderSpeedBlock(): HTMLElement {
    const block = document.createElement('div');
    block.className = 'hud-speed-block';

    const speedLabel = document.createElement('span');
    speedLabel.className = 'hud-stat-label';
    speedLabel.textContent = 'Speed';
    block.appendChild(speedLabel);

    const group = document.createElement('div');
    group.className = 'hud-speed-group';

    this.speedDecBtn = document.createElement('button');
    this.speedDecBtn.type = 'button';
    this.speedDecBtn.className = 'hud-ctrl-btn';
    this.speedDecBtn.textContent = '\u2212';
    this.speedDecBtn.setAttribute('aria-label', 'Slow down');
    this.speedDecBtn.addEventListener('click', () => {
      const cur = this.speedApi.currentIndex;
      if (cur > 0) this.onSpeedChange(cur - 1);
    });
    group.appendChild(this.speedDecBtn);

    this.speedLabelEl = document.createElement('span');
    this.speedLabelEl.className = 'hud-speed-value';
    this.speedLabelEl.textContent = '1x';
    group.appendChild(this.speedLabelEl);

    this.speedIncBtn = document.createElement('button');
    this.speedIncBtn.type = 'button';
    this.speedIncBtn.className = 'hud-ctrl-btn';
    this.speedIncBtn.textContent = '+';
    this.speedIncBtn.setAttribute('aria-label', 'Speed up');
    this.speedIncBtn.addEventListener('click', () => {
      const cur = this.speedApi.currentIndex;
      const max = this.speedApi.maxIndex;
      if (cur < max) this.onSpeedChange(cur + 1);
    });
    group.appendChild(this.speedIncBtn);

    block.appendChild(group);
    return block;
  }

  /**
   * Mobile "More" popup — mirrors the HUD elements that get hidden on small
   * screens (DPS, FPS, speed, stats & enemies buttons). Stays open when the
   * user clicks speed controls, so they can adjust and observe the effect.
   */
  private installMorePopup(): void {
    const popover = document.createElement('div');
    popover.className = 'hud-more-popover';
    const inner = document.createElement('div');
    inner.className = 'hud-more-popover-inner';

    const header = document.createElement('div');
    header.className = 'hud-more-popover-header';
    const title = document.createElement('h4');
    title.className = 'hud-more-popover-title';
    title.textContent = 'More Controls';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'hud-more-popover-close';
    closeBtn.textContent = '\u00d7';
    closeBtn.setAttribute('aria-label', 'Close');
    const close = () => {
      toggleClass(popover, 'is-open', false);
      toggleClass(this.moreBtn, 'is-active', false);
    };
    closeBtn.addEventListener('click', close);
    header.appendChild(title);
    header.appendChild(closeBtn);
    inner.appendChild(header);

    // DPS row.
    const dpsRow = document.createElement('div');
    dpsRow.className = 'hud-more-popover-row';
    const dpsLabel = document.createElement('span');
    dpsLabel.className = 'hud-more-popover-label';
    dpsLabel.textContent = 'DPS';
    this.moreDpsEl = document.createElement('span');
    this.moreDpsEl.className = 'hud-more-popover-value';
    this.moreDpsEl.textContent = '0';
    dpsRow.appendChild(dpsLabel);
    dpsRow.appendChild(this.moreDpsEl);
    inner.appendChild(dpsRow);


    // Speed row — controls stay open on click.
    const speedBlock = document.createElement('div');
    speedBlock.className = 'hud-speed-block';
    const speedLabel = document.createElement('span');
    speedLabel.className = 'hud-stat-label';
    speedLabel.textContent = 'Speed';
    speedBlock.appendChild(speedLabel);
    const speedGroup = document.createElement('div');
    speedGroup.className = 'hud-speed-group';
    this.moreSpeedDecBtn = document.createElement('button');
    this.moreSpeedDecBtn.type = 'button';
    this.moreSpeedDecBtn.className = 'hud-ctrl-btn';
    this.moreSpeedDecBtn.textContent = '\u2212';
    this.moreSpeedDecBtn.setAttribute('aria-label', 'Slow down');
    this.moreSpeedDecBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const cur = this.speedApi.currentIndex;
      if (cur > 0) this.onSpeedChange(cur - 1);
    });
    speedGroup.appendChild(this.moreSpeedDecBtn);
    this.moreSpeedLabelEl = document.createElement('span');
    this.moreSpeedLabelEl.className = 'hud-speed-value';
    this.moreSpeedLabelEl.textContent = '1x';
    speedGroup.appendChild(this.moreSpeedLabelEl);
    this.moreSpeedIncBtn = document.createElement('button');
    this.moreSpeedIncBtn.type = 'button';
    this.moreSpeedIncBtn.className = 'hud-ctrl-btn';
    this.moreSpeedIncBtn.textContent = '+';
    this.moreSpeedIncBtn.setAttribute('aria-label', 'Speed up');
    this.moreSpeedIncBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const cur = this.speedApi.currentIndex;
      const max = this.speedApi.maxIndex;
      if (cur < max) this.onSpeedChange(cur + 1);
    });
    speedGroup.appendChild(this.moreSpeedIncBtn);
    speedBlock.appendChild(speedGroup);
    const speedRow = document.createElement('div');
    speedRow.className = 'hud-more-popover-row';
    const speedRowLabel = document.createElement('span');
    speedRowLabel.className = 'hud-more-popover-label';
    speedRowLabel.textContent = 'Speed';
    speedRow.appendChild(speedRowLabel);
    speedRow.appendChild(speedBlock);
    inner.appendChild(speedRow);

    // Stats / Enemies action buttons.
    const actions = document.createElement('div');
    actions.className = 'hud-more-popover-actions';
    this.moreStatsBtn = document.createElement('button');
    this.moreStatsBtn.type = 'button';
    this.moreStatsBtn.className = 'hud-stats-btn';
    this.moreStatsBtn.textContent = 'Stats';
    this.moreStatsBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (hasClass(this.statsPopup, 'is-open')) this.closeStatsPopup();
      else this.openStatsPopup();
    });
    actions.appendChild(this.moreStatsBtn);
    this.moreEnemyStatsBtn = document.createElement('button');
    this.moreEnemyStatsBtn.type = 'button';
    this.moreEnemyStatsBtn.className = 'hud-stats-btn';
    this.moreEnemyStatsBtn.textContent = 'Enemies';
    this.moreEnemyStatsBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (hasClass(this.enemyStatsPopup, 'is-open')) this.closeEnemyStatsPopup();
      else this.openEnemyStatsPopup();
    });
    actions.appendChild(this.moreEnemyStatsBtn);
    inner.appendChild(actions);

    popover.appendChild(inner);
    popover.addEventListener('click', (e) => {
      if (e.target === popover) close();
    });
    document.body.appendChild(popover);

    this.moreBtn.addEventListener('click', () => {
      const opening = !hasClass(popover, 'is-open');
      toggleClass(popover, 'is-open', opening);
      toggleClass(this.moreBtn, 'is-active', opening);
    });
  }

  /**
   * One HUD bar: head row (icon · label · value) over the track.
   *
   * All three bars share this because all three were three near-identical
   * blocks of DOM code with three near-identical CSS blocks behind them, and
   * every improvement in §7 — gradient, ghost, segments, pulse — would
   * otherwise have had to be written out three times and kept in step by hand.
   */
  private makeBar(
    key: 'hp' | 'mana' | 'xp',
    label: string,
    iconKey: StatIconKey,
    tone: string,
  ): BarRefs {
    const block = document.createElement('div');
    block.className = `hud-bar-block hud-${key}`;
    block.dataset.tone = tone;

    const head = document.createElement('div');
    head.className = 'hud-bar-head';
    head.appendChild(icon(STAT_ICONS[iconKey], { tone: 'inherit', className: 'hud-bar-icon' }));
    const labelEl = document.createElement('span');
    labelEl.className = 'hud-bar-label';
    labelEl.textContent = label;
    head.appendChild(labelEl);
    const valueEl = document.createElement('span');
    valueEl.className = 'hud-bar-value u-tabular';
    head.appendChild(valueEl);
    block.appendChild(head);

    const track = document.createElement('div');
    track.className = 'hud-bar-track';
    // Ghost first so the live fill paints over it: what is left is bright, what
    // was just lost is the dim tail sticking out past it.
    const ghost = document.createElement('div');
    ghost.className = 'hud-bar-ghost';
    track.appendChild(ghost);
    const fill = document.createElement('div');
    fill.className = 'hud-bar-fill';
    track.appendChild(fill);
    block.appendChild(track);

    return {
      block,
      fill,
      ghost,
      valueEl,
      ratio: 1,
      ratioPrev: 1,
      ghostRatio: 1,
      ghostHold: 0,
      quarter: 4,
      pulsePhase: false,
      suppressGhostOnDrop: key === 'xp',
      seeded: false,
    };
  }

  /**
   * Advance one bar on wall-clock `dt`: write the fill, run the ghost, and fire
   * the pulse if the fill just crossed a quarter.
   *
   * Deliberately per-frame rather than on the throttled `update()`. The fill is
   * already smoothed by `tickDisplay`'s tween, so a CSS width transition on top
   * of it was double-smoothing — the HP bar lagged a hit by a visible beat —
   * and a ghost stepping at 10 fps is not a trail, it is a stutter. The `dom`
   * helpers cache the last value, so a bar that is not moving writes nothing.
   */
  private tickBar(refs: BarRefs, rawRatio: number, dt: number): void {
    const ratio = Math.max(0, Math.min(1, rawRatio));
    if (!refs.seeded) {
      refs.seeded = true;
      refs.ratio = ratio;
      refs.ratioPrev = ratio;
      refs.ghostRatio = ratio;
      refs.quarter = ratio >= 1 ? 4 : Math.floor(ratio * 4);
    }
    const dropped = ratio < refs.ratioPrev - 1e-6;
    refs.ratioPrev = refs.ratio;
    refs.ratio = ratio;
    setStyle(refs.fill, 'width', `${(ratio * 100).toFixed(2)}%`);

    if (refs.suppressGhostOnDrop && dropped) {
      // A tower level-up wraps XP back to zero. Trailing a ghost across the
      // whole bar would read as a loss, which is the opposite of what happened.
      refs.ghostRatio = ratio;
    } else if (ratio >= refs.ghostRatio) {
      refs.ghostRatio = ratio;
      refs.ghostHold = 0;
    } else if (dropped) {
      refs.ghostHold = BAR_GHOST_HOLD;
    } else if (refs.ghostHold > 0) {
      refs.ghostHold = Math.max(0, refs.ghostHold - dt);
    } else {
      refs.ghostRatio += (ratio - refs.ghostRatio) * (1 - Math.exp(-dt / BAR_GHOST_TAU));
      if (refs.ghostRatio - ratio < 0.002) refs.ghostRatio = ratio;
    }
    const showGhost = refs.ghostRatio - ratio > 0.004;
    toggleClass(refs.ghost, 'is-visible', showGhost);
    if (showGhost) setStyle(refs.ghost, 'width', `${(refs.ghostRatio * 100).toFixed(2)}%`);

    // The pulse marks a *crossing*, not a value: a bar sitting at 49% has
    // nothing to announce, but the frame it fell through 50% does.
    const quarter = ratio >= 1 ? 4 : Math.floor(ratio * 4);
    if (quarter !== refs.quarter) {
      const falling = quarter < refs.quarter;
      refs.quarter = quarter;
      refs.pulsePhase = !refs.pulsePhase;
      toggleClass(refs.block, 'is-pulse-a', refs.pulsePhase);
      toggleClass(refs.block, 'is-pulse-b', !refs.pulsePhase);
      toggleClass(refs.block, 'is-pulse-down', falling);
    }
  }

  /**
   * A resource chip: icon, label, value. Replaces the old bare label+span pair.
   *
   * `iconKey` is a `StatIconKey`, not a free-form `IconId`, so a chip cannot
   * invent a mark for a concept that already has one — the same reuse rule
   * `docs/icon-system.md` states for every other surface.
   */
  private addPill(
    parent: HTMLElement,
    label: string,
    initialValue: string,
    iconKey: StatIconKey,
    tone: string,
  ): PillRefs {
    const wrap = document.createElement('div');
    wrap.className = 'hud-pill';
    wrap.dataset.tone = tone;
    // The phone layout drops the written caption and keeps the icon, so the
    // name has to live somewhere a screen reader can still reach it.
    wrap.setAttribute('aria-label', label);
    wrap.title = label;

    const iconEl = icon(STAT_ICONS[iconKey], { tone: 'inherit', className: 'hud-pill-icon' });
    wrap.appendChild(iconEl);

    const text = document.createElement('div');
    text.className = 'hud-pill-text';
    const labelEl = document.createElement('span');
    labelEl.className = 'hud-pill-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'hud-pill-value u-display u-tabular';
    valueEl.textContent = initialValue;
    text.appendChild(labelEl);
    text.appendChild(valueEl);
    wrap.appendChild(text);

    parent.appendChild(wrap);
    const refs: PillRefs = { wrap, valueEl, last: Number.NaN, tickPhase: false };
    this.pills.push(refs);
    return refs;
  }

  /**
   * Write a chip's value and, if the underlying resource went *up*, play the
   * tick (and a flare if the jump was large relative to the total).
   *
   * `authoritative` is the real state number rather than the tweened display
   * one: the tween lags by a few frames, so detecting the gain on it would fire
   * the tick repeatedly as the number eased towards its target.
   */
  private setPillValue(refs: PillRefs, text: string, authoritative: number): void {
    setText(refs.valueEl, text);
    const prev = refs.last;
    refs.last = authoritative;
    if (!Number.isFinite(prev) || authoritative <= prev) return;
    const gain = authoritative - prev;
    const big = prev > 0 && gain / prev >= PILL_FLARE_FRACTION;
    refs.tickPhase = !refs.tickPhase;
    toggleClass(refs.wrap, 'is-tick-a', refs.tickPhase);
    toggleClass(refs.wrap, 'is-tick-b', !refs.tickPhase);
    toggleClass(refs.wrap, 'is-flare-a', big && refs.tickPhase);
    toggleClass(refs.wrap, 'is-flare-b', big && !refs.tickPhase);
  }
}
