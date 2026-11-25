import { afterEach, describe, expect, it } from 'vitest';
import { hashString } from '../src/core/rng';
import { BALANCE } from '../src/content/balance';
import { PHONE_OVAL } from '../src/content/arena';
import { BOSSES } from '../src/content/bosses';
import { EVOLUTIONS } from '../src/content/evolutions';
import { FRAMES, frameById } from '../src/content/frames';
import { FUSION_BY_ID } from '../src/content/fusions';
import { OMEN_MODS, OMEN_MOD_BY_ID } from '../src/content/omens';
import { ACT1_REGIONS, REGIONS, WAKE_REGIONS } from '../src/content/regions';
import { STARS } from '../src/content/stars';
import { SIM_DT } from '../src/app/loop';
import {
  bankOmen, beginOmen, decodeResult, encodeResult, findResult, omenBand, omenConfig, omenDay, omenLabel, omenSeed, omenTrims,
  omenRegion, openOmen, poolAnswers, replayOmen, resultLine, rollOmen, scoredFree, settlePending,
} from '../src/meta/omen';
import { bankRun } from '../src/meta/results';
import { newProfile, type Profile } from '../src/meta/profile';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';
import { wonTrims } from '../src/meta/trials';
import { applyInput, createRun, noteResume, step } from '../src/sim/run';
import type { RunState } from '../src/sim/state';
import { botInput } from '../tools/bot';

const DAY_MS = 86_400_000;
/** Saturday 14 November 2026, the plan's example day. */
const N = Date.UTC(2026, 10, 14) / DAY_MS;

/** A profile with Act 2 open: every region's boss down. */
function act2(): Profile {
  const p = newProfile(0);
  p.tutorial.firstDraft = true;
  for (const b of BOSSES) if (!b.abyss) p.bosses[b.id] = { kills: 1, fastest: 100 };
  return p;
}

/** A run of day `n` ended at `wave` with `kills`, as the sim would leave it. */
function ended(n: number, wave: number, kills: number, practice = false): RunState {
  const run = createRun(omenConfig(n, practice), omenSeed(n));
  run.wave = wave;
  run.kills = kills;
  run.outcome = { kind: 'fell', wave, time: 400 };
  return run;
}

function stateHash(run: RunState): number {
  const { events: _e, omen: _o, ...rest } = run;
  return hashString(JSON.stringify(rest));
}

describe('the day (§4.1)', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it('is the local calendar date, at 23:59 and at 00:00', () => {
    for (const zone of ['UTC', 'Pacific/Tongatapu', 'Pacific/Pago_Pago', 'Europe/London']) {
      process.env.TZ = zone;
      expect(omenDay(new Date(2026, 10, 14, 23, 59, 59).getTime()), zone).toBe(N);
      expect(omenDay(new Date(2026, 10, 15, 0, 0, 0).getTime()), zone).toBe(N + 1);
      expect(omenDay(new Date(2026, 10, 14, 0, 0, 0).getTime()), zone).toBe(N);
    }
  });

  it('holds across a daylight-saving change', () => {
    process.env.TZ = 'Europe/London';
    // 29 March 2026: the clocks go forward at 01:00.
    const day = Date.UTC(2026, 2, 29) / DAY_MS;
    for (const h of [0, 1, 2, 3, 12, 23]) expect(omenDay(new Date(2026, 2, 29, h, 30).getTime())).toBe(day);
    expect(omenDay(new Date(2026, 2, 30, 0, 0).getTime())).toBe(day + 1);
    // 25 October 2026: back at 02:00.
    const fall = Date.UTC(2026, 9, 25) / DAY_MS;
    for (const h of [0, 1, 2, 23]) expect(omenDay(new Date(2026, 9, 25, h, 30).getTime())).toBe(fall);
  });

  it('reads the same everywhere', () => {
    expect(omenLabel(N)).toBe('Sat 14 Nov');
  });
});

