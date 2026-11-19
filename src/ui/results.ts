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

/** Final Form's chip (plans/late-game/07): "Final Form · wave 17", tagged NEW on the frame's first, RECORD on an earlier wave. */
function formFind(form: { wave: number; first: boolean; record: boolean }): HTMLElement {
  const el = document.createElement('li');
  el.className = 'results-find is-form';
  const tag = form.first ? 'New' : form.record ? 'Record' : '';
  if (tag) el.dataset.tag = tag;
  el.setAttribute('aria-label', `Final Form at wave ${form.wave}${tag ? `, ${tag.toLowerCase()}` : ''}`);
  el.append(icon('crown'));
  const name = document.createElement('span');
  name.textContent = `Final Form · wave ${form.wave}`;
  el.append(name);
  return el;
}

/**
 * The results screen (§4.6). One screen, no scrolling on mobile, no failure
 * language: the wave, the haul (tap for the breakdown), records with the old
 * value struck through, what was discovered, and one "Next:" line. Two
 * buttons, Forge and Run again; once auto-restart is owned, Run again fires
 * itself after a short countdown, which a pause button beside it holds. The build shows (U5), and behind a tap
 * the damage each weapon dealt and what wore the tower down; the countdown
 * waits while that is open.
 */
/** What a met contract paid (plans/late-game/10 §2): "Contract done · ✦ 8 · 2.0M". */
function contractLine(c: NonNullable<RunSummary['contract']>): string {
  if (!c.pay) return `Contract not met: ${c.why ?? 'not yet'}`;
  const star = c.pay.starlight > 0 ? ` · ✦ ${formatNumber(c.pay.starlight)}` : '';
  return `Contract done${star} · ${formatNumber(c.pay.shards)} shards`;
}

