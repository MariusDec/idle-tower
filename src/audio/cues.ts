import type { WeaponId } from '../content/types';
import type { SimEvent } from '../sim/state';
import type { Synth } from './synth';

/**
 * The cue map (§10.4): which sim events make a sound, and what sound. Each
 * weapon has its own shot, quiet and pitch-varied so a busy build hums
 * rather than drills. A cue that can fire many times a frame is throttled
 * on the wall clock: past a few a second the ear hears one.
 */

/** Least milliseconds between two plays of the same cue. */
const GAP_MS: Readonly<Record<string, number>> = {
  shot: 55,
  hit: 45,
  crit: 70,
  kill: 40,
  blast: 70,
  ignite: 120,
  shatter: 80,
  towerHit: 90,
  lance: 120,
  rune: 70,
  shell: 60,
  // Several drafts taken at once (U2) chime once.
  picked: 150,
};

/** Each weapon's shot (§10.4): a pattern you could pick out with your eyes shut. */
function shot(s: Synth, weapon: WeaponId, pitch: number): void {
  switch (weapon) {
    case 'arcane-bolt':
      s.tone({ freq: 820 * pitch, freqEnd: 560 * pitch, type: 'sine', duration: 0.06, volume: 0.09 });
      return;
    case 'scattershot':
      s.noise(0.07, 0.1, 2600 * pitch, 'bandpass');
      s.tone({ freq: 220 * pitch, freqEnd: 130, type: 'square', duration: 0.05, volume: 0.04 });
      return;
    case 'chain-lightning':
      s.noise(0.09, 0.08, 5200, 'highpass');
      s.tone({ freq: 1400 * pitch, freqEnd: 700, type: 'sawtooth', duration: 0.07, volume: 0.035 });
      return;
    case 'frost-ring':
      s.tone({ freq: 1250 * pitch, freqEnd: 1800 * pitch, type: 'triangle', duration: 0.18, volume: 0.06, attack: 0.02 });
      return;
    case 'mortar':
      s.tone({ freq: 140 * pitch, freqEnd: 70, type: 'triangle', duration: 0.12, volume: 0.14 });
      s.noise(0.06, 0.06, 900);
      return;
    case 'sunlance':
      s.tone({ freq: 520 * pitch, freqEnd: 540 * pitch, type: 'sawtooth', duration: 0.09, volume: 0.025, attack: 0.02 });
      return;
    case 'glaives':
      s.noise(0.05, 0.05, 3200, 'bandpass');
      return;
    case 'sentinel-drones':
      s.tone({ freq: 1600 * pitch, freqEnd: 1100 * pitch, type: 'square', duration: 0.035, volume: 0.025 });
      return;
    case 'moonblade':
      // A whoosh that bends up as the crescent leaves.
      s.noise(0.12, 0.05, 1800 * pitch, 'bandpass');
      s.tone({ freq: 380 * pitch, freqEnd: 620 * pitch, type: 'sine', duration: 0.12, volume: 0.05 });
      return;
    case 'rune-traps':
      s.tone({ freq: 660 * pitch, freqEnd: 990 * pitch, type: 'triangle', duration: 0.08, volume: 0.04 });
      return;
    case 'soul-tether':
      s.tone({ freq: 300 * pitch, freqEnd: 290 * pitch, type: 'sine', duration: 0.05, volume: 0.025 });
      return;
    case 'gilded-rail':
      // The slug: a crack and a ringing rail.
      s.noise(0.08, 0.16, 4200, 'highpass');
      s.tone({ freq: 1800 * pitch, freqEnd: 240, type: 'sawtooth', duration: 0.22, volume: 0.07 });
      return;
    default: {
      const exhaustive: never = weapon;
      return exhaustive;
    }
  }
}

export class Cues {
  private readonly last = new Map<string, number>();

  constructor(private readonly synth: Synth) {}

  /** True, and the clock reset, when `cue` may play now. */
  private ready(cue: string, now: number): boolean {
    const gap = GAP_MS[cue] ?? 0;
    const prev = this.last.get(cue) ?? -Infinity;
    if (now - prev < gap) return false;
    this.last.set(cue, now);
    return true;
  }

