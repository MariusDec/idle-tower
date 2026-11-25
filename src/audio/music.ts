import type { Synth } from './synth';
import type { StratumTone } from '../content/strata';

/**
 * The music (§10.4): no tracks, a slow generative pad on the synth's music
 * bus. Three moods, each a short chord loop in a minor key: the hub drifts,
 * a run walks, a boss fight churns over a pulsing bass. Each region shifts
 * the key, so the Glass Wastes do not sound like the Ashen Fields. A
 * stratum of the Abyss (plans/late-game/08) brings its own tone: its key,
 * its run loop, and a drone, a bell or a pulse under it. Each Act 1 region
 * has a voice too (R10, plans/review-risks.md): a second run loop the run
 * alternates with its own, and a figure over the pad, so four hours in Act 1
 * are not one 16-second loop.
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

/** A region's figure over the run's pad (R10): one small ornament each. */
export type Figure = 'arp' | 'drone' | 'chime' | 'pulse' | 'echo' | 'toll';

/** An Act 1 region's voice in a run (R10). A stratum's tone replaces it. */
export interface RegionVoice {
  /** The run's B section, chords as semitones over the key: two passes of the run's loop, then two of this. */
  readonly loop: readonly (readonly number[])[];
  readonly figure: Figure;
}

/** By region index, 1–6 and the Wake's 9 on. The Abyss has its strata instead. */
export const REGION_VOICES: Readonly<Record<number, RegionVoice>> = {
  // Ashen Fields: i – VII – VI – VII, a plain walk; a rising arpeggio, the first light.
  1: { loop: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-2, 2, 5]], figure: 'arp' },
  // Drowned Mire: i – v – iv – i, heavy and low; a sunk drone.
  2: { loop: [[0, 3, 7], [-5, -2, 2], [-7, -4, 0], [0, 3, 7]], figure: 'drone' },
  // Glass Wastes: i – III – VII – iv, open; a high chime, glass struck.
  3: { loop: [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [5, 8, 12]], figure: 'chime' },
  // Ember Rift: i – VI – iv – V, driven; a slow bass pulse, embers breathing.
  4: { loop: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -1, 2]], figure: 'pulse' },
  // The Hollow: i – iv – i – ♭VI, empty; a note and its echoes, as the Hollow's dead rise again.
  5: { loop: [[0, 3, 7], [5, 8, 12], [0, 3, 7], [-4, 0, 3]], figure: 'echo' },
  // Blight Heart: i – ♭II – ♭vii° – i, sour; a low toll a tritone off the root.
  6: { loop: [[0, 3, 7], [1, 5, 8], [-2, 1, 4], [0, 3, 7]], figure: 'toll' },
  // The Wake (plans/late-game/12 §2). The Bell Marches: i – v – i – ♭VII, the bell answered; the toll.
  9: { loop: [[0, 3, 7], [-5, -2, 2], [0, 3, 7], [-2, 2, 5]], figure: 'toll' },
  // The Orrery: i – III – iv – III, turning round and back; a rising arpeggio, the wheel.
  10: { loop: [[0, 3, 7], [3, 7, 10], [5, 8, 12], [3, 7, 10]], figure: 'arp' },
  // The Frozen Sea: i – ♭VI – ♭VII – ♭VI, cold and wide; a high chime, ice struck.
  11: { loop: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-4, 0, 3]], figure: 'chime' },
  // Giants' Rest: i – iv – v – iv, slow and heavy; a low drone under the great dead.
  12: { loop: [[0, 3, 7], [-7, -4, 0], [-5, -2, 2], [-7, -4, 0]], figure: 'drone' },
  // Stormcrown: i – ♭II – i – ♭VII, restless; a driving pulse under the storm.
  13: { loop: [[0, 3, 7], [1, 5, 8], [0, 3, 7], [-2, 1, 5]], figure: 'pulse' },
};

/** Passes of each section before the other: A A B B. */
const SECTION_PASSES = 2;

/**
 * The chord a run plays at `step`: the run loop `a` for two passes, then the
 * region's `b` for two, and round again. Without a `b`, `a` loops.
 */
export function chordAt(a: readonly (readonly number[])[], b: readonly (readonly number[])[] | null, step: number): readonly number[] {
  if (!b) return a[step % a.length];
  const lenA = a.length * SECTION_PASSES;
  const s = step % (lenA + b.length * SECTION_PASSES);
  return s < lenA ? a[s % a.length] : b[(s - lenA) % b.length];
}

