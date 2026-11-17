/**
 * The Daily Omen's tuning tool (plans/late-game/11 §9).
 *
 *   npm run omen -- --days 28            28 days from today: per day the region,
 *                                        frame, points and modifiers; the active
 *                                        bot's fall wave and minutes; the
 *                                        hands-off policy's (the Autocaster, and
 *                                        the suggestion when a draft times out)
 *   npm run omen -- --days 28 --from 20771
 *                                        from a day number (days since 1970)
 *   npm run omen -- --ring 6 --points 3,5
 *                                        tuning: every tower bought out to ring 6,
 *                                        and the day's points in 3–5
 *
 * The summary reads §9's targets: a median run of 8–15 minutes, the active
 * median fall wave 26–34, band III on at most a quarter of days, no day the
 * active bot falls before wave 15, and the active bot at least two waves
 * ahead of hands-off on the median day (skill shows in the score). It also
 * prints the Starlight a scored try pays per screen-minute, and what thirty
 * days of band III would come to against the Constellations' price.
 *
 * Headless: it drives the real sim, every input between steps as the app's.
 */
import { BALANCE } from '../src/content/balance';
import { frameById } from '../src/content/frames';
import { OMEN_MOD_BY_ID } from '../src/content/omens';
import { regionByIndex } from '../src/content/regions';
import { STARS } from '../src/content/stars';
import { SIM_DT } from '../src/app/loop';
import { omenBand, omenConfig, omenDay, omenLabel, omenSeed, omenStarlight, rollOmen } from '../src/meta/omen';
import { STAR_WEB } from '../src/meta/stars';
import { applyInput, createRun, step } from '../src/sim/run';
import { autoUltWanted } from '../src/sim/systems/ultimate';
import type { RunInput, RunState } from '../src/sim/state';
import { botInput } from './bot';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

type Policy = 'active' | 'hands-off';

/** Wall seconds the active bot spends on a draft, as the pacing bot does. */
const ACTIVE_DRAFT = 2;
const MAX_SECONDS = 3600;

interface Played {
  wave: number;
  kills: number;
  /** Wall minutes at 1×, the drafts' slow motion included. */
  minutes: number;
}

/** Play day `n` under `policy`: inputs between steps, wall time as the app would spend it at 1×. */
export function playOmen(n: number, policy: Policy): Played {
  const run: RunState = createRun(omenConfig(n), omenSeed(n));
  const slow = BALANCE.draft.slowMotion;
  const timeout = BALANCE.automation.tacticianSeconds;
  let wall = 0;
  let draftUp = 0;
  let shown: unknown = null;
  const max = Math.round(MAX_SECONDS / SIM_DT);
  while (!run.outcome && run.tick < max) {
    if (run.draft !== shown) {
      shown = run.draft;
      draftUp = 0;
      if (run.draft && policy === 'active') wall += ACTIVE_DRAFT;
    }
    let input: RunInput = {};
    if (policy === 'active') {
      input = botInput(run, 'active');
    } else {
      if (run.draft && draftUp >= timeout) input.pick = run.draft.suggested;
      if (autoUltWanted(run)) input.ult = true;
    }
    if (Object.keys(input).length > 0) applyInput(run, input);
    if (run.outcome) break;
    const drafting = run.draft !== null;
    step(run, SIM_DT);
    const dt = SIM_DT / (drafting && policy === 'hands-off' ? slow : 1);
    wall += dt;
    if (drafting) draftUp += dt;
  }
  return { wave: run.outcome?.wave ?? run.wave, kills: run.kills, minutes: wall / 60 };
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * Tuning overrides, read before the first roll (rolls are memoised):
 * `--ring 6` buys every region's tower out to ring 6; `--points 3,5` sets the day's band.
 */
function overrides(): void {
  const O = BALANCE.omen as { ring: readonly number[]; points: readonly [number, number] };
  const ring = arg('ring', NaN);
  if (Number.isFinite(ring)) O.ring = O.ring.map((_, i) => (i === 0 ? 0 : ring));
  const i = process.argv.indexOf('--points');
  if (i >= 0) O.points = process.argv[i + 1].split(',').map(Number) as unknown as [number, number];
}

function main(): void {
  overrides();
  const days = arg('days', 28);
  const from = arg('from', omenDay(Date.now()));
  const rows: { n: number; active: Played; idle: Played }[] = [];
  console.log('day          region         frame        pts  modifiers                                   active        hands-off');
  for (let n = from; n < from + days; n++) {
    const r = rollOmen(n);
    const active = playOmen(n, 'active');
    const idle = playOmen(n, 'hands-off');
    rows.push({ n, active, idle });
    const mods = [r.boon, r.twist ?? '—', r.banes.map((b) => `${b.id}${b.rank > 1 ? `×${b.rank}` : ''}`).join(',')].join(' ');
    console.log([
      `${n} ${omenLabel(n)}`.padEnd(12),
      regionByIndex(r.region).name.padEnd(14),
      frameById(r.frame).name.padEnd(12),
      String(r.points).padStart(3),
      mods.padEnd(43).slice(0, 43),
      `w${active.wave} ${active.minutes.toFixed(1)}m`.padEnd(13),
      `w${idle.wave} ${idle.minutes.toFixed(1)}m`,
    ].join(' '));
  }
  const minutes = median(rows.map((x) => x.active.minutes));
  const wave = median(rows.map((x) => x.active.wave));
  const band3 = rows.filter((x) => omenBand(x.active.wave) >= 3).length / rows.length;
  const worst = Math.min(...rows.map((x) => x.active.wave));
  const gap = median(rows.map((x) => x.active.wave - x.idle.wave));
  const ok = (b: boolean): string => (b ? 'ok' : 'OFF');
  console.log('');
  console.log(`median run            ${minutes.toFixed(1)} min        target 8–15        ${ok(minutes >= 8 && minutes <= 15)}`);
  console.log(`median fall (active)  wave ${wave}          target 26–34       ${ok(wave >= 26 && wave <= 34)}`);
  console.log(`band III days         ${(band3 * 100).toFixed(0)}%              target ≤ 25%       ${ok(band3 <= 0.25)}`);
  console.log(`earliest fall         wave ${worst}          target ≥ 15        ${ok(worst >= 15)}`);
  console.log(`active − hands-off    ${gap} waves (median)  target ≥ 2   ${ok(gap >= 2)}`);
  // Pay: per screen-minute of a scored try, and thirty days of band III against the sky.
  const pay = rows.map((x) => omenStarlight(omenBand(x.active.wave)));
  const perMin = pay.reduce((a, b) => a + b, 0) / rows.reduce((a, x) => a + x.active.minutes, 0);
  let sky = 0;
  for (const s of STARS) for (let l = 0; l < s.maxLevel; l++) sky += STAR_WEB.cost(s, l);
  const month = 30 * omenStarlight(3);
  console.log(`Starlight / minute    ${perMin.toFixed(2)} (before the Stargazers); compare npm run pacing -- --act2`);
  console.log(`30 days of band III   ${month} Starlight against the sky's ~${sky}: ${(month / Math.max(1, sky) * 100).toFixed(0)}%  target ≤ 33%  ${ok(month <= sky / 3)}`);
  console.log(`modifiers seen        ${new Set(rows.flatMap((x) => { const r = rollOmen(x.n); return [r.boon, r.twist, ...r.banes.map((b) => b.id)]; }).filter((id): id is string => !!id && !!OMEN_MOD_BY_ID[id])).size}`);
}

main();
