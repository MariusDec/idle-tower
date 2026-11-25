import { describe, expect, it } from 'vitest';
import { ABYSS_INDEX } from '../src/content/abyss';
import { BOSSES } from '../src/content/bosses';
import { contractText, plural } from '../src/content/contracts';
import { FORGE } from '../src/content/forge';
import { MAX_TEXT_WORDS } from '../src/content/lint';
import { REGIONS, WAKE_REGIONS } from '../src/content/regions';
import type { ContractMod, ContractSpec, ContractTarget, WeaponId } from '../src/content/types';
import {
  SLOTS, placeOf, boardOpen, comfortable, contractLead, contractMet, contractTier, ensureBoard, ownedWeapons, pin, reroll, score, slotBand, takeContract, takenContract, tierOf, trivial, valid,
} from '../src/meta/contracts';
import { hubGoal } from '../src/meta/goals';
import { newProfile, type Profile } from '../src/meta/profile';
import { bankRun } from '../src/meta/results';
import { buildRunConfig } from '../src/meta/runConfig';
import { MIGRATIONS, migrate } from '../src/meta/save/migrate';
import { chooseTrial } from '../src/meta/trials';
import { wonTrims } from '../src/meta/trials';
import { createRun } from '../src/sim/run';
import type { RunState } from '../src/sim/state';

/** A profile with the regions to `upTo` cleared, the Forge's weapon nodes owned, and some farm behind it. */
function cleared(upTo: number): Profile {
  const p = newProfile(1_700_000_000_000 + upTo);
  for (const r of REGIONS) {
    if (r.index > upTo) break;
    p.bosses[r.boss] = { kills: 3, fastest: 40 + r.index * 10 };
    p.regions[r.index] = { bestWave: 26 - r.index, runs: 3 };
  }
  p.regions[upTo + 1] ??= { bestWave: 12, runs: 3 };
  for (const n of FORGE) if (n.effects.some((e) => e.kind === 'unlockCard')) p.forge[n.id] = 1;
  p.recipes.found = ['seeker-swarm'];
  p.relics = { 'mothers-tear': 1, 'gatekeepers-seal': 2 };
  p.farm = [120, 140, 160];
  return p;
}

/** The four fixtures (§6): Forgeheart down, the Blight down, heat 10, floor 12. */
function fixtures(): Record<string, Profile> {
  const forgeheart = cleared(4);
  const blight = cleared(6);
  const heat10 = cleared(6);
  for (const r of REGIONS) heat10.pacts.best[r.index] = 10;
  heat10.pacts.ranks = { scarcity: 3, elites: 3, haste: 3, tyranny: 1 };
  // The Abyss opens on the Thunderhead (plans/late-game/12 D-1): the Wake walked, then the descent.
  for (const r of WAKE_REGIONS) heat10.bosses[r.boss] = { kills: 1, fastest: null };
  heat10.bosses.deepwarden = { kills: 1, fastest: null };
  heat10.abyss.best = 6;
  heat10.abyss.felled = 1;
  heat10.rush = { best: 5, time: null };
  const floor12 = structuredClone(heat10);
  floor12.createdAt += 1;
  floor12.abyss = { best: 12, felled: 2, start: 1 };
  floor12.bosses.undertow = { kills: 1, fastest: null };
  floor12.rush = { best: 8, time: 600 };
  return { forgeheart, blight, heat10, floor12 };
}

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;

