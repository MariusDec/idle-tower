import type { RunState } from '../sim/state';
import { FRAMES } from '../content/frames';
import { formatNumber } from '../core/format';
import { setAriaLabel, setStyle, setText, toggleClass } from './dom';

/**
 * The battle HUD (§10.1): HP and wave on top; the XP bar, the level and the
 * ultimate at the bottom, under the thumb. Nothing else (§3).
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly level: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly ult: HTMLButtonElement;
  private readonly ultLabel: HTMLElement;

  constructor(host: HTMLElement, onPause: () => void, onUlt: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-row">
          <div class="hud-wave"><span class="hud-label">Wave</span> <span class="hud-wave-n">1</span></div>
          <button type="button" class="hud-pause" aria-label="Pause">❚❚</button>
        </div>
        <div class="hud-hp" role="meter" aria-label="Tower health">
          <div class="hud-hp-fill"></div>
          <span class="hud-hp-text"></span>
        </div>
      </div>
      <div class="hud-bottom">
        <div class="hud-row hud-row-bottom">
          <div class="hud-level"><span class="hud-label">Lv</span> <span class="hud-level-n">1</span></div>
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
    this.root.querySelector('.hud-pause')!.addEventListener('click', onPause);
    this.ult.addEventListener('click', onUlt);
    host.appendChild(this.root);
    this.hide();
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  update(run: RunState): void {
    setText(this.wave, String(run.wave));
    const hp = Math.max(0, run.tower.hp);
    const max = run.stats.maxHp;
    const frac = max > 0 ? hp / max : 0;
    setStyle(this.hpFill, 'transform', `scaleX(${frac.toFixed(3)})`);
    setText(this.hpText, `${formatNumber(Math.ceil(hp))} / ${formatNumber(Math.round(max))}`);

    setText(this.level, String(run.level));
    setStyle(this.xpFill, 'transform', `scaleX(${Math.min(1, run.xp / run.xpNext).toFixed(3)})`);

    const name = (FRAMES.find((f) => f.id === run.frameId) ?? FRAMES[0]).ultimate.name;
    const ready = run.ult.charge >= 1;
    setText(this.ultLabel, ready ? name : `${Math.floor(run.ult.charge * 100)}%`);
    setStyle(this.ult, '--charge', run.ult.charge.toFixed(3));
    toggleClass(this.ult, 'is-ready', ready);
    setAriaLabel(this.ult, ready ? `${name}: ready` : `${name}: charging`);
  }
}
