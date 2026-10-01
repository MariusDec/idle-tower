import { Rng } from '../../core/rng';
import { BALANCE } from '../../content/balance';
import { FALLBACKS } from '../../content/passives';
import { EVOLUTION_BY_ID, EVOLUTION_OF } from '../../content/evolutions';
import { WEAPON_BY_ID } from '../../content/weapons';
import type { CardItemId, WeaponId } from '../../content/types';
import type { Card, RunState } from '../state';
import { allMods, resolveStats } from '../stats';
import { pactLoad } from '../pacts';
import { suggest } from '../suggest';
import { evolveAt, newWeapon } from './arms';

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
 * Every card the draft may offer now. A new item appears only while a slot
 * of its type is free; a maxed item never appears (§12.6). Evolutions come
 * first: they are always in the hand (see `rollOffer`).
 */
export function candidateCards(run: RunState): Card[] {
  const max = BALANCE.maxLevel;
  const out: Card[] = evolutionCards(run);
  for (const w of run.weapons) if (w.level < max) out.push({ kind: 'weapon', id: w.id, level: w.level + 1 });
  for (const p of run.passives) if (p.level < max) out.push({ kind: 'passive', id: p.id, level: p.level + 1 });
  const weaponFree = run.weapons.length < run.weaponSlots;
  const passiveFree = run.passives.length < run.passiveSlots;
  for (const id of run.pool) {
    if (isWeaponId(id)) {
      if (weaponFree && !run.weapons.some((w) => w.id === id)) out.push({ kind: 'weapon', id, level: 1 });
    } else if (passiveFree && !run.passives.some((p) => p.id === id)) {
      out.push({ kind: 'passive', id, level: 1 });
    }
  }
  return out;
}

/** Cards per draft: the base, plus Choice, less Hoarder (§11.4) and Scarcity (§9), never below the floor. */
export function draftChoices(run: RunState): number {
  const B = BALANCE.behaviours;
  const n = BALANCE.draft.choices
    + B.extraChoice * (run.behaviours['extra-choice'] ?? 0)
    - B.hoarderChoices * (run.behaviours.hoarder ?? 0)
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
  // A ready evolution is always offered (§4.4: "the next level-up offers
  // it"); the rest of the hand is a uniform sample, by partial Fisher–Yates.
  const forced = candidates.filter((c) => c.kind === 'evolution').slice(0, n);
  const hand = candidates.filter((c) => c.kind !== 'evolution');
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

/** Open the next banked draft, if none is open. */
export function tickDraft(run: RunState): void {
  if (run.draft || run.pendingDrafts <= 0) return;
  const cards = rollOffer(run, Rng.wrap(run.streams.draft));
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
  if (!d || run.rerolls <= 0 || (run.firstDraft && run.draftsOpened === 1)) return;
  run.rerolls--;
  const cards = rollOffer(run, Rng.wrap(run.streams.draft));
  // A new offer object, so presentation sees a new hand.
  run.draft = { cards, suggested: suggest(run, cards), level: d.level };
  run.events.push({ kind: 'draftOpen' });
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
      if (!w || w.evolved) return;
      w.evolved = true;
      run.evolved.push(evo.id);
      run.events.push({ kind: 'evolve', weapon: w.id, evolution: evo.id });
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
        case 'shards':
          run.shards += BALANCE.draft.shardBonus;
          run.shardsFrom.cards += BALANCE.draft.shardBonus;
          return;
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

/** Re-resolve stats after a passive changes. Max HP gained is HP gained. */
export function refreshStats(run: RunState): void {
  const oldMax = run.stats.maxHp;
  run.stats = resolveStats(allMods(run.mods, run.passives));
  const gained = run.stats.maxHp - oldMax;
  run.tower.hp = Math.min(run.stats.maxHp, run.tower.hp + Math.max(0, gained));
}
