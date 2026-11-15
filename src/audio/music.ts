import type { Synth } from './synth';
import type { StratumTone } from '../content/strata';

/**
 * The music (§10.4): no tracks, a slow generative pad on the synth's music
 * bus. Three moods, each a short chord loop in a minor key: the hub drifts,
 * a run walks, a boss fight churns over a pulsing bass. Each region shifts
 * the key, so the Glass Wastes do not sound like the Ashen Fields. A
 * stratum of the Abyss (plans/late-game/08) brings its own tone: its key,
 * its run loop, and a drone, a bell or a pulse under it.
 *
 * A wall-clock timer schedules each chord a little ahead on the audio
 * clock. Nothing is scheduled while the music could not be heard, so a
 * muted game costs nothing but the timer.
 */
export type Mood = 'hub' | 'run' | 'boss';

interface MoodDef {
  /** Seconds a chord holds. */
  chord: number;
  /** Chords as semitones above the key's root, each a triad or so. */
  loop: readonly (readonly number[])[];
  /** Lowpass cutoff in Hz: darker for the hub, brighter for a fight. */
  cutoff: number;
  /** Peak gain of each voice. */
  level: number;
  /** A bass pulse on each beat of this many seconds; 0 for none. */
  pulse: number;
}

const MOODS: Readonly<Record<Mood, MoodDef>> = {
  // i – VI – III – VII
  hub: { chord: 6, loop: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]], cutoff: 900, level: 0.05, pulse: 0 },
  // i – iv – VI – V
  run: { chord: 4, loop: [[0, 3, 7], [5, 8, 12], [-4, 0, 3], [-5, -1, 2]], cutoff: 1300, level: 0.045, pulse: 0 },
  // i – ♭II, Phrygian: the dread of the boss wave.
  boss: { chord: 3, loop: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [1, 5, 10]], cutoff: 1700, level: 0.05, pulse: 0.5 },
};

/** The key's root: A2, shifted per region (by region index; the Abyss is its own). */
const ROOT_HZ = 110;
const REGION_SHIFT: readonly number[] = [0, 0, 2, -2, 3, -4, 5, 1];
/** How far ahead of the audio clock chords are scheduled, and how often the timer looks. */
const LOOKAHEAD = 0.6;
const TICK_MS = 200;

function hz(semitones: number): number {
  return ROOT_HZ * Math.pow(2, semitones / 12);
}

export class Music {
  private mood: Mood = 'hub';
  private shift = 0;
  /** Audio-clock time the next chord starts; 0 until the first is scheduled. */
  private next = 0;
  private step = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private filter: BiquadFilterNode | null = null;
  /** The pad's duck (plans/late-game/02: −6 dB while a rift is chosen). */
  private duckGain: GainNode | null = null;
  private ducked = false;
  /** Final Form (plans/late-game/07): a high voice over each run chord until the run ends. */
  private formed = false;
  /** A stratum's tone (plans/late-game/08), or null for the region's. */
  private tone: StratumTone | null = null;

  constructor(private readonly synth: Synth) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Duck the pad 6 dB (a rift being chosen), or bring it back. */
  duck(on: boolean): void {
    this.ducked = on;
  }

  /** Final Form's layer on or off; it lands on the next chord. Never over the hub. */
  setFormed(on: boolean): void {
    this.formed = on;
  }

  /** The mood and region to play, and a stratum's tone over them; a change lands on the next chord. */
  set(mood: Mood, region: number, tone: StratumTone | null = null): void {
    if (mood !== this.mood || tone !== this.tone) this.step = 0;
    this.mood = mood;
    this.tone = tone;
    this.shift = tone ? tone.shift : REGION_SHIFT[region] ?? REGION_SHIFT[REGION_SHIFT.length - 1];
  }

  /** The mood as played now: a stratum's tone recasts the run's loop; a boss keeps its churn, in the stratum's key. */
  private def(): MoodDef {
    const base = MOODS[this.mood];
    const t = this.tone;
    if (!t || this.mood !== 'run') return base;
    return {
      ...base,
      loop: t.loop ?? base.loop,
      chord: t.chord ?? base.chord,
      cutoff: t.cutoff ?? base.cutoff,
      pulse: t.pulse ?? base.pulse,
    };
  }

  private tick(): void {
    const out = this.synth.musicOut;
    if (!out || !this.synth.audible || !this.synth.musicOn) {
      this.next = 0;
      return;
    }
    const { ctx, bus } = out;
    if (!this.filter) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.duckGain = ctx.createGain();
      this.filter.connect(this.duckGain);
      this.duckGain.connect(bus);
    }
    this.duckGain!.gain.setTargetAtTime(this.ducked ? 0.5 : 1, ctx.currentTime, 0.08);
    const now = ctx.currentTime;
    if (this.next < now) this.next = now + 0.05;
    while (this.next < now + LOOKAHEAD) {
      const len = this.def().chord;
      this.chord(ctx, this.next);
      this.next += len;
    }
  }

  /** One chord at `t0`: soft triangle voices that swell and fade into the next. */
  private chord(ctx: AudioContext, t0: number): void {
    const def = this.def();
    const notes = def.loop[this.step % def.loop.length];
    const step = this.step++;
    this.filter!.frequency.setTargetAtTime(def.cutoff, t0, 0.5);
    const end = t0 + def.chord * 1.35;
    for (const [i, n] of [...notes, notes[0] - 12].entries()) {
      const osc = ctx.createOscillator();
      osc.type = i === notes.length ? 'sine' : 'triangle';
      osc.frequency.value = hz(n + this.shift);
      // A slight detune per voice, so the pad breathes.
      osc.detune.value = (i - 1) * 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(def.level, t0 + def.chord * 0.35);
      g.gain.linearRampToValueAtTime(def.level * 0.7, t0 + def.chord);
      g.gain.linearRampToValueAtTime(0, end);
      osc.connect(g);
      g.connect(this.filter!);
      osc.start(t0);
      osc.stop(end + 0.05);
    }
    if (this.formed && this.mood !== 'hub') {
      // One more triangle, an octave over the chord's third voice, entering late and soft.
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(notes[2] + 12 + this.shift);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(def.level * 0.6, t0 + def.chord * 0.5);
      g.gain.linearRampToValueAtTime(0, end);
      osc.connect(g);
      g.connect(this.filter!);
      osc.start(t0);
      osc.stop(end + 0.05);
    }
    const tone = this.mood === 'hub' ? null : this.tone;
    if (tone?.drone) {
      // A low root, sustained under the floor: two octaves down, overlapping the next.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz(this.shift - 24);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(def.level * 1.4, t0 + def.chord * 0.3);
      g.gain.linearRampToValueAtTime(0, end);
      osc.connect(g);
      g.connect(this.filter!);
      osc.start(t0);
      osc.stop(end + 0.05);
    }
    if (tone?.bell && this.mood === 'run' && step % 2 === 0) {
      // The gate's bell: a sine a tenth over the octave, struck and let ring.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz(notes[0] + 19 + this.shift);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(def.level * 1.6, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      osc.connect(g);
      g.connect(this.filter!);
      osc.start(t0);
      osc.stop(t0 + 2.5);
    }
    if (def.pulse > 0) {
      for (let t = t0; t < t0 + def.chord - 1e-6; t += def.pulse) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz(notes[0] + this.shift - 12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(def.level * 2.2, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + def.pulse * 0.8);
        osc.connect(g);
        g.connect(this.filter!);
        osc.start(t);
        osc.stop(t + def.pulse);
      }
    }
  }
}
