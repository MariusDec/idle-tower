/**
 * The idle bot (§13): the same real sim as the pacing report, played the way
 * an idle player plays it, to check I2 and I5 (§8.4).
 *
 * The check-in schedule. Two check-ins a day, `CHECKIN_EVERY` apart. Each one:
 *   1. offline earnings for the time away (§6.3)
 *   2. the chores: claim feats, shop cheapest-first, go to the frontier,
 *      the fastest speed
 *   3. a session of `SESSION` wall seconds with the hands off: drafts run
 *      their timers out onto the suggestion, the ultimate only through the
 *      Autocaster. Before Auto-restart the player still taps Run again
 *      (and shops while there); after it, runs follow each other, and
 *      Frontier March moves them on after a boss's first fall
 *   4. the app closes mid-run: the run resumes from its last wave-start
 *      snapshot at the next check-in (§12.4), as the app would
 *
 * Stored Light (plans/late-game/01 §6): offline pays its instant part to
 * shards and its stored part to the pool, and every banked run burns it.
 * A bot plays a whole run under one policy, so an `active` run's base shards
 * are all played and an `idle` run's all left alone. `mode: 'engaged'` keeps
 * the same schedule and chores but plays each session with the `active`
 * policy and shops between runs: I7 compares its screen time with the
 * hands-off bot's.
 *
 * I5 compares the two players at the *same* Forge state: from checkpoints of
 * the active pacing run, each policy plays a batch of runs on a copy of the
 * profile (no shopping) and the shards per wall hour are divided.
 */
import { createRun } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { BALANCE } from '../src/content/balance';
import { BOSSES, BOSS_BY_ID } from '../src/content/bosses';
import { Rng } from '../src/core/rng';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { newProfile, type Profile } from '../src/meta/profile';
import { migrate, type RawProfile } from '../src/meta/save/migrate';
import { starsLit } from '../src/meta/stars';
import { autoUlt, automations, draftSeconds, marchOn, openingSeconds, runSpeed } from '../src/meta/automation';
import { bankRun } from '../src/meta/results';
import { heldBeat } from '../src/meta/runConfig';
import { formCount } from '../src/sim/systems/form';
import { frontier, hubUnlocks } from '../src/meta/collection';
import { claimAll } from '../src/meta/feats';
import { offlineEarnings } from '../src/meta/offline';
import type { ActiveOnlyKind } from '../src/meta/results';
import type { BurnTally } from '../src/meta/storedLight';
import { FAST_STEPS, playRun, snapshotOf, type PlayPolicy, toolConfig } from './play';
import { shop } from './shop';

/** Hours between check-ins: two a day. */
export const CHECKIN_EVERY = 12 * 3600;
/** Wall seconds of each check-in's session. */
export const SESSION = 20 * 60;
/** Wall seconds a present player takes to tap Run again (before Auto-restart). */
const MANUAL_RESTART = 10;
/** Wall seconds between an active player's runs: the results, a glance at the Forge. */
const ACTIVE_BETWEEN = 6;

/** How the check-in sessions are played: hands off (today's idle bot), or engaged with the `active` policy. */
export type IdleMode = 'hands-off' | 'engaged';

