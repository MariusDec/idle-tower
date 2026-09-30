import type { RunState } from '../sim/state';
import { formatNumber } from '../core/format';
import { setStyle, setText } from './dom';

/**
 * The battle HUD (§10.1): HP, wave, pause. Minute 1 shows nothing else (§3).
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly wave: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;

  constructor(host: HTMLElement, onPause: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="hud-row">
        <div class="hud-wave"><span class="hud-label">Wave</span> <span class="hud-wave-n">1</span></div>
        <button type="button" class="hud-pause" aria-label="Pause">❚❚</button>
      </div>
      <div class="hud-hp" role="meter" aria-label="Tower health">
        <div class="hud-hp-fill"></div>
        <span class="hud-hp-text"></span>
      </div>`;
    this.wave = this.root.querySelector('.hud-wave-n')!;
    this.hpFill = this.root.querySelector('.hud-hp-fill')!;
    this.hpText = this.root.querySelector('.hud-hp-text')!;
    this.root.querySelector('.hud-pause')!.addEventListener('click', onPause);
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
    setText(this.hpText, `${formatNumber(Math.ceil(hp))} / ${formatNumber(max)}`);
  }
}
