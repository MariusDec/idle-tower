import type { AuraType } from '../types';
import { ENEMY_LABELS } from '../data/enemies';
import type { WavePreview } from '../systems/WaveManager';
import { setStyle, setText, setTitle, toggleClass } from '../utils/dom';

/**
 * Everything the pacing HUD reads, resolved once per frame by `Game`.
 *
 * Plain data, for the same reason `BossBarData` is plain data: presentation
 * that holds a live manager reference is presentation that can change the
 * simulation.
 */
export interface PacingHudData {
  /** The dial as set (0-5). */
  risk: number;
  /** The risk the live wave is running. Differs while a change is pending. */
  activeRisk: number;
  riskPending: boolean;
  maxRisk: number;
  /** Early-call momentum as a gold fraction, and how it got there. */
  momentum: number;
  momentumStreak: number;
  momentumCap: number;
  /** True when Space / the HUD button would start the next wave now. */
  canCallEarly: boolean;
  /** Gold bonus the *current* moment of intermission would bank. */
  callBonus: number;
  intermissionRemaining: number;
  intermissionLength: number;
  /** Kill combo: count, tier, and how full the drain bar is. */
  combo: number;
  comboTier: number;
  comboTierCount: number;
  comboLabel: string | null;
  comboNext: number | null;
  comboFraction: number;
  comboGold: number;
  /** The coming wave's composition, or null outside an intermission. */
  preview: WavePreview | null;
}

const AURA_LABELS: Record<AuraType, string> = {
  haste: 'Haste',
  thorns: 'Thorns',
  greed: 'Greed',
  vitality: 'Vitality',
  retribution: 'Retribution',
};

/**
 * The combo meter and the next-wave threat readout (gameplay plan §7.2/§7.3).
 *
 * One overlay for both because they are two halves of the same beat: the combo
 * meter is what the wave *was*, the threat preview is what the next one *is*,
 * and they are never both interesting at once — a combo dies two seconds after
 * the last kill and the preview only exists during an intermission.
 *
 * The plan calls the combo meter "the readout the game currently lacks
 * entirely", and the drain is the whole point of it: a number that only counts
 * up is a score, whereas a bar visibly emptying is a clock the player can beat.
 *
 * Everything routes through the caching `dom` helpers, so a steady frame writes
 * nothing.
 */
export class PacingOverlay {
  private readonly root: HTMLElement;
  private readonly comboWrap: HTMLElement;
  private readonly comboCount: HTMLElement;
  private readonly comboTier: HTMLElement;
  private readonly comboBonus: HTMLElement;
  private readonly comboDrain: HTMLElement;
  private readonly comboNext: HTMLElement;
  private readonly previewWrap: HTMLElement;
  private readonly previewTitle: HTMLElement;
  private readonly previewBody: HTMLElement;
  private readonly previewHint: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.classList.add('pacing-overlay');

    this.previewWrap = document.createElement('div');
    this.previewWrap.className = 'threat-preview';
    this.previewTitle = document.createElement('div');
    this.previewTitle.className = 'threat-preview-title';
    this.previewWrap.appendChild(this.previewTitle);
    this.previewBody = document.createElement('div');
    this.previewBody.className = 'threat-preview-body';
    this.previewWrap.appendChild(this.previewBody);
    this.previewHint = document.createElement('div');
    this.previewHint.className = 'threat-preview-hint';
    this.previewWrap.appendChild(this.previewHint);
    this.root.appendChild(this.previewWrap);

    this.comboWrap = document.createElement('div');
    this.comboWrap.className = 'combo-meter';
    const row = document.createElement('div');
    row.className = 'combo-meter-row';
    this.comboCount = document.createElement('span');
    this.comboCount.className = 'combo-meter-count';
    row.appendChild(this.comboCount);
    this.comboTier = document.createElement('span');
    this.comboTier.className = 'combo-meter-tier';
    row.appendChild(this.comboTier);
    this.comboBonus = document.createElement('span');
    this.comboBonus.className = 'combo-meter-bonus';
    row.appendChild(this.comboBonus);
    this.comboWrap.appendChild(row);
    const bar = document.createElement('div');
    bar.className = 'combo-meter-bar';
    this.comboDrain = document.createElement('div');
    this.comboDrain.className = 'combo-meter-fill';
    bar.appendChild(this.comboDrain);
    this.comboWrap.appendChild(bar);
    this.comboNext = document.createElement('div');
    this.comboNext.className = 'combo-meter-next';
    this.comboWrap.appendChild(this.comboNext);
    this.root.appendChild(this.comboWrap);
  }

  update(data: PacingHudData): void {
    this.updateCombo(data);
    this.updatePreview(data);
  }

  private updateCombo(data: PacingHudData): void {
    const visible = data.combo > 0;
    toggleClass(this.comboWrap, 'is-visible', visible);
    if (!visible) return;
    setText(this.comboCount, `${data.combo}x`);
    setText(this.comboTier, data.comboLabel ?? '');
    setText(
      this.comboBonus,
      data.comboGold > 0 ? `+${Math.round(data.comboGold * 100)}% gold & XP` : '',
    );
    setStyle(this.comboDrain, 'width', `${(data.comboFraction * 100).toFixed(1)}%`);
    // Tier drives the colour so the bar reads at a glance without being read.
    toggleClass(this.comboWrap, 'tier-1', data.comboTier === 1);
    toggleClass(this.comboWrap, 'tier-2', data.comboTier === 2);
    toggleClass(this.comboWrap, 'tier-3', data.comboTier === 3);
    toggleClass(this.comboWrap, 'tier-4', data.comboTier >= 4);
    setText(
      this.comboNext,
      data.comboNext !== null ? `${data.combo} → ${data.comboNext}` : 'max tier',
    );
  }

  private updatePreview(data: PacingHudData): void {
    const p = data.preview;
    toggleClass(this.previewWrap, 'is-visible', p !== null);
    if (!p) return;
    setText(this.previewTitle, p.isBoss ? `Wave ${p.wave} — BOSS` : `Wave ${p.wave} incoming`);
    toggleClass(this.previewWrap, 'is-boss', p.isBoss);

    // Threat types are named, trash is only counted — see `ENEMY_THREAT_CLASS`.
    // Naming the threat rather than the headcount is what makes the window
    // useful: "3 Siege" tells the player to change targeting mode, "18
    // enemies" tells them nothing they could act on.
    const parts: string[] = [`${p.count} ${p.count === 1 ? 'enemy' : 'enemies'}`];
    for (const t of p.threats) parts.push(`${t.count} ${ENEMY_LABELS[t.type]}`);
    for (const e of p.elites) {
      parts.push(`${e.count} Elite (${AURA_LABELS[e.aura]})`);
    }
    setText(this.previewBody, parts.join(' · '));
    setTitle(
      this.previewWrap,
      p.threats.length > 0
        ? `Named types are the ones that ask a question of your build.`
        : 'Nothing here needs a special answer.',
    );

    setText(
      this.previewHint,
      data.canCallEarly
        ? `Space: call it now for +${Math.round(data.callBonus * 100)}% gold`
        : '',
    );
  }
}
