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
import type { RunConfig, RunInput, RunState, SimEvent } from '../src/sim/state';
import { buildRunConfig } from '../src/meta/runConfig';
import { cardKey } from '../src/sim/systems/draft';
import { autoUltWanted } from '../src/sim/systems/ultimate';
import type { Profile } from '../src/meta/profile';
import { botInput } from './bot';
import { PHONE_OVAL, meanRim, type Oval, type Squareness } from '../src/content/arena';
import { stageOval } from '../src/render/camera';

export type PlayPolicy = 'active' | 'idle';

/**
 * Inputs only a present player sends (I9, plans/late-game/01 §9.1): a late-game
 * plan that adds one lists it here, and the idle branch below asserts it
 * never sets one. Stored Light adds none: it is app-side.
 */
export const ACTIVE_INPUTS: readonly (keyof RunInput)[] = ['tapRift', 'chooseRift', 'claim'];

/** Wall seconds an active player spends reading a tapped rift: the arena is stopped meanwhile (plans/late-game/02 §8). */
export const RIFT_SECONDS = 3;

/**
 * The run config the bots play: the game's, without rifts when the tool was
 * started with `--no-rifts` (plans/late-game/02 §8's comparisons).
 */
export const NO_RIFTS = process.argv.includes('--no-rifts');
export function toolConfig(profile: Profile): RunConfig {
  const config = buildRunConfig(profile);
  const arena = TOOL_ARENA === PHONE_OVAL ? config : { ...config, arena: TOOL_ARENA };
  return NO_RIFTS ? { ...arena, rifts: null } : arena;
}

/**
 * The stages a bot can play on (plans/large-screens.md §11.2), each the
 * shape `stageOval` takes from that CSS box, so `n` follows the same
 * form-factor rule as the game. `phone` is `PHONE_OVAL`, what every tool
 * plays by default.
 */
export const ARENA_SHAPES: Readonly<Record<string, (n?: Squareness) => Oval>> = {
  phone: (n) => (n === undefined ? PHONE_OVAL : { ...PHONE_OVAL, n }),
  /** Today's desktop or tablet: the 480 px column, letterboxed. */
  letterbox: (n) => stageOval(480, 900, n),
  'tablet-p': (n) => stageOval(768, 1024, n),
  'tablet-l': (n) => stageOval(1280, 800, n),
  desktop: (n) => stageOval(1920, 1080, n),
  /** An unfolded book-style foldable. */
  square: (n) => stageOval(1000, 1000, n),
};

/**
 * The arena the bots play: `--arena <shape>` (one of `ARENA_SHAPES`), and
 * `--fog 2|3|4` to force its squareness. Neither: a phone's.
 */
export const TOOL_ARENA: Oval = toolArena(process.argv);

function toolArena(argv: readonly string[]): Oval {
  const at = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const name = at('--arena') ?? 'phone';
  const fog = at('--fog');
  const shape = ARENA_SHAPES[name];
  if (!shape) throw new Error(`--arena wants one of ${Object.keys(ARENA_SHAPES).join(', ')}, not ${name}`);
  if (fog !== undefined && fog !== '2' && fog !== '3' && fog !== '4') throw new Error(`--fog wants 2, 3 or 4, not ${fog}`);
  return shape(fog === undefined ? undefined : (Number(fog) as Squareness));
}

/** One line on the arena a tool plays, for its report's header. */
export function arenaLine(oval: Oval = TOOL_ARENA): string {
  const phone = meanRim(500, PHONE_OVAL);
  const mean = meanRim(500, oval);
  return `arena ${oval.sx.toFixed(2)} × ${oval.sy.toFixed(2)}, n = ${oval.n}: mean rim ${mean.toFixed(0)} (phone ${phone.toFixed(0)}, ${(((mean / phone) - 1) * 100).toFixed(1)} %)`;
}

/** Wall seconds an active player spends on a draft, and anyone on the first (paused) one. */
export const DRAFT_SECONDS = 2;
export const FIRST_DRAFT_SECONDS = 5;
/** A run that outlives this many sim seconds is cut off: a safety net, since overtime always ends a run. */
export const MAX_RUN_SECONDS = 3600;

/**
 * How many of the game's steps one `--fast` step stands for: 3, or the
 * number given (`--fast=6`). Weapons still act once per game step
 * (`step`'s `weaponSteps`), so a fast build's fire rate isn't capped.
 */
export const FAST_STEPS = fastSteps(process.argv);
/**
 * The step the bots play at. The game's own `SIM_DT`, unless the tool was
 * started with `--fast`: then several of its steps at once, for a fraction
 * of the time. A seed then plays a different game in its details, but the
 * medians hold within seed noise (`docs/balancing.md`), so `--fast` is for a
 * quick look and a gate's reading is taken without it.
 */
export const PLAY_DT = SIM_DT * FAST_STEPS;

function fastSteps(argv: readonly string[]): number {
  const flag = argv.find((a) => a === '--fast' || a.startsWith('--fast='));
  if (flag === undefined) return 1;
  const n = flag === '--fast' ? 3 : Number(flag.slice('--fast='.length));
  if (!Number.isInteger(n) || n < 1) throw new Error(`--fast wants a whole number of steps, not ${flag}`);
  return n;
}

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
  /** The active policy never casts the ultimate: a contract asks it not to (plans/late-game/10 §9). */
  holdUlt?: boolean;
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
  const maxTicks = Math.round(MAX_RUN_SECONDS / PLAY_DT);
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
      if (o.holdUlt) delete input.ult;
    } else {
      const inOpening = run.draft !== null && run.draftsOpened <= opening && opening > 1;
      const takeAll = inOpening && o.openingSeconds != null && draftUp >= o.openingSeconds;
      const pick = run.draft && !takeAll && draftUp >= (o.draftSeconds ?? BALANCE.draft.seconds) ? run.draft.suggested : undefined;
      const ult = o.autoUlt === true && autoUltWanted(run);
      input = { pick, takeAll: takeAll || undefined, ult: ult || undefined };
      for (const k of ACTIVE_INPUTS) if (input[k] !== undefined) throw new Error(`I9: the idle policy sent ${k}`);
    }
    const drafting = o.policy === 'idle' && run.draft !== null && input.pick === undefined && !input.takeAll;
    // A rift tapped: the arena stops while it is read (plans/late-game/02 §2).
    if (input.tapRift && run.rift?.phase === 'shown') wall += RIFT_SECONDS;
    // While a rift waits, a watching player's arena runs at 1× (§2): the active bot is always watching.
    const capped = o.policy === 'active' && run.rift?.phase === 'shown';
    const before = run.wave;
    step(run, PLAY_DT, input, FAST_STEPS);
    // An idle draft runs the arena at 15% while its timer counts wall seconds.
    const speed = capped ? Math.min(o.speed, BALANCE.rifts.engagedCap) : o.speed;
    const dt = PLAY_DT / (speed * (drafting ? slow : 1));
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
