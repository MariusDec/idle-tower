import { BALANCE } from '../content/balance';
import { RIFT_BY_ID } from '../content/rifts';
import type { RiftEffect, RiftSpan, StatKey } from '../content/types';
import { formatNumber } from '../core/format';
import { riftLegal } from '../sim/systems/rifts';
import { regionAt, runWave, waveBonus } from '../sim/systems/waves';
import type { RunState } from '../sim/state';
import { icon } from './icon';
import { toggleClass } from './dom';

/**
 * The rift's offer (plans/late-game/02 §2): a lighter panel on the draft's
 * shell (`.draft`, `.draft-actions`), not `DraftPanel`, which is typed on
 * cards. A header (icon, name, rarity, the whisper), one or two full-width
 * choice rows with their costs in blood and rewards in gold, each with a
 * live figure, and "Leave it", always there and always free. A choice that
 * can't apply is greyed out with its reason. The arena is stopped while it
 * is up, so there is no timer.
 */

const STAT_NAME: Record<StatKey, string> = {
  damage: 'Damage', attackSpeed: 'Attack speed', critChance: 'Crit chance', critDamage: 'Crit damage', range: 'Range',
  maxHp: 'Max HP', regen: 'Regen', armor: 'Armor', xpGain: 'XP', shardGain: 'Shards', ultCharge: 'Ultimate charge',
  area: 'Area', duration: 'Duration', projectileSpeed: 'Projectile speed', pierce: 'Pierce',
};

function spanText(span: RiftSpan): string {
  if (span === 'run') return 'for the run';
  if (span === 'boss') return 'until the boss falls';
  return span.waves === 1 ? 'through the next wave' : `for ${span.waves} more waves`;
}

/** One line per effect, cost or reward, with the live figure (§2: "HP 2,000 → 1,600", "≈ 1,240 shards"). */
export function riftFigures(run: RunState, effects: readonly RiftEffect[]): { text: string; cost: boolean }[] {
  const n = runWave(run);
  const max = run.stats.maxHp;
  const hp = run.tower.hp;
  const wavePay = waveBonus(regionAt(run.regionId, n), n) * run.stats.shardMult;
  return effects.map((f) => {
    switch (f.kind) {
      case 'shards': {
        const pay = `≈ ${formatNumber(Math.floor(f.waves * wavePay))} shards`;
        return { text: f.atWave !== undefined ? `${pay} at wave ${f.atWave}` : pay, cost: false };
      }
      case 'hurt': {
        const after = Math.max(Math.min(hp, max * BALANCE.rifts.hurtFloor), hp - max * f.fraction);
        return { text: `HP ${formatNumber(Math.ceil(hp))} → ${formatNumber(Math.ceil(after))}`, cost: true };
      }
      case 'heal': {
        const after = Math.min(max, hp + max * f.fraction);
        return { text: `HP ${formatNumber(Math.ceil(hp))} → ${formatNumber(Math.ceil(after))}`, cost: false };
      }
      case 'stat': {
        const m = f.mod.mult ?? 1;
        const word = m === 0 ? 'stops' : `×${m}`;
        return { text: `${STAT_NAME[f.mod.key]} ${word} ${spanText(f.span)}`, cost: m < 1 };
      }
      case 'horde':
        return { text: `×${f.count} bodies for ${f.waves} wave${f.waves === 1 ? '' : 's'}`, cost: true };
      case 'bounty':
        return { text: `${f.on === 'elites' ? 'Elites pay' : 'Kills pay'} ×${f.mult} ${spanText(f.span)}`, cost: false };
      case 'elites':
        return { text: f.champion ? 'The next body: a Champion' : `+${f.n} elite${f.n === 1 ? '' : 's'}${f.perWave ? ' a wave' : ''}`, cost: !f.champion };
      case 'draft':
        return { text: `+${f.n} level-up${f.n === 1 ? '' : 's'}${f.hand === 'forged' ? ': an evolution' : ''}`, cost: false };
      case 'levels':
        return { text: `${f.target === 'strongest' ? 'Strongest weapon' : f.target === 'others' ? 'Other weapons' : 'Weapons'} ${f.delta > 0 ? '+1' : '−1'} level`, cost: f.delta < 0 };
      case 'charges': {
        const parts: string[] = [];
        if (f.rerolls) parts.push(`+${f.rerolls} rerolls`);
        if (f.banishes) parts.push(`+${f.banishes} Banish`);
        if (f.revives) parts.push(`+${f.revives} Second Wind`);
        return { text: parts.join(', '), cost: false };
      }
      case 'ult':
        return { text: `Ultimate ${Math.floor(run.ult.charge * 100)}% → ${Math.round(f.charge * 100)}%`, cost: false };
      case 'stun':
        return { text: `Every body stops for ${f.seconds} s`, cost: false };
      case 'boss':
        return { text: `Boss HP ×${f.hp}`, cost: true };
      default: {
        const exhaustive: never = f;
        return exhaustive;
      }
    }
  });
}