describe('the board (plans/late-game/10 §4.1)', () => {
  it('opens at Forgeheart\'s fall, and not before', () => {
    const before = cleared(3);
    expect(boardOpen(before)).toBe(false);
    expect(ensureBoard(before)).toBe(false);
    expect(before.contracts.board).toEqual([]);
    const after = cleared(4);
    expect(boardOpen(after)).toBe(true);
    expect(ensureBoard(after)).toBe(true);
    expect(after.contracts.board.map((c) => c.slot)).toEqual(['quick', 'steady', 'hard']);
  });

  it('the same profile and seq draw the same board; a save round-trip keeps it', () => {
    const a = cleared(6);
    const b = cleared(6);
    ensureBoard(a);
    ensureBoard(b);
    expect(b.contracts.board).toEqual(a.contracts.board);
    const loaded = JSON.parse(JSON.stringify(a)) as Profile;
    expect(loaded.contracts.board).toEqual(a.contracts.board);
    // Nothing is drawn on load: the board is stored, not regenerated.
    expect(ensureBoard(loaded)).toBe(false);
    expect(loaded.contracts.seq).toBe(a.contracts.seq);
  });

  it('a reroll keeps the slot\'s band and rider, and moves seq by one', () => {
    const p = cleared(6);
    ensureBoard(p);
    for (let i = 0; i < 30; i++) {
      const hard = p.contracts.board.find((c) => c.slot === 'hard')!;
      const seq = p.contracts.seq;
      expect(reroll(p, hard.id)).toBe(true);
      const next = p.contracts.board.find((c) => c.slot === 'hard')!;
      expect(p.contracts.seq).toBe(seq + 1);
      expect(next.id).not.toBe(hard.id);
      expect(next.rider).toBe(hard.rider);
      const [lo, hi] = slotBand('hard');
      expect(tierOf(score(p, next))).toBeGreaterThanOrEqual(lo);
      expect(tierOf(score(p, next))).toBeLessThanOrEqual(hi);
    }
    expect(p.contracts.board.find((c) => c.slot === 'hard')!.rider).not.toBeNull();
    expect(reroll(p, 'nope')).toBe(false);
  });

  it('10,000 boards over four profiles: valid, never trivial, within 15 words, each slot in its band, no clash', () => {
    const seen = { cards: 0, weapons: 0 };
    let kinds = 0;
    const rules: WeaponId[][] = [];
    const owned = new Set<WeaponId>();
    for (const p of Object.values(fixtures())) {
      for (const w of ownedWeapons(p)) owned.add(w);
      ensureBoard(p);
      for (let i = 0; i < 2500; i++) {
        const board = p.contracts.board;
        for (const c of board) {
          seen.cards++;
          const text = contractText(c);
          expect(valid(p, c), text).toBe(true);
          expect(trivial(p, c), text).toBe(false);
          expect(words(text), text).toBeLessThanOrEqual(MAX_TEXT_WORDS);
          const [lo, hi] = slotBand(c.slot);
          const t = tierOf(score(p, c));
          expect(t >= lo && t <= hi, `${c.slot} T${t}: ${text}`).toBe(true);
          for (const m of c.mods) if (m.kind === 'rule' && m.rule.kind === 'weapons') rules.push([...m.rule.ids]);
        }
        // Never two cards in one place; a kind is shared only by Act 1's last-resort Hard card (§4.1's fallback).
        expect(new Set(board.map((c) => placeOf(c.target))).size).toBe(3);
        kinds += new Set(board.map((c) => c.target.kind)).size === 3 ? 1 : 0;
        for (const s of SLOTS) reroll(p, board.find((c) => c.slot === s)!.id);
      }
    }
    expect(seen.cards).toBe(30_000);
    expect(kinds / 10_000).toBeGreaterThan(0.95);
    // No favourite (§6, in I4's spirit): each owned weapon's share of the weapons rules stays in a band.
    seen.weapons = rules.length;
    expect(seen.weapons).toBeGreaterThan(500);
    for (const w of owned) {
      const share = rules.filter((ids) => ids.includes(w)).length / rules.length;
      expect(share, w).toBeGreaterThanOrEqual(0.04);
      expect(share, w).toBeLessThanOrEqual(0.3);
    }
    // Ten thousand draws: a few seconds beside the other suites' sims.
  }, 30_000);
});

/** A profile with a board, and a run built for card `c` (taken), unfinished. */
function runFor(p: Profile, c: ContractSpec): RunState {
  p.contracts.board = [c];
  expect(takeContract(p, c.id)).toBe(true);
  return createRun(buildRunConfig(p), 7);
}

