import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { lightRadius } from '../../content/arena';
import { FALLBACKS } from '../../content/passives';
import { ANOMALY_BY_ID, ANOMALY_OF } from '../../content/anomalies';
import { EVOLUTION_BY_ID, EVOLUTION_OF } from '../../content/evolutions';
import { FUSION_BY_ID } from '../../content/fusions';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { CardItemId, WeaponId } from '../../content/types';
import type { Card, RunState, WeaponState } from '../state';
import { allMods, resolveStats, runMods } from '../stats';
import { pactLoad } from '../pacts';
import { suggest } from '../suggest';
import { newWeapon, slotsUsed } from './arms';
import { runRegion, waveBonus } from './waves';
import { notePick } from './secrets';

/**
 * XP, level-ups and the draft (§4.5). The sim only offers and applies cards;
 * how long the player may think, and how slow the arena runs meanwhile, is
 * the app's business. The run never stops for a draft.
 */

/** XP from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  const X = BALANCE.xp;
  return Math.round((X.first + X.perLevel * (level - 1)) * Math.pow(X.growth, level - 1));
}

export function isWeaponId(id: CardItemId): id is WeaponId {
  return id in WEAPON_BY_ID;
}

/** Kills feed XP; each level banks a draft. */
export function gainXp(run: RunState, amount: number): void {
  run.xp += amount * run.stats.xpMult;
  while (run.xp >= run.xpNext) {
    run.xp -= run.xpNext;
    run.level++;
    run.xpNext = xpToNext(run.level);
    run.pendingDrafts++;
    run.events.push({ kind: 'levelUp', level: run.level });
    // Starseed (§11.5): each level mends the tower.
    const seed = run.behaviours['level-heal'] ?? 0;
    if (seed > 0) {
      const R = BALANCE.relics.levelHeal;
      run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * R[Math.min(seed, R.length) - 1]);
    }
  }
}

/** A stable key per item, for "seen" records and de-duplication. */
export function cardKey(card: Card): string {
  return `${card.kind}:${card.id}`;
}

/**
 * Evolutions ready now (§4.4): once Alchemy is owned, a weapon at its
 * evolving level, not yet evolved, with its partner passive at its own.
 */
export function evolutionCards(run: RunState): Card[] {
  if (!run.behaviours.alchemy) return [];
  const E = BALANCE.evolutions;
  const out: Card[] = [];
  for (const w of run.weapons) {
    // An anomaly (plans/late-game/04 §5) is the weapon's other road: it never evolves.
    if (w.evolved || w.anomaly || w.level < E.evolveAt) continue;
    const evo = EVOLUTION_OF[w.id];
    if (run.passives.some((p) => p.id === evo.passive && p.level >= E.passiveAt)) out.push({ kind: 'evolution', id: evo.id });
  }
  return out;
}

/**
 * Fusions ready now (N9): its star lit, both its weapons carried and
 * evolved, and neither already half of a fusion.
 */
export function fusionCards(run: RunState): Card[] {
  const out: Card[] = [];
  for (const id of run.fusions) {
    if (run.fused.includes(id)) continue;
    const ready = FUSION_BY_ID[id].weapons.every((wid) => run.weapons.some((w) => w.id === wid && w.evolved && !w.fusion));
    if (ready) out.push({ kind: 'fusion', id });
  }
  return out;
}

/**
 * True for a card that is always in the hand when ready: a fusion. A ready
 * evolution is drawn like any other card, so it may wait a level-up or two.
 */
export function isForced(card: Card): boolean {
  return card.kind === 'fusion';
}

/**
 * Every card the draft may offer now. A new item appears only while a slot
 * of its type is free; a maxed item never appears (§12.6). Fusions come
 * first: they are always in the hand (see `rollOffer`).
 */
export function candidateCards(run: RunState): Card[] {
  const max = BALANCE.maxLevel;
  const out: Card[] = [...fusionCards(run), ...evolutionCards(run)];
  for (const w of run.weapons) if (w.level < max) out.push({ kind: 'weapon', id: w.id, level: w.level + 1 });
  for (const p of run.passives) if (p.level < max) out.push({ kind: 'passive', id: p.id, level: p.level + 1 });
  const weaponFree = slotsUsed(run) < run.weaponSlots;
  const passiveFree = run.passives.length < run.passiveSlots;
  for (const id of run.pool) {
    // Banished (N1): struck from this run's draft for good.
    if (run.banished.includes(id)) continue;
    if (isWeaponId(id)) {
      if (weaponFree && !run.weapons.some((w) => w.id === id)) out.push({ kind: 'weapon', id, level: 1 });
    } else if (passiveFree && !run.passives.some((p) => p.id === id)) {
      out.push({ kind: 'passive', id, level: 1 });
    }
  }
  return out;
}

