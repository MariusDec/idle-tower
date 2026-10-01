import type { RunState } from '../sim/state';
import { BOSS_BY_ID } from '../content/bosses';
import { frameById } from '../content/frames';
import { regionByIndex } from '../content/regions';
import { BOSS_WAVE } from '../sim/systems/waves';
import { formatNumber } from '../core/format';
import { setAriaLabel, setStyle, setText, toggleClass } from './dom';
import { iconMarkup } from './icon';

/**
 * The battle HUD (§10.1): HP, wave, region and the run's shards on top, and
 * the boss bar while a boss stands; the XP bar, the level, the speed toggle
 * and the Autocaster switch (each once owned) and the ultimate at the
 * bottom, under the thumb. Nothing else.
 */
export interface HudActions {
  pause(): void;
  ult(): void;
  speed(): void;
  autoUlt(): void;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly level: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly ult: HTMLButtonElement;
  private readonly ultLabel: HTMLElement;
  private readonly region: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly speed: HTMLButtonElement;
  private readonly auto: HTMLButtonElement;
  private readonly waveLabel: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossPips: HTMLElement;

  constructor(host: HTMLElement, actions: HudActions) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-row">
          <div class="hud-wave"><span class="hud-label hud-wave-label">Wave</span> <span class="hud-wave-n">1</span></div>
          <button type="button" class="hud-pause" aria-label="Pause">❚❚</button>
        </div>
        <div class="hud-hp" role="meter" aria-label="Tower health">
          <div class="hud-hp-fill"></div>
          <span class="hud-hp-text"></span>
        </div>
        <div class="hud-row hud-meta">
          <span class="hud-region"></span>
          <span class="hud-shards" aria-label="Shards this run">${iconMarkup('crystal-cluster')}<span class="hud-shards-n">0</span></span>
        </div>
        <div class="hud-boss" hidden>
          <div class="hud-row"><span class="hud-boss-name"></span><span class="hud-boss-pips"></span></div>
          <div class="hud-boss-bar" role="meter" aria-label="Boss health"><div class="hud-boss-fill"></div></div>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="hud-row hud-row-bottom">
          <div class="hud-level"><span class="hud-label">Lv</span> <span class="hud-level-n">1</span></div>
          <div class="hud-toggles">
            <button type="button" class="hud-speed" hidden>1×</button>
            <button type="button" class="hud-auto" hidden>Auto</button>
          </div>
          <button type="button" class="hud-ult"><span class="hud-ult-label"></span></button>
        </div>
        <div class="hud-xp" role="meter" aria-label="Experience"><div class="hud-xp-fill"></div></div>
      </div>`;
    this.wave = this.root.querySelector('.hud-wave-n')!;
    this.hpFill = this.root.querySelector('.hud-hp-fill')!;
    this.hpText = this.root.querySelector('.hud-hp-text')!;
    this.level = this.root.querySelector('.hud-level-n')!;
    this.xpFill = this.root.querySelector('.hud-xp-fill')!;
    this.ult = this.root.querySelector('.hud-ult')!;
    this.ultLabel = this.root.querySelector('.hud-ult-label')!;
    this.region = this.root.querySelector('.hud-region')!;
    this.shards = this.root.querySelector('.hud-shards-n')!;
    this.speed = this.root.querySelector('.hud-speed')!;
    this.auto = this.root.querySelector('.hud-auto')!;
    this.waveLabel = this.root.querySelector('.hud-wave-label')!;
    this.boss = this.root.querySelector('.hud-boss')!;
    this.bossName = this.root.querySelector('.hud-boss-name')!;
    this.bossFill = this.root.querySelector('.hud-boss-fill')!;
    this.bossPips = this.root.querySelector('.hud-boss-pips')!;
    this.speed.addEventListener('click', () => actions.speed());
    this.auto.addEventListener('click', () => actions.autoUlt());
    this.root.querySelector('.hud-pause')!.addEventListener('click', () => actions.pause());
    this.ult.addEventListener('click', () => actions.ult());
    host.appendChild(this.root);
    this.hide();
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** The speed toggle (§6.2): hidden until Overdrive is owned. */
  setSpeed(max: number, current: number): void {
    this.speed.hidden = max <= 1;
    setText(this.speed, `${current}×`);
    setAriaLabel(this.speed, `Game speed ${current}×`);
    toggleClass(this.speed, 'is-fast', current > 1);
  }

  /** The Autocaster switch (§6.2): hidden until it is owned, lit while it is on. */
  setAutoUlt(owned: boolean, on: boolean): void {
    this.auto.hidden = !owned;
    this.auto.setAttribute('aria-pressed', String(on));
    setAriaLabel(this.auto, on ? 'Autocaster on' : 'Autocaster off');
    toggleClass(this.auto, 'is-on', on);
  }

  update(run: RunState): void {
    // "7/20" in the region; past the boss, overtime counts on (§4.2).
    const overtime = run.wave > BOSS_WAVE;
    setText(this.waveLabel, overtime ? 'Overtime' : 'Wave');
    setText(this.wave, overtime ? `+${run.wave - BOSS_WAVE}` : `${Math.max(1, run.wave)}/${BOSS_WAVE}`);
    const region = regionByIndex(run.regionId);
    setText(this.region, region.rule ? `${region.name} · ${region.rule.name}` : region.name);
    this.updateBoss(run);
    setText(this.shards, formatNumber(Math.floor(run.shards)));
    const hp = Math.max(0, run.tower.hp);
    const max = run.stats.maxHp;
    const frac = max > 0 ? hp / max : 0;
    setStyle(this.hpFill, 'transform', `scaleX(${frac.toFixed(3)})`);
    setText(this.hpText, `${formatNumber(Math.ceil(hp))} / ${formatNumber(Math.round(max))}`);

    setText(this.level, String(run.level));
    setStyle(this.xpFill, 'transform', `scaleX(${Math.min(1, run.xp / run.xpNext).toFixed(3)})`);

    const name = frameById(run.frameId).ultimate.name;
    const ready = run.ult.charge >= 1;
    setText(this.ultLabel, ready ? name : `${Math.floor(run.ult.charge * 100)}%`);
    setStyle(this.ult, '--charge', run.ult.charge.toFixed(3));
    toggleClass(this.ult, 'is-ready', ready);
    setAriaLabel(this.ult, ready ? `${name}: ready` : `${name}: charging`);
  }

  /** The boss bar (§4.3): its name, its HP, a pip per phase. Only while it stands. */
  private updateBoss(run: RunState): void {
    const b = run.boss;
    const body = b && b.killedIn === null ? run.enemies.find((e) => e.id === b.enemy) : undefined;
    this.boss.hidden = !b || !body;
    if (!b || !body) return;
    const def = BOSS_BY_ID[b.id];
    setText(this.bossName, b.enraged ? `${def.name} · Enraged` : def.name);
    setStyle(this.bossFill, 'transform', `scaleX(${Math.max(0, body.hp / body.maxHp).toFixed(3)})`);
    setText(this.bossPips, def.phases.map((_, i) => (i <= b.phase ? '◆' : '◇')).join(' '));
    toggleClass(this.boss, 'is-enraged', b.enraged);
  }
}
