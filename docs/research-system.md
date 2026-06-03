# Research System

**Files:** `src/systems/ResearchTree.ts`, `src/data/research.ts`

## Overview

Research Points (RP) earned on each Ascension (RP = AP gained). Spent on permanent upgrades in 4 categories.

## Research Categories

### Combat
| ID | Name | Cost | Prereq | Effect |
|----|------|------|--------|--------|
| piercing_shots | Piercing Shots | 5 | — | Arrows pierce +1 enemy |
| improved_pierce | Splintering Volley | 12 | piercing_shots | Arrows pierce +1 more enemy |

### Economy
| ID | Name | Cost | Prereq | Effect |
|----|------|------|--------|--------|
| alchemy | Alchemy | 3 | — | +25% gold (multiplicative) |
| transmutation | Transmutation | 10 | alchemy | 5% chance for 3x gold |

### Arcane
| ID | Name | Cost | Prereq | Effect |
|----|------|------|--------|--------|
| mana_font | Mana Font | 5 | — | +50% mana regen |
| arcane_mastery | Arcane Mastery | 15 | mana_font | -30% ability mana cost |

### Scouting
| ID | Name | Cost | Prereq | Effect |
|----|------|------|--------|--------|
| veteran_scouts | Veteran Scouts | 3 | — | Start ascension at wave 5 |
| elite_scouts | Elite Scouts | 10 | veteran_scouts | Start ascension at wave 15 |

## Locking/Unlocking (`ResearchTree`)

- `canUnlock(id)`: has RP, not already unlocked, prerequisites satisfied
- `reasonBlocked(id)`: returns reason string or null
- `unlock(id)`: deduct RP, add to unlocked set, emit `research_unlocked`
- `addRP(amount)`: add RP, emit `rp_changed`

## Effect Queries

| Method | Computes |
|--------|----------|
| `getPierceCount()` | Total pierce extra from combat research |
| `getGoldMultiplicative()` | Gold multiplier factor |
| `getGoldLuckChance()` | Gold luck probability |
| `getManaRegenMultiplicative()` | Mana regen multiplier |
| `getAbilityCostReduction()` | Ability cost reduction (capped 90%) |
| `getStartWave()` | Highest start wave research (max of 5, 15) |

## Reset

- `resetForAscension()` — called on transcendence, clears all research
- `replaceUnlocked(ids, rp)` — used when loading saves