describe('the roll (§4.1, §6)', () => {
  const days = Array.from({ length: 365 }, (_, i) => N + i);

  it('is valid on every day of a year', () => {
    const [lo, hi] = BALANCE.omen.points;
    for (const n of days) {
      const r = rollOmen(n);
      expect(poolAnswers(r.pool, r.region), `${n}`).toBe(true);
      expect(r.pool).toHaveLength(BALANCE.omen.pool);
      expect(new Set(r.pool).size).toBe(r.pool.length);
      expect(r.pool[0]).toBe(frameById(r.frame).startingWeapon);
      expect(r.points).toBeGreaterThanOrEqual(lo);
      expect(r.points).toBeLessThanOrEqual(hi);
      const sum = OMEN_MOD_BY_ID[r.boon].points + (r.twist ? OMEN_MOD_BY_ID[r.twist].points : 0) + r.banes.reduce((a, b) => a + b.rank, 0);
      expect(sum).toBe(r.points);
      for (const b of r.banes) expect(b.rank).toBeLessThanOrEqual(Math.min(BALANCE.omen.maxRank, OMEN_MOD_BY_ID[b.id].maxRank ?? 9));
      const boon = OMEN_MOD_BY_ID[r.boon];
      if (r.twist) expect(boon.clashes ?? []).not.toContain(r.twist);
      const fusion = boon.rules.find((x) => x.kind === 'fusion');
      if (fusion?.kind === 'fusion') for (const w of FUSION_BY_ID[fusion.id].weapons) expect(r.pool).toContain(w);
    }
  });

  it('brings every region and frame once per six-day block, never two days running', () => {
    // Regions: Act 1's six-day cycle, on the days before the Wake joins.
    const wake = BALANCE.omen.wakeFrom;
    const start = Math.ceil((wake - 366) / 6) * 6;
    for (let b = start; b + 6 <= wake; b += 6) {
      const block = Array.from({ length: 6 }, (_, i) => omenRegion(b + i));
      expect(new Set(block).size).toBe(ACT1_REGIONS.length);
      for (const r of block) expect(ACT1_REGIONS.map((x) => x.index)).toContain(r);
    }
    const fStart = Math.ceil(N / 6) * 6;
    for (let b = fStart; b < fStart + 360; b += 6) {
      const block = Array.from({ length: 6 }, (_, i) => rollOmen(b + i));
      expect(new Set(block.map((r) => r.frame)).size).toBe(FRAMES.length);
    }
    for (const n of days) {
      // The seam (§8.10 step 3): the day before the cutover and the cutover day may share a region.
      if (n + 1 !== wake) expect(rollOmen(n + 1).region, `${n}`).not.toBe(rollOmen(n).region);
      expect(rollOmen(n + 1).frame, `${n}`).not.toBe(rollOmen(n).frame);
    }
  });

  it('draws every modifier somewhere in the year', () => {
    const seen = new Set<string>();
    for (const n of days) {
      const r = rollOmen(n);
      seen.add(r.boon);
      if (r.twist) seen.add(r.twist);
      for (const b of r.banes) seen.add(b.id);
    }
    for (const m of OMEN_MODS) expect(seen, m.id).toContain(m.id);
  });
});

