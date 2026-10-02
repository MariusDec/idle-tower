/**
 * The Web Audio synth (§10.4), ported from the legacy `AudioManager`: no
 * asset files, every sound a short oscillator or noise burst. The context
 * starts on the first user gesture, as browsers require; before that, and
 * with the sound off, every call is a no-op.
 */

export interface Tone {
  freq: number;
  type?: OscillatorType;
  /** Seconds. */
  duration: number;
  volume?: number;
  /** Glide to this frequency over the tone. */
  freqEnd?: number;
  attack?: number;
  /** Seconds after `delay` before it starts: for arpeggios. */
  delay?: number;
}

/** The master level with the sound on and the slider full. */
const MASTER = 0.5;

/** The player's levels, 0–1 each (§10.4). */
export interface Volumes {
  master: number;
  sfx: number;
  music: number;
}

/**
 * Two buses under the master: effects (every `tone` and `noise`) and music
 * (`Music` plays into `musicBus`). The sound switch and the master slider
 * both act on the master, so muting never loses the player's levels.
 */
export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private on = true;
  private volumes: Volumes = { master: 1, sfx: 1, music: 1 };
  /** One cached second of white noise, sliced for every burst. */
  private noiseBuffer: AudioBuffer | null = null;

  /** Start the context; call from a user gesture. Safe to call again. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.masterLevel();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = this.volumes.sfx;
      this.sfx.connect(this.master);
      this.music = this.ctx.createGain();
      this.music.gain.value = this.volumes.music;
      this.music.connect(this.master);
    } catch (err) {
      console.warn('[audio] no AudioContext', err);
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.glide(this.master, this.masterLevel());
  }

  setVolumes(v: Volumes): void {
    this.volumes = { ...v };
    this.glide(this.master, this.masterLevel());
    this.glide(this.sfx, v.sfx);
    this.glide(this.music, v.music);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** True when an effect would be heard: worth the caller's throttling work. */
  get live(): boolean {
    return this.audible && this.volumes.sfx > 0;
  }

  /** True when anything at all would be heard. */
  get audible(): boolean {
    return this.on && this.volumes.master > 0 && this.ctx !== null && this.ctx.state === 'running';
  }

  /** True when the music slider is up. */
  get musicOn(): boolean {
    return this.volumes.music > 0;
  }

  /** The running context and the music bus, for `Music`; null until started. */
  get musicOut(): { ctx: AudioContext; bus: GainNode } | null {
    return this.ctx && this.music ? { ctx: this.ctx, bus: this.music } : null;
  }

  private masterLevel(): number {
    return this.on ? MASTER * this.volumes.master : 0;
  }

  /** A short glide to `level`, so a change never clicks. */
  private glide(node: GainNode | null, level: number): void {
    if (!this.ctx || !node) return;
    const now = this.ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(level, now, 0.03);
  }

  tone(t: Tone): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (t.delay ?? 0);
    const dur = Math.max(0.02, t.duration);
    const vol = t.volume ?? 0.3;
    const attack = t.attack ?? 0.005;
    const osc = ctx.createOscillator();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, t0);
    if (t.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, t.freqEnd), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.sfx!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A filtered noise burst: hits, blasts, rumbles. */
  noise(duration: number, volume: number, cutoff = 1800, type: BiquadFilterType = 'lowpass'): void {
    if (!this.live) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const dur = Math.max(0.03, Math.min(1, duration));
    if (!this.noiseBuffer) {
      const n = ctx.sampleRate;
      this.noiseBuffer = ctx.createBuffer(1, n, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx!);
    src.start(now, Math.random() * 0.5);
    src.stop(now + dur + 0.02);
  }
}