function spec(target: ContractTarget, mods: ContractMod[], id = 'cx'): ContractSpec {
  return { id, slot: 'steady', target, mods, rider: null };
}

describe('contractMet: every target and modifier (§3)', () => {
  const p = cleared(6);

  it('boss: felled or standing', () => {
    const c = spec({ kind: 'boss', region: 2 }, [{ kind: 'noUlt' }]);
    const run = runFor(p, c);
    run.boss = { ...(run.boss ?? {}), id: 'bog-mother', killedIn: null, minHp: 1 } as RunState['boss'];
    expect(contractMet(c, run)).toEqual({ met: false, why: 'the Bog Mother still stands' });
    run.boss!.killedIn = 30;
    expect(contractMet(c, run).met).toBe(true);
    run.ult.casts = 1;
    expect(contractMet(c, run)).toEqual({ met: false, why: 'the ultimate was cast' });
  });

  it('wave, overtime and a run\'s tallies', () => {
    const wave = spec({ kind: 'wave', region: 3, wave: 15 }, [{ kind: 'noUlt' }]);
    const run = runFor(p, wave);
    run.wave = 14;
    expect(contractMet(wave, run).met).toBe(false);
    run.wave = 15;
    expect(contractMet(wave, run).met).toBe(true);
    const ot = spec({ kind: 'overtime', region: 3, k: 5 }, [{ kind: 'noUlt' }]);
    expect(contractMet(ot, run).met).toBe(false);
    run.wave = 25;
    expect(contractMet(ot, run).met).toBe(true);

    const untouched = spec({ kind: 'run', region: 3 }, [{ kind: 'untouched', wave: 10 }]);
    run.firstHurtWave = 7;
    expect(contractMet(untouched, run)).toEqual({ met: false, why: 'hit in wave 7' });
    run.firstHurtWave = null;
    expect(contractMet(untouched, run).met).toBe(true);

    const slay = spec({ kind: 'run', region: 3 }, [{ kind: 'slay', enemy: 'burrower', n: 70 }]);
    run.killsBy = { burrower: 69 };
    expect(contractMet(slay, run).met).toBe(false);
    run.killsBy = { burrower: 70 };
    expect(contractMet(slay, run).met).toBe(true);
    const elites = spec({ kind: 'run', region: 3 }, [{ kind: 'slay', enemy: 'elite', n: 4 }]);
    run.elitesKilled = 4;
    expect(contractMet(elites, run).met).toBe(true);
  });

  it('within, healthy, carry, evolve, fuse', () => {
    const c = spec({ kind: 'boss', region: 4 }, [{ kind: 'within', seconds: 40 }, { kind: 'healthy', pct: 70 }]);
    const run = runFor(p, c);
    run.boss = { ...(run.boss ?? {}), id: 'forgeheart', killedIn: 41, minHp: 0.9 } as RunState['boss'];
    expect(contractMet(c, run)).toEqual({ met: false, why: 'it fell in 41 s' });
    run.boss!.killedIn = 39;
    expect(contractMet(c, run).met).toBe(true);
    run.boss!.minHp = 0.6;
    expect(contractMet(c, run).met).toBe(false);

    const carry = spec({ kind: 'boss', region: 4 }, [{ kind: 'carry', weapon: 'mortar' }]);
    run.damageBy = { mortar: 40, glaives: 60 };
    expect(contractMet(carry, run).met).toBe(false);
    run.damageBy = { mortar: 60, glaives: 40, burn: 0 };
    expect(contractMet(carry, run).met).toBe(true);

    const evolve = spec({ kind: 'boss', region: 4 }, [{ kind: 'evolve', weapon: 'arcane-bolt' }]);
    run.evolved = [];
    expect(contractMet(evolve, run).met).toBe(false);
    run.evolved = ['seeker-swarm'];
    expect(contractMet(evolve, run).met).toBe(true);

    const fuse = spec({ kind: 'boss', region: 4 }, [{ kind: 'fuse', fusion: 'blizzard' }]);
    run.fused = [];
    expect(contractMet(fuse, run).met).toBe(false);
    run.fused = ['blizzard'];
    expect(contractMet(fuse, run).met).toBe(true);
  });

  it('heat reads the run\'s own pacts', () => {
    const q = cleared(6);
    q.pacts.best[2] = 4;
    q.pacts.ranks = { scarcity: 3, elites: 2 };
    const c = spec({ kind: 'boss', region: 2 }, [{ kind: 'heat', heat: 5 }]);
    const run = runFor(q, c);
    run.boss = { ...(run.boss ?? {}), id: 'bog-mother', killedIn: 30, minHp: 1 } as RunState['boss'];
    expect(contractMet(c, run).met).toBe(true);
    const higher = spec({ kind: 'boss', region: 2 }, [{ kind: 'heat', heat: 6 }]);
    expect(contractMet(higher, run)).toEqual({ met: false, why: 'heat 5, not 6' });
  });

  it('floor, guardian and Boss Rush', () => {
    const q = fixtures().floor12;
    const floor = spec({ kind: 'floor', floor: 10 }, [{ kind: 'noUlt' }]);
    const run = runFor(q, floor);
    expect(run.regionId).toBe(ABYSS_INDEX);
    // The descent starts at the deepest waypoint at or above floor 10 (§4.5).
    expect(run.startWave).toBe((7 - 1) * 10 + 1);
    run.floors = 9;
    expect(contractMet(floor, run).met).toBe(false);
    run.floors = 10;
    expect(contractMet(floor, run).met).toBe(true);
    const guardian = spec({ kind: 'guardian', boss: 'undertow' }, [{ kind: 'noUlt' }]);
    run.felled = ['deepwarden'];
    expect(contractMet(guardian, run).met).toBe(false);
    run.felled = ['undertow'];
    expect(contractMet(guardian, run).met).toBe(true);

    const rush = spec({ kind: 'rush', stages: 8, within: 540 }, [{ kind: 'noUlt' }]);
    const rr = runFor(q, rush);
    rr.felled = BOSSES.slice(0, 8).map((b) => b.id);
    rr.outcome = { kind: 'cleared', wave: 8, time: 560 };
    expect(contractMet(rush, rr)).toEqual({ met: false, why: 'the clear took 9:20' });
    rr.outcome = { kind: 'cleared', wave: 8, time: 530 };
    expect(contractMet(rush, rr).met).toBe(true);
    const stages = spec({ kind: 'rush', stages: 4, within: null }, [{ kind: 'noUlt' }]);
    rr.felled = rr.felled.slice(0, 3);
    expect(contractMet(stages, rr)).toEqual({ met: false, why: '3 of 4 stages' });
  });

  it('a run elsewhere never meets a card', () => {
    const c = spec({ kind: 'wave', region: 3, wave: 10 }, [{ kind: 'noUlt' }]);
    const run = runFor(p, c);
    run.regionId = 2;
    run.wave = 30;
    expect(contractMet(c, run)).toEqual({ met: false, why: 'it ran somewhere else' });
  });
});