/** What became of a Trial (N5), in one line. */
function trialLine(t: NonNullable<RunSummary['trial']>): string {
  const name = TRIAL_BY_ID[t.id]?.name ?? t.id;
  if (!t.won) return `Trial: ${name} · not yet`;
  return t.paid ? `Trial won: ${name} · ${t.paid.line}` : `Trial won again: ${name}`;
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

export class ResultsScreen {
  private readonly root: HTMLElement;
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
  private readonly rewards: HTMLElement;
  private readonly records: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly time: HTMLElement;
  private readonly shards: HTMLButtonElement;
  private readonly shardsN: HTMLElement;
  private readonly breakdown: HTMLElement;
  private readonly storedLine: HTMLElement;
  /** The Daily Omen's block (plans/late-game/11 §2), in place of the shards. */
  private readonly omen: HTMLElement;
  private omenLine = '';
  private readonly riftLine: HTMLElement;
  private readonly reliquaryLine: HTMLElement;
  /** "An anomaly came and went" (plans/late-game/04 §2): no timer, no cost, it can come again. */
  private readonly anomalyLine: HTMLElement;
  private readonly finds: HTMLElement;
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
  private readonly build: HTMLElement;
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
      <section class="results-section" hidden><h3 class="section-head">Rewards</h3><ul class="results-rewards"></ul></section>
      <section class="results-section" hidden><h3 class="section-head">Records</h3><ul class="results-records"></ul></section>
      <div class="results-stats">
        <div><span class="results-stat-n results-kills"></span><span class="results-stat-l">Kills</span></div>
        <div><span class="results-stat-n results-time"></span><span class="results-stat-l">Held</span></div>
        <button type="button" class="results-shards" aria-expanded="false">
          <span class="results-stat-n">${iconMarkup('io-diamond')}<span class="results-shards-n"></span></span>
          <span class="results-stat-l">Shards</span>
        </button>
      </div>
      <div class="results-omen" hidden>
        <p class="results-omen-head"></p>
        <p class="results-omen-score"><span class="results-omen-wave"></span><span class="results-omen-band"></span></p>
        <p class="results-omen-pay"></p>
        <p class="results-omen-note"></p>
        <button type="button" class="btn results-omen-copy">Copy result</button>
      </div>
      <p class="results-stored" hidden></p>
      <p class="results-rifts" hidden></p>
      <p class="results-rifts results-reliquaries" hidden></p>
      <p class="results-rifts results-anomaly" hidden></p>
      <dl class="results-breakdown inset" hidden></dl>
      <section class="results-section" hidden><h3 class="section-head">Discoveries</h3><ul class="results-finds"></ul></section>
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
    this.rewards = q('.results-rewards');
    this.records = q('.results-records');
    this.kills = q('.results-kills');
    this.time = q('.results-time');
    this.shards = q('.results-shards');
    this.shardsN = q('.results-shards-n');
    this.breakdown = q('.results-breakdown');
    this.storedLine = q('.results-stored');
    this.omen = q('.results-omen');
    const copy = q<HTMLButtonElement>('.results-omen-copy');
    copy.addEventListener('click', () => {
      void this.onCopy(this.omenLine).then((ok) => {
        copy.textContent = ok ? 'Copied' : 'Couldn’t copy';
        window.setTimeout(() => { copy.textContent = 'Copy result'; }, 1600);
      });
    });
    this.riftLine = q('.results-rifts');
    this.reliquaryLine = q('.results-reliquaries');
    this.anomalyLine = q('.results-anomaly');
    this.finds = q('.results-finds');
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
    // A stratum's guardian, felled for the first time (plans/late-game/08): its lump, and its waypoint.
    if (s.stratumRecord) {
      const names = s.stratumRecord.felled.map((id) => BOSS_BY_ID[id].name).join(', ');
      starlight.push(reward('round-star', `${names} fell · +${formatNumber(s.stratumRecord.starlight)} Starlight`, 'unlock'));
      starlight.push(reward('star-gate', 'A waypoint opens on the Map', 'unlock'));
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
      // A contract (plans/late-game/10 §2): what it paid, its rider and milestone, and the card in its place; or why not.
      ...(s.contract ? [reward('wanted-reward', contractLine(s.contract), s.contract.pay ? 'unlock' : 'feat')] : []),
      ...(s.contract?.rider ? [reward('locked-chest', s.contract.rider, 'relic')] : []),
      ...(s.contract?.milestone ? [reward('star-medal', s.contract.milestone, 'unlock')] : []),
      ...(s.contract?.next ? [reward('wanted-reward', `New contract: ${s.contract.next}`, 'feat')] : []),
      ...s.unlocks.map((u) => reward('star-gate', u, 'unlock')),
      ...s.relics.map((r) => {
        const def = RELIC_BY_ID[r.id];
        const peak = r.bound !== undefined
          ? `binding ${r.bound}/${BALANCE.cursed.bindAt}${r.bound >= BALANCE.cursed.bindAt ? ' · Bound' : ''}`
          : r.set ? `at its peak · ${r.set} grows` : `at its peak · +${formatNumber(r.shards ?? 0)} shards`;
        const rank = r.rank === 0 ? peak : r.rank === 1 ? (isCursed(def) ? 'new cursed relic' : 'new relic') : `rank ${'I'.repeat(r.rank)}`;
        const li = reward(def.icon, `${def.name} · ${rank}`, 'relic');
        // A cursed relic (plans/late-game/03 §2): its curse, and a Wear button; never worn by itself.
        if (isCursed(def)) {
          const curse = document.createElement('span');
          curse.className = 'entry-curse';
          curse.textContent = ` ${curseLine(def)}`;
          li.append(curse);
          if (r.rank === 1) {
            const wear = document.createElement('button');
            wear.type = 'button';
            wear.className = 'btn results-wear';
            wear.textContent = 'Wear';
            wear.addEventListener('click', () => this.onWear(r.id, (worn) => {
              wear.textContent = worn ? 'Worn' : 'Wear';
              wear.disabled = worn;
            }));
            li.append(wear);
          }
        }
        return li;
      }),
      // Before the Feats tab opens, feats are earned quietly: the tab opens on the batch (§5.4).
      ...(s.featsOpen ? s.feats : []).map((f) => reward(f.icon, `Feat: ${f.name}`, 'feat')),
    );
    this.rewards.parentElement!.hidden = this.rewards.childElementCount === 0;

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
    this.records.parentElement!.hidden = this.records.childElementCount === 0;

    setText(this.kills, formatNumber(s.kills));
    setText(this.time, formatDuration(s.time));
    const st = s.stored;
    setText(this.shardsN, formatNumber(s.shards + (st?.bonus ?? 0)));
    // Stored Light (plans/late-game/01 §2): what the pool paid, at what rate, and what is left.
    this.storedLine.hidden = st === null;
    if (st) {
      const played = st.engagedBonus > 0 ? ` · ×${st.rate} played` : '';
      setText(this.storedLine, `Stored Light +${formatNumber(st.bonus)}${played} · ${formatNumber(st.left)} left`);
    }
    // Rifts (plans/late-game/02 §2): "Rifts · Wager taken · one closed unseen".
    const line = riftLine(s.rifts);
    this.riftLine.hidden = line === null;
    if (line) setText(this.riftLine, line);
    // Reliquaries (plans/late-game/03 §2): a count, not a scolding.
    const faded = s.reliquaries.faded;
    this.reliquaryLine.hidden = faded === 0;
    if (faded > 0) setText(this.reliquaryLine, `${faded} reliquar${faded === 1 ? 'y' : 'ies'} faded.`);
    const gone = s.anomaly && !s.anomaly.taken ? ANOMALY_BY_ID[s.anomaly.id] : null;
    this.anomalyLine.hidden = gone === null;
    if (gone) setText(this.anomalyLine, `An anomaly came and went: ${gone.name}.`);
    // Where the shards came from: inset rows, a source and its figure each.
    const f = s.shardsFrom;
    const parts: [string, number][] = [['Kills', f.kills], ['Waves', f.waves]];
    if (f.elites > 0) parts.push(['Elites', f.elites]);
    if (f.boss > 0) parts.push(['Boss', f.boss]);
    if (f.cards > 0) parts.push(['Cards', f.cards]);
    if (f.rifts > 0) parts.push(['Rifts', f.rifts]);
    if (st) parts.push(['Stored', st.bonus]);
    this.breakdown.replaceChildren(...parts.map(([label, n]) => {
      const row = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = formatNumber(n);
      row.append(dt, dd);
      return row;
    }));
    this.breakdown.hidden = true;
    this.shards.setAttribute('aria-expanded', 'false');

    this.finds.replaceChildren(
      ...(s.finalForm ? [formFind(s.finalForm)] : []),
      ...s.newRecipes.map((id) => chip(EVOLUTION_BY_ID[id], 'recipe')),
      ...s.newFusions.map((id) => chip(FUSION_BY_ID[id], 'recipe')),
      ...s.newEnemies.map((id) => chip(ENEMY_BY_ID[id], 'enemy')),
      // Secrets (plans/late-game/05): a find by name; a new riddle as "Written in the margin".
      ...(s.secrets?.found ?? []).map((id) => chip(SECRET_BY_ID[id], 'secret')),
      ...(s.secrets?.heard && !s.secrets.found.includes(s.secrets.heard)
        ? [chip({ id: 'margin', name: 'Written in the margin', icon: 'all-seeing-eye', text: '' }, 'whisper')] : []),
      // An anomaly is a find only once taken (plans/late-game/04 §2); let go, it has its own line.
      ...s.newCards.filter((k) => !k.startsWith('anomaly:') || s.anomaly?.taken)
        .map(cardEntry).filter((e): e is ContentEntry => e !== null).map((e) => chip(e, 'card')),
    );
    this.finds.parentElement!.hidden = this.finds.childElementCount === 0;

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
