import { EventBus } from '../game/EventBus';

const STORAGE_KEY = 'the-tower-audio';

interface AudioPrefs {
  volume: number;
  muted: boolean;
}

function loadPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { volume: 0.6, muted: false };
    const parsed = JSON.parse(raw);
    return {
      volume: typeof parsed.volume === 'number' ? Math.max(0, Math.min(1, parsed.volume)) : 0.6,
      muted: !!parsed.muted,
    };
  } catch {
    return { volume: 0.6, muted: false };
  }
}

function savePrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/**
 * AudioManager — procedural Web Audio synthesis.
 * No asset files. Subscribes to game events to play sounds.
 */
export class AudioManager {
  private readonly bus: EventBus;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambientOsc: OscillatorNode | null = null;
  private ambientGain: GainNode | null = null;
  private ambientLfo: OscillatorNode | null = null;
  private volume: number = 0.6;
  private muted: boolean = false;
  private started = false;
  private unsubscribers: Array<() => void> = [];

  constructor(bus: EventBus) {
    this.bus = bus;
    const prefs = loadPrefs();
    this.volume = prefs.volume;
    this.muted = prefs.muted;
  }

  /**
   * Initialize the AudioContext (lazy, on first user gesture).
   */
  ensureContext(): void {
    if (this.started) return;
    try {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
      this.masterGain.connect(this.ctx.destination);
      this.started = true;
      this.attachHandlers();
      this.startAmbient();
    } catch (err) {
      console.warn('[AudioManager] failed to start AudioContext:', err);
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {
        // ignore
      });
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMasterGain();
    savePrefs({ volume: this.volume, muted: this.muted });
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.applyMasterGain();
    savePrefs({ volume: this.volume, muted: this.muted });
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get currentVolume(): number {
    return this.volume;
  }

  tick(_dt: number): void {
    // Currently no per-frame work needed; ambient is LFO-driven.
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
    this.stopAmbient();
    if (this.ctx) {
      this.ctx.close().catch(() => {
        // ignore
      });
      this.ctx = null;
      this.masterGain = null;
    }
  }

  private applyMasterGain(): void {
    if (!this.masterGain || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    // Use setTargetAtTime to avoid clicks
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.03);
  }

  // ─── Event subscriptions ───

  private attachHandlers(): void {
    this.unsubscribers.push(
      this.bus.on('projectile_fired', () => this.playShoot()),
      this.bus.on('enemy_damaged', (p) => this.playHit(p as { killed?: boolean; isCrit?: boolean })),
      this.bus.on('enemy_killed', (p) => this.playKill(p as { type?: string })),
      this.bus.on('ability_cast', () => this.playAbility()),
      this.bus.on('upgrade_purchased', () => this.playUpgrade()),
      this.bus.on('wave_started', (w) => this.playWaveStart(w as number)),
      this.bus.on('ascension_performed', () => this.playAscension()),
      this.bus.on('transcendence_performed', () => this.playAscension()),
      this.bus.on('boss_enraged', () => this.playBossEnrage()),
      this.bus.on('boss_killed', () => this.playBossDeath()),
    );
  }

  // ─── Sound synth primitives ───

  private playTone(opts: {
    freq: number;
    type?: OscillatorType;
    duration: number;
    volume?: number;
    freqEnd?: number;
    attack?: number;
    release?: number;
  }): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = Math.max(0.02, opts.duration);
    const vol = (opts.volume ?? 0.4);
    const attack = opts.attack ?? 0.005;
    const release = opts.release ?? Math.max(0.04, dur * 0.6);

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(opts.freq, now);
    if (opts.freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), now + dur);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + attack);
    g.gain.setValueAtTime(vol, now + dur - release);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private playNoiseHit(duration: number, volume: number = 0.2): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = Math.max(0.03, duration);
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  // ─── Named sounds ───

  private playShoot(): void {
    this.playTone({ freq: 800, type: 'sine', duration: 0.05, volume: 0.18, freqEnd: 600 });
  }

  private playHit(p: { killed?: boolean; isCrit?: boolean }): void {
    if (p.killed) {
      // Death handled in playKill
      return;
    }
    this.playTone({ freq: 200, type: 'square', duration: 0.04, volume: 0.18, freqEnd: 120 });
  }

  private playKill(p: { type?: string }): void {
    if (p.type === 'boss') return; // boss_killed handles this
    // Rising chirp
    this.playTone({ freq: 300, type: 'sine', duration: 0.08, volume: 0.25, freqEnd: 600 });
  }

  private playAbility(): void {
    // Ascending arpeggio — 3 quick notes
    const baseTime = (this.ctx?.currentTime ?? 0);
    if (!this.ctx) return;
    const notes = [520, 700, 940];
    for (let i = 0; i < notes.length; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t0 = baseTime + i * 0.06;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(notes[i], t0);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    }
  }

  private playUpgrade(): void {
    // Cash register cha-ching (two-tone)
    this.playTone({ freq: 600, type: 'triangle', duration: 0.07, volume: 0.22, freqEnd: 600 });
    setTimeout(() => this.playTone({ freq: 1200, type: 'triangle', duration: 0.09, volume: 0.22, freqEnd: 1200 }), 60);
  }

  private playWaveStart(wave: number): void {
    // Dramatic low horn for boss waves
    if (wave % 10 === 0 && wave > 0) {
      this.playTone({ freq: 100, type: 'triangle', duration: 0.4, volume: 0.32, attack: 0.05, release: 0.3 });
    }
  }

  private playAscension(): void {
    if (!this.ctx) return;
    // Long sustained chord
    const baseTime = this.ctx.currentTime;
    const notes = [200, 300, 400];
    for (const freq of notes) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, baseTime);
      g.gain.setValueAtTime(0, baseTime);
      g.gain.linearRampToValueAtTime(0.2, baseTime + 0.1);
      g.gain.setValueAtTime(0.2, baseTime + 1.0);
      g.gain.exponentialRampToValueAtTime(0.0001, baseTime + 1.5);
      osc.connect(g);
      g.connect(this.masterGain!);
      osc.start(baseTime);
      osc.stop(baseTime + 1.55);
    }
  }

  private playBossEnrage(): void {
    if (!this.ctx) return;
    // Rising angry whoosh
    const baseTime = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, baseTime);
    osc.frequency.exponentialRampToValueAtTime(400, baseTime + 0.4);
    g.gain.setValueAtTime(0, baseTime);
    g.gain.linearRampToValueAtTime(0.3, baseTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, baseTime + 0.45);
    osc.connect(g);
    g.connect(this.masterGain!);
    osc.start(baseTime);
    osc.stop(baseTime + 0.5);
  }

  private playBossDeath(): void {
    if (!this.ctx) return;
    // Deep explosion rumble
    this.playTone({ freq: 80, type: 'sawtooth', duration: 0.3, volume: 0.35, attack: 0.01, release: 0.3 });
    this.playNoiseHit(0.4, 0.3);
  }

  // ─── Ambient pad ───

  private startAmbient(): void {
    if (!this.ctx || !this.masterGain) return;
    if (this.ambientOsc) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Main pad oscillator (low triangle)
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(72, now); // ~D2
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.06, now + 2);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);

    // LFO modulating frequency
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.3, now);
    const lfoGainNode = ctx.createGain();
    lfoGainNode.gain.setValueAtTime(6, now);
    lfo.connect(lfoGainNode);
    lfoGainNode.connect(osc.frequency);
    lfo.start(now);

    this.ambientOsc = osc;
    this.ambientGain = g;
    this.ambientLfo = lfo;
  }

  private stopAmbient(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.ambientGain) {
      this.ambientGain.gain.cancelScheduledValues(now);
      this.ambientGain.gain.setValueAtTime(this.ambientGain.gain.value, now);
      this.ambientGain.gain.linearRampToValueAtTime(0, now + 0.3);
    }
    if (this.ambientOsc) {
      try { this.ambientOsc.stop(now + 0.35); } catch { /* ignore */ }
    }
    if (this.ambientLfo) {
      try { this.ambientLfo.stop(now + 0.35); } catch { /* ignore */ }
    }
    this.ambientOsc = null;
    this.ambientGain = null;
    this.ambientLfo = null;
  }
}
