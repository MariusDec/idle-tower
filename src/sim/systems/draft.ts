import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { lightRadius } from '../../content/arena';
import { FALLBACKS } from '../../content/passives';
import { EVOLUTION_BY_ID, EVOLUTION_OF } from '../../content/evolutions';
import { FUSION_BY_ID } from '../../content/fusions';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { CardItemId, WeaponId } from '../../content/types';
import type { Card, RunState } from '../state';
import { allMods, resolveStats } from '../stats';
import { pactLoad } from '../pacts';
import { suggest } from '../suggest';
import { evolveAt, newWeapon, slotsUsed } from './arms';
import { runRegion, waveBonus } from './waves';

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
 * evolving level, not yet evolved, with its partner passive owned.
 * Specialist evolves earlier.
 */
export function evolutionCards(run: RunState): Card[] {
  if (!run.behaviours.alchemy) return [];
  const at = evolveAt((run.behaviours.specialist ?? 0) > 0);
  const out: Card[] = [];
  for (const w of run.weapons) {
    if (w.evolved || w.level < at) continue;
    const evo = EVOLUTION_OF[w.id];
    if (run.passives.some((p) => p.id === evo.passive)) out.push({ kind: 'evolution', id: evo.id });
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

/** True for a card that is always in the hand when ready: an evolution or a fusion. */
export function isForced(card: Card): boolean {
  return card.kind === 'evolution' || card.kind === 'fusion';
}

/**
 * Every card the draft may offer now. A new item appears only while a slot
 * of its type is free; a maxed item never appears (§12.6). Fusions and
 * evolutions come first: they are always in the hand (see `rollOffer`).
 */
export function candidateCards(run: RunState): Card[] {
  const max = BALANCE.maxLevel;
  const out: Card[] = [...fusionCards(run), ...evolutionCards(run)];
  for (const w of run.weapons) if (w.level < max) out.push({ kind: 'weapon', id: w.id, level: w.level + 1 });
  for (const p of run.passives) if (p.level < max) out.push({ kind: 'passive', id: p.id, level: p.level + 1 });
  // Specialist (S4): until its first weapon card, the one slot may be swapped.
  const weaponFree = slotsUsed(run) < run.weaponSlots || run.swap;
  // A swapped-in weapon takes the place, and the level, of the one it replaces.
  const joins = run.swap ? run.weapons[0].level : 1;
  const passiveFree = run.passives.length < run.passiveSlots;
  for (const id of run.pool) {
    // Banished (N1): struck from this run's draft for good.
    if (run.banished.includes(id)) continue;
    if (isWeaponId(id)) {
      if (weaponFree && !run.weapons.some((w) => w.id === id)) out.push({ kind: 'weapon', id, level: joins });
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
export function rollOffer(run: RunState, rng: Rng): Card[] {
  const candidates = candidateCards(run);
  const n = draftChoices(run);
  if (run.firstDraft && run.draftsOpened === 0) {
    const legal = new Set(candidates.map((c) => `${cardKey(c)}:${'level' in c ? c.level : 0}`));
    const scripted = run.firstDraft.filter((c) => legal.has(`${cardKey(c)}:${'level' in c ? c.level : 0}`));
    if (scripted.length > 0) return scripted.slice(0, n);
  }
  // A ready evolution or fusion is always offered (§4.4: "the next level-up
  // offers it"); the rest of the hand is a uniform sample, by partial Fisher–Yates.
  const forced = candidates.filter(isForced).slice(0, n);
  const hand = candidates.filter((c) => !isForced(c));
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

/** True while the open draft is the profile's first, authored one: no reroll, no Banish. */
function authored(run: RunState): boolean {
  return run.firstDraft !== null && run.draftsOpened === 1;
}

/** Open the next banked draft, if none is open. */
export function tickDraft(run: RunState): void {
  if (run.draft || run.pendingDrafts <= 0) return;
  const first = run.firstDraft !== null && run.draftsOpened === 0;
  const rolled = rollOffer(run, Rng.wrap(run.streams.draft));
  const cards = first ? rolled : autoBanish(run, rolled);
  run.draft = {
    cards,
    suggested: suggest(run, cards),
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
  // A new offer object, so presentation sees a new hand.
  run.draft = { cards, suggested: suggest(run, cards), level: d.level };
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
  applyCard(run, card);
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
  while (run.pendingDrafts > 0) {
    if (!run.draft) tickDraft(run);
    if (!run.draft) break;
    pickCard(run, run.draft.suggested);
    n++;
  }
  return n;
}

export function applyCard(run: RunState, card: Card): void {
  switch (card.kind) {
    case 'weapon': {
      const w = run.weapons.find((x) => x.id === card.id);
      const swap = run.swap;
      // Specialist (S4): its first weapon card locks the one slot.
      run.swap = false;
      if (w) w.level = card.level;
      // …and a new one takes the starting weapon's place, at its level.
      else if (swap) run.weapons = [newWeapon(card.id, card.level)];
      // Drilled (§11.4): a new weapon joins a level up.
      else run.weapons.push(newWeapon(card.id, Math.min(BALANCE.maxLevel, 1 + (run.behaviours.drilled ?? 0))));
      return;
    }
    case 'evolution': {
      const evo = EVOLUTION_BY_ID[card.id];
      const w = run.weapons.find((x) => x.id === evo.weapon);
      if (!w || w.evolved) return;
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
  run.stats = resolveStats(allMods(run.mods, run.passives));
  // A Fog-caller closes the light in with the range: the fog is its look.
  if (run.enemies.some((e) => e.alive && e.aura === 'fog')) {
    const dim = 1 - BALANCE.elites.fog;
    run.stats.range *= dim;
    run.stats.light = lightRadius(run.stats.range, dim);
  }
  const gained = run.stats.maxHp - oldMax;
  run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + Math.max(0, gained));
}
