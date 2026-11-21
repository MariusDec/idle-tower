import { ANOMALY_BY_ID } from '../content/anomalies';
import { RIFT_BY_ID } from '../content/rifts';
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
import type { AnomalyId, ContentEntry, PassiveId, RelicId, WeaponId } from '../content/types';
import { curseLine, isCursed } from '../content/cursed';
import { formatDuration, formatNumber } from '../core/format';
import { SECRET_BY_ID } from '../content/secrets';
import { motionReduced, setAriaLabel, setStyle, setText } from './dom';
import { regionByIndex } from '../content/regions';
import { bandDots, digits } from '../meta/omen';
import { icon, iconMarkup } from './icon';


/** A `cardKey` ("weapon:scattershot") back to its content entry. */
function cardEntry(key: string): ContentEntry | null {
  const [kind, id] = key.split(':');
  if (kind === 'weapon') return WEAPON_BY_ID[id as WeaponId] ?? null;
  if (kind === 'passive') return PASSIVE_BY_ID[id as PassiveId] ?? null;
  // An evolution or fusion card shows as its recipe, from `newRecipes` and `newFusions`.
  if (kind === 'evolution' || kind === 'fusion') return null;
  if (kind === 'anomaly') return ANOMALY_BY_ID[id as AnomalyId] ?? null;
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

/** A gain's colour: gold for records and what opened up, arcane for relics, accent for finds, dim for a miss. */
type GainTone = 'record' | 'unlock' | 'relic' | 'feat' | 'find' | 'miss';

/**
 * One row of "New this run": the icon, what it is, and on the right a short
 * tag saying which kind of gain it is ("New relic", "Feat", "Record"). A
 * `note` adds a second, dimmer line under the name.
 */
function gain(iconId: Parameters<typeof icon>[0], name: string, tag: string | Node, tone: GainTone, note = ''): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `results-gain is-${tone}`;
  li.append(icon(iconId));
  const text = document.createElement('span');
  text.className = 'results-gain-text';
  const n = document.createElement('span');
  n.className = 'results-gain-name';
  n.textContent = name;
  text.append(n);
  if (note) {
    const sub = document.createElement('span');
    sub.className = 'results-gain-note';
    sub.textContent = note;
    text.append(sub);
  }
  li.append(text);
  const t = document.createElement('span');
  t.className = 'results-gain-tag';
  if (tag !== '') t.append(tag);
  li.append(t);
  return li;
}

/** What a discovered card is called in its tag, from its `cardKey` kind. */
const CARD_TAG: Readonly<Record<string, string>> = { weapon: 'New weapon', passive: 'New passive', anomaly: 'New anomaly' };

/** A record's tag: the old value struck through, then the new one. */
function recordTag(r: { old: number; now: number }, fmt: (n: number) => string): Node {
  const frag = document.createDocumentFragment();
  const old = document.createElement('s');
  old.textContent = fmt(r.old);
  frag.append(old, ` ${fmt(r.now)}`);
  return frag;
}

/** What a met contract paid (plans/late-game/10 §2): "✦ 8 · 2.0M shards". */
function contractPay(pay: NonNullable<NonNullable<RunSummary['contract']>['pay']>): string {
  const star = pay.starlight > 0 ? `✦ ${formatNumber(pay.starlight)} · ` : '';
  return `${star}${formatNumber(pay.shards)} shards`;
}

/**
 * A plateau's line (R2 §4): on a run short of the region's best, what did
 * move: the wave against the last few runs there, and the Forge's next node
 * nearer. Null when neither moved.
 */