export class RiftPanel {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly row: HTMLElement;
  private readonly leave: HTMLButtonElement;
  private shown: string | null = null;

  constructor(host: HTMLElement, private readonly onChoose: (index: number) => void) {
    this.root = document.createElement('section');
    this.root.className = 'draft rift-panel';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'A rift');
    this.root.innerHTML = `
      <h2 class="draft-title rift-title"></h2>
      <p class="draft-hint rift-whisper"></p>
      <div class="draft-row rift-choices"></div>
      <div class="draft-actions"><button type="button" class="btn rift-leave">Leave it</button></div>`;
    this.title = this.root.querySelector('.rift-title')!;
    this.hint = this.root.querySelector('.rift-whisper')!;
    this.row = this.root.querySelector('.rift-choices')!;
    this.leave = this.root.querySelector('.rift-leave')!;
    this.leave.addEventListener('click', () => this.onChoose(-1));
    this.row.addEventListener('click', (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLButtonElement>('.rift-choice');
      if (el && !el.disabled) this.onChoose(Number(el.dataset.index));
    });
    host.appendChild(this.root);
    this.hide();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Show the open rift's offer, drawn once per rift. */
  show(run: RunState): void {
    const r = run.rift;
    if (!r) return;
    const key = `${r.id}@${r.at}`;
    if (this.shown === key && this.open) return;
    this.shown = key;
    const def = RIFT_BY_ID[r.id];
    this.title.replaceChildren(icon(def.icon), document.createTextNode(def.name));
    const chip = document.createElement('span');
    chip.className = `rift-rarity is-${def.rarity}`;
    chip.textContent = def.rarity;
    this.title.append(chip);
    this.hint.textContent = def.text;
    this.root.setAttribute('aria-label', `A rift: ${def.name}`);
    this.row.replaceChildren(...def.choices.map((c, i) => {
      const why = riftLegal(run, i);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rift-choice';
      b.dataset.index = String(i);
      b.disabled = why !== null;
      const text = document.createElement('p');
      text.className = 'rift-choice-text';
      text.textContent = c.text;
      b.append(text);
      const figs = document.createElement('p');
      figs.className = 'rift-choice-figures';
      const lines = riftFigures(run, c.effects);
      for (const f of lines) {
        const s = document.createElement('span');
        s.className = f.cost ? 'is-cost' : 'is-reward';
        s.textContent = f.text;
        figs.append(s);
      }
      b.append(figs);
      if (why !== null) {
        const reason = document.createElement('p');
        reason.className = 'rift-choice-reason';
        reason.textContent = why;
        b.append(reason);
      }
      b.setAttribute('aria-label', `${c.text} ${lines.map((l) => l.text).join('. ')}${why ? `. Unavailable: ${why}` : ''}`);
      return b;
    }));
    toggleClass(this.root, 'is-legendary', def.rarity === 'legendary');
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.shown = null;
  }
}
