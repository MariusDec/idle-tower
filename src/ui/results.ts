import type { RunSummary } from '../meta/results';
import type { DamageBy, HurtBy } from '../sim/state';
import { frameById } from '../content/frames';
import { buildList, foremanLine, tallyBars, type TallyRow } from './build';
import { floorWave } from '../content/abyss';
import { RUSH_STAGES } from '../content/rush';
import { BALANCE } from '../content/balance';
import { BOSS_BY_ID } from '../content/bosses';
import { ENEMY_BY_ID } from '../content/enemies';
import { EVOLUTION_BY_ID } from '../content/evolutions';
import { FUSION_BY_ID } from '../content/fusions';
import { RELIC_BY_ID } from '../content/relics';
import { TRIAL_BY_ID } from '../content/trials';
import { FALLBACKS, PASSIVE_BY_ID } from '../content/passives';
import { WEAPON_BY_ID } from '../content/weapons';
import type { ContentEntry, PassiveId, WeaponId } from '../content/types';
import { formatDuration, formatNumber } from '../core/format';
import { setStyle, setText } from './dom';
import { icon, iconMarkup } from './icon';


/** A `cardKey` ("weapon:scattershot") back to its content entry. */
function cardEntry(key: string): ContentEntry | null {
  const [kind, id] = key.split(':');
  if (kind === 'weapon') return WEAPON_BY_ID[id as WeaponId] ?? null;
  if (kind === 'passive') return PASSIVE_BY_ID[id as PassiveId] ?? null;
  // An evolution or fusion card shows as its recipe, from `newRecipes` and `newFusions`.
  if (kind === 'evolution' || kind === 'fusion') return null;
  return FALLBACKS.find((f) => f.id === id) ?? null;
}

/** What a damage tally's sources are called (U5). */
const TAKEN: Readonly<Record<HurtBy, string>> = {
  contact: 'At the wall',
  shots: 'Shots',
  slams: 'Shockwaves',
  pools: 'Molten pools',
  blasts: 'Blasts',
};

function dealtRows(s: RunSummary): TallyRow[] {
  return Object.entries(s.damageBy).map(([by, value]) => {
    const id = by as DamageBy;
    const weapon = WEAPON_BY_ID[id as WeaponId];
    if (weapon) return { label: weapon.name, icon: weapon.icon, value: value ?? 0 };
    const label = id === 'ult' ? frameById(s.frameId).ultimate.name : id === 'thorns' ? 'Thorns' : id === 'burn' ? 'Burns' : 'Other';
    return { label, value: value ?? 0 };
  });
}