/** Cards per draft: the base, plus Choice, less Scarcity (§9), never below the floor. */
export function draftChoices(run: RunState): number {
  const B = BALANCE.behaviours;
  const n = BALANCE.draft.choices
    + B.extraChoice * (run.behaviours['extra-choice'] ?? 0)
    + pactLoad(run.pacts).choices;
  return Math.min(BALANCE.draft.maxChoices, Math.max(BALANCE.draft.minChoices, n));
}

/** Roll a hand: distinct cards from the candidates, padded with fallbacks. */
export function rollOffer(run: RunState, rng: Rng, size?: number): Card[] {
  const candidates = candidateCards(run);
  const n = size ?? draftChoices(run);
  if (run.firstDraft && run.draftsOpened === 0) {
    const legal = new Set(candidates.map((c) => `${cardKey(c)}:${'level' in c ? c.level : 0}`));
    const scripted = run.firstDraft.filter((c) => legal.has(`${cardKey(c)}:${'level' in c ? c.level : 0}`));
    if (scripted.length > 0) return scripted.slice(0, n);
  }
  // A ready fusion is always offered, and so is Twin Mount's weapon while it
  // is still a new card; the rest of the hand, a ready evolution among it,
  // is a uniform sample, by partial Fisher–Yates.
  const twin = (c: Card): boolean => c.kind === 'weapon' && c.id === run.twinOffer && c.level === 1;
  const forced = [...candidates.filter(isForced), ...candidates.filter(twin)].slice(0, n);
  const hand = candidates.filter((c) => !isForced(c) && !twin(c));
  for (let i = 0; i < Math.min(n - forced.length, hand.length); i++) {
    const j = rng.int(i, hand.length - 1);
    [hand[i], hand[j]] = [hand[j], hand[i]];
  }
  const out = [...forced, ...hand.slice(0, n - forced.length)];
  for (const f of FALLBACKS) {
    if (out.length >= n) break;
    out.push({ kind: 'fallback', id: f.id });
  }
  return out;
}

/**
 * A forged hand (Blood Price, plans/late-game/02 §3): the evolution of every
 * carried weapon at `forgedFrom` or more, partner or not, padded with a
 * normal roll; with none to forge, a normal hand with one more card.
 */
export function forgedOffer(run: RunState, rng: Rng): Card[] {
  const out: Card[] = [];
  if (run.behaviours.alchemy) {
    for (const w of run.weapons) {
      if (w.evolved || w.joined || w.anomaly || w.level < BALANCE.rifts.forgedFrom) continue;
      out.push({ kind: 'evolution', id: EVOLUTION_OF[w.id].id });
    }
  }
  const n = draftChoices(run);
  const forged = out.slice(0, n);
  const rest = rollOffer(run, rng, forged.length > 0 ? n : n + 1)
    .filter((c) => !forged.some((f) => cardKey(f) === cardKey(c)));
  return [...forged, ...rest].slice(0, forged.length > 0 ? n : n + 1);
}

/**
 * Weapons an anomaly may come for (plans/late-game/04 §3): carried, at
 * `minLevel` or more, not evolved, not half of a fusion, and with one
 * authored.
 */
export function anomalyEligible(run: RunState): WeaponState[] {
  return run.weapons.filter((w) => !w.evolved && !w.fusion && !w.joined && !w.anomaly
    && w.level >= BALANCE.anomalies.minLevel && ANOMALY_OF[w.id] !== undefined);
}

/** True for a hand that holds an anomaly. */
export function holdsAnomaly(cards: readonly Card[]): boolean {
  return cards.some((c) => c.kind === 'anomaly');
}

/**
 * The anomaly this hand deals, if any (plans/late-game/04 §3): once a run,
 * after its wait in eligible drafts. A forged hand (Blood Price, plan 02 §7)
 * deals one whenever none has been taken, held or not. Every draw is on the
 * `anomaly` stream, so the hand and its suggestion are the same either way.
 */
function anomalyCard(run: RunState, forged: boolean): Card | null {
  const plan = run.anomaly;
  if (!plan || plan.taken) return null;
  if (!forged && (!plan.held || plan.offered)) return null;
  const eligible = anomalyEligible(run);
  if (eligible.length === 0) return null;
  if (!forged && plan.delay > 0) {
    plan.delay--;
    return null;
  }
  const w = eligible.length === 1 ? eligible[0] : Rng.wrap(run.streams.anomaly).pick(eligible);
  const id = ANOMALY_OF[w.id]!.id;
  plan.offered = id;
  run.events.push({ kind: 'anomalyOffer', anomaly: id });
  return { kind: 'anomaly', id };
}

