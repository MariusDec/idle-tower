import type { GameState, StatsInfo, EnemyWaveStatsEntry } from '../types';
import { formatNumber } from '../utils/bigNumber';
import type { SpeedAPI, WaveControlAPI } from './UIManager';

const MANA_UNLOCK_WAVE = 10;

function formatSpeed(v: number): string {
  if (Number.isInteger(v)) return `${v}x`;
  return `${v.toFixed(1).replace(/\.0$/, '')}x`;
}

export class HUD {
  private readonly root: HTMLElement;
  private goldEl!: HTMLElement;
  private manaEl!: HTMLElement;
  private manaBarFill!: HTMLElement;
  private manaWrap!: HTMLElement;
  private waveEl!: HTMLElement;
  private dpsEl!: HTMLElement;
  private killsEl!: HTMLElement;
  private fpsEl!: HTMLElement;
  private hpEl!: HTMLElement;
  private hpWrap!: HTMLElement;
  private hpBarFill!: HTMLElement;
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
  private tweenInitialized = false;
  private dps = 0;
  private speedApi: SpeedAPI = { speeds: [], currentIndex: 0, maxIndex: 0 };
  private waveApi: WaveControlAPI = { autoProgress: true, currentWave: 1, isIntermission: false };
  private onSpeedChange: (index: number) => void = () => {};
  private onPrevWave: () => void = () => {};
  private onNextWave: () => void = () => {};
  private onToggleAutoProgress: () => void = () => {};
  private speedLabelEl!: HTMLElement;
  private speedDecBtn!: HTMLButtonElement;
  private speedIncBtn!: HTMLButtonElement;
  private prevWaveBtn!: HTMLButtonElement;
  private nextWaveBtn!: HTMLButtonElement;
  private autoProgressBtn!: HTMLButtonElement;
  private waveStatusEl!: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.render();
  }

  setDPS(value: number): void {
    this.dps = value;
  }

  getFpsEl(): HTMLElement {
    return this.fpsEl;
  }

  setSpeedAPI(api: SpeedAPI): void {
    this.speedApi = api;
  }

  setWaveControlAPI(api: WaveControlAPI): void {
    this.waveApi = api;
  }

  setOnSpeedChange(handler: (index: number) => void): void {
    this.onSpeedChange = handler;
  }

  setOnPrevWave(handler: () => void): void {
    this.onPrevWave = handler;
  }

  setOnNextWave(handler: () => void): void {
    this.onNextWave = handler;
  }

  setOnToggleAutoProgress(handler: () => void): void {
    this.onToggleAutoProgress = handler;
  }

  setStatsInfo(info: StatsInfo): void {
    this.statsInfo = info;
    if (this.statsTooltip.style.display !== 'none') {
      this.renderStatsContent(this.statsTooltip, info);
    }
    if (this.statsPopup.classList.contains('is-open')) {
      this.renderStatsContent(this.statsPopupBody, info);
    }
  }

  private renderStatsContent(el: HTMLElement, info: StatsInfo): void {
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    el.innerHTML = `
      <div class="stat-row"><span>Damage</span><span>${formatNumber(info.damage)}</span></div>
      <div class="stat-row"><span>Fire Rate</span><span>${info.fireRate.toFixed(2)}/s</span></div>
      <div class="stat-row"><span>DPS</span><span>${formatNumber(info.dps)}</span></div>
      <div class="stat-row"><span>Crit Rate</span><span>${pct(info.critChance)}</span></div>
      <div class="stat-row"><span>Crit Damage</span><span>${(info.critDamage * 100).toFixed(0)}%</span></div>
      <div class="stat-row"><span>Range</span><span>${info.range.toFixed(0)}</span></div>
      <div class="stat-row"><span>Health</span><span>${Math.floor(info.hp)} / ${Math.floor(info.maxHp)}</span></div>
      <div class="stat-row"><span>Health Regen</span><span>${(info.maxHp * info.healthRegen).toFixed(2)}/s</span></div>
      <div class="stat-row"><span>Defense</span><span>${info.defense.toFixed(0)}</span></div>
      <div class="stat-row"><span>Armor</span><span>${info.armor.toFixed(0)}</span></div>
      <div class="stat-row"><span>Lifesteal</span><span>${pct(info.lifesteal)}</span></div>
      <div class="stat-row"><span>Thorns</span><span>${pct(info.thorns)}</span></div>
      <div class="stat-row"><span>Mana Regen</span><span>${info.manaRegen.toFixed(1)}/s</span></div>
      <div class="stat-row"><span>Max Mana</span><span>${info.maxMana}</span></div>
      <div class="stat-row"><span>Gold Multiplier</span><span>${info.goldMultiplier.toFixed(2)}x</span></div>
    `;
  }

  private openStatsPopup(): void {
    if (!this.statsInfo) return;
    this.renderStatsContent(this.statsPopupBody, this.statsInfo);
    this.statsPopup.classList.add('is-open');
    this.statsBtn.classList.add('is-active');
  }

  private closeStatsPopup(): void {
    this.statsPopup.classList.remove('is-open');
    this.statsBtn.classList.remove('is-active');
  }

  setEnemyStatsInfo(entries: EnemyWaveStatsEntry[]): void {
    this.enemyStatsInfo = entries;
    if (this.enemyStatsTooltip.style.display !== 'none') {
      this.renderEnemyStatsContent(this.enemyStatsTooltip, entries);
    }
    if (this.enemyStatsPopup.classList.contains('is-open')) {
      this.renderEnemyStatsContent(this.enemyStatsPopupBody, entries);
    }
  }

  private renderEnemyStatsContent(el: HTMLElement, entries: EnemyWaveStatsEntry[]): void {
    if (entries.length === 0) {
      el.innerHTML = '<div class="stat-row"><span>No enemies this wave</span><span></span></div>';
      return;
    }
    const cols = entries.map(e => {
      const label = e.type.charAt(0).toUpperCase() + e.type.slice(1);
      return `<div class="enemy-stats-col">
        <div class="enemy-stats-type-header">${label}</div>
        <div class="stat-row"><span>HP</span><span>${formatNumber(e.hp)}</span></div>
        <div class="stat-row"><span>Speed</span><span>${e.speed.toFixed(0)}</span></div>
        <div class="stat-row"><span>Armor</span><span>${e.armor.toFixed(0)}</span></div>
        <div class="stat-row"><span>Magic Resist</span><span>${(e.magicResist * 100).toFixed(0)}%</span></div>
        <div class="stat-row"><span>Damage</span><span>${formatNumber(e.damage)}</span></div>
        <div class="stat-row"><span>Fire Rate</span><span>${e.fireRate.toFixed(2)}/s</span></div>
        <div class="stat-row"><span>Gold</span><span>${formatNumber(e.gold)}</span></div>
      </div>`;
    }).join('');
    const wide = entries.length > 3 ? ' enemy-stats-grid-wide' : '';
    el.innerHTML = `<div class="enemy-stats-grid${wide}">${cols}</div>`;
  }

  private openEnemyStatsPopup(): void {
    if (this.enemyStatsInfo.length === 0) return;
    this.renderEnemyStatsContent(this.enemyStatsPopupBody, this.enemyStatsInfo);
    this.enemyStatsPopup.classList.add('is-open');
    this.enemyStatsBtn.classList.add('is-active');
  }

  private closeEnemyStatsPopup(): void {
    this.enemyStatsPopup.classList.remove('is-open');
    this.enemyStatsBtn.classList.remove('is-active');
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
  }

  update(state: GameState): void {
    const manaUnlocked = state.wave.highestWave >= MANA_UNLOCK_WAVE;
    this.manaWrap.classList.toggle('is-locked', !manaUnlocked);
    this.goldEl.textContent = formatNumber(this.displayGold);
    if (manaUnlocked) {
      const manaDisplay = Math.floor(this.displayMana);
      this.manaEl.textContent = `${manaDisplay} / ${state.resources.maxMana}`;
      const ratio = state.resources.maxMana > 0
        ? this.displayMana / state.resources.maxMana
        : 0;
      this.manaBarFill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    } else {
      this.manaEl.textContent = `Locked · wave ${MANA_UNLOCK_WAVE}`;
      this.manaBarFill.style.width = '0%';
    }
    this.waveEl.textContent = `Wave ${Math.round(this.displayWave)}`;
    this.dpsEl.textContent = `${formatNumber(this.dps)} DPS`;
    this.killsEl.textContent = `Kills: ${formatNumber(state.stats.enemiesKilled)}`;
    const hpDisplay = Math.max(0, this.displayHP);
    const maxHpDisplay = Math.max(1, this.displayMaxHP);
    this.hpEl.textContent = `${formatNumber(hpDisplay)} / ${formatNumber(maxHpDisplay)}`;
    const hpRatio = maxHpDisplay > 0 ? hpDisplay / maxHpDisplay : 0;
    this.hpBarFill.style.width = `${Math.min(100, Math.max(0, hpRatio * 100))}%`;
    this.hpWrap.classList.toggle('is-critical', hpRatio > 0 && hpRatio <= 0.4);
    this.hpWrap.classList.toggle('is-dead', hpRatio <= 0);
    this.syncControls(state);
  }

  private syncControls(state: GameState): void {
    const speeds = this.speedApi.speeds;
    const cur = Math.max(0, Math.min(speeds.length - 1, this.speedApi.currentIndex));
    const max = Math.max(0, Math.min(speeds.length - 1, this.speedApi.maxIndex));
    const currentSpeed = speeds[cur] ?? 1;
    this.speedLabelEl.textContent = formatSpeed(currentSpeed);
    this.speedDecBtn.disabled = cur <= 0;
    this.speedIncBtn.disabled = cur >= max;
    this.speedDecBtn.title = cur > 0 ? `Slow to ${formatSpeed(speeds[cur - 1])}` : 'Already slowest';
    this.speedIncBtn.title = cur < max ? `Speed up to ${formatSpeed(speeds[cur + 1])}` : 'Max speed reached';

    const wave = state.wave.number;
    this.prevWaveBtn.disabled = wave <= 1;
    this.prevWaveBtn.title = wave > 1 ? `Restart wave ${wave - 1}` : 'Already at wave 1';
    this.nextWaveBtn.title = `Skip to wave ${wave + 1}`;
    this.nextWaveBtn.disabled = wave >= state.wave.highestWave;
    this.autoProgressBtn.classList.toggle('is-on', this.waveApi.autoProgress);
    this.autoProgressBtn.classList.toggle('is-off', !this.waveApi.autoProgress);
    this.autoProgressBtn.textContent = this.waveApi.autoProgress ? 'Auto' : 'Paused';
    this.autoProgressBtn.title = this.waveApi.autoProgress
      ? 'Auto-Progress is ON. Click to auto-restart current wave.'
      : 'Auto-Progress is OFF. Click to resume auto-advancing waves.';

    if (this.waveApi.isIntermission && !this.waveApi.autoProgress) {
      this.waveStatusEl.textContent = '';
      this.waveStatusEl.classList.add('is-warning');
    } else if (this.waveApi.isIntermission) {
      this.waveStatusEl.textContent = 'Intermission';
      this.waveStatusEl.classList.remove('is-warning');
    } else {
      this.waveStatusEl.textContent = '';
      this.waveStatusEl.classList.remove('is-warning');
    }
  }

  private render(): void {
    this.root.innerHTML = '';
    this.root.className = 'hud';

    const groupLeft = document.createElement('div');
    groupLeft.className = 'hud-group';
    this.goldEl = this.addStat(groupLeft, 'Gold', '0');
    this.killsEl = this.addStat(groupLeft, 'Kills', '0');
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
        this.statsTooltip.style.display = 'block';
      }
    });
    this.statsBtn.addEventListener('mouseleave', () => {
      this.statsTooltip.style.display = 'none';
    });
    this.statsBtn.addEventListener('click', () => {
      if (this.statsPopup.classList.contains('is-open')) {
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
        this.enemyStatsTooltip.style.display = 'block';
      }
    });
    this.enemyStatsBtn.addEventListener('mouseleave', () => {
      this.enemyStatsTooltip.style.display = 'none';
    });
    this.enemyStatsBtn.addEventListener('click', () => {
      if (this.enemyStatsPopup.classList.contains('is-open')) {
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

    const hpWrap = document.createElement('div');
    hpWrap.className = 'hud-hp';
    this.hpWrap = hpWrap;
    const hpRow = document.createElement('div');
    hpRow.className = 'hud-hp-row';
    const hpLabel = document.createElement('span');
    hpLabel.className = 'hud-hp-label';
    hpLabel.textContent = 'Tower HP';
    this.hpEl = document.createElement('span');
    this.hpEl.className = 'hud-hp-value';
    this.hpEl.textContent = '5 / 5';
    hpRow.appendChild(hpLabel);
    hpRow.appendChild(this.hpEl);
    hpWrap.appendChild(hpRow);
    const hpBar = document.createElement('div');
    hpBar.className = 'hp-bar';
    this.hpBarFill = document.createElement('div');
    this.hpBarFill.className = 'hp-bar-fill';
    hpBar.appendChild(this.hpBarFill);
    hpWrap.appendChild(hpBar);
    this.root.appendChild(hpWrap);

    const manaWrap = document.createElement('div');
    manaWrap.className = 'hud-mana';
    this.manaWrap = manaWrap;
    const manaRow = document.createElement('div');
    manaRow.className = 'hud-mana-row';
    const manaLabel = document.createElement('span');
    manaLabel.className = 'hud-mana-label';
    manaLabel.textContent = 'Mana';
    this.manaEl = document.createElement('span');
    this.manaEl.className = 'hud-mana-value';
    this.manaEl.textContent = '0 / 100';
    manaRow.appendChild(manaLabel);
    manaRow.appendChild(this.manaEl);
    manaWrap.appendChild(manaRow);
    const manaBar = document.createElement('div');
    manaBar.className = 'mana-bar';
    this.manaBarFill = document.createElement('div');
    this.manaBarFill.className = 'mana-bar-fill';
    manaBar.appendChild(this.manaBarFill);
    manaWrap.appendChild(manaBar);
    this.root.appendChild(manaWrap);

    const groupRight = document.createElement('div');
    groupRight.className = 'hud-group right';
    this.dpsEl = this.addStat(groupRight, 'DPS', '0');
    this.fpsEl = this.addStat(groupRight, 'FPS', '--');
    this.fpsEl.classList.add('hud-fps');
    groupRight.appendChild(this.renderSpeedBlock());
    this.root.appendChild(groupRight);
  }

  private renderWaveBlock(): HTMLElement {
    const block = document.createElement('div');
    block.className = 'hud-wave-block';

    const waveStat = document.createElement('div');
    waveStat.className = 'hud-wave-stat';
    const waveLabel = document.createElement('span');
    waveLabel.className = 'hud-stat-label';
    waveLabel.textContent = 'Wave';
    this.waveEl = document.createElement('span');
    this.waveEl.className = 'hud-stat-value';
    this.waveEl.textContent = 'Wave 1';
    waveStat.appendChild(waveLabel);
    waveStat.appendChild(this.waveEl);
    block.appendChild(waveStat);

    const controls = document.createElement('div');
    controls.className = 'hud-wave-controls';

    this.prevWaveBtn = document.createElement('button');
    this.prevWaveBtn.type = 'button';
    this.prevWaveBtn.className = 'hud-ctrl-btn';
    this.prevWaveBtn.textContent = '\u00ab';
    this.prevWaveBtn.setAttribute('aria-label', 'Previous wave');
    this.prevWaveBtn.addEventListener('click', () => this.onPrevWave());
    controls.appendChild(this.prevWaveBtn);

    this.autoProgressBtn = document.createElement('button');
    this.autoProgressBtn.type = 'button';
    this.autoProgressBtn.className = 'hud-ctrl-btn hud-ctrl-toggle is-on';
    this.autoProgressBtn.textContent = 'Auto';
    this.autoProgressBtn.setAttribute('aria-label', 'Toggle auto-progress');
    this.autoProgressBtn.addEventListener('click', () => this.onToggleAutoProgress());
    controls.appendChild(this.autoProgressBtn);

    this.nextWaveBtn = document.createElement('button');
    this.nextWaveBtn.type = 'button';
    this.nextWaveBtn.className = 'hud-ctrl-btn';
    this.nextWaveBtn.textContent = '\u00bb';
    this.nextWaveBtn.setAttribute('aria-label', 'Next wave');
    this.nextWaveBtn.addEventListener('click', () => this.onNextWave());
    controls.appendChild(this.nextWaveBtn);

    block.appendChild(controls);

    this.waveStatusEl = document.createElement('div');
    this.waveStatusEl.className = 'hud-wave-status';
    block.appendChild(this.waveStatusEl);

    return block;
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

  private addStat(parent: HTMLElement, label: string, initialValue: string): HTMLElement {
    const stat = document.createElement('div');
    stat.className = 'hud-stat';
    const labelEl = document.createElement('span');
    labelEl.className = 'hud-stat-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'hud-stat-value';
    valueEl.textContent = initialValue;
    stat.appendChild(labelEl);
    stat.appendChild(valueEl);
    parent.appendChild(stat);
    return valueEl;
  }
}