describe('the config is profile-free (§4.3)', () => {
  it('is the same, field for field, however far the player has come', () => {
    // A fresh Act 2 profile and a full sky: nothing in either may reach the day.
    const fresh = act2();
    const full = act2();
    for (const s of STARS) full.stars[s.id] = s.maxLevel;
    full.recipes.found = EVOLUTIONS.map((e) => e.id);
    full.tactics.all = ['scattershot'];
    full.relics['mothers-tear'] = 3;
    full.equipped = ['mothers-tear'];
    for (const p of [fresh, full]) openOmen(p, N * DAY_MS);
    for (let n = N; n < N + 12; n++) {
      const a = JSON.stringify(omenConfig(n));
      bankOmen(fresh, ended(n, 22, 900));
      expect(JSON.stringify(omenConfig(n))).toBe(a);
      bankOmen(full, ended(n, 30, 1500));
      expect(JSON.stringify(omenConfig(n))).toBe(a);
    }
  });

  it('fixes every field the siblings read from a profile', () => {
    const c = omenConfig(N);
    expect(c.regionId).toBe(rollOmen(N).region);
    expect(c.frameId).toBe(rollOmen(N).frame);
    expect(c.trial).toBeNull();
    expect(c.contract).toBeNull();
    expect(c.firstDraft).toBeNull();
    expect(c.firstKill).toBe(false);
    expect(c.relicDrops).toBe(false);
    expect(c.priority).toBeNull();
    expect(c.never).toBeNull();
    expect(c.secrets).toBeNull();
    expect(c.reliquaries).toBeNull();
    expect(c.abyssRelics).toEqual([]);
    expect(c.arena).toEqual(PHONE_OVAL);
    expect(c.recipes).toEqual(EVOLUTIONS.map((e) => e.id));
    expect(c.rifts).toMatchObject({ first: false, known: [], act2: true });
    expect(c.omen).toEqual({ day: N, practice: false });
    // The pacts are the day's banes, at their ranks.
    const banes = Object.fromEntries(rollOmen(N).banes.map((b) => [OMEN_MOD_BY_ID[b.id].pact, b.rank]));
    expect(c.pacts).toEqual(banes);
  });

  it('applies each kind of modifier', () => {
    const find = (pred: (n: number) => boolean): number => {
      for (let n = N; n < N + 2000; n++) if (pred(n)) return n;
      throw new Error('no such day');
    };
    const lone = find((n) => rollOmen(n).twist === 'lone-light');
    expect(omenConfig(lone).weaponSlots).toBe(1);
    const glass = find((n) => rollOmen(n).twist === 'glass');
    expect(omenConfig(glass).mods).toContainEqual({ key: 'damage', mult: 1.8 });
    const fusion = find((n) => rollOmen(n).boon === 'blizzard-lit');
    expect(omenConfig(fusion).fusions).toContain('blizzard');
    const early = find((n) => rollOmen(n).boon === 'early-light');
    expect(omenConfig(early).behaviours['extra-level']).toBeGreaterThanOrEqual(4);
    const rift = find((n) => rollOmen(n).boon === 'rift-touched');
    expect(omenConfig(rift).rifts?.rate).toBe(2);
    const odd = find((n) => rollOmen(n).boon === 'strange-stars');
    expect(omenConfig(odd).anomaly).toEqual({ chance: 1 });
    const crown = find((n) => rollOmen(n).twist === 'lent-glass-crown');
    expect(omenConfig(crown).behaviours.unrisen).toBe(1);
  });
});

