import { BALANCE } from '../content/balance';
import { REGIONS } from '../content/regions';
import { SECRETS, SECRET_BY_ID, secretRegion } from '../content/secrets';
import type { BossId, Effect, SecretDef, SecretId, TrimId } from '../content/types';
import type { RunState, SecretConfig } from '../sim/state';
import { bossDown, bossKills } from './collection';
import type { Profile } from './profile';

/**
 * Secrets between runs (plans/late-game/05): which are live, what found ones
 * give every run, banking a run's stirs and finds, and the Recipe Book's
 * margin. Nothing here ever counts the table: the margin shows what was heard.
 */

/** True for an id the table knows: a save may hold ids a later build dropped. */
function known(id: string): id is SecretId {
  return Object.prototype.hasOwnProperty.call(SECRET_BY_ID, id);
}

/** True once a secret is found on this profile. */
export function secretFound(profile: Profile, id: SecretId): boolean {
  return profile.secrets.found[id] !== undefined;
}

/** Secrets whose gate boss has fallen: their triggers are checked from now on. */
export function secretsSurfaced(profile: Profile): SecretDef[] {
  return SECRETS.filter((s) => bossDown(profile, s.after));
}

/**
 * The run's secrets (§3): those surfaced and not yet found, and every
 * surfaced form (a repeat fall drops another rank of its relic). Null in a
 * Trial and Boss Rush (authored or shared runs), and while none is live, so
 * a fresh profile's runs are as they were.
 */
export function secretConfig(profile: Profile, authored: boolean): SecretConfig | null {
  if (authored) return null;
  const live = secretsSurfaced(profile)
    .filter((s) => !secretFound(profile, s.id) || s.trigger.kind === 'form')
    .map((s) => s.id);
  if (live.length === 0) return null;
  const tally: Partial<Record<SecretId, number>> = {};
  for (const [id, n] of Object.entries(profile.secrets.tally)) if (known(id)) tally[id] = n;
  return Object.freeze({
    live: Object.freeze(live),
    heard: Object.freeze(profile.secrets.heard.filter(known)),
    found: Object.freeze(Object.keys(profile.secrets.found).filter(known)),
    tally: Object.freeze(tally),
  });
}

/** What found secrets give every run, as a Trial notable's effects do. */
export function secretEffects(profile: Profile): Effect[] {
  return SECRETS.flatMap((s) => (secretFound(profile, s.id) && s.reward.kind === 'effects' ? [...s.reward.effects] : []));
}

/** The trims found secrets have paid, with their names, in the order found. */
export function secretTrims(profile: Profile): { trim: TrimId; name: string }[] {
  return margin(profile).flatMap((r) => (r.found && r.secret.reward.kind === 'trim' ? [{ trim: r.secret.reward.trim, name: r.secret.reward.name }] : []));
}

/** What a run did for the secrets, for the results screen. */
export interface SecretsBanked {
  /** The riddle written this run, if it was new to the margin. */
  heard: SecretId | null;
  /** Found this run, in order. */
  found: SecretId[];
  /** One-off pay for the finds: shards (Act 1) and Starlight (Act 2), outside the run's own. */
  shards: number;
  starlight: number;
}

/**
 * Bank a run's secrets (§3.6): the riddle heard whatever the outcome, each
 * find with its run number and its one-off pay, forms sighted, lifetime
 * tallies. Null when the run had none live.
 */
export function recordSecrets(profile: Profile, run: RunState): SecretsBanked | null {
  const S = run.secrets;
  if (!S) return null;
  const P = profile.secrets;
  const heard = S.stirred && !P.heard.includes(S.stirred) ? S.stirred : null;
  if (heard) P.heard.push(heard);
  for (const id of S.sighted) if (!P.sighted.includes(id)) P.sighted.push(id);
  for (const id of S.live) {
    const t = SECRET_BY_ID[id].trigger;
    if (t.kind === 'tally' && t.lifetime) P.tally[id] = S.counts[id] ?? 0;
  }
  const found: SecretId[] = [];
  let shards = 0;
  let starlight = 0;
  for (const id of S.fresh) {
    if (P.found[id] !== undefined) continue;
    P.found[id] = profile.records.runs;
    delete P.tally[id];
    found.push(id);
    const def = SECRET_BY_ID[id];
    shards += def.shards ?? 0;
    starlight += def.starlight ?? 0;
  }
  profile.shards += shards;
  profile.starlight += starlight;
  return { heard, found, shards, starlight };
}

/** A row of the Recipe Book's margin (§2). */
export interface MarginRow {
  secret: SecretDef;
  /** Found: its name, effect and where it works. Else only its riddle. */
  found: boolean;
  /** The region it is bound to, by name; null for one that works anywhere. */
  where: string | null;
}

/**
 * The margin: found secrets in the order found, then riddles heard (or forms
 * sighted) in the order heard. No count, no empty rows: only what was met.
 */
export function margin(profile: Profile): MarginRow[] {
  const P = profile.secrets;
  const row = (secret: SecretDef, found: boolean): MarginRow => {
    const r = secretRegion(secret);
    return { secret, found, where: r === null ? null : REGIONS.find((x) => x.index === r)?.name ?? null };
  };
  const found = Object.entries(P.found)
    .filter((e): e is [SecretId, number] => known(e[0]))
    .sort((a, b) => a[1] - b[1] || SECRETS.indexOf(SECRET_BY_ID[a[0]]) - SECRETS.indexOf(SECRET_BY_ID[b[0]]))
    .map(([id]) => row(SECRET_BY_ID[id], true));
  const met: SecretId[] = [];
  for (const id of [...P.heard, ...P.sighted]) if (known(id) && P.found[id] === undefined && !met.includes(id)) met.push(id);
  return [...found, ...met.map((id) => row(SECRET_BY_ID[id], false))];
}

/** A boss's other forms seen, by name: the Bestiary's "Also seen as". */
export function formsSeen(profile: Profile, boss: BossId): string[] {
  return SECRETS.flatMap((s) => (
    s.trigger.kind === 'form' && s.trigger.boss === boss && s.form && (profile.secrets.sighted.includes(s.id) || secretFound(profile, s.id))
      ? [s.form.name] : []
  ));
}

/**
 * A boss's lore line (§2, "Lore"): once it has fallen `loreKills` times, an
 * unseen form's riddle joins its Bestiary entry. Only surfaced forms.
 */
export function bossLore(profile: Profile, boss: BossId): string[] {
  if (bossKills(profile, boss) < BALANCE.secrets.loreKills) return [];
  return secretsSurfaced(profile).flatMap((s) => (
    s.trigger.kind === 'form' && s.trigger.boss === boss && !profile.secrets.sighted.includes(s.id) && !secretFound(profile, s.id)
      ? [s.hint] : []
  ));
}
