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
 * I5 compares the two players at the *same* Forge state: from checkpoints of
 * the active pacing run, each policy plays a batch of runs on a copy of the
 * profile (no shopping) and the shards per wall hour are divided.
 */
import { createRun } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { BALANCE } from '../src/content/balance';
import { BOSS_BY_ID } from '../src/content/bosses';
import { Rng } from '../src/core/rng';
import { buildRunConfig } from '../src/meta/runConfig';
import { newProfile, type Profile } from '../src/meta/profile';
import { autoUlt, automations, draftSeconds, marchOn, openingSeconds, runSpeed } from '../src/meta/automation';
import { bankRun } from '../src/meta/results';
import { frontier, hubUnlocks } from '../src/meta/collection';
import { claimAll } from '../src/meta/feats';
import { offlineEarnings } from '../src/meta/offline';
import { playRun, snapshotOf, type PlayPolicy } from './play';
import { shop } from './shop';

/** Hours between check-ins: two a day. */
export const CHECKIN_EVERY = 12 * 3600;
/** Wall seconds of each check-in's session. */
export const SESSION = 20 * 60;
/** Wall seconds a present player takes to tap Run again (before Auto-restart). */
const MANUAL_RESTART = 10;
/** Wall seconds between an active player's runs: the results, a glance at the Forge. */
const ACTIVE_BETWEEN = 6;

export interface IdleReport {
  /** Wall seconds since the first check-in when each boss first fell. */
  bossKills: Record<string, number>;
  /** Shards offline paid, in all. */
  offline: number;
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

/**
 * A fresh profile, played by the idle schedule until every boss in `bosses`
 * has fallen or `days` pass.
 */
export function runIdle(days: number, seed: number, bosses: readonly string[] = Object.keys(BOSS_BY_ID)): IdleReport {
  const profile = newProfile(0);
  const seeds = new Rng(seed);
  const report: IdleReport = { bossKills: {}, offline: 0, played: 0, checkins: 0, runs: 0 };
  const end = days * 86400;
  /** The run the app was closed in, as its last wave-start snapshot. */
  let pending: RunState | null = null;
  let lastSeen = 0;
  for (let checkin = 0; checkin < end; checkin += CHECKIN_EVERY) {
    report.checkins++;
    const earned = offlineEarnings(profile, checkin - lastSeen);
    if (earned) {
      profile.shards += earned.shards;
      report.offline += earned.shards;
    }
    chores(profile);
    let clock = checkin;
    const close = checkin + SESSION;
    while (clock < close) {
      const run = pending ?? createRun(buildRunConfig(profile), seeds.nextU32());
      pending = null;
      let snap = snapshotOf(run);
      const speed = runSpeed(profile);
      const start = clock;
      const played = playRun(profile, run, {
        policy: 'idle',
        speed,
        autoUlt: autoUlt(profile),
        draftSeconds: draftSeconds(profile),
        openingSeconds: openingSeconds(profile),
        until: close - clock,
        onWave: (r) => { snap = snapshotOf(r); },
        onEvent: (ev, wall) => {
          if (ev.kind === 'bossKill' && ev.first && !(ev.boss in report.bossKills)) report.bossKills[ev.boss] = start + wall;
        },
      });
      clock += played.wall;
      if (!run.outcome) {
        // The session ends mid-run; the app comes back to its snapshot.
        pending = snap;
        break;
      }
      const summary = bankRun(profile, run, played.newCards, speed);
      report.runs++;
      report.played += summary.shards;
      marchOn(profile, summary);
      if (automations(profile).has('auto-restart')) {
        clock += BALANCE.automation.restartSeconds;
      } else {
        clock += MANUAL_RESTART;
        chores(profile);
      }
    }
    lastSeen = Math.min(clock, close);
    if (bosses.every((b) => b in report.bossKills)) break;
  }
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
 * is left out, so one lucky kill doesn't decide the comparison.
 */
export function farmRate(profile: Profile, policy: PlayPolicy, n: number, seed: number): FarmRate {
  const seeds = new Rng(seed);
  let shards = 0;
  let wall = 0;
  const openings: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = structuredClone(profile);
    const speed = runSpeed(p);
    const run = createRun(buildRunConfig(p), seeds.nextU32());
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