describe('taking, settling and retrying (§4.5)', () => {
  it('a card\'s rules reach the run\'s config; Take clears a chosen Trial', () => {
    const p = cleared(4);
    expect(chooseTrial(p, 'lone-light')).toBe(true);
    const c = spec({ kind: 'boss', region: 2 }, [{ kind: 'rule', rule: { kind: 'frame', frame: 'bastion' } }, { kind: 'rule', rule: { kind: 'slots', passive: 0 } }]);
    p.contracts.board = [c];
    expect(takeContract(p, c.id)).toBe(true);
    expect(p.trial).toBeNull();
    const cfg = buildRunConfig(p);
    expect(cfg.contract).toBe(c.id);
    expect(cfg.trial).toBeNull();
    expect(cfg.frameId).toBe('bastion');
    expect(cfg.passiveSlots).toBe(0);
    // A Trial chosen after clears the contract: a run is one or the other.
    expect(chooseTrial(p, 'lone-light')).toBe(true);
    expect(p.contracts.taken).toBeNull();
    expect(takenContract(p)).toBeNull();
  });

  it('Take is blocked until the heat a card needs is set', () => {
    const p = cleared(6);
    p.pacts.best[3] = 3;
    const c = spec({ kind: 'boss', region: 3 }, [{ kind: 'heat', heat: 4 }]);
    p.contracts.board = [c];
    expect(takeContract(p, c.id)).toBe(false);
    p.pacts.ranks = { scarcity: 3, elites: 1 };
    expect(takeContract(p, c.id)).toBe(true);
  });

  it('a met card pays, counts, refills its slot; the next run is ordinary', () => {
    const p = cleared(6);
    ensureBoard(p);
    const hard = p.contracts.board.find((x) => x.slot === 'hard')!;
    const c: ContractSpec = { ...spec({ kind: 'wave', region: 2, wave: 10 }, [{ kind: 'noUlt' }, { kind: 'rule', rule: { kind: 'slots', weapon: 1 } }], hard.id), slot: 'hard', rider: 'mothers-tear' };
    p.contracts.board = p.contracts.board.map((x) => (x.id === hard.id ? c : x));
    const tier = contractTier(p, c);
    expect(takeContract(p, c.id)).toBe(true);
    const run = createRun(buildRunConfig(p), 3);
    run.wave = 12;
    const shards = p.shards;
    const starlight = p.starlight;
    const farm = [...p.farm];
    const s = bankRun(p, run);
    expect(s.contract?.met).toBe(true);
    expect(s.contract?.pay?.tier).toBe(tier);
    expect(s.contract?.pay?.shards).toBeGreaterThan(0);
    expect(p.starlight - starlight).toBe(s.contract!.pay!.starlight);
    expect(p.shards - shards).toBeGreaterThanOrEqual(s.contract!.pay!.shards);
    expect(s.contract?.rider).toBe('Mother\'s Tear · rank II');
    expect(p.relics['mothers-tear']).toBe(2);
    expect(p.contracts.done).toBe(1);
    expect(p.contracts.taken).toBeNull();
    expect(p.contracts.board.some((x) => x.id === c.id)).toBe(false);
    expect(p.contracts.board.find((x) => x.slot === 'hard')!.id).not.toBe(c.id);
    expect(s.contract?.next).toBe(contractText(p.contracts.board.find((x) => x.slot === 'hard')!));
    expect(s.activeOnly.some((a) => a.kind === 'contract')).toBe(true);
    // A contract run never feeds the offline farm rate (§4.4).
    expect(p.farm).toEqual(farm);
  });

  it('a failed card stays with its rider; taken clears anyway', () => {
    const p = cleared(6);
    // Heat 1, the most a card may ask above a record of 0.
    p.pacts.ranks = { scarcity: 1 };
    ensureBoard(p);
    const hard = p.contracts.board.find((x) => x.slot === 'hard')!;
    expect(takeContract(p, hard.id)).toBe(true);
    const run = createRun(buildRunConfig(p), 3);
    run.boss = null;
    run.wave = 1;
    run.floors = 0;
    run.killsBy = {};
    const s = bankRun(p, run);
    expect(s.contract?.met).toBe(false);
    expect(s.contract?.why).toBeTruthy();
    expect(s.activeOnly.some((a) => a.kind === 'contract')).toBe(false);
    expect(p.contracts.taken).toBeNull();
    expect(p.contracts.board.find((x) => x.slot === 'hard')).toEqual(hard);
    expect(p.contracts.done).toBe(0);
    // Retry: the same card, taken again.
    expect(takeContract(p, hard.id)).toBe(true);
  });

  it('a run not taken for a card never completes one, even when it meets it', () => {
    const p = cleared(6);
    const c = spec({ kind: 'wave', region: 2, wave: 5 }, [{ kind: 'noUlt' }]);
    p.contracts.board = [c];
    p.region = 2;
    const run = createRun(buildRunConfig(p), 3);
    expect(run.contract).toBeNull();
    run.wave = 20;
    const s = bankRun(p, run);
    expect(s.contract).toBeNull();
    expect(p.contracts.done).toBe(0);
    expect(p.contracts.board.some((x) => x.id === c.id)).toBe(true);
  });

  it('milestones: a trim at 10 and 30 done', () => {
    const p = cleared(6);
    p.contracts.done = 9;
    expect(wonTrims(p).some((t) => t.trim === 'seals')).toBe(false);
    p.contracts.done = 10;
    expect(wonTrims(p).map((t) => t.trim)).toContain('seals');
    p.contracts.done = 30;
    expect(wonTrims(p).map((t) => t.trim)).toEqual(expect.arrayContaining(['seals', 'lanterns']));
  });
});