/** True while the open draft is the profile's first, authored one: no reroll, no Banish. */
function authored(run: RunState): boolean {
  return run.firstDraft !== null && run.draftsOpened === 1;
}

/** Open the next banked draft, if none is open. */
export function tickDraft(run: RunState): void {
  // A rift being chosen (plans/late-game/02) holds the next draft back.
  if (run.draft || run.pendingDrafts <= 0 || run.rift?.phase === 'choosing') return;
  const first = run.firstDraft !== null && run.draftsOpened === 0;
  const forged = run.forgedHand;
  const rolled = forged ? forgedOffer(run, Rng.wrap(run.streams.draft)) : rollOffer(run, Rng.wrap(run.streams.draft));
  run.forgedHand = false;
  const cards = first ? rolled : autoBanish(run, rolled);
  const suggested = suggest(run, cards);
  // The anomaly joins after the hand is rolled and scored (plans/late-game/04
  // §6), at its end: the `draft` stream and the suggestion are untouched.
  const anomaly = first ? null : anomalyCard(run, forged);
  run.draft = {
    cards: anomaly ? [...cards, anomaly] : cards,
    suggested,
    level: run.level - run.pendingDrafts + 1,
  };
  run.draftsOpened++;
  run.events.push({ kind: 'draftOpen' });
}

/**
 * Spend a reroll (§4.5): the open draft is replaced by a fresh hand from the
 * same stream. The first, authored draft cannot be rerolled.
 */
export function rerollDraft(run: RunState): void {
  const d = run.draft;
  if (!d || run.rerolls <= 0 || authored(run)) return;
  run.rerolls--;
  const cards = autoBanish(run, rollOffer(run, Rng.wrap(run.streams.draft)));
  // An anomaly isn't from the deck (plans/late-game/04 §3): a reroll keeps it.
  const kept = d.cards.filter((c) => c.kind === 'anomaly');
  // A new offer object, so presentation sees a new hand.
  run.draft = { cards: [...cards, ...kept], suggested: suggest(run, cards), level: d.level };
  run.events.push({ kind: 'draftOpen' });
}

/**
 * A card Banish may strike (N1): a new weapon or passive, not yet on the
 * tower. What the tower carries is never clutter, and an evolution or a
 * fallback is not an item in the pool.
 */
export function banishable(run: RunState, card: Card): boolean {
  if (card.kind === 'weapon') return !run.weapons.some((w) => w.id === card.id);
  if (card.kind === 'passive') return !run.passives.some((p) => p.id === card.id);
  return false;
}

/**
 * Spend a Banish charge on card `index` of the open draft (N1): its item
 * leaves this run's pool, and the card is replaced from the same stream.
 */
export function banishCard(run: RunState, index: number): void {
  const d = run.draft;
  const card = d?.cards[index];
  if (!d || !card || run.banishes <= 0 || authored(run) || !banishable(run, card)) return;
  run.banishes--;
  const cards = strike(run, d.cards, index);
  // A new offer object, so presentation sees a new hand.
  run.draft = { cards, suggested: suggest(run, cards), level: d.level };
}

/** Banish card `index`'s item and put a fresh card in its place: another candidate, else a fallback. */
function strike(run: RunState, cards: readonly Card[], index: number): Card[] {
  const card = cards[index];
  if (card.kind === 'weapon' || card.kind === 'passive') run.banished.push(card.id);
  const held = new Set(cards.map(cardKey));
  const fresh = candidateCards(run).filter((c) => !isForced(c) && !held.has(cardKey(c)));
  const out = [...cards];
  if (fresh.length > 0) {
    out[index] = Rng.wrap(run.streams.draft).pick(fresh);
    return out;
  }
  const f = FALLBACKS.find((x) => !held.has(`fallback:${x.id}`));
  if (f) out[index] = { kind: 'fallback', id: f.id };
  else if (out.length > 1) out.splice(index, 1);
  return out;
}

/** The Tactician's Never list spends Banish charges by itself (U7, N1): a listed new item is struck at once. */
function autoBanish(run: RunState, cards: Card[]): Card[] {
  const never = run.never;
  if (!never) return cards;
  let hand = cards;
  for (;;) {
    if (run.banishes <= 0) return hand;
    const i = hand.findIndex((c) => (c.kind === 'weapon' || c.kind === 'passive') && never.includes(c.id) && banishable(run, c));
    if (i < 0) return hand;
    run.banishes--;
    hand = strike(run, hand, i);
  }
}

