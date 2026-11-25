import { BALANCE } from '../../content/balance';
import { frameById } from '../../content/frames';
import { weaponParams } from '../../content/weapons';
import type { Enemy, RunState } from '../state';
import { Rng } from '../../core/rng';
import { BOSS_BY_ID } from '../../content/bosses';
import { phasesOf, staggerBoss } from './boss';
import { damageEnemy, knockBack, targetable } from './combat';
import { runRegion, runWave, waveHp } from './waves';
import { healTower } from './tower';

/**
 * The frame's ultimate (§4.4): charged by kills (see `kill`), fired on the
 * player's tap. Each cast makes the next charge longer.
 */
export function castUltimate(run: RunState): boolean {
  const u = run.ult;
  if (u.charge < 1) return false;
  const c = run.capstones;
  // Engineering Mastery (plans/mastery-capstones.md): kills while it goes off refund (rank 2).
  c.casting = true;
  unleash(run, false);
  c.casting = false;
  u.charge = 0;
  u.casts++;
  u.need *= BALANCE.ultimate.growth;
  // Hollow Crown (§11.5): each cast mends the tower.
  const crown = run.behaviours['ult-heal'] ?? 0;
  if (crown > 0) {
    const R = BALANCE.relics.ultHeal;
    healTower(run, run.stats.maxHp * R[Math.min(crown, R.length) - 1]);
  }
  const rank = run.behaviours['engineering-capstone'] ?? 0;
  if (rank > 0) {
    // Rank 1: an echo, for no charge. Ranks 2–3: what the full charge couldn't hold comes back now.
    c.echoAt = run.time + BALANCE.capstones.echoDelay;
    const carry = c.chargeBank + c.refund;
    c.chargeBank = 0;
    c.refund = 0;
    if (carry > 0) addUltCharge(run, carry);
  }
  return true;
}

/**
 * The ultimate going off: the cast, or (`echo`) Engineering Mastery's echo
 * at `echoShare` of its strength. Aegis and the lasting ones echo shorter,
 * not weaker: their time is the share.
 */
function unleash(run: RunState, echo: boolean): void {
  const u = run.ult;
  const frame = frameById(run.frameId);
  const ult = frame.ultimate;
  const share = echo ? BALANCE.capstones.echoShare : 1;
  switch (ult.id) {
    case 'nova': {
      const level = run.weapons.find((w) => w.id === frame.startingWeapon)?.level ?? 1;
      const damage = weaponParams(frame.startingWeapon, level).damage * ult.damage * run.stats.damageMult * share;
      const r2 = run.stats.range * run.stats.range;
      // A Nova into a boss's wind-up staggers it (§4.3).
      staggerBoss(run);
      // Only what was there when it went off, not what its kills burst into.
      const n = run.enemies.length;
      for (let i = 0; i < n; i++) {
        const e = run.enemies[i];
        if (!targetable(run, e) || e.x * e.x + e.y * e.y > r2) continue;
        damageEnemy(run, e, floored(e, damage, ult.floor * share), false, 'nova');
        if (e.alive && !e.boss) knockBack(run, e, ult.knockback);
      }
      run.events.push({ kind: 'nova', radius: run.stats.range });
      break;
    }
    case 'aegis':
      if (echo) run.tower.invulnUntil = Math.max(run.tower.invulnUntil, run.time) + ult.seconds * share;
      else run.tower.invulnUntil = run.time + ult.seconds;
      run.events.push({ kind: 'aegis', seconds: ult.seconds * share });
      break;
    case 'tempest':
    case 'overclock':
    case 'daybreak':
      // Lasting: `tickUltimate` strikes (Tempest) and slows (Daybreak); the
      // weapons read Overclock, `damageTaken` Daybreak's vulnerability.
      // An echo adds its share of the time to what is left.
      if (echo && u.until > run.time) {
        u.until += ult.seconds * share;
      } else {
        u.until = run.time + ult.seconds * share;
        u.timer = 0;
      }
      run.events.push({ kind: 'ultStart', seconds: ult.seconds * share });
      break;
    case 'eclipse': {
      // A share of what each body has left (§9): a boss loses less. A pool
      // of HP is struck once: a Chorus through one of its bodies, a court
      // through its king (a shade's own HP is never spent).
      const r2 = run.stats.range * run.stats.range;
      const n = run.enemies.length;
      const groups = new Set<number>();
      for (let i = 0; i < n; i++) {
        const e = run.enemies[i];
        if (e.court || !targetable(run, e) || e.x * e.x + e.y * e.y > r2) continue;
        if (e.group) {
          if (groups.has(e.group)) continue;
          groups.add(e.group);
        }
        damageEnemy(run, e, e.hp * (e.boss ? ult.bossFraction : ult.fraction) * share, false, 'eclipse');
      }
      run.events.push({ kind: 'eclipse', radius: run.stats.range });
      break;
    }
    default: {
      const exhaustive: never = ult;
      return exhaustive;
    }
  }
}

/** Engineering rank 1: the echo goes off when its time comes. Its kills refund like the cast's (rank 2). */
function tickEcho(run: RunState): void {
  const c = run.capstones;
  if (c.echoAt < 0 || run.time < c.echoAt) return;
  c.echoAt = -1;
  c.casting = true;
  unleash(run, true);
  c.casting = false;
  const carry = c.refund;
  c.refund = 0;
  if (carry > 0) addUltCharge(run, carry);
}