describe('the Next line (§4.6)', () => {
  it('the pinned card outranks the frontier\'s boss; the board\'s Quick card never lets it run dry', () => {
    const p = cleared(4);
    ensureBoard(p);
    // Forgeheart down, the Hollow King standing: the frontier's boss is the line.
    expect(hubGoal(p)?.text).toMatch(/Hollow King/);
    const steady = p.contracts.board.find((c) => c.slot === 'steady')!;
    expect(pin(p, steady.id)).toBe(true);
    const goal = hubGoal(p)!;
    expect(goal.text).toBe(`Contract: ${contractText(steady)}`);
    expect(goal.open).toBe('contracts');
    expect(pin(p, steady.id)).toBe(true);
    expect(p.contracts.pinned).toBeNull();
  });
});

describe('the save (§6)', () => {
  it('v22 → v23: an empty board, nothing done', () => {
    const out = migrate({ version: 22, createdAt: 5, shards: 50 }, MIGRATIONS, 23);
    expect(out.version).toBe(23);
    expect(out.contracts).toEqual({ seq: 0, board: [], pinned: null, taken: null, done: 0 });
  });

  it('v23 → v24: a board gains its way back, and keeps its cards', () => {
    const board = { seq: 7, board: [{ id: 'c6' }], pinned: 'c6', taken: null, done: 4 };
    const out = migrate({ version: 23, createdAt: 5, contracts: board }, MIGRATIONS, 24);
    expect(out.version).toBe(24);
    expect(out.contracts).toEqual({ ...board, back: null });
  });
});

