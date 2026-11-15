import { BALANCE } from '../../content/balance';
import { EVOLUTION_BY_ID } from '../../content/evolutions';
import { MIRRORED_PATTERNS, SECRET_BY_ID } from '../../content/secrets';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { BodyMark, BossId, FormCondition, SecretId, SecretNeeds } from '../../content/types';
import type { DamageBy, Enemy, RunState, SecretRun } from '../state';
import { runRegion } from './waves';

/**
 * Secrets (plans/late-game/05 §3). Nothing here rolls a die: a trigger is a
 * pure function of the run, so a player who learns one can call it at will,
 * and a run with no secret live (`run.secrets` null) plays exactly as before.
 *
 * A tally counts kills; at `stirAt` of its goal it stirs (its riddle is
 * written, one a run), and at the goal it is found, its reward working at
 * once. A form is chosen at the boss's arrival; felling it is the find.
 */

/** True when body `e` wears `mark` now. Read before anything its death sets off (a shatter thaws it). */
export function hasMark(run: RunState, e: Enemy, mark: BodyMark): boolean {
  switch (mark) {
    case 'frozen':
      return e.frozenUntil > run.time;
    case 'burning':
      return e.burnUntil > run.time;
    case 'gilded':
      return e.gildedUntil > run.time;
    case 'tethered':
      return run.weapons.some((w) => w.tethers.includes(e.id));
    case 'elite':
      return e.elite;
    case 'shade':
      return e.shade;
    case 'inContact':
      return e.inContact;
    default: {
      const exhaustive: never = mark;
      return exhaustive;
    }
  }
}

/** True when the run holds what `needs` asks: weapons carried, evolutions made, its frame. */
export function needsMet(run: RunState, needs: SecretNeeds | undefined): boolean {
  if (!needs) return true;
  if (needs.frame && run.frameId !== needs.frame) return false;
  for (const w of needs.carried ?? []) if (!run.weapons.some((x) => x.id === w)) return false;
  for (const id of needs.evolved ?? []) {
    const evo = EVOLUTION_BY_ID[id];
    if (!run.weapons.some((x) => x.id === evo.weapon && x.evolved)) return false;
  }
  return true;
}

/** Write a secret's riddle in the margin: once a run, never one already heard or found. */
function stir(run: RunState, S: SecretRun, id: SecretId): void {
  if (S.stirred !== null || BALANCE.secrets.stirsPerRun < 1) return;
  if (S.heard.includes(id) || S.found.includes(id)) return;
  S.stirred = id;
  S.heard.push(id);
  run.events.push({ kind: 'secret', id, stage: 'stir' });
}

/** Found: its reward works at once, in this run. Once only; a form's repeat fall finds nothing new. */
export function findSecret(run: RunState, id: SecretId): void {
  const S = run.secrets;
  if (!S || S.found.includes(id)) return;
  S.found.push(id);
  S.fresh.push(id);
  const def = SECRET_BY_ID[id];
  if (def.trigger.kind !== 'form') S.live = S.live.filter((x) => x !== id);
  if (def.reward.kind === 'effects') {
    for (const e of def.reward.effects) {
      if (e.kind === 'behaviour') run.behaviours[e.id] = Math.max(1, run.behaviours[e.id] ?? 0);
    }
  }
  run.events.push({ kind: 'secret', id, stage: 'found' });
}

/** One more toward a tally: a stir at its share, the find at its goal. */
function bump(run: RunState, S: SecretRun, id: SecretId, n: number): void {
  const c = (S.counts[id] ?? 0) + 1;
  S.counts[id] = c;
  if (c >= n) findSecret(run, id);
  else if (c >= Math.ceil(n * BALANCE.secrets.stirAt)) stir(run, S, id);
}

/**
 * A body fell (`combat.ts#kill`, before its death's own effects): each live
 * tally it answers counts one. `by` is who the kill is credited to (T1).
 */
export function tallyKill(run: RunState, e: Enemy, by: DamageBy): void {
  const S = run.secrets;
  if (!S || S.live.length === 0 || e.boss || e.plate || e.court) return;
  for (const id of S.live) {
    const t = SECRET_BY_ID[id].trigger;
    if (t.kind !== 'tally') continue;
    if (t.by !== undefined && t.by !== by) continue;
    if (t.enemy !== undefined && t.enemy !== e.type) continue;
    if (t.region !== undefined && t.region !== run.regionId) continue;
    if (t.on !== undefined && !hasMark(run, e, t.on)) continue;
    if (!needsMet(run, t.needs)) continue;
    bump(run, S, id, t.n);
    // `bump` may have found it, and `findSecret` replaced the list: stop walking the old one.
    if (!S.live.includes(id)) break;
  }
}

/** True when the run meets a form's condition. */
function formMet(run: RunState, when: FormCondition): boolean {
  switch (when.kind) {
    case 'unturned':
      return !run.weapons.some((w) => MIRRORED_PATTERNS.has(WEAPON_BY_ID[w.id].pattern));
    case 'needs':
      return needsMet(run, when.needs);
    default: {
      const exhaustive: never = when;
      return exhaustive;
    }
  }
}

/**
 * The form boss `boss` arrives in, or null (§3.5): a live form whose
 * condition the run meets, in its own region, never on the region's first
 * kill. The Abyss's floors keep their bosses as they are.
 */
export function formFor(run: RunState, boss: BossId): SecretId | null {
  const S = run.secrets;
  if (!S || run.firstKill || runRegion(run).abyss) return null;
  for (const id of S.live) {
    const t = SECRET_BY_ID[id].trigger;
    if (t.kind === 'form' && t.boss === boss && formMet(run, t.when)) return id;
  }
  return null;
}

/** A boss arrived in its other form: the sighting. */
export function sightForm(run: RunState, id: SecretId): void {
  const S = run.secrets;
  if (!S) return;
  if (!S.sighted.includes(id)) S.sighted.push(id);
  run.events.push({ kind: 'secret', id, stage: 'sighted' });
}

/**
 * A boss fell (`boss.ts#onBossKilled`): its form is found, and drops its
 * relic again on a repeat fall (banking ranks it to III, then melts it);
 * Kintsugi's brink and the Wayward road are read.
 */
export function secretsOnBossKill(run: RunState, x: number, y: number): void {
  const S = run.secrets;
  const b = run.boss;
  if (!S || !b) return;
  if (b.form) {
    const def = SECRET_BY_ID[b.form];
    S.felled.push(b.form);
    if (def.reward.kind === 'relic') {
      run.relics.push(def.reward.relic);
      run.events.push({ kind: 'relicDrop', relic: def.reward.relic, x, y });
    }
    findSecret(run, b.form);
  }
  for (const id of [...S.live]) {
    const t = SECRET_BY_ID[id].trigger;
    if (t.kind === 'brink') {
      if (b.minHp < t.hp) findSecret(run, id);
      else if (b.minHp < t.stir) stir(run, S, id);
    } else if (t.kind === 'wayward') {
      if (S.on === 0 && S.off >= t.drafts) findSecret(run, id);
    }
  }
}

/**
 * A card was taken (`draft.ts#pickCard`): on the suggestion or off it. The
 * Wayward road stirs once enough picks have been the player's own.
 */
export function notePick(run: RunState, suggested: boolean): void {
  const S = run.secrets;
  if (!S) return;
  if (suggested) S.on++;
  else S.off++;
  if (S.on > 0) return;
  for (const id of S.live) {
    const t = SECRET_BY_ID[id].trigger;
    if (t.kind === 'wayward' && S.off >= t.stir) stir(run, S, id);
  }
}
