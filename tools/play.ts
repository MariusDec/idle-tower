/**
 * One run, played headless by a bot policy on the real sim (§13), with the
 * player's wall clock kept beside it. Shared by the pacing report's active
 * bot and the idle bot, so both read time the same way:
 *
 *   active  takes the suggested card at once, a couple of seconds per draft
 *           (one tap takes every banked draft, U2), and casts the
 *           ultimate by hand (`botInput`)
 *   idle    touches nothing: each draft runs its timer out at slow motion
 *           and the suggestion is taken (§4.5); with the Tactician, the
 *           Opening takes every banked draft after its own short wait (U2);
 *           the ultimate goes off only through the Autocaster, if owned (§6.2)
 *
 * The first draft of a profile pauses for both: it waits for a tap.
 */
import { SIM_DT } from '../src/app/loop';
import { BALANCE } from '../src/content/balance';
import { applyInput, step } from '../src/sim/run';
import type { RunInput, RunState, SimEvent } from '../src/sim/state';
import { cardKey } from '../src/sim/systems/draft';
import { autoUltWanted } from '../src/sim/systems/ultimate';
import type { Profile } from '../src/meta/profile';
import { botInput } from './bot';

export type PlayPolicy = 'active' | 'idle';

/** Wall seconds an active player spends on a draft, and anyone on the first (paused) one. */
export const DRAFT_SECONDS = 2;
export const FIRST_DRAFT_SECONDS = 5;
/** A run that outlives this many sim seconds is cut off: a safety net, since overtime always ends a run. */
export const MAX_RUN_SECONDS = 3600;

export interface PlayOptions {
  policy: PlayPolicy;
  /** Game speed the run plays at. */
  speed: number;
  /** The idle policy's Autocaster (§6.2). */
  autoUlt?: boolean;
  /** Wall seconds an idle draft waits before the suggestion is taken (`draftSeconds`). */
  draftSeconds?: number;
  /** Wall seconds the idle Opening waits before taking every banked draft (`openingSeconds`); null: one by one. */
  openingSeconds?: number | null;
  /** Stop once the wall clock passes this many seconds of play (a session ends), the run unfinished. */
  until?: number;
  /** Every sim event, with the wall seconds into play it happened at. */
  onEvent?: (ev: SimEvent, at: number) => void;
  /** Each new draft: the cards on it never seen before, and whether it is the profile's first. */
  onDraft?: (fresh: string[], first: boolean, at: number) => void;
  /** Each wave start, on the step boundary the app snapshots at (§12.4). */
  onWave?: (run: RunState) => void;
}

export interface PlayResult {
  /** Wall seconds this stretch of the run took. */
  wall: number;
  /** Draft cards first seen this stretch (`cardKey`), for `bankRun`. */
  newCards: string[];
  /**
   * Wall seconds from the run's start to its first moment with no draft open
   * or banked (U2): how long the Opening held the run. Null for a resumed
   * run, or one that never got clear.
   */
  opening: number | null;
}

/**
 * Play `run` until it ends or the wall clock passes `until`. The profile's
 * seen cards and first-draft lesson are updated as the app would.
 */
export function playRun(profile: Profile, run: RunState, o: PlayOptions): PlayResult {
  const seen = new Set(profile.seenCards);
  const newCards: string[] = [];
  const maxTicks = Math.round(MAX_RUN_SECONDS / SIM_DT);
  const slow = BALANCE.draft.slowMotion;
  let wall = 0;
  let shown: unknown = null;
  /** Wall seconds the open draft has been up (idle: its timer). */
  let draftUp = 0;
  /** Drafts banked before the first step: the Opening (U2). */
  const opening = run.tick === 0 ? run.pendingDrafts : 0;
  let openingDone: number | null = run.tick === 0 && opening === 0 ? 0 : null;
  while (!run.outcome && run.tick < maxTicks && (o.until === undefined || wall < o.until)) {
    if (run.draft && run.draft !== shown) {
      shown = run.draft;
      draftUp = 0;
      const first = !profile.tutorial.firstDraft;
      const fresh: string[] = [];
      for (const c of run.draft.cards) {
        const key = cardKey(c);
        if (seen.has(key)) continue;
        seen.add(key);
        if (c.kind !== 'fallback') fresh.push(key);
      }
      newCards.push(...fresh);
      o.onDraft?.(fresh, first, wall);
      if (first) {
        // The lesson waits for a tap, whoever is playing.
        wall += FIRST_DRAFT_SECONDS;
        profile.tutorial.firstDraft = true;
        applyInput(run, { pick: run.draft.suggested });
        continue;
      }
      if (o.policy === 'active') wall += DRAFT_SECONDS;
    }
    let input: RunInput;
    if (o.policy === 'active') {
      input = botInput(run, 'active');
    } else {
      const inOpening = run.draft !== null && run.draftsOpened <= opening && opening > 1;
      const takeAll = inOpening && o.openingSeconds != null && draftUp >= o.openingSeconds;
      const pick = run.draft && !takeAll && draftUp >= (o.draftSeconds ?? BALANCE.draft.seconds) ? run.draft.suggested : undefined;
      const ult = o.autoUlt === true && autoUltWanted(run);
      input = { pick, takeAll: takeAll || undefined, ult: ult || undefined };
    }
    const drafting = o.policy === 'idle' && run.draft !== null && input.pick === undefined && !input.takeAll;
    const before = run.wave;
    step(run, SIM_DT, input);
    // An idle draft runs the arena at 15% while its timer counts wall seconds.
    const dt = SIM_DT / (o.speed * (drafting ? slow : 1));
    wall += dt;
    if (drafting) draftUp += dt;
    for (const ev of run.events) {
      o.onEvent?.(ev, wall);
      // A card taken unseen (U2's take-all) is seen now: it is on the tower.
      if (ev.kind === 'picked' && ev.card.kind !== 'fallback' && !seen.has(cardKey(ev.card))) {
        seen.add(cardKey(ev.card));
        newCards.push(cardKey(ev.card));
        o.onDraft?.([cardKey(ev.card)], false, wall);
      }
    }
    run.events.length = 0;
    if (openingDone === null && opening > 0 && !run.draft && run.pendingDrafts === 0) openingDone = wall;
    if (run.wave > before && !run.outcome) o.onWave?.(run);
  }
  profile.seenCards = [...seen];
  return { wall, newCards, opening: openingDone };
}

/** A deep copy of a run as the app's snapshot holds it: plain data, no events. */
export function snapshotOf(run: RunState): RunState {
  return structuredClone({ ...run, events: [] });
}
