import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chordAt, Music, REGION_VOICES } from '../src/audio/music';
import { Synth } from '../src/audio/synth';
import { REGIONS } from '../src/content/regions';

/**
 * R10 (plans/review-risks.md): the music gets repetitive over a 4 h session.
 * Each Act 1 region gets a voice: a second run loop played A A B B against
 * the run's own, and a figure over the pad. And the audio stops while the
 * app is hidden (minimised on Android), and comes back with it.
 */

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const RUN_LOOP = [[0, 3, 7], [5, 8, 12], [-4, 0, 3], [-5, -1, 2]];

describe('R10: a voice per Act 1 region', () => {
  const act1 = REGIONS.filter((r) => r.index >= 1 && r.index <= 6);

  it('gives every Act 1 region a voice, each with its own figure', () => {
    expect(act1).toHaveLength(6);
    for (const r of act1) expect(REGION_VOICES[r.index], r.name).toBeDefined();
    const figures = act1.map((r) => REGION_VOICES[r.index].figure);
    expect(new Set(figures).size).toBe(6);
  });

  it('gives every region a B section unlike the run loop and unlike each other', () => {
    const loops = act1.map((r) => JSON.stringify(REGION_VOICES[r.index].loop));
    expect(new Set(loops).size).toBe(6);
    for (const l of loops) expect(l).not.toBe(JSON.stringify(RUN_LOOP));
  });

  it('keeps every chord a triad near the root, tonic first', () => {
    for (const r of act1) {
      const { loop } = REGION_VOICES[r.index];
      expect(loop[0]).toEqual([0, 3, 7]);
      for (const c of loop) {
        expect(c).toHaveLength(3);
        for (const n of c) expect(Math.abs(n)).toBeLessThanOrEqual(12);
      }
    }
  });

  it('plays A A B B, then round again', () => {
    const b = REGION_VOICES[1].loop;
    const played = Array.from({ length: 32 }, (_, i) => chordAt(RUN_LOOP, b, i));
    expect(played.slice(0, 8)).toEqual([...RUN_LOOP, ...RUN_LOOP]);
    expect(played.slice(8, 16)).toEqual([...b, ...b]);
    expect(played.slice(16, 32)).toEqual(played.slice(0, 16));
  });

  it('loops A alone without a voice', () => {
    for (let i = 0; i < 12; i++) expect(chordAt(RUN_LOOP, null, i)).toEqual(RUN_LOOP[i % 4]);
  });
});

/** An AudioContext that counts its oscillators, and a synth that hands it out. */
function fakeAudio(state: AudioContextState) {
  let oscillators = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, gain: param(), frequency: param(), detune: param(), type: '' });
  const ctx = {
    state,
    currentTime: 10,
    createBiquadFilter: node,
    createGain: node,
    createOscillator: () => {
      oscillators++;
      return { ...node(), start() {}, stop() {} };
    },
  };
  const synth = { musicOut: { ctx, bus: node() }, audible: state === 'running', musicOn: true };
  return { ctx, synth, count: () => oscillators };
}

describe('R10: hidden, the audio stops', () => {
  it('suspends a running context when hidden and resumes it when shown', async () => {
    const calls: string[] = [];
    const ctx = {
      state: 'running' as AudioContextState,
      suspend: async () => { calls.push('suspend'); ctx.state = 'suspended'; },
      resume: async () => { calls.push('resume'); ctx.state = 'running'; },
    };
    const synth = new Synth();
    (synth as unknown as { ctx: typeof ctx }).ctx = ctx;
    synth.setHidden(true);
    await Promise.resolve();
    synth.setHidden(true);
    expect(synth.audible).toBe(false);
    synth.setHidden(false);
    await Promise.resolve();
    synth.setHidden(false);
    expect(calls).toEqual(['suspend', 'resume']);
    expect(synth.audible).toBe(true);
  });

  it('does nothing before the first gesture made a context', () => {
    expect(() => new Synth().setHidden(true)).not.toThrow();
  });

  it('schedules nothing while suspended, and keeps its place on the clock', () => {
    const a = fakeAudio('running');
    const music = new Music(a.synth as unknown as Synth);
    music.set('run', 3);
    const tick = (): void => (music as unknown as { tick(): void }).tick();
    tick();
    const scheduled = a.count();
    const next = (music as unknown as { next: number }).next;
    expect(scheduled).toBeGreaterThan(0);
    (a.ctx as { state: AudioContextState }).state = 'suspended';
    a.synth.audible = false;
    tick();
    tick();
    expect(a.count()).toBe(scheduled);
    expect((music as unknown as { next: number }).next).toBe(next);
  });

  it('is wired to the app going away and coming back', () => {
    const app = read('src/app/App.ts');
    const hidden = app.slice(app.indexOf('private hidden(): Promise<void>'), app.indexOf('private absent('));
    expect(hidden).toContain('this.synth.setHidden(true)');
    const absent = app.slice(app.indexOf('private absent('), app.indexOf('/** The HUD\'s Autocaster switch'));
    expect(absent).toMatch(/visibilityState !== 'hidden'\) \{[^}]*this\.synth\.setHidden\(false\)/s);
  });
});