export interface IdleReport {
  mode: IdleMode;
  /** Wall seconds since the first check-in when each boss first fell. */
  bossKills: Record<string, number>;
  /** Session wall seconds (screen time) summed up to each boss's first fall (I7). */
  screen: Record<string, number>;
  /** Shards offline paid, in all: the instant part. */
  offline: number;
  /** Shards offline stored as Stored Light, in all. */
  stored: number;
  /** Shards Stored Light paid out to runs, in all. */
  burned: number;
  /** The pool when the bot stopped. */
  poolAtEnd: number;
  /** Stars lit when the bot stopped (plans/late-game/12 §10.2: the idle bot buys none, so 0 unless a start had some). */
  stars: number;
  /** The run tallies' totals: I9 holds `engaged` at 0 for the hands-off bot. */
  tally: BurnTally;
  /** Every run's `RunSummary.activeOnly`, summed by kind (I9). */
  activeOnly: Partial<Record<ActiveOnlyKind, number>>;
  /** Shards rifts paid, reported apart (plans/late-game/02 §8: I5, I7). */
  riftShards: number;
  /** Reliquaries that faded (plans/late-game/03 §9): the hands-off bot claims none, so all it meets fade. */
  reliquariesFaded: number;
  /** Anomalies dealt into a hand, and taken (plans/late-game/04 §9): the hands-off bot takes none, so I9 isn't vacuous only while some are offered. */
  anomalies: { offered: number; taken: number };
  /**
   * Final Form (plans/late-game/07 §8), by region index: runs banked, runs
   * that could form (`need` > 0), runs that formed, and the waves they formed at.
   */
  forms: Record<number, { runs: number; could: number; formed: number; waves: number[]; evolved: number[]; recipes: number }>;
  /** Shards runs paid, in all. */
  played: number;
  checkins: number;
  runs: number;
}

/** The chores at a check-in, or between manual runs. */
function chores(profile: Profile): void {
  if (hubUnlocks(profile).feats) claimAll(profile);
  profile.region = frontier(profile).index;
  shop(profile);
}

/** A whole run's base shards, in the bucket its policy plays: the bot never switches mid-run. */
export function tallyOf(policy: PlayPolicy, shards: number): BurnTally {
  return policy === 'active' ? { engaged: shards, handsOff: 0 } : { engaged: 0, handsOff: shards };
}

/** The Act 1 finale, whose first fall `runIdle`'s `onFinale` marks. */
const FINALE = BOSSES.find((b) => b.finale)!.id;

/**
 * A fresh profile (or a copy of `start`), played by the idle schedule until
 * every boss in `bosses` has fallen or `days` pass. `onFinale` is handed a
 * copy of the profile once the run the Blight first fell in is banked (its
 * trophy and pay in), with the wall seconds then; the bot doesn't stop
 * before that run is banked.
 */
