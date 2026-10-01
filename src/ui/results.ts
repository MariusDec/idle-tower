import type { RunSummary } from '../meta/results';
import { ENEMY_BY_ID } from '../content/enemies';
import { FALLBACKS, PASSIVE_BY_ID } from '../content/passives';
import { WEAPON_BY_ID } from '../content/weapons';
import type { ContentEntry, PassiveId, WeaponId } from '../content/types';
import { formatDuration, formatNumber } from '../core/format';
import { setStyle, setText } from './dom';
import { icon, iconMarkup } from './icon';

/** Seconds before auto-restart starts the next run (§4.6, §6.2). */
export const AUTO_RESTART_SECONDS = 5;

/** A `cardKey` ("weapon:scattershot") back to its content entry. */
function cardEntry(key: string): ContentEntry | null {
  const [kind, id] = key.split(':');
  if (kind === 'weapon') return WEAPON_BY_ID[id as WeaponId] ?? null;
  if (kind === 'passive') return PASSIVE_BY_ID[id as PassiveId] ?? null;
  return FALLBACKS.find((f) => f.id === id) ?? null;
}

function chip(entry: ContentEntry, kind: string): HTMLElement {
  const el = document.createElement('li');
  el.className = 'results-find';
  el.setAttribute('aria-label', `New ${kind}: ${entry.name}`);
  el.append(icon(entry.icon));
  const name = document.createElement('span');
  name.textContent = entry.name;
  el.append(name);
  return el;
}

/**
 * The results screen (§4.6). One screen, no scrolling on mobile, no failure
 * language: the wave, the haul (tap for the breakdown), records with the old
 * value struck through, what was discovered, and one "Next:" line. Two
 * buttons, Forge and Run again; once auto-restart is owned, Run again fires
 * itself after a short countdown.
 */
export class ResultsScreen {
  private readonly root: HTMLElement;
  private readonly headline: HTMLElement;
  private readonly records: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly time: HTMLElement;
  private readonly shards: HTMLButtonElement;
  private readonly shardsN: HTMLElement;
  private readonly breakdown: HTMLElement;
  private readonly finds: HTMLElement;
  private readonly next: HTMLElement;
  private readonly nextIcon: HTMLElement;
  private readonly nextName: HTMLElement;
  private readonly nextFill: HTMLElement;
  private readonly nextValue: HTMLElement;
  private readonly again: HTMLButtonElement;
  /** Seconds left before auto-restart; null when it is off. */
  private countdown: number | null = null;

  constructor(host: HTMLElement, onForge: () => void, private readonly onAgain: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen results';
    this.root.innerHTML = `
      <p class="results-headline"></p>
      <ul class="results-records"></ul>
      <div class="results-stats">
        <div><span class="results-stat-n results-kills"></span><span class="results-stat-l">Kills</span></div>
        <div><span class="results-stat-n results-time"></span><span class="results-stat-l">Held</span></div>
        <button type="button" class="results-shards" aria-expanded="false">
          <span class="results-stat-n">${iconMarkup('crystal-cluster')}<span class="results-shards-n"></span></span>
          <span class="results-stat-l">Shards</span>
        </button>
      </div>
      <p class="results-breakdown" hidden></p>
      <ul class="results-finds"></ul>
      <div class="results-next">
        <span class="results-next-label">Next</span>
        <span class="results-next-icon"></span>
        <span class="results-next-name"></span>
        <div class="results-next-bar"><div class="results-next-fill"></div></div>
        <span class="results-next-value"></span>
      </div>
      <div class="results-actions">
        <button type="button" class="btn results-forge">Forge</button>
        <button type="button" class="btn btn-primary results-again">Run again</button>
      </div>`;
    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel)!;
    this.headline = q('.results-headline');
    this.records = q('.results-records');
    this.kills = q('.results-kills');
    this.time = q('.results-time');
    this.shards = q('.results-shards');
    this.shardsN = q('.results-shards-n');
    this.breakdown = q('.results-breakdown');
    this.finds = q('.results-finds');
    this.next = q('.results-next');
    this.nextIcon = q('.results-next-icon');
    this.nextName = q('.results-next-name');
    this.nextFill = q('.results-next-fill');
    this.nextValue = q('.results-next-value');
    this.again = q('.results-again');
    this.shards.addEventListener('click', () => {
      this.breakdown.hidden = !this.breakdown.hidden;
      this.shards.setAttribute('aria-expanded', String(!this.breakdown.hidden));
    });
    q('.results-forge').addEventListener('click', () => {
      this.countdown = null;
      onForge();
    });
    this.again.addEventListener('click', () => {
      this.countdown = null;
      onAgain();
    });
    host.appendChild(this.root);
    this.hide();
  }

  show(s: RunSummary, autoRestart: boolean): void {
    this.headline.textContent = s.outcome === 'retreat'
      ? `The tower withdraws. Wave ${s.wave}.`
      : `The light recedes. Wave ${s.wave}.`;

    this.records.replaceChildren();
    const rec = (label: string, r: { old: number; now: number } | null): void => {
      if (!r) return;
      const li = document.createElement('li');
      li.className = 'results-record';
      const old = document.createElement('s');
      old.textContent = formatNumber(r.old);
      li.append(`New record · ${label} `, old, ` ${formatNumber(r.now)}`);
      this.records.append(li);
    };
    rec('wave', s.records.wave);
    rec('shards', s.records.shards);
    this.records.hidden = this.records.childElementCount === 0;

    setText(this.kills, formatNumber(s.kills));
    setText(this.time, formatDuration(s.time));
    setText(this.shardsN, formatNumber(s.shards));
    const f = s.shardsFrom;
    const parts = [`Kills ${formatNumber(f.kills)}`, `Waves ${formatNumber(f.waves)}`];
    if (f.cards > 0) parts.push(`Cards ${formatNumber(f.cards)}`);
    this.breakdown.textContent = parts.join(' · ');
    this.breakdown.hidden = true;
    this.shards.setAttribute('aria-expanded', 'false');

    this.finds.replaceChildren(
      ...s.newEnemies.map((id) => chip(ENEMY_BY_ID[id], 'enemy')),
      ...s.newCards.map(cardEntry).filter((e): e is ContentEntry => e !== null).map((e) => chip(e, 'card')),
    );
    this.finds.hidden = this.finds.childElementCount === 0;

    const goal = s.next;
    this.next.hidden = goal === null;
    if (goal) {
      this.nextIcon.replaceChildren(icon(goal.node.icon));
      setText(this.nextName, goal.node.name);
      setStyle(this.nextFill, 'transform', `scaleX(${goal.progress.toFixed(3)})`);
      setText(this.nextValue, goal.progress >= 1 ? 'Ready' : `${Math.floor(goal.progress * 100)}%`);
      this.next.classList.toggle('is-ready', goal.progress >= 1);
    }

    this.countdown = autoRestart ? AUTO_RESTART_SECONDS : null;
    this.paintAgain();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.countdown = null;
  }

  /** Run the auto-restart countdown on the wall clock. */
  tick(realDt: number): void {
    if (this.countdown === null || this.root.hidden) return;
    this.countdown = Math.max(0, this.countdown - realDt);
    this.paintAgain();
    if (this.countdown === 0) {
      this.countdown = null;
      this.onAgain();
    }
  }

  private paintAgain(): void {
    setText(this.again, this.countdown === null ? 'Run again' : `Run again · ${Math.ceil(this.countdown)}`);
  }
}