function takenRows(s: RunSummary): TallyRow[] {
  return Object.entries(s.takenBy).map(([by, value]) => ({ label: TAKEN[by as HurtBy], value: value ?? 0 }));
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
 * itself after a short countdown. The build shows (U5), and behind a tap
 * the damage each weapon dealt and what wore the tower down; the countdown
 * waits while that is open.
 */
/** What became of a Trial (N5), in one line. */
function trialLine(t: NonNullable<RunSummary['trial']>): string {
  const name = TRIAL_BY_ID[t.id]?.name ?? t.id;
  if (!t.won) return `Trial: ${name} · not yet`;
  return t.paid ? `Trial won: ${name} · ${t.paid.line}` : `Trial won again: ${name}`;
}

export class ResultsScreen {
  private readonly root: HTMLElement;
  private readonly headline: HTMLElement;
  private readonly bossLine: HTMLElement;
  private readonly rewards: HTMLElement;
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
  private readonly hubBtn: HTMLButtonElement;
  private readonly reportBtn: HTMLButtonElement;
  private readonly report: HTMLElement;
  private readonly reportBody: HTMLElement;
  private readonly build: HTMLElement;
  /** Seconds left before auto-restart; null when it is off. */
  private countdown: number | null = null;

  /** `onForge` leads to the hub (the Map, after a first boss kill); `onAgain` starts the next run. */
  constructor(host: HTMLElement, onForge: () => void, private readonly onAgain: () => void) {
    this.root = document.createElement('section');
    this.root.className = 'screen results';
    this.root.innerHTML = `
      <p class="results-headline"></p>
      <p class="results-boss" hidden></p>
      <ul class="results-rewards" hidden></ul>
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
      <div class="results-build"></div>
      <button type="button" class="btn results-report-btn" aria-expanded="false">How it went</button>
      <div class="results-report" role="dialog" aria-label="How it went" hidden>
        <div class="results-report-card">
          <h2 class="modal-title">How it went</h2>
          <div class="results-report-body"></div>
          <button type="button" class="btn btn-primary results-report-close">Close</button>
        </div>
      </div>
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
    this.bossLine = q('.results-boss');
    this.rewards = q('.results-rewards');
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
    this.hubBtn = q('.results-forge');
    this.reportBtn = q('.results-report-btn');
    this.report = q('.results-report');
    this.reportBody = q('.results-report-body');
    this.build = q('.results-build');
    const setReport = (open: boolean): void => {
      this.report.hidden = !open;
      this.reportBtn.setAttribute('aria-expanded', String(open));
    };
    this.reportBtn.addEventListener('click', () => setReport(true));
    q('.results-report-close').addEventListener('click', () => setReport(false));
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

  /** `hubLabel` names where the other button goes: the Forge, or the Map after a first kill. */
  show(s: RunSummary, autoRestart: boolean, hubLabel = 'Forge'): void {
    this.hubBtn.textContent = hubLabel;
    const where = s.abyss
      ? `Floor ${s.abyss.floor}, wave ${floorWave(s.wave)}`
      : s.rush ? `Boss Rush, stage ${s.wave} of ${RUSH_STAGES}`
        : s.wave > 20 ? `Overtime +${s.wave - 20}` : `Wave ${s.wave}`;
    this.headline.textContent = s.outcome === 'cleared'
      ? `Boss Rush cleared in ${formatDuration(s.rush?.time ?? s.time)}.`
      : s.outcome === 'retreat'
        ? `The tower withdraws. ${where}.`
        : `The light recedes. ${where}.`;

    // The boss: felled (and how fast), or still standing. The Abyss counts floors (§9).
    const b = s.boss;
    this.bossLine.hidden = b === null && s.abyss === null && s.rush === null;
    if (s.rush) {
      const n = s.rush.stages;
      this.bossLine.textContent = n > 0 ? `${n} of ${RUSH_STAGES} bosses fell.` : 'The first boss still stands.';
      this.bossLine.classList.toggle('is-first', s.rushRecord !== null);
    } else if (s.abyss) {
      const n = s.abyss.cleared;
      this.bossLine.textContent = n > 0 ? `${n} floor${n === 1 ? '' : 's'} of the Abyss cleared.` : 'The first floor holds.';
      this.bossLine.classList.toggle('is-first', s.floorRecord !== null);
    } else if (b) {
      const name = BOSS_BY_ID[b.id].name;
      this.bossLine.textContent = b.killedIn === null
        ? `${name} still stands.`
        : `${b.first ? 'Region cleared! ' : ''}${name} fell in ${formatDuration(b.killedIn)}.`;
      this.bossLine.classList.toggle('is-first', b.first);
    }

    // The rewards stack (§7.3): what opened up, relics found, feats earned.
    const reward = (iconId: Parameters<typeof icon>[0], text: string, tone: string): HTMLElement => {
      const li = document.createElement('li');
      li.className = `results-reward is-${tone}`;
      li.append(icon(iconId));
      const t = document.createElement('span');
      t.textContent = text;
      li.append(t);
      return li;
    };
    const starlight: HTMLElement[] = [];
    if (s.heatRecord) {
      starlight.push(reward('round-star', `Heat record ${s.heatRecord.now} · +${formatNumber(s.heatRecord.starlight)} Starlight`, 'unlock'));
    }
    if (s.floorRecord) {
      starlight.push(reward('round-star', `Deepest floor ${s.floorRecord.now} · +${formatNumber(s.floorRecord.starlight)} Starlight`, 'unlock'));
    }
    if (s.rushRecord) {
      const now = s.rushRecord.now;
      const what = now.time !== null ? `Boss Rush record ${formatDuration(now.time)}` : `Boss Rush record: ${now.stages} bosses`;
      starlight.push(reward('round-star', `${what} · +${formatNumber(s.rushRecord.starlight)} Starlight`, 'unlock'));
    }
    this.rewards.replaceChildren(
      ...starlight,
      // Overtime trophies (N4): a mark on the Map, a light on the tower, once.
      ...s.trophies.map((t) => reward('star-medal', `Trophy · overtime +${t.overtime} · +${formatNumber(t.shards)} shards`, 'unlock')),
      ...(s.foreman.length > 0 ? [reward('shop', `The Foreman bought ${foremanLine(s.foreman)}`, 'unlock')] : []),
      // A Trial (N5): won, and what it paid the first time; or what still stands.
      ...(s.trial ? [reward('checkered-flag', trialLine(s.trial), s.trial.paid ? 'unlock' : 'feat')] : []),
      ...s.unlocks.map((u) => reward('star-gate', u, 'unlock')),
      ...s.relics.map((r) => {
        const def = RELIC_BY_ID[r.id];
        const peak = r.set ? `at its peak · ${r.set} grows` : `at its peak · +${formatNumber(r.shards ?? 0)} shards`;
        const rank = r.rank === 0 ? peak : r.rank === 1 ? 'new relic' : `rank ${'I'.repeat(r.rank)}`;
        return reward(def.icon, `${def.name} · ${rank}`, 'relic');
      }),
      // Before the Feats tab opens, feats are earned quietly: the tab opens on the batch (§5.4).
      ...(s.featsOpen ? s.feats : []).map((f) => reward(f.icon, `Feat: ${f.name}`, 'feat')),
    );
    this.rewards.hidden = this.rewards.childElementCount === 0;

    this.records.replaceChildren();
    const rec = (label: string, r: { old: number; now: number } | null, fmt = formatNumber): void => {
      if (!r) return;
      const li = document.createElement('li');
      li.className = 'results-record';
      const old = document.createElement('s');
      old.textContent = fmt(r.old);
      li.append(`New record · ${label} `, old, ` ${fmt(r.now)}`);
      this.records.append(li);
    };
    rec('wave', s.records.wave);
    rec('overtime', s.records.overtime, (n) => `+${formatNumber(n)}`);
    rec('shards', s.records.shards);
    this.records.hidden = this.records.childElementCount === 0;

    setText(this.kills, formatNumber(s.kills));
    setText(this.time, formatDuration(s.time));
    setText(this.shardsN, formatNumber(s.shards));
    const f = s.shardsFrom;
    const parts = [`Kills ${formatNumber(f.kills)}`, `Waves ${formatNumber(f.waves)}`];
    if (f.elites > 0) parts.push(`Elites ${formatNumber(f.elites)}`);
    if (f.boss > 0) parts.push(`Boss ${formatNumber(f.boss)}`);
    if (f.cards > 0) parts.push(`Cards ${formatNumber(f.cards)}`);
    this.breakdown.textContent = parts.join(' · ');
    this.breakdown.hidden = true;
    this.shards.setAttribute('aria-expanded', 'false');

    this.finds.replaceChildren(
      ...s.newRecipes.map((id) => chip(EVOLUTION_BY_ID[id], 'recipe')),
      ...s.newFusions.map((id) => chip(FUSION_BY_ID[id], 'recipe')),
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

    // The build (U5) on the screen; behind a tap, what dealt the damage and what took it.
    this.build.replaceChildren(buildList(s.build));
    const section = (title: string, node: HTMLElement): HTMLElement[] => {
      const h = document.createElement('h3');
      h.className = 'results-report-head';
      h.textContent = title;
      return [h, node];
    };
    const taken = tallyBars(takenRows(s), 'Damage taken');
    taken.classList.add('is-taken');
    const tookNone = takenRows(s).every((r) => r.value === 0);
    const none = document.createElement('p');
    none.className = 'tactics-empty';
    none.textContent = 'Nothing touched the tower.';
    this.reportBody.replaceChildren(
      ...section('Damage dealt', tallyBars(dealtRows(s), 'Damage dealt')),
      ...section('What wore it down', tookNone ? none : taken),
    );
    this.report.hidden = true;
    this.reportBtn.setAttribute('aria-expanded', 'false');

    this.countdown = autoRestart ? BALANCE.automation.restartSeconds : null;
    this.paintAgain();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.countdown = null;
  }

  /** Run the auto-restart countdown on the wall clock. */
  tick(realDt: number): void {
    if (this.countdown === null || this.root.hidden || !this.report.hidden) return;
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