/**
 * Charge into the ultimate, as a share of a full one. Past full it is lost,
 * or at Engineering rank 3 banked, up to `chargeBank`, for after the next cast.
 */
export function addUltCharge(run: RunState, gain: number): void {
  const u = run.ult;
  const room = 1 - u.charge;
  if (gain < room) {
    u.charge += gain;
    return;
  }
  const was = u.charge;
  u.charge = 1;
  if (was < 1) run.events.push({ kind: 'ultReady' });
  if ((run.behaviours['engineering-capstone'] ?? 0) >= 3) {
    const c = run.capstones;
    c.chargeBank = Math.min(BALANCE.capstones.chargeBank, c.chargeBank + gain - room);
  }
}

/**
 * True while the ultimate (or its echo) is going off, for Engineering's
 * refund (rank 2): a cast's own hits, a lasting one's time, Aegis's guard.
 */
export function ultGoing(run: RunState, source: string): boolean {
  if (run.capstones.casting || source === 'nova' || source === 'tempest' || source === 'eclipse') return true;
  if (run.ult.until > run.time) return true;
  return frameById(run.frameId).ultimate.id === 'aegis' && run.tower.invulnUntil > run.time;
}

/**
 * A lasting ultimate, each step: Tempest strikes random bodies in range at
 * its rate (§11.6); Daybreak holds everything in range slowed (§9).
 */
export function tickUltimate(run: RunState, dt: number): void {
  const u = run.ult;
  if (run.capstones.echoAt >= 0) tickEcho(run);
  if (u.until <= run.time) return;
  const frame = frameById(run.frameId);
  const ult = frame.ultimate;
  if (ult.id === 'daybreak') {
    const r2 = run.stats.range * run.stats.range;
    for (const e of run.enemies) {
      if (!e.alive || e.x * e.x + e.y * e.y > r2) continue;
      e.slow = Math.max(e.slowUntil > run.time ? e.slow : 0, ult.slow);
      e.slowUntil = Math.max(e.slowUntil, run.time + dt * 2);
    }
    return;
  }
  if (ult.id !== 'tempest') return;
  u.timer -= dt;
  if (u.timer > 0) return;
  u.timer += 1 / ult.rate;
  const r2 = run.stats.range * run.stats.range;
  const inRange = run.enemies.filter((e) => targetable(run, e) && e.x * e.x + e.y * e.y <= r2);
  if (inRange.length === 0) return;
  const e = Rng.wrap(run.streams.arms).pick(inRange);
  const level = run.weapons.find((w) => w.id === frame.startingWeapon)?.level ?? 1;
  const damage = weaponParams(frame.startingWeapon, level).damage * ult.damage * run.stats.damageMult;
  run.events.push({ kind: 'chain', points: [e.x - 40, e.y - 260, e.x + 20, e.y - 120, e.x, e.y] });
  damageEnemy(run, e, floored(e, damage, ult.floor), false, 'tempest');
}

/**
 * An ultimate's hit on one body (S3): the starting weapon's multiple, or a
 * share of the body's Max HP if that is more, so the button keeps pace with
 * the region. A boss and its parts (a shade, a plate) take only the hit.
 */
function floored(e: Enemy, hit: number, floor: number): number {
  return e.boss || e.court || e.plate ? hit : Math.max(hit, e.maxHp * floor);
}

/** Living bodies within the tower's range: what a Nova would catch. */
export function enemiesInRange(run: RunState): number {
  const r2 = run.stats.range * run.stats.range;
  let n = 0;
  for (const e of run.enemies) if (e.alive && e.x * e.x + e.y * e.y <= r2) n++;
  return n;
}

/**
 * The Autocaster's rule (§6.2, U13): each ultimate has its own moment, as
 * data on the frame (`AutoRule`). The app and the idle bot both cast on it.
 */
export function autoUltWanted(run: RunState): boolean {
  if (run.ult.charge < 1) return false;
  const rule = frameById(run.frameId).ultimate.auto;
  const b = run.boss;
  const boss = b && b.killedIn === null && !b.submerged ? b : null;
  switch (rule.kind) {
    case 'windup': {
      if (boss && boss.windup > 0) return true;
      // A boss with no slam to break: no point waiting for one.
      if (boss && !phasesOf(run, BOSS_BY_ID[boss.id])[boss.phase]?.patterns.some((p) => p.kind === 'slam')) return true;
      return enemiesInRange(run) >= rule.crowd;
    }
    case 'wall': {
      const R = run.stats.radius;
      for (const r of run.rings) {
        if (r.hit) continue;
        const reach = Math.hypot(r.x, r.y) - R - r.radius;
        if (reach / r.speed <= rule.within) return true;
      }
      if (run.tower.hp >= run.stats.maxHp * rule.hp) return false;
      let contact = 0;
      for (const e of run.enemies) if (e.alive && e.inContact) contact++;
      return contact >= rule.contact;
    }
    case 'pool': {
      if (boss) return true;
      const r2 = run.stats.range * run.stats.range;
      let hp = 0;
      for (const e of run.enemies) if (targetable(run, e) && !e.court && e.x * e.x + e.y * e.y <= r2) hp += e.hp;
      return hp >= rule.bodies * waveHp(runRegion(run), runWave(run));
    }
    case 'crowd':
      return boss !== null || enemiesInRange(run) >= rule.crowd;
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}