export function runIdle(
  days: number, seed: number, bosses: readonly string[] = Object.keys(BOSS_BY_ID), mode: IdleMode = 'hands-off',
  start?: Profile, onFinale?: (profile: Profile, at: number) => void,
): IdleReport {
  const profile = start ? structuredClone(start) : newProfile(0);
  /** The finale fell in a run not yet banked (only tracked for `onFinale`). */
  let finaleUnbanked = false;
  const seeds = new Rng(seed);
  const policy: PlayPolicy = mode === 'engaged' ? 'active' : 'idle';
  const report: IdleReport = {
    mode, bossKills: {}, screen: {}, offline: 0, stored: 0, burned: 0, poolAtEnd: 0, stars: 0,
    tally: { engaged: 0, handsOff: 0 }, activeOnly: {}, riftShards: 0, reliquariesFaded: 0, anomalies: { offered: 0, taken: 0 }, forms: {}, played: 0, checkins: 0, runs: 0,
  };
  /** Session wall seconds before this check-in's. */
  let screenBefore = 0;
  const end = days * 86400;
  /** The run the app was closed in, as its last wave-start snapshot. */
  let pending: RunState | null = null;
  let lastSeen = 0;
  for (let checkin = 0; checkin < end; checkin += CHECKIN_EVERY) {
    report.checkins++;
    const earned = offlineEarnings(profile, checkin - lastSeen);
    if (earned) {
      profile.shards += earned.shards;
      profile.storedLight += earned.stored;
      report.offline += earned.shards;
      report.stored += earned.stored;
    }
    chores(profile);
    let clock = checkin;
    const close = checkin + SESSION;
    while (clock < close) {
      const run = pending ?? createRun(toolConfig(profile), seeds.nextU32());
      pending = null;
      let snap = snapshotOf(run);
      const speed = runSpeed(profile);
      const runStart = clock;
      const played = playRun(profile, run, {
        policy,
        speed,
        autoUlt: autoUlt(profile),
        draftSeconds: draftSeconds(profile),
        openingSeconds: openingSeconds(profile),
        until: close - clock,
        onWave: (r) => { snap = snapshotOf(r); },
        onEvent: (ev, wall) => {
          if (ev.kind === 'bossKill' && ev.first && !(ev.boss in report.bossKills)) {
            report.bossKills[ev.boss] = runStart + wall;
            report.screen[ev.boss] = screenBefore + (runStart - checkin) + wall;
            if (onFinale && ev.boss === FINALE) finaleUnbanked = true;
          }
        },
      });
      clock += played.wall;
      if (!run.outcome) {
        // The session ends mid-run; the app comes back to its snapshot.
        pending = snap;
        break;
      }
      const tally = tallyOf(policy, run.shards);
      const summary = bankRun(profile, run, played.newCards, speed, tally);
      report.runs++;
      report.played += summary.shards;
      report.tally.engaged += tally.engaged;
      report.tally.handsOff += tally.handsOff;
      report.burned += summary.stored?.bonus ?? 0;
      for (const a of summary.activeOnly) report.activeOnly[a.kind] = (report.activeOnly[a.kind] ?? 0) + a.amount;
      // I9 (plans/late-game/02 §8): the hands-off bot never opens a rift. A hard fail.
      if (policy === 'idle' && (run.shardsFrom.rifts > 0 || run.riftLog.some((e) => e.tapped))) {
        throw new Error('I9: the hands-off bot opened a rift');
      }
      // I9 (plans/late-game/03 §9): nor claims a reliquary. A hard fail.
      if (policy === 'idle' && run.reliquariesClaimed > 0) throw new Error('I9: the hands-off bot claimed a reliquary');
      // I9 (plans/late-game/04 §9): nor takes an anomaly. A hard fail.
      if (policy === 'idle' && run.anomaly?.taken) throw new Error('I9: the hands-off bot took an anomaly');
      // I9 (plans/late-game/05 §2): nor finds the Wayward Banner, which only picks of one's own earn. A hard fail.
      if (policy === 'idle' && run.secrets?.fresh.includes('wayward')) throw new Error('I9: the hands-off bot found the Wayward Banner');
      // I9 (plans/late-game/10 §4.7): the Contract board is active-only: no run of this bot is ever one. A hard fail.
      if (run.contract !== null || profile.contracts.done > 0 || summary.contract !== null) {
        throw new Error('I9: an idle-bot run settled a contract');
      }
      const f = (report.forms[run.regionId] ??= { runs: 0, could: 0, formed: 0, waves: [], evolved: [0, 0, 0, 0], recipes: 0 });
      f.runs++;
      f.evolved[Math.min(3, formCount(run))]++;
      f.recipes = Math.max(f.recipes, run.recipes.length);
      if (run.form.need > 0) f.could++;
      if (run.form.wave !== null) {
        f.formed++;
        f.waves.push(run.form.wave);
      }
      if (run.anomaly?.offered) report.anomalies.offered++;
      if (run.anomaly?.taken) report.anomalies.taken++;
      report.riftShards += run.shardsFrom.rifts;
      report.reliquariesFaded += summary.reliquaries.faded;
      marchOn(profile, summary);
      if (finaleUnbanked) {
        finaleUnbanked = false;
        onFinale!(structuredClone(profile), clock);
      }
      if (mode === 'engaged') {
        // A present player looks over the results and shops between runs, as the pacing bot does.
        clock += ACTIVE_BETWEEN;
        chores(profile);
      } else if (automations(profile).has('auto-restart')) {
        clock += BALANCE.automation.restartSeconds;
      } else {
        clock += MANUAL_RESTART;
        chores(profile);
      }
    }
    lastSeen = Math.min(clock, close);
    screenBefore += lastSeen - checkin;
    if (bosses.every((b) => b in report.bossKills) && !finaleUnbanked) break;
  }
  report.poolAtEnd = profile.storedLight;
  report.stars = starsLit(profile);
  // …nor wears a trim its milestones pay (plans/late-game/10 §9).
  if (profile.contracts.done !== 0 || profile.contracts.taken !== null) throw new Error('I9: the idle bot touched the Contract board');
  return report;
}