describe('a card is a detour (review of plan 10)', () => {
  it('the run after a card goes back to where the player was, met or not', () => {
    const p = cleared(6);
    p.region = 6;
    const c = spec({ kind: 'wave', region: 2, wave: 10 }, [{ kind: 'noUlt' }]);
    p.contracts.board = [c];
    expect(takeContract(p, c.id)).toBe(true);
    expect(p.region).toBe(2);
    const lost = createRun(buildRunConfig(p), 3);
    lost.wave = 4;
    expect(bankRun(p, lost).contract?.met).toBe(false);
    // Run again and auto-restart farm the frontier, not the card's place.
    expect(p.region).toBe(6);
    expect(buildRunConfig(p).contract).toBeNull();
    // Retry: the same detour, and back again.
    expect(takeContract(p, c.id)).toBe(true);
    const won = createRun(buildRunConfig(p), 4);
    won.wave = 12;
    expect(bankRun(p, won).contract?.met).toBe(true);
    expect(p.region).toBe(6);
    expect(p.contracts.back).toBeNull();
  });

  it('an Abyss card puts the waypoint back too', () => {
    const p = fixtures().floor12;
    p.region = ABYSS_INDEX;
    p.abyss.start = 1;
    const c = spec({ kind: 'floor', floor: 10 }, [{ kind: 'noUlt' }]);
    p.contracts.board = [c];
    expect(takeContract(p, c.id)).toBe(true);
    expect(p.abyss.start).toBe(7);
    const run = createRun(buildRunConfig(p), 3);
    bankRun(p, run);
    expect(p.region).toBe(ABYSS_INDEX);
    expect(p.abyss.start).toBe(1);
  });

  it('an ordinary run, or a Trial chosen instead, drops the way back', () => {
    const p = cleared(4);
    p.region = 4;
    const c = spec({ kind: 'wave', region: 2, wave: 10 }, [{ kind: 'noUlt' }]);
    p.contracts.board = [c];
    expect(takeContract(p, c.id)).toBe(true);
    expect(chooseTrial(p, 'lone-light')).toBe(true);
    expect(p.contracts.back).toBeNull();
    const region = p.region;
    bankRun(p, createRun(buildRunConfig(p), 3));
    expect(p.region).toBe(region);
  });

  it('a card that names a weapon starts the run with it mounted', () => {
    const p = cleared(4);
    const carry = spec({ kind: 'boss', region: 2 }, [{ kind: 'carry', weapon: 'mortar' }, { kind: 'rule', rule: { kind: 'frame', frame: 'bastion' } }]);
    p.contracts.board = [carry];
    expect(contractLead(carry)).toBe('mortar');
    expect(takeContract(p, carry.id)).toBe(true);
    const cfg = buildRunConfig(p);
    expect(cfg.frameId).toBe('bastion');
    expect(cfg.startingWeapon).toBe('mortar');
    expect(createRun(cfg, 3).weapons[0].id).toBe('mortar');
    // Inside a weapons rule the named weapon leads; outside it the rule's first does.
    const evolve = spec({ kind: 'boss', region: 2 }, [{ kind: 'evolve', weapon: 'arcane-bolt' }, { kind: 'rule', rule: { kind: 'weapons', ids: ['glaives', 'arcane-bolt'] } }], 'c2');
    p.contracts.board = [evolve];
    expect(takeContract(p, evolve.id)).toBe(true);
    expect(buildRunConfig(p).startingWeapon).toBe('arcane-bolt');
    expect(contractLead(spec({ kind: 'boss', region: 2 }, [{ kind: 'noUlt' }]))).toBeNull();
  });

  it('a carry and an evolve name one weapon; a speed record never rides a build handicap', () => {
    const p = cleared(6);
    const at = { kind: 'boss', region: 2 } as const;
    expect(valid(p, spec(at, [{ kind: 'carry', weapon: 'mortar' }, { kind: 'evolve', weapon: 'arcane-bolt' }]))).toBe(false);
    expect(valid(p, spec(at, [{ kind: 'carry', weapon: 'arcane-bolt' }, { kind: 'evolve', weapon: 'arcane-bolt' }]))).toBe(true);
    expect(valid(p, spec(at, [{ kind: 'within', seconds: 60 }, { kind: 'rule', rule: { kind: 'slots', weapon: 1 } }]))).toBe(false);
    expect(valid(p, spec(at, [{ kind: 'within', seconds: 60 }, { kind: 'carry', weapon: 'mortar' }]))).toBe(false);
    expect(valid(p, spec(at, [{ kind: 'within', seconds: 60 }, { kind: 'noUlt' }]))).toBe(true);
  });

  it('a boss felled once or twice, a wave at the record and a hold past it score as stretches', () => {
    const p = cleared(4);
    const rule: ContractMod = { kind: 'rule', rule: { kind: 'slots', weapon: 2 } };
    const known = score(p, spec({ kind: 'boss', region: 2 }, [rule]));
    p.bosses[REGIONS[1].boss].kills = 1;
    expect(score(p, spec({ kind: 'boss', region: 2 }, [rule]))).toBe(known + 2);
    expect(comfortable(p, { kind: 'boss', region: 2 })).toBe(false);
    p.regions[3] = { bestWave: 20 };
    const far = score(p, spec({ kind: 'wave', region: 3, wave: 10 }, [rule]));
    expect(score(p, spec({ kind: 'wave', region: 3, wave: 20 }, [rule]))).toBe(far + 1.5);
    expect(comfortable(p, { kind: 'wave', region: 3, wave: 20 })).toBe(false);
    expect(comfortable(p, { kind: 'wave', region: 3, wave: 15 })).toBe(true);
    p.regions[1] = { bestWave: 30 };
    const inside = score(p, spec({ kind: 'overtime', region: 1, k: 5 }, [rule]));
    p.regions[1] = { bestWave: 22 };
    expect(score(p, spec({ kind: 'overtime', region: 1, k: 5 }, [rule]))).toBe(inside + 3);
  });

  it('Quick draws only what the tower does with room; no card asks a wave past the record or a quarry it cannot reach', () => {
    // The board has just opened: Forgeheart fell once, the Hollow is new ground.
    const p = cleared(4);
    p.bosses[REGIONS[3].boss].kills = 1;
    p.regions[5] = { bestWave: 9 };
    ensureBoard(p);
    for (let i = 0; i < 1500; i++) {
      const c = p.contracts.board[i % 3];
      const t = c.target;
      if (c.slot === 'quick') expect(comfortable(p, t), contractText(c)).toBe(true);
      if (t.kind === 'wave') expect(t.wave, contractText(c)).toBeLessThanOrEqual((p.regions[t.region]?.bestWave ?? 0) - 2);
      if (c.mods.some((m) => m.kind === 'slay') && t.kind === 'run') {
        expect(p.bosses[REGIONS[t.region - 1].boss]?.kills ?? 0, contractText(c)).toBeGreaterThanOrEqual(3);
      }
      reroll(p, c.id);
    }
  });

  it('a counted name reads as a plural', () => {
    expect(plural('Leech')).toBe('Leeches');
    expect(plural('Grunt')).toBe('Grunts');
    expect(plural('Glaives')).toBe('Glaives');
  });
});