export function plateauLine(s: Pick<RunSummary, 'wave' | 'plateau'>): string | null {
  const p = s.plateau;
  if (!p) return null;
  const parts: string[] = [];
  if (s.wave > p.median) parts.push(`Further than your last ${p.runs} runs here (wave ${p.median})`);
  if (p.forge) {
    const pct = (x: number): string => `${Math.floor(x * 100)}%`;
    parts.push(`${p.forge.name} ${pct(p.forge.from)} → ${p.forge.to >= 1 ? 'ready' : pct(p.forge.to)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The results screen (§4.6). One screen, no failure language, read top to
 * bottom: the wave, the boss, three stats (kills, time held, shards), then
 * one list of everything new this run (records, rewards, relics, feats and
 * discoveries), each row tagged with what it is. *Run details* opens a sheet
 * with the rest: where the shards came from, the build (U5), the damage
 * dealt and taken, and what happened along the way (rifts, reliquaries,
 * anomalies); the countdown waits while it is open. Then one "Next upgrade"
 * line, and two buttons, Forge and Run again; once auto-restart is owned,
 * Run again fires itself after a short countdown, which a pause button
 * beside it holds.
 */
export class ResultsScreen {
  private readonly root: HTMLElement;
  /** The hub button's leave (Forge, Map, or the Omen's view). */
  private readonly leave: () => void;
  /** Close Run details' sheet; false when it wasn't open. */
  private readonly closeReport: () => boolean;
  private readonly heroN: HTMLElement;
  private readonly heroL: HTMLElement;
  private readonly headline: HTMLElement;
  /** What moved on a plateau (R2 §4), under the headline. */
  private readonly plateau: HTMLElement;
  private readonly againRing: SVGElement;
  private readonly againFill: SVGElement;
  private readonly againLabel: HTMLElement;
  /** The hero number's count-up (plans/visual-identity.md §2.6), cancelled by a newer one. */
  private countUp = 0;
  private readonly bossLine: HTMLElement;
  /** "New this run": records, rewards and discoveries, one tagged row each. */
  private readonly gains: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly time: HTMLElement;
  private readonly shards: HTMLElement;
  private readonly shardsN: HTMLElement;
  /** The Daily Omen's block (plans/late-game/11 §2), in place of the shards. */
  private readonly omen: HTMLElement;
  private omenLine = '';
  private readonly next: HTMLElement;
  private readonly nextIcon: HTMLElement;
  private readonly nextName: HTMLElement;
  private readonly nextFill: HTMLElement;
  private readonly nextValue: HTMLElement;
  private readonly again: HTMLButtonElement;
  /** Retry an unmet contract (plans/late-game/10 §2): the same card, at once. */
  private readonly retry: HTMLButtonElement;
  private retryId: string | null = null;
  private readonly hubBtn: HTMLButtonElement;
  private readonly reportBtn: HTMLButtonElement;
  private readonly report: HTMLElement;
  private readonly reportBody: HTMLElement;
  /** Seconds left before auto-restart; null when it is off. */
  private countdown: number | null = null;
  /** The countdown held by the player, to read the results at leisure. */
  private paused = false;
  /** Pause / resume the auto-restart countdown; shown only while it runs. */
  private readonly hold: HTMLButtonElement;

  /** `onForge` leads to the hub (the Map, after a first boss kill); `onAgain` starts the next run. */
  constructor(
    host: HTMLElement, onForge: () => void, private readonly onAgain: () => void,
    /** Wear a cursed relic just claimed (plans/late-game/03 §2); `done(worn)` redraws its button. */
    private readonly onWear: (id: RelicId, done: (worn: boolean) => void) => void = () => {},
    /** Retry a contract not met (plans/late-game/10 §2). */
    onRetry: (id: string) => void = () => {},
    /** Copy a Daily Omen's result line (plans/late-game/11 §2); true when it landed. */
    private readonly onCopy: (text: string) => Promise<boolean> = async () => false,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'screen results';
    this.root.innerHTML = `
      <p class="results-hero"><span class="results-hero-n"></span><span class="results-hero-l"></span></p>
      <p class="results-headline"></p>
      <p class="results-plateau" hidden></p>
      <p class="results-boss" hidden></p>
      <div class="results-stats">
        <div><span class="results-stat-n results-kills"></span><span class="results-stat-l">Kills</span></div>
        <div><span class="results-stat-n results-time"></span><span class="results-stat-l">Held</span></div>
        <div class="results-shards">
          <span class="results-stat-n">${iconMarkup('io-diamond')}<span class="results-shards-n"></span></span>
          <span class="results-stat-l">Shards</span>
        </div>
      </div>
      <div class="results-omen" hidden>
        <p class="results-omen-head"></p>
        <p class="results-omen-score"><span class="results-omen-wave"></span><span class="results-omen-band"></span></p>
        <p class="results-omen-pay"></p>
        <p class="results-omen-note"></p>
        <button type="button" class="btn results-omen-copy">Copy result</button>
      </div>
      <section class="results-section" hidden><h3 class="section-head">New this run</h3><ul class="results-gains"></ul></section>
      <button type="button" class="btn btn-tertiary results-report-btn" aria-expanded="false">Run details${iconMarkup('io-chevron-forward', { size: 18 })}</button>
      <div class="results-report" role="dialog" aria-label="Run details" hidden>
        <div class="results-report-card">
          <h2 class="modal-title">Run details</h2>
          <div class="results-report-body"></div>
          <button type="button" class="btn btn-primary results-report-close">Close</button>
        </div>
      </div>
      <div class="results-next">
        <span class="results-next-label">Next upgrade</span>
        <span class="results-next-icon"></span>
        <span class="results-next-name"></span>
        <div class="results-next-bar"><div class="results-next-fill"></div></div>
        <span class="results-next-value"></span>
      </div>
      <div class="results-actions">
        <button type="button" class="btn results-forge">Forge</button>
        <button type="button" class="btn results-retry" hidden>Retry</button>
        <button type="button" class="btn results-hold" hidden></button>
        <button type="button" class="btn btn-primary results-again">
          <svg class="ring results-again-ring" viewBox="0 0 36 36" aria-hidden="true" hidden>
            <circle class="ring-track" cx="18" cy="18" r="15"></circle>
            <circle class="ring-fill results-again-fill" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="100"></circle>
          </svg>
          <span class="results-again-label">Run again</span>
        </button>
      </div>`;
    const q = <T extends HTMLElement>(sel: string): T => this.root.querySelector<T>(sel)!;
    this.heroN = q('.results-hero-n');
    this.heroL = q('.results-hero-l');
    this.headline = q('.results-headline');
    this.plateau = q('.results-plateau');
    this.againRing = this.root.querySelector<SVGElement>('.results-again-ring')!;
    this.againFill = this.root.querySelector<SVGElement>('.results-again-fill')!;
    this.againLabel = q('.results-again-label');
    this.bossLine = q('.results-boss');
    this.gains = q('.results-gains');
    this.kills = q('.results-kills');
    this.time = q('.results-time');
    this.shards = q('.results-shards');
    this.shardsN = q('.results-shards-n');
    this.omen = q('.results-omen');
    const copy = q<HTMLButtonElement>('.results-omen-copy');
    copy.addEventListener('click', () => {
      void this.onCopy(this.omenLine).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Couldn’t copy';
        window.setTimeout(() => { copy.textContent = 'Copy result'; }, 1600);
      });
    });
    this.next = q('.results-next');
    this.nextIcon = q('.results-next-icon');
    this.nextName = q('.results-next-name');
    this.nextFill = q('.results-next-fill');
    this.nextValue = q('.results-next-value');
    this.again = q('.results-again');
    this.retry = q('.results-retry');
    this.hubBtn = q('.results-forge');
    this.reportBtn = q('.results-report-btn');
    this.report = q('.results-report');
    this.reportBody = q('.results-report-body');
    const setReport = (open: boolean): void => {
      this.report.hidden = !open;
      this.reportBtn.setAttribute('aria-expanded', String(open));
    };
    this.reportBtn.addEventListener('click', () => setReport(true));
    q('.results-report-close').addEventListener('click', () => setReport(false));
    this.leave = () => {
      this.countdown = null;
      onForge();
    };
    this.closeReport = () => {
      if (this.report.hidden) return false;
      setReport(false);
      return true;
    };
    q('.results-forge').addEventListener('click', this.leave);
    this.hold = q<HTMLButtonElement>('.results-hold');
    this.hold.addEventListener('click', () => {
      this.paused = !this.paused;
      this.paintAgain();
    });
    this.again.addEventListener('click', () => {
      this.countdown = null;
      onAgain();
    });
    this.retry.addEventListener('click', () => {
      this.countdown = null;
      if (this.retryId) onRetry(this.retryId);
    });
    host.appendChild(this.root);
    this.hide();
  }

  /** `hubLabel` names where the other button goes: the Forge, or the Map after a first kill. */
  show(s: RunSummary, autoRestart: boolean, hubLabel = 'Forge'): void {
    this.hubBtn.textContent = hubLabel;
    // The hero number (plans/visual-identity.md §6.7): how far the run got, counted up.
    if (s.outcome === 'cleared') {
      this.hero(null, formatDuration(s.rush?.time ?? s.time), 'Boss Rush cleared');
    } else if (s.abyss) {
      this.hero(s.abyss.floor, '', `Floor reached · wave ${floorWave(s.wave)}`);
    } else if (s.rush) {
      this.hero(s.wave, '', `Stage reached · of ${RUSH_STAGES}`);
    } else {
      this.hero(s.wave, '', s.wave > 20 ? `Wave reached · overtime +${s.wave - 20}` : 'Wave reached');
    }
    this.headline.textContent = s.outcome === 'cleared'
      ? 'Every boss fell.'
      : s.outcome === 'retreat' ? 'The tower withdraws.' : 'The light recedes.';
    // Short of the best (R2 §4): lead with what did improve.
    const plateau = plateauLine(s);
    this.plateau.hidden = plateau === null;
    this.plateau.textContent = plateau ?? '';

    // The boss: felled (and how fast), or still standing. The Abyss counts floors (§9).
    const b = s.boss;
    this.bossLine.hidden = b === null && s.abyss === null && s.rush === null;
    if (s.rush) {
      const n = s.rush.stages;
      this.bossLine.textContent = n > 0 ? `${n} of ${RUSH_STAGES} bosses fell.` : 'The first boss still stands.';
      this.bossLine.classList.toggle('is-first', s.rushRecord !== null);
    } else if (s.abyss) {
      const n = s.abyss.cleared;
      this.bossLine.textContent = n >= s.abyss.start ? `Down to floor ${n} of the Abyss.` : `Floor ${s.abyss.start} holds.`;
      this.bossLine.classList.toggle('is-first', s.floorRecord !== null || s.stratumRecord !== null);
    } else if (b) {
      const name = BOSS_BY_ID[b.id].name;
      this.bossLine.textContent = b.killedIn === null
        ? `${name} still stands.`
        : `${b.first ? 'Region cleared! ' : ''}${name} fell in ${formatDuration(b.killedIn)}.`;
      this.bossLine.classList.toggle('is-first', b.first);
    }

    // "New this run" (§7.3): records first, then what the run paid and opened up, then what it discovered.
    const fmtOver = (n: number): string => `+${formatNumber(n)}`;
    const records: HTMLElement[] = [];
    if (s.records.wave) records.push(gain('trophy', 'Best wave', recordTag(s.records.wave, formatNumber), 'record'));
    if (s.records.overtime) records.push(gain('trophy', 'Best overtime', recordTag(s.records.overtime, fmtOver), 'record'));
    if (s.records.shards) records.push(gain('trophy', 'Most shards', recordTag(s.records.shards, formatNumber), 'record'));

    const starlight = (n: number): string => `+${formatNumber(n)} ✦`;
    const rewards: HTMLElement[] = [];
    if (s.heatRecord) rewards.push(gain('round-star', `Heat record ${s.heatRecord.now}`, starlight(s.heatRecord.starlight), 'record'));
    if (s.floorRecord) rewards.push(gain('round-star', `Deepest floor ${s.floorRecord.now}`, starlight(s.floorRecord.starlight), 'record'));
    // A stratum's guardian, felled for the first time (plans/late-game/08): its lump, and its waypoint.
    if (s.stratumRecord) {
      const names = s.stratumRecord.felled.map((id) => BOSS_BY_ID[id].name).join(', ');
      rewards.push(gain('round-star', `${names} fell`, starlight(s.stratumRecord.starlight), 'unlock'));
      rewards.push(gain('star-gate', 'A waypoint opens on the Map', 'Unlocked', 'unlock'));
    }
    if (s.rushRecord) {
      const now = s.rushRecord.now;
      const what = now.time !== null ? `Boss Rush in ${formatDuration(now.time)}` : `Boss Rush: ${now.stages} bosses`;
      rewards.push(gain('round-star', what, starlight(s.rushRecord.starlight), 'record'));
    }
    // Overtime trophies (N4): a mark on the Map, a light on the tower, once.
    for (const t of s.trophies) rewards.push(gain('star-medal', `Overtime trophy +${t.overtime}`, `+${formatNumber(t.shards)} shards`, 'unlock'));
    if (s.foreman.length > 0) rewards.push(gain('shop', foremanLine(s.foreman), 'Foreman bought', 'unlock'));
    // A Trial (N5): won, and what it paid the first time; or what still stands.
    if (s.trial) {
      const t = s.trial;
      const name = TRIAL_BY_ID[t.id]?.name ?? t.id;
      rewards.push(t.won
        ? gain('checkered-flag', name, t.paid ? 'Trial won' : 'Won again', t.paid ? 'unlock' : 'feat', t.paid?.line ?? '')
        : gain('checkered-flag', name, 'Trial · not yet', 'miss'));
    }
    // A contract (plans/late-game/10 §2): what it paid, its rider and milestone, and the card in its place; or why not.
    const c = s.contract;
    if (c) {
      rewards.push(c.pay
        ? gain('wanted-reward', 'Contract done', contractPay(c.pay), 'unlock')
        : gain('wanted-reward', 'Contract not met', '', 'miss', c.why ?? 'not yet'));
      if (c.rider) rewards.push(gain('locked-chest', c.rider, 'Contract', 'relic'));
      if (c.milestone) rewards.push(gain('star-medal', c.milestone, 'Milestone', 'unlock'));
      if (c.next) rewards.push(gain('wanted-reward', c.next, 'New contract', 'feat'));
    }
    for (const u of s.unlocks) rewards.push(gain('star-gate', u, 'Unlocked', 'unlock'));
    for (const r of s.relics) rewards.push(this.relicGain(r));
    // Before the Feats tab opens, feats are earned quietly: the tab opens on the batch (§5.4).
    if (s.featsOpen) for (const f of s.feats) rewards.push(gain(f.icon, f.name, 'Feat', 'feat'));

    const finds: HTMLElement[] = [];
    // Final Form (plans/late-game/07): NEW on the frame's first, RECORD on an earlier wave.
    if (s.finalForm) {
      const f = s.finalForm;
      finds.push(gain('crown', `Final Form · wave ${f.wave}`, f.first ? 'New' : f.record ? 'Record' : '', 'find'));
    }
    const find = (e: ContentEntry, tag: string): HTMLElement => gain(e.icon, e.name, tag, 'find');
    for (const id of s.newRecipes) finds.push(find(EVOLUTION_BY_ID[id], 'New recipe'));
    for (const id of s.newFusions) finds.push(find(FUSION_BY_ID[id], 'New recipe'));
    for (const id of s.newEnemies) finds.push(find(ENEMY_BY_ID[id], 'New enemy'));
    // Secrets (plans/late-game/05): a find by name; a new riddle as "Written in the margin".
    for (const id of s.secrets?.found ?? []) finds.push(find(SECRET_BY_ID[id], 'Secret'));
    if (s.secrets?.heard && !s.secrets.found.includes(s.secrets.heard)) finds.push(gain('all-seeing-eye', 'Written in the margin', 'New riddle', 'find'));
    // An anomaly is a find only once taken (plans/late-game/04 §2); let go, it is told in Run details.
    for (const k of s.newCards) {
      if (k.startsWith('anomaly:') && !s.anomaly?.taken) continue;
      const e = cardEntry(k);
      if (e) finds.push(find(e, CARD_TAG[k.split(':')[0]] ?? 'New card'));
    }
    this.gains.replaceChildren(...records, ...rewards, ...finds);
    this.gains.parentElement!.hidden = this.gains.childElementCount === 0;

    setText(this.kills, formatNumber(s.kills));
    setText(this.time, formatDuration(s.time));
    const st = s.stored;
    setText(this.shardsN, formatNumber(s.shards + (st?.bonus ?? 0)));

    const goal = s.next;
    this.next.hidden = goal === null;
    if (goal) {
      this.nextIcon.replaceChildren(icon(goal.node.icon));
      setText(this.nextName, goal.node.name);
      setStyle(this.nextFill, 'transform', `scaleX(${goal.progress.toFixed(3)})`);
      setText(this.nextValue, goal.progress >= 1 ? 'Ready' : `${Math.floor(goal.progress * 100)}%`);
      this.next.classList.toggle('is-ready', goal.progress >= 1);
    }

    this.reportBody.replaceChildren(...this.details(s));
    this.report.hidden = true;
    this.reportBtn.setAttribute('aria-expanded', 'false');

    // Retry only for a contract not met; the auto-restart countdown never retries one (§2).
    this.retryId = s.contract && !s.contract.met ? s.contract.id : null;
    this.retry.hidden = this.retryId === null;
    this.showOmen(s);
    // Auto-restart never follows an Omen (plans/late-game/11 §2): Done returns to its view.
    this.countdown = autoRestart && !s.omen ? BALANCE.automation.restartSeconds : null;
    this.paused = false;
    this.paintAgain();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.countdown = null;
    this.countUp++;
  }

  /**
   * The back button: Run details' sheet closes first; else the screen is
   * left the way its hub button leaves it, never by starting another run.
   */
  back(): boolean {
    if (this.root.hidden) return false;
    if (!this.closeReport()) this.leave();
    return true;
  }

  /**
   * A relic's row: new, ranked up, or at its peak (feeding its set, or paid
   * in shards, or binding a cursed one, N6). A newly found cursed relic
   * (plans/late-game/03 §2) shows its curse and a Wear button in place of the
   * tag; it is never worn by itself.
   */
  private relicGain(r: RunSummary['relics'][number]): HTMLElement {
    const def = RELIC_BY_ID[r.id];
    const cursed = isCursed(def);
    let tag: string;
    let note = '';
    if (r.rank === 0) {
      tag = r.bound !== undefined ? 'Binding' : 'At its peak';
      note = r.bound !== undefined
        ? `${r.bound}/${BALANCE.cursed.bindAt}${r.bound >= BALANCE.cursed.bindAt ? ' · Bound' : ''}`
        : r.set ? `${r.set} grows` : `+${formatNumber(r.shards ?? 0)} shards`;
    } else {
      tag = r.rank === 1 ? (cursed ? 'New cursed relic' : 'New relic') : `Rank ${'I'.repeat(r.rank)}`;
    }
    if (cursed) note = [note, curseLine(def)].filter(Boolean).join(' · ');
    const wearable = cursed && r.rank === 1;
    if (wearable) note = `${tag} · ${note}`;
    const li = gain(def.icon, def.name, wearable ? '' : tag, 'relic', note);
    if (cursed) li.querySelector('.results-gain-note')?.classList.add('is-curse');
    if (wearable) {
      const wear = document.createElement('button');
      wear.type = 'button';
      wear.className = 'btn btn-sm results-wear';
      wear.textContent = 'Wear';
      wear.addEventListener('click', () => this.onWear(r.id, (worn) => {
        wear.textContent = worn ? 'Worn' : 'Wear';
        wear.disabled = worn;
      }));
      li.querySelector('.results-gain-tag')!.replaceChildren(wear);
    }
    return li;
  }

  /**
   * Run details' sheet: where the shards came from (with Stored Light's pay,
   * plans/late-game/01 §2), the build (U5), what dealt the damage and what
   * wore the tower down, and what came and went along the way (rifts,
   * reliquaries, a let-go anomaly).
   */
  private details(s: RunSummary): HTMLElement[] {
    const section = (title: string, ...nodes: HTMLElement[]): HTMLElement[] => {
      const h = document.createElement('h3');
      h.className = 'results-report-head';
      h.textContent = title;
      return [h, ...nodes];
    };
    const p = (cls: string, text: string): HTMLElement => {
      const el = document.createElement('p');
      el.className = cls;
      el.textContent = text;
      return el;
    };

    // Where the shards came from: inset rows, a source and its figure each.
    const st = s.stored;
    const f = s.shardsFrom;
    const parts: [string, number][] = [['Kills', f.kills], ['Waves', f.waves]];
    if (f.elites > 0) parts.push(['Elites', f.elites]);
    if (f.boss > 0) parts.push(['Boss', f.boss]);
    if (f.cards > 0) parts.push(['Cards', f.cards]);
    if (f.rifts > 0) parts.push(['Rifts', f.rifts]);
    if (st) parts.push(['Stored Light', st.bonus]);
    const breakdown = document.createElement('dl');
    breakdown.className = 'results-breakdown inset';
    breakdown.append(...parts.map(([label, n]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = formatNumber(n);
      row.append(dt, dd);
      return row;
    }));
    const shards = s.omen ? [] : section('Shards', breakdown);
    if (st) {
      const played = st.engagedBonus > 0 ? ` · ×${st.rate} played` : '';
      shards.push(p('results-stored', `Stored Light${played} · ${formatNumber(st.left)} left`));
    }

    const taken = tallyBars(takenRows(s), 'Damage taken');
    taken.classList.add('is-taken');
    const tookNone = takenRows(s).every((r) => r.value === 0);

    // Along the way: rifts (plans/late-game/02 §2), reliquaries faded (03 §2, a count, not a scolding),
    // and an anomaly let go (04 §2: no timer, no cost, it can come again).
    const along: HTMLElement[] = [];
    const rifts = riftLine(s.rifts);
    if (rifts) along.push(p('results-along', rifts));
    const faded = s.reliquaries.faded;
    if (faded > 0) along.push(p('results-along', `${faded} reliquar${faded === 1 ? 'y' : 'ies'} faded.`));
    const gone = s.anomaly && !s.anomaly.taken ? ANOMALY_BY_ID[s.anomaly.id] : null;
    if (gone) along.push(p('results-along', `An anomaly came and went: ${gone.name}.`));

    return [
      ...shards,
      ...section('Build', buildList(s.build)),
      ...section('Damage dealt', tallyBars(dealtRows(s), 'Damage dealt')),
      ...section('What wore it down', tookNone ? p('tactics-empty', 'Nothing touched the tower.') : taken),
      ...(along.length > 0 ? section('Along the way', ...along) : []),
    ];
  }

  /**
   * The hero: `n` counted up from zero over 420ms (snapped under reduced
   * motion), or `text` as it is, with its label under it.
   */
  private hero(n: number | null, text: string, label: string): void {
    setText(this.heroL, label);
    const run = ++this.countUp;
    if (n === null) {
      setText(this.heroN, text);
      return;
    }
    if (motionReduced() || n <= 0) {
      setText(this.heroN, formatNumber(n));
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      if (run !== this.countUp) return;
      const t = Math.min(1, (now - start) / COUNT_UP_MS);
      // Decelerate: quick to start, settling on the figure.
      const eased = 1 - (1 - t) ** 3;
      setText(this.heroN, formatNumber(Math.round(n * eased)));
      if (t < 1) requestAnimationFrame(step);
    };
    setText(this.heroN, '0');
    requestAnimationFrame(step);
  }

  /** The Omen's block (plans/late-game/11 §2): the day, the score and its band, the pay, and Copy result. */
  private showOmen(s: RunSummary): void {
    const o = s.omen;
    this.omen.hidden = o === null;
    this.shards.hidden = o !== null;
    this.again.hidden = o !== null;
    if (o === null) return;
    this.next.hidden = true;
    this.hubBtn.textContent = 'Done';
    this.omenLine = o.line;
    const q = (sel: string): HTMLElement => this.omen.querySelector<HTMLElement>(sel)!;
    setText(q('.results-omen-head'), `${o.practice ? 'Practice' : 'Omen'} · ${o.label} · ${regionByIndex(o.region).name}`);
    setText(q('.results-omen-wave'), `Wave ${o.wave} · ${digits(o.kills)} slain`);
    setText(q('.results-omen-band'), bandDots(o.band));
    const pay = q('.results-omen-pay');
    pay.hidden = o.starlight <= 0 && o.trims.length === 0;
    setText(pay, [o.starlight > 0 ? `+${formatNumber(o.starlight)} ✦ Starlight` : '', ...o.trims.map((t) => `Tower trim: ${t}`)].filter(Boolean).join(' · '));
    const note = !o.practice
      ? 'This is the day’s score.'
      : o.standing
        ? `Practice · the day’s score stays wave ${o.standing.wave}.${o.best ? ` Practice best: wave ${o.best.wave}.` : ''}`
        : `Practice · it pays nothing.${o.best ? ` Practice best: wave ${o.best.wave}.` : ''}`;
    setText(q('.results-omen-note'), note);
  }

  /** Run the auto-restart countdown on the wall clock. */
  tick(realDt: number): void {
    if (this.countdown === null || this.paused || this.root.hidden || !this.report.hidden) return;
    this.countdown = Math.max(0, this.countdown - realDt);
    this.paintAgain();
    if (this.countdown === 0) {
      this.countdown = null;
      this.onAgain();
    }
  }

  /** Auto-restart's countdown is a ring on the primary button, draining to the restart. */
  private paintAgain(): void {
    const c = this.countdown;
    this.againRing.toggleAttribute('hidden', c === null);
    this.hold.hidden = c === null;
    setText(this.againLabel, 'Run again');
    if (c === null) {
      this.again.removeAttribute('aria-label');
      return;
    }
    this.againFill.setAttribute('stroke-dashoffset', (100 * (1 - c / BALANCE.automation.restartSeconds)).toFixed(1));
    this.again.classList.toggle('is-held', this.paused);
    setAriaLabel(this.again, this.paused ? 'Run again, countdown paused' : `Run again, starting in ${Math.ceil(c)}`);
    const want = this.paused ? 'resume' : 'pause';
    if (this.hold.dataset.state !== want) {
      this.hold.dataset.state = want;
      this.hold.innerHTML = iconMarkup(this.paused ? 'io-play' : 'io-pause', { size: 20 });
      setAriaLabel(this.hold, this.paused ? 'Resume the countdown' : 'Pause the countdown');
      this.hold.setAttribute('aria-pressed', String(this.paused));
    }
  }
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five'];

/** The identity's count-up duration (plans/visual-identity.md §2.6). */
const COUNT_UP_MS = 420;

/** The results' rift line, or null when the run met none (plans/late-game/02 §2). */
export function riftLine(rifts: RunSummary['rifts']): string | null {
  if (rifts.length === 0) return null;
  const parts: string[] = [];
  for (const r of rifts) {
    if (!r.tapped) continue;
    parts.push(`${RIFT_BY_ID[r.id].name} ${r.choice === null ? 'left' : 'taken'}`);
  }
  const unseen = rifts.filter((r) => !r.tapped).length;
  if (unseen > 0) parts.push(`${COUNT_WORDS[unseen] ?? unseen} closed unseen`);
  return `Rifts · ${parts.join(' · ')}`;
}