export interface FarmRate {
  /** Shards per wall hour, first-kill boss bonuses left out. */
  perHour: number;
  runs: number;
  /** Median wall seconds a run's Opening held it (U2); 0 when no run opened on banked drafts. */
  opening: number;
}

/**
 * Shards per wall hour for `policy` at this Forge state: `n` runs, each on a
 * copy of `profile`, nothing bought between them. A first boss kill's bonus
 * is left out, so one lucky kill doesn't decide the comparison; a held rift
 * owed is taken as met, or every copy would meet it.
 */
export function farmRate(profile: Profile, policy: PlayPolicy, n: number, seed: number): FarmRate {
  const seeds = new Rng(seed);
  let shards = 0;
  let wall = 0;
  const openings: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = structuredClone(profile);
    // I5 measures run efficiency alone: no pool, so no burn.
    p.storedLight = 0;
    // A region's held rift (R2 §2–3) comes once in its life, as a first kill does: met, it joins the draw.
    const beat = heldBeat(p);
    if (beat) p.rifts[beat] = { glimpsed: 1, seen: 0, taken: [] };
    const speed = runSpeed(p);
    const run = createRun(toolConfig(p), seeds.nextU32());
    const played = playRun(p, run, {
      policy, speed, autoUlt: autoUlt(p), draftSeconds: draftSeconds(p), openingSeconds: openingSeconds(p),
    });
    openings.push(played.opening ?? 0);
    const summary = bankRun(p, run, played.newCards, speed);
    shards += summary.shards - (summary.boss?.first ? summary.shardsFrom.boss : 0);
    const between = policy === 'active'
      ? ACTIVE_BETWEEN
      : automations(p).has('auto-restart') ? BALANCE.automation.restartSeconds : MANUAL_RESTART;
    wall += played.wall + between;
  }
  openings.sort((a, b) => a - b);
  return { perHour: shards / (wall / 3600), runs: n, opening: openings[openings.length >> 1] ?? 0 };
}

/** I5's reading at one Forge state: active shards per hour over idle. */
export function farmRatio(profile: Profile, n: number, seed: number): { active: number; idle: number; ratio: number; opening: number } {
  const active = farmRate(profile, 'active', n, seed).perHour;
  const idle = farmRate(profile, 'idle', n, seed);
  return { active, idle: idle.perHour, ratio: active / Math.max(1e-9, idle.perHour), opening: idle.opening };
}

/** A profile at the Blight's first fall, for the Wake's idle reading (plans/late-game/12a W9): `at` in wall seconds. */
export interface IdleStart {
  at: number;
  profile: Profile;
}

/** Where `--idle --wake --make-starts` keeps each seed's idle profile at the Blight's fall. */
export const IDLE_STARTS = 'node_modules/.tmp/idle-starts';

/** A seed's idle start file; a --fast start is kept apart, so a full reading never uses one. */
export function idleStartFile(seed: number, dir = IDLE_STARTS): string {
  return `${dir}/seed-${seed}${FAST_STEPS > 1 ? `-fast${FAST_STEPS}` : ''}.json`;
}

export function saveIdleStart(file: string, start: IdleStart): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(start));
}

/** A saved start, walked up the save ladder (an older build may have written it); null if there is none. */
export function loadIdleStart(file: string): IdleStart | null {
  if (!existsSync(file)) return null;
  const saved = JSON.parse(readFileSync(file, 'utf8')) as { at: number; profile: RawProfile };
  return { at: saved.at, profile: migrate(saved.profile) as unknown as Profile };
}