  /** Sound this frame's sim events. */
  play(events: readonly SimEvent[]): void {
    const s = this.synth;
    if (!s.live || events.length === 0) return;
    const now = performance.now();
    for (const ev of events) {
      switch (ev.kind) {
        case 'fire':
          // Per weapon, so two weapons firing together are both heard.
          if (this.ready(`shot:${ev.weapon}`, now) && this.ready('shot', now - (GAP_MS.shot * 0.6))) {
            shot(s, ev.weapon, 0.92 + Math.random() * 0.16);
          }
          break;
        case 'hit':
          if (ev.crit) {
            if (this.ready('crit', now)) s.tone({ freq: 1500, freqEnd: 2100, type: 'triangle', duration: 0.07, volume: 0.07 });
          } else if (this.ready('hit', now)) {
            s.tone({ freq: 200, freqEnd: 120, type: 'square', duration: 0.035, volume: 0.035 });
          }
          break;
        case 'kill':
          if (this.ready('kill', now)) s.tone({ freq: 300, freqEnd: 600, type: 'sine', duration: 0.07, volume: 0.08 });
          break;
        case 'blast':
          if (ev.style === 'shatter') {
            if (this.ready('shatter', now)) s.tone({ freq: 2400, freqEnd: 900, type: 'triangle', duration: 0.12, volume: 0.07 });
          } else if (this.ready('blast', now)) {
            const big = ev.style === 'meteor';
            s.noise(big ? 0.45 : 0.18, big ? 0.24 : 0.12, big ? 700 : 1400);
            s.tone({ freq: big ? 90 : 120, freqEnd: 45, type: 'triangle', duration: big ? 0.35 : 0.14, volume: big ? 0.2 : 0.1 });
          }
          break;
        case 'ignite':
          if (this.ready('ignite', now)) s.noise(0.15, 0.04, 1200, 'bandpass');
          break;
        case 'lance':
          if (this.ready('lance', now)) s.tone({ freq: 880, freqEnd: 1320, type: 'sawtooth', duration: 0.1, volume: 0.04 });
          break;
        case 'eliteSpawn':
          s.tone({ freq: 160, freqEnd: 240, type: 'sawtooth', duration: 0.35, volume: 0.1, attack: 0.04 });
          break;
        case 'towerHit':
          if (this.ready('towerHit', now)) s.noise(0.12, 0.12, 600);
          break;
        case 'fell':
          s.tone({ freq: 220, freqEnd: 40, type: 'sawtooth', duration: 1.1, volume: 0.2, attack: 0.02 });
          s.noise(0.8, 0.2, 500);
          break;
        case 'levelUp':
          s.tone({ freq: 660, type: 'triangle', duration: 0.09, volume: 0.12 });
          s.tone({ freq: 990, type: 'triangle', duration: 0.12, volume: 0.12, delay: 0.07 });
          break;
        case 'picked':
          if (this.ready('picked', now)) s.tone({ freq: 740, freqEnd: 880, type: 'sine', duration: 0.08, volume: 0.1 });
          break;
        case 'evolve':
        case 'fuse':
          for (const [i, f] of [392, 523, 659, 784, 1047].entries()) {
            s.tone({ freq: f, type: 'triangle', duration: 0.5 - i * 0.05, volume: 0.12, delay: i * 0.08 });
          }
          break;
        case 'rune':
          if (ev.burst && this.ready('rune', now)) {
            s.noise(0.12, 0.1, 1600, 'bandpass');
            s.tone({ freq: 440, freqEnd: 180, type: 'triangle', duration: 0.12, volume: 0.08 });
          }
          break;
        case 'shell':
          if (this.ready('shell', now)) s.tone({ freq: 1100, freqEnd: 900, type: 'square', duration: 0.03, volume: 0.03 });
          break;
        case 'plateBreak':
          // Iron giving way: a low clank and grit.
          s.noise(0.18, 0.14, 900, 'lowpass');
          s.tone({ freq: 160, freqEnd: 70, type: 'square', duration: 0.25, volume: 0.1 });
          break;
        case 'floor':
          for (const [i, f] of [392, 494, 587, 784].entries()) s.tone({ freq: f, type: 'sine', duration: 0.6, volume: 0.1, delay: i * 0.1 });
          break;
        case 'nova':
        case 'aegis':
        case 'ultStart':
        case 'eclipse':
          for (const [i, f] of [520, 700, 940].entries()) s.tone({ freq: f, type: 'triangle', duration: 0.1, volume: 0.15, delay: i * 0.06 });
          break;
        case 'bossArrive':
          s.tone({ freq: 70, type: 'triangle', duration: 1.2, volume: 0.25, attack: 0.1 });
          s.tone({ freq: 105, type: 'sawtooth', duration: 1, volume: 0.06, attack: 0.3 });
          break;
        case 'bossKill':
          s.tone({ freq: 80, type: 'sawtooth', duration: 0.5, volume: 0.25 });
          s.noise(0.7, 0.28, 900);
          for (const [i, f] of [523, 659, 784].entries()) s.tone({ freq: f, type: 'sine', duration: 0.9, volume: 0.1, delay: 0.35 + i * 0.12 });
          break;
        case 'cleared':
          for (const [i, f] of [523, 659, 784, 1047].entries()) s.tone({ freq: f, type: 'triangle', duration: 1.2, volume: 0.12, delay: i * 0.15 });
          break;
        case 'enrage':
          s.tone({ freq: 120, freqEnd: 400, type: 'sawtooth', duration: 0.45, volume: 0.15 });
          break;
        case 'relicDrop':
          s.tone({ freq: 880, type: 'sine', duration: 0.4, volume: 0.1 });
          s.tone({ freq: 1320, type: 'sine', duration: 0.5, volume: 0.08, delay: 0.1 });
          break;
        default:
          break;
      }
    }
  }

  /** Something opened up (§10.4: reveal/unlock): a bright rising arpeggio. */
  unlock(): void {
    for (const [i, f] of [523, 659, 784, 1047, 1319].entries()) {
      this.synth.tone({ freq: f, type: 'sine', duration: 0.35, volume: 0.09, delay: i * 0.07 });
    }
  }

  /** A feat claimed: a coin's chime. */
  claim(): void {
    this.synth.tone({ freq: 1320, type: 'triangle', duration: 0.12, volume: 0.1 });
    this.synth.tone({ freq: 1760, type: 'sine', duration: 0.3, volume: 0.08, delay: 0.07 });
  }

  /** A Forge purchase (§10.4): two rising notes. */
  purchase(): void {
    this.synth.tone({ freq: 600, type: 'triangle', duration: 0.08, volume: 0.15 });
    this.synth.tone({ freq: 1200, type: 'triangle', duration: 0.1, volume: 0.15, delay: 0.06 });
  }
}
