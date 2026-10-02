import type { Synth } from './synth';

/**
 * The music (§10.4): no tracks, a slow generative pad on the synth's music
 * bus. Three moods, each a short chord loop in a minor key: the hub drifts,
 * a run walks, a boss fight churns over a pulsing bass. Each region shifts
 * the key, so the Glass Wastes do not sound like the Ashen Fields.
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

  constructor(private readonly synth: Synth) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** The mood and region to play; a change lands on the next chord. */
  set(mood: Mood, region: number): void {
    if (mood !== this.mood) this.step = 0;
    this.mood = mood;
    this.shift = REGION_SHIFT[region] ?? REGION_SHIFT[REGION_SHIFT.length - 1];
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
      this.filter.connect(bus);
    }
    const now = ctx.currentTime;
    if (this.next < now) this.next = now + 0.05;
    while (this.next < now + LOOKAHEAD) {
      this.chord(ctx, this.next);
      this.next += MOODS[this.mood].chord;
    }
  }

  /** One chord at `t0`: soft triangle voices that swell and fade into the next. */
  private chord(ctx: AudioContext, t0: number): void {
    const def = MOODS[this.mood];
    const notes = def.loop[this.step % def.loop.length];
    this.step++;
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
