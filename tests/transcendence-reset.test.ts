/**
 * What a transcendence actually takes back.
 *
 * A transcendence is the game's one full wipe of a cycle: the AP layer, the
 * passive track, research and the run itself. Three separate holes let a new
 * cycle open holding the last one's progress, and every one of them is silent
 * — the game looks *generous* when it breaks, so nothing but a test catches it.
 *
 * 1. `WaveManager.startAtWave` kept the previous run's `highestWave`, and the
 *    reset path uses it whenever a head start puts the new run above wave 1.
 *    `highestWave` is what gates ascension (and prices its AP), mana and every
 *    ability, so a fresh cycle opened fully unlocked and could ascend at wave 1
 *    for the *old* run's payout.
 * 2. The passive unlock gate read the lifetime wave mark, so passives wiped by
 *    the transcendence were immediately re-buyable.
 * 3. Research was never cleared, though the docs, the transcendence panel's own
 *    note and the comment beside the code all say it is.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventBus } from '../src/game/EventBus';
import { EnemyManager } from '../src/systems/EnemyManager';
import { ResourceManager } from '../src/systems/ResourceManager';
import { WaveManager } from '../src/systems/WaveManager';
import { PassiveAbilityManager } from '../src/systems/PassiveAbilityManager';
import { PASSIVE_ABILITIES } from '../src/data/passiveAbilities';
import { world } from '../src/data/arena';
import type { GameStats, PassiveAbilityState, ResourceState } from '../src/types';

const ARENA_W = world(800);
const ARENA_H = world(600);

function waveManager(): WaveManager {
  const bus = new EventBus();
  const state: ResourceState = {
    gold: 0,
    mana: 0,
    maxMana: 100,
    manaRegen: 0,
    ascensionPoints: 0,
    apThisTranscendence: 0,
    transcendencePoints: 0,
    lifetimeAP: 0,
    lifetimeGold: 0,
  };
  const resources = new ResourceManager(bus, state, { goldEarned: 0 } as unknown as GameStats);
  const enemies = new EnemyManager(bus, resources);
  return new WaveManager(bus, enemies, ARENA_W, ARENA_H, () => {}, () => {});
}

describe('the wave high-water mark across a run reset', () => {
  it('carries the mark through a jump inside the run', () => {
    const waves = waveManager();
    waves.startAtWave(60);
    expect(waves.snapshot.highestWave).toBe(60);
    // A death rewind is still the same run: it reached wave 60.
    waves.startAtWave(59);
    expect(waves.snapshot.highestWave).toBe(60);
  });

  it('drops the mark to the opening wave of a fresh run', () => {
    const waves = waveManager();
    waves.startAtWave(60);
    // The reset path an ascension/transcendence takes when research, talents or
    // the `veteran_start` Watch unlock open the run above wave 1.
    waves.startAtWave(6, { freshRun: true });
    expect(waves.snapshot.number).toBe(6);
    expect(waves.snapshot.highestWave).toBe(6);
  });

  it('is what `applySavedStateReset` asks for', () => {
    const src = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/startAtWave\(startWave, \{ freshRun: true \}\)/);
  });
});

describe('the passive unlock gate is scoped to the transcendence cycle', () => {
  function passives(): { mgr: PassiveAbilityManager; state: Record<string, PassiveAbilityState> } {
    const state: Record<string, PassiveAbilityState> = {};
    const mgr = new PassiveAbilityManager(state, new EventBus());
    mgr.ensureInitialized();
    return { mgr, state };
  }

  const deep = [...PASSIVE_ABILITIES].sort((a, b) => b.unlockWave - a.unlockWave)[0];

  it('opens a passive once the cycle has reached its wave', () => {
    const { mgr } = passives();
    expect(mgr.canUnlock(deep.id, deep.unlockWave - 1)).toBe(false);
    expect(mgr.canUnlock(deep.id, deep.unlockWave)).toBe(true);
  });

  it('closes it again for a cycle that has not', () => {
    const { mgr } = passives();
    // The transcendence wiped the track and reset the cycle mark; the lifetime
    // mark is still deep, and must not be what answers here.
    mgr.reset();
    expect(mgr.canUnlock(deep.id, 1)).toBe(false);
  });

  it('reads the cycle mark, not the lifetime one, everywhere in Game', () => {
    const src = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/canUnlock\(id, this\.state\.stats\.lifetimeHighestWave\)/);
    expect(src.match(/canUnlock\(id, this\.state\.stats\.highestWaveThisTranscendence\)/g))
      .toHaveLength(2);
    // The panel's "Unlocks at wave N" line has to agree with the gate.
    expect(src).toMatch(/highestWave: \(\) => this\.state\.stats\.highestWaveThisTranscendence/);
  });
});

describe('transcendence clears research', () => {
  it('wipes levels, RP and the in-progress node before the run reset', () => {
    const src = readFileSync(new URL('../src/game/Game.ts', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('private applyFullTranscendenceReset()'));
    const reset = body.slice(0, body.indexOf('\n  private applyPersistedState'));
    expect(reset).toMatch(/this\.researchTree\.replaceLevels\(\{\}, 0, null\)/);
    expect(reset).toMatch(/this\.state\.research = \{\}/);
    expect(reset).toMatch(/this\.state\.researchInProgress = null/);
    // Order matters: `applySavedStateReset` reads `getStartWave()` to open the
    // new run, so a research clear after it would still hand out the head start.
    expect(reset.indexOf('replaceLevels')).toBeLessThan(reset.indexOf('applySavedStateReset()'));
    // The cycle's passive gate restarts with the cycle.
    expect(reset).toMatch(/highestWaveThisTranscendence = this\.state\.wave\.highestWave/);
  });

  it('says so on the transcendence panel', () => {
    const panel = readFileSync(new URL('../src/ui/TranscendencePanel.ts', import.meta.url), 'utf8');
    expect(panel).toMatch(/passives, research and the whole ascension layer/);
    expect(panel).not.toMatch(/tower XP, research, achievements and equipment carry over/);
  });
});