describe('pay (§4.2, §4.8)', () => {
  it('a date pays once, and only from the day the Omen opened', () => {
    const p = act2();
    openOmen(p, (N + 0.5) * DAY_MS);
    expect(p.omen.since).toBe(N);
    expect(scoredFree(p, N - 1)).toBe(false);
    const before = p.starlight;
    const first = bankOmen(p, ended(N, 31, 1204));
    expect(first.practice).toBe(false);
    expect(first.starlight).toBeGreaterThan(0);
    expect(p.starlight - before).toBe(first.starlight);
    const again = bankOmen(p, ended(N, 40, 3000));
    expect(again.practice).toBe(true);
    expect(again.starlight).toBe(0);
    expect(p.omen.days[N].score?.wave).toBe(31);
    expect(p.omen.days[N].practice?.wave).toBe(40);
    // A day before `since` never pays.
    expect(bankOmen(p, ended(N - 3, 30, 10)).starlight).toBe(0);
  });

  it('a clock moved forward then back pays no more than a straight run of days', () => {
    const straight = act2();
    openOmen(straight, N * DAY_MS);
    for (let n = N; n < N + 5; n++) bankOmen(straight, ended(n, 26, 500));
    const clock = act2();
    openOmen(clock, N * DAY_MS);
    for (const n of [N, N + 4, N + 3, N + 1, N + 2, N + 4, N]) bankOmen(clock, ended(n, 26, 500));
    expect(clock.starlight).toBe(straight.starlight);
    expect(clock.omen.played).toBe(straight.omen.played);
  });

  it('a scored try is today or yesterday; older days are practice', () => {
    const p = act2();
    openOmen(p, N * DAY_MS);
    const now = (N + 2.5) * DAY_MS;
    expect(beginOmen(p, N + 2, now).practice).toBe(false);
    expect(beginOmen(p, N + 1, now).practice).toBe(false);
    expect(beginOmen(p, N, now).practice).toBe(true);
  });

  it('a snapshot from the 14th, resumed on the 16th, banks against the 14th', () => {
    const p = act2();
    openOmen(p, N * DAY_MS);
    const run = ended(N, 27, 800);
    const resumed = JSON.parse(JSON.stringify(run)) as RunState;
    noteResume(resumed);
    bankOmen(p, resumed);
    expect(p.omen.days[N].score).toMatchObject({ wave: 27, resumes: 1 });
    expect(p.omen.days[N + 2]).toBeUndefined();
  });

  it('banks nothing else: no shards, records, farm or relics', () => {
    const p = act2();
    openOmen(p, N * DAY_MS);
    p.shards = 1234;
    p.farm = [5, 6];
    p.relics = { 'bog-lantern': 1 };
    const records = { ...p.records };
    const regions = JSON.stringify(p.regions);
    const run = ended(N, 31, 1204);
    run.shards = 9999;
    run.relics.push('bog-lantern');
    const s = bankRun(p, run);
    expect(s.omen?.wave).toBe(31);
    expect(s.shards).toBe(0);
    expect(p.shards).toBe(1234);
    expect(p.farm).toEqual([5, 6]);
    expect(p.relics).toEqual({ 'bog-lantern': 1 });
    expect(JSON.stringify(p.regions)).toBe(regions);
    expect(p.records).toEqual({ ...records, runs: records.runs + 1, kills: records.kills + 1204 });
    // I9: its Starlight is a present player's.
    expect(s.activeOnly.map((x) => x.kind)).toEqual(['omen']);
  });

  it('a lost scored snapshot opens the try again', () => {
    const p = act2();
    openOmen(p, N * DAY_MS);
    beginOmen(p, N, N * DAY_MS);
    settlePending(p, null);
    expect(p.omen.pending).toBeNull();
    expect(scoredFree(p, N)).toBe(true);
  });

  it('bands follow the overtime trophies', () => {
    expect([20, 21, 25, 26, 30, 31, 40].map(omenBand)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('pays the Augur’s Veil at seven scored Omens and Starfall at the first band III', () => {
    const p = act2();
    openOmen(p, N * DAY_MS);
    for (let i = 0; i < 6; i++) bankOmen(p, ended(N + i, 22, 100));
    expect(omenTrims(p)).toEqual([]);
    const seventh = bankOmen(p, ended(N + 6, 31, 100));
    expect(seventh.trims).toEqual(['Augur’s Veil', 'Starfall']);
    expect(wonTrims(p).map((t) => t.trim)).toEqual(expect.arrayContaining(['veil', 'starfall']));
  });

  it('keeps sixty days, and a dropped day never pays again', () => {
    const p = act2();
    openOmen(p, N * DAY_MS);
    bankOmen(p, ended(N, 22, 1));
    bankOmen(p, ended(N + 70, 22, 1));
    expect(p.omen.days[N]).toBeUndefined();
    expect(scoredFree(p, N)).toBe(false);
  });
});

describe('the share code (§4.6)', () => {
  it('round-trips', () => {
    const r = { day: N, wave: 31, kills: 1204, resumes: 2, practice: false };
    const code = encodeResult(r);
    expect(code).toMatch(/^[0-9A-Z]{6}-[0-9A-Z]{6}-[0-9A-Z]{6}$/);
    expect(decodeResult(code)).toEqual({ ...r, sameRules: true });
    expect(decodeResult(code.toLowerCase())).toEqual({ ...r, sameRules: true });
  });

  it('fails the check on any one-character edit', () => {
    const code = encodeResult({ day: N, wave: 31, kills: 1204, resumes: 0, practice: false });
    const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '-') continue;
      for (const ch of B32) {
        if (ch === code[i]) continue;
        expect(decodeResult(code.slice(0, i) + ch + code.slice(i + 1)), `${i}:${ch}`).toBeNull();
      }
    }
  });

  it('is found anywhere in a pasted message, whatever the line says', () => {
    const line = resultLine(N, 31, 1204, 0, false);
    expect(line).toMatch(/^Omen Sat 14 Nov · .+ · wave 31 · 1,204 slain · [0-9A-Z-]{20}$/);
    expect(line.length).toBeLessThanOrEqual(90);
    const forged = line.replace('wave 31', 'wave 99');
    expect(findResult(`look at this!\n${forged}\nbeat that`)?.wave).toBe(31);
    expect(findResult('no code here')).toBeNull();
  });
});

describe('the input log (§4.7)', () => {
  /** Play day `n` live, every input between steps, for `seconds`; resume from a copy at `resumeAt` if given. */
  function playLive(n: number, seconds: number, resumeAt?: number): RunState {
    let run = createRun(omenConfig(n), omenSeed(n));
    const max = Math.round(seconds / SIM_DT);
    while (!run.outcome && run.tick < max) {
      if (resumeAt !== undefined && run.tick === resumeAt) {
        // The app killed: the snapshot is the run as it stood, then resumed.
        run = JSON.parse(JSON.stringify(run)) as RunState;
        noteResume(run);
      }
      const input = botInput(run, 'active');
      if (Object.keys(input).length > 0) applyInput(run, input);
      if (run.outcome) break;
      step(run, SIM_DT);
    }
    return run;
  }

  it('replays to the same wave, kills and state', () => {
    const live = playLive(N, 150);
    expect(live.omen!.log.length).toBeGreaterThan(0);
    const again = replayOmen(N, live.omen!.log, false, 150);
    expect(again.wave).toBe(live.wave);
    expect(again.kills).toBe(live.kills);
    expect(stateHash(again)).toBe(stateHash(live));
  });

  it('replays a resumed run too, and counts the resume', () => {
    const live = playLive(N + 1, 120, 3000);
    expect(live.omen!.resumes).toBe(1);
    const again = replayOmen(N + 1, live.omen!.log, false, 120);
    expect(again.omen!.resumes).toBe(1);
    expect(stateHash(again)).toBe(stateHash(live));
  });

  it('logs nothing on any other run', () => {
    const run = createRun({ ...omenConfig(N), omen: null }, 5);
    applyInput(run, { ult: true });
    expect(run.omen).toBeNull();
  });
});

describe('the save', () => {
  it('v24 → v25: the Omen, not yet opened', () => {
    const out = migrate({ version: 24, createdAt: 5, shards: 50 }, MIGRATIONS, 25);
    expect(out.version).toBe(25);
    expect(out.omen).toEqual({ since: 0, days: {}, played: 0, best: 0, pending: null });
  });
});

describe('the Wake joins the Omen (plans/late-game/12 §8.10)', () => {
  /** omenRegion(20700 + i), recorded before the cutover code: Act 1's days never move. */
  const GOLDEN = '1543623541625342613154262653413541623215462461351632543154621265436452132135461543264312';

  it('days before the cutover name the regions they always did', () => {
    expect(20700 + GOLDEN.length).toBeLessThanOrEqual(BALANCE.omen.wakeFrom);
    for (let i = 0; i < GOLDEN.length; i++) expect(omenRegion(20700 + i), `${20700 + i}`).toBe(Number(GOLDEN[i]));
  });

  it('from the cutover, every block of eleven days names each region once', () => {
    const size = REGIONS.length;
    const start = Math.ceil(BALANCE.omen.wakeFrom / size) * size;
    for (let b = start; b < start + size * 40; b += size) {
      const block = Array.from({ length: size }, (_, i) => omenRegion(b + i));
      expect([...block].sort((x, y) => x - y)).toEqual(REGIONS.map((r) => r.index).sort((x, y) => x - y));
    }
  });

  it('a Wake day builds and runs 60 s headless', () => {
    const wake = new Set(WAKE_REGIONS.map((r) => r.index));
    let n = BALANCE.omen.wakeFrom;
    while (!wake.has(omenRegion(n))) n++;
    const run = createRun(omenConfig(n), omenSeed(n));
    for (let t = 0; t < Math.round(60 / SIM_DT) && !run.outcome; t++) step(run, SIM_DT);
    expect(run.tick).toBeGreaterThan(0);
  });
});