/** The key's root: A2, shifted per region (by region index; the Abyss is its own). */
const ROOT_HZ = 110;
// 7 and 8 (the Abyss, Boss Rush) read their own; 9 on is the Wake (plans/late-game/12 §9.2).
const REGION_SHIFT: readonly number[] = [0, 0, 2, -2, 3, -4, 5, 1, 1, -1, 2, 4, -3, 6];
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
  /** The region's voice (R10), or null: the hub, a boss, the Abyss. */
  private voice: RegionVoice | null = null;

  constructor(private readonly synth: Synth) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** The key's root now, in Hz: the cues that sit on the music's key read it. */
  rootHz(): number {
    return hz(this.shift);
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
    const voice = mood === 'run' && !tone ? REGION_VOICES[region] ?? null : null;
    if (mood !== this.mood || tone !== this.tone || voice !== this.voice) this.step = 0;
    this.mood = mood;
    this.tone = tone;
    this.voice = voice;
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
    // Suspended (the app hidden): the audio clock stands still, so the
    // schedule is kept and picks up where it stopped.
    if (out?.ctx.state === 'suspended') return;
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
    const notes = chordAt(def.loop, this.voice?.loop ?? null, this.step);
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
    if (this.voice) this.figure(ctx, this.voice.figure, notes, def, t0, step);
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

  /** One voice of a figure: an oscillator with a gain envelope into the pad's filter. */
  private voiceAt(ctx: AudioContext, type: OscillatorType, semis: number, t0: number, attack: number, peak: number, end: number, ring = false): void {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz(semis + this.shift);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    if (ring) g.gain.exponentialRampToValueAtTime(0.0001, end);
    else g.gain.linearRampToValueAtTime(0, end);
    osc.connect(g);
    g.connect(this.filter!);
    osc.start(t0);
    osc.stop(end + 0.05);
  }

  /** A region's figure (R10) over one run chord. */
  private figure(ctx: AudioContext, kind: Figure, notes: readonly number[], def: MoodDef, t0: number, step: number): void {
    const len = def.chord;
    const lv = def.level;
    switch (kind) {
      case 'arp': {
        // The chord's tones up an octave, one per beat, in the chord's back half every other chord.
        if (step % 2 === 1) return;
        const beat = len / 4;
        notes.forEach((n, i) => this.voiceAt(ctx, 'sine', n + 12, t0 + beat * (i + 1), 0.01, lv * 0.9, t0 + beat * (i + 1) + beat * 1.6, true));
        return;
      }
      case 'drone':
        // The root two octaves down, sustained into the next chord.
        this.voiceAt(ctx, 'sine', notes[0] - 24, t0, len * 0.3, lv * 1.3, t0 + len * 1.35);
        return;
      case 'chime':
        // The fifth two octaves up, struck, on every chord; a fainter third a beat later.
        this.voiceAt(ctx, 'sine', notes[2] + 24, t0 + 0.02, 0.005, lv * 0.8, t0 + 2.2, true);
        this.voiceAt(ctx, 'sine', notes[1] + 24, t0 + len / 2, 0.005, lv * 0.5, t0 + len / 2 + 1.6, true);
        return;
      case 'pulse':
        // A bass beat each second, softer than the boss's.
        for (let t = t0; t < t0 + len - 1e-6; t += 1) this.voiceAt(ctx, 'sine', notes[0] - 12, t, 0.03, lv * 1.5, t + 0.8, true);
        return;
      case 'echo': {
        // The chord's top, an octave up, and three echoes, each softer, every other chord.
        if (step % 2 === 1) return;
        for (let k = 0; k < 4; k++) {
          const t = t0 + len * 0.25 + k * 0.45;
          this.voiceAt(ctx, 'triangle', notes[notes.length - 1] + 12, t, 0.01, lv * 0.8 * Math.pow(0.5, k), t + 0.9, true);
        }
        return;
      }
      case 'toll':
        // A low bell a tritone off the root, every second chord.
        if (step % 2 === 1) return;
        this.voiceAt(ctx, 'sine', notes[0] - 6, t0, 0.01, lv * 1.6, t0 + 3, true);
        this.voiceAt(ctx, 'sine', notes[0] + 6, t0, 0.01, lv * 0.6, t0 + 2, true);
        return;
    }
  }
}