/** Take card `index` of the open draft. Out-of-range indices take the suggestion. */
export function pickCard(run: RunState, index: number): void {
  const d = run.draft;
  if (!d) return;
  const card = d.cards[index] ?? d.cards[d.suggested];
  // Secrets (plans/late-game/05): the Wayward road counts the player's own picks.
  if (run.secrets) notePick(run, index === d.suggested || d.cards[index] === undefined);
  applyCard(run, card);
  // Twin Mount's offer stands for one draft, whatever was taken from it.
  run.twinOffer = null;
  run.draft = null;
  run.pendingDrafts--;
  run.events.push({ kind: 'picked', card });
}

/**
 * Take the suggestion on the open draft and on every banked draft after it
 * (U2's "Take suggested ×N"): each hand is rolled and scored in turn, just
 * as it would have been one at a time. Returns how many were taken.
 */
export function takeSuggested(run: RunState): number {
  let n = 0;
  // The hand open now is the one the player is looking at; a later one that
  // deals an anomaly is left open, so it is never passed by unseen (plans/late-game/04 §3).
  const shown = run.draft;
  while (run.pendingDrafts > 0) {
    if (!run.draft) tickDraft(run);
    if (!run.draft) break;
    if (run.draft !== shown && holdsAnomaly(run.draft.cards)) break;
    pickCard(run, run.draft.suggested);
    n++;
  }
  return n;
}

export function applyCard(run: RunState, card: Card): void {
  switch (card.kind) {
    case 'weapon': {
      const w = run.weapons.find((x) => x.id === card.id);
      if (w) w.level = card.level;
      // Drilled (§11.4): a new weapon joins a level up.
      else run.weapons.push(newWeapon(card.id, Math.min(BALANCE.maxLevel, 1 + (run.behaviours.drilled ?? 0))));
      return;
    }
    case 'evolution': {
      const evo = EVOLUTION_BY_ID[card.id];
      const w = run.weapons.find((x) => x.id === evo.weapon);
      if (!w || w.evolved || w.anomaly) return;
      w.evolved = true;
      run.evolved.push(evo.id);
      run.events.push({ kind: 'evolve', weapon: w.id, evolution: evo.id });
      return;
    }
    case 'fusion': {
      // The first weapon is the mount; the second joins it there, and its slot is free (N9).
      const [a, b] = FUSION_BY_ID[card.id].weapons;
      const host = run.weapons.find((x) => x.id === a);
      const partner = run.weapons.find((x) => x.id === b);
      if (!host || !partner || host.fusion || partner.fusion || run.fused.includes(card.id)) return;
      host.fusion = card.id;
      partner.fusion = card.id;
      partner.joined = true;
      run.fused.push(card.id);
      run.events.push({ kind: 'fuse', weapon: host.id, fusion: card.id });
      return;
    }
    case 'anomaly': {
      // The weapon keeps its slot and its level, and never evolves (plans/late-game/04 §3).
      const def = ANOMALY_BY_ID[card.id];
      const w = run.weapons.find((x) => x.id === def.weapon);
      if (!w || w.evolved || w.fusion || w.anomaly || !run.anomaly || run.anomaly.taken) return;
      w.anomaly = card.id;
      run.anomaly.taken = card.id;
      run.events.push({ kind: 'anomaly', weapon: w.id, anomaly: card.id });
      return;
    }
    case 'passive': {
      const p = run.passives.find((x) => x.id === card.id);
      if (p) p.level = card.level;
      else run.passives.push({ id: card.id, level: 1 });
      refreshStats(run);
      return;
    }
    case 'fallback': {
      const id = card.id;
      switch (id) {
        case 'heal':
          run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + run.stats.maxHp * BALANCE.draft.healFraction);
          return;
        case 'shards': {
          // Worth a few waves' pay where it is drawn, so it keeps pace with the region.
          const n = Math.max(1, run.wave);
          const pay = Math.max(BALANCE.draft.shardBonus, BALANCE.draft.shardWaves * waveBonus(runRegion(run), n) * run.stats.shardMult);
          run.shards += pay;
          run.shardsFrom.cards += pay;
          return;
        }
        default: {
          const exhaustive: never = id;
          return exhaustive;
        }
      }
    }
    default: {
      const exhaustive: never = card;
      return exhaustive;
    }
  }
}

/**
 * Re-resolve stats after a passive changes, or a Fog-caller comes or goes
 * (N3). Max HP gained is HP gained.
 */
export function refreshStats(run: RunState): void {
  const oldMax = run.stats.maxHp;
  run.stats = resolveStats(allMods(runMods(run), run.passives));
  // A Fog-caller closes the light in with the range: the fog is its look.
  if (run.enemies.some((e) => e.alive && e.aura === 'fog')) {
    const dim = 1 - BALANCE.elites.fog;
    run.stats.range *= dim;
    run.stats.light = lightRadius(run.stats.range, dim);
  }
  const gained = run.stats.maxHp - oldMax;
  run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + Math.max(0, gained));
}