describe('the Wake on the board (plans/late-game/12 §8.11)', () => {
  /** The Blight down and the Wake walked to the Giants' Rest: the Thunderhead stands. */
  function midWake(): Profile {
    const p = cleared(6);
    for (const r of REGIONS) p.pacts.best[r.index] = 4;
    for (const r of WAKE_REGIONS.slice(0, -1)) {
      p.bosses[r.boss] = { kills: 2, fastest: 90 };
      p.regions[r.index] = { bestWave: 22, runs: 3 };
    }
    p.regions[WAKE_REGIONS[WAKE_REGIONS.length - 1].index] = { bestWave: 12, runs: 2 };
    return p;
  }

  it('no floor, guardian or Rush card before the Thunderhead; Wake regions appear as regional targets', () => {
    const p = midWake();
    ensureBoard(p);
    const wake = new Set(WAKE_REGIONS.map((r) => r.index));
    const places = new Set<number>();
    for (let i = 0; i < 1500; i++) {
      for (const c of p.contracts.board) {
        expect(['floor', 'guardian', 'rush'], contractText(c)).not.toContain(c.target.kind);
        expect(valid(p, c), contractText(c)).toBe(true);
        if ('region' in c.target && wake.has(c.target.region)) places.add(c.target.region);
      }
      for (const s of SLOTS) reroll(p, p.contracts.board.find((c) => c.slot === s)!.id);
    }
    expect([...places].sort((a, b) => a - b)).toEqual(WAKE_REGIONS.map((r) => r.index));
  });

  it('the free plan draws no Wake region', () => {
    const p = midWake();
    ensureBoard(p, 'free');
    const wake = new Set(WAKE_REGIONS.map((r) => r.index));
    for (let i = 0; i < 300; i++) {
      for (const c of p.contracts.board) expect('region' in c.target && wake.has(c.target.region), contractText(c)).toBe(false);
      for (const s of SLOTS) reroll(p, p.contracts.board.find((c) => c.slot === s)!.id, 'free');
    }
  });
});
