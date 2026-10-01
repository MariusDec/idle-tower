import type { FeatDef } from './types';

/**
 * Feats (§5.4): one finite list of forty, each paying shards once. Each
 * points at something worth finding. The Feats tab appears after the first
 * boss, with the ones already earned waiting to be claimed. Four are secret:
 * "???" and a riddle until earned, and they surface only once Forgeheart has
 * fallen (§7.1). *Tinkerer* also earns the Artificer frame (§11.6).
 */
export const FEATS: readonly FeatDef[] = [
  { id: 'first-light', name: 'First Light', icon: 'sparkles', text: 'Reach wave 10.', goal: { kind: 'wave', wave: 10 }, reward: 30 },
  { id: 'thousand-cuts', name: 'Thousand Cuts', icon: 'crossed-swords', text: 'Slay 1,000 enemies.', goal: { kind: 'kills', n: 1000 }, reward: 40 },
  { id: 'master-craft', name: 'Master Craft', icon: 'hammer-nails', text: 'Take a weapon to level 5.', goal: { kind: 'maxWeapon' }, reward: 50 },
  { id: 'alchemist', name: 'Alchemist', icon: 'bubbling-flask', text: 'Evolve any weapon.', goal: { kind: 'evolve' }, reward: 300 },
  { id: 'scholar', name: 'Scholar', icon: 'book-pile', text: 'Reach level 15 in one run.', goal: { kind: 'level', level: 15 }, reward: 60 },
  { id: 'at-the-gate', name: 'At the Gate', icon: 'knight-banner', text: 'Reach wave 20 and face the Gatekeeper.', goal: { kind: 'wave', wave: 20 }, reward: 80 },
  { id: 'gatebreaker', name: 'Gatebreaker', icon: 'locked-fortress', text: 'Defeat the Gatekeeper.', goal: { kind: 'boss', boss: 'gatekeeper' }, reward: 150 },
  { id: 'unbroken', name: 'Unbroken', icon: 'magic-shield', text: 'Take no damage before wave 8.', goal: { kind: 'untouched', wave: 8 }, reward: 60 },
  { id: 'lone-tower', name: 'Lone Tower', icon: 'heart-tower', text: 'Reach wave 15 with a single weapon.', goal: { kind: 'lone', wave: 15 }, reward: 120 },
  { id: 'elite-hunter', name: 'Elite Hunter', icon: 'executioner-hood', text: 'Slay 10 elites.', goal: { kind: 'elites', n: 10 }, reward: 150 },
  { id: 'relic-seeker', name: 'Relic Seeker', icon: 'open-treasure-chest', text: 'Find 3 different relics.', goal: { kind: 'relics', n: 3 }, reward: 250 },
  { id: 'mire-naturalist', name: 'Mire Naturalist', icon: 'telescope', text: 'Discover every enemy in the Drowned Mire.', goal: { kind: 'bestiary', region: 2 }, reward: 200 },
  { id: 'steady-hand', name: 'Steady Hand', icon: 'bordered-shield', text: 'Defeat a boss without dropping below half HP.', goal: { kind: 'bossHealthy', hp: 0.5 }, reward: 400 },
  { id: 'swift-judgment', name: 'Swift Judgment', icon: 'hourglass', text: 'Defeat a boss within 45 s of its arrival.', goal: { kind: 'bossFast', seconds: 45 }, reward: 500 },
  { id: 'ten-thousand', name: 'Ten Thousand', icon: 'reaper-scythe', text: 'Slay 10,000 enemies.', goal: { kind: 'kills', n: 10000 }, reward: 400 },
  { id: 'mire-drained', name: 'Mire Drained', icon: 'well', text: 'Defeat the Bog Mother.', goal: { kind: 'boss', boss: 'bog-mother' }, reward: 800 },
  { id: 'fields-naturalist', name: 'Fields Naturalist', icon: 'telescope', text: 'Discover every enemy in the Ashen Fields.', goal: { kind: 'bestiary', region: 1 }, reward: 40 },
  { id: 'prism-shattered', name: 'Prism Shattered', icon: 'floating-crystal', text: 'Defeat the Prism.', goal: { kind: 'boss', boss: 'prism' }, reward: 3000 },
  { id: 'forge-quenched', name: 'Forge Quenched', icon: 'frostfire', text: 'Defeat Forgeheart.', goal: { kind: 'boss', boss: 'forgeheart' }, reward: 10000 },
  { id: 'crown-broken', name: 'Crown Broken', icon: 'crowned-skull', text: 'Defeat the Hollow King.', goal: { kind: 'boss', boss: 'hollow-king' }, reward: 35000 },
  { id: 'the-light-returns', name: 'The Light Returns', icon: 'sun', text: 'Defeat the Blight.', goal: { kind: 'boss', boss: 'blight' }, reward: 100000 },
  { id: 'glass-naturalist', name: 'Glass Naturalist', icon: 'crystal-shine', text: 'Discover every enemy in the Glass Wastes.', goal: { kind: 'bestiary', region: 3 }, reward: 1200 },
  { id: 'rift-naturalist', name: 'Rift Naturalist', icon: 'fire-bowl', text: 'Discover every enemy in the Ember Rift.', goal: { kind: 'bestiary', region: 4 }, reward: 4000 },
  { id: 'hollow-naturalist', name: 'Hollow Naturalist', icon: 'eclipse', text: 'Discover every enemy in the Hollow.', goal: { kind: 'bestiary', region: 5 }, reward: 14000 },
  { id: 'apprentice-alchemist', name: 'Apprentice Alchemist', icon: 'round-potion', text: 'Find 3 different evolutions.', goal: { kind: 'recipes', n: 3 }, reward: 2500 },
  { id: 'grand-alchemist', name: 'Grand Alchemist', icon: 'standing-potion', text: 'Find all 8 evolutions.', goal: { kind: 'recipes', n: 8 }, reward: 40000 },
  { id: 'relic-hoard', name: 'Relic Hoard', icon: 'knapsack', text: 'Find 8 different relics.', goal: { kind: 'relics', n: 8 }, reward: 2000 },
  { id: 'relic-keeper', name: 'Relic Keeper', icon: 'locked-chest', text: 'Find 16 different relics.', goal: { kind: 'relics', n: 16 }, reward: 20000 },
  { id: 'fifty-thousand', name: 'Fifty Thousand', icon: 'skull-crack', text: 'Slay 50,000 enemies.', goal: { kind: 'kills', n: 50000 }, reward: 3000 },
  { id: 'crown-hunter', name: 'Crown Hunter', icon: 'crowned-skull', text: 'Slay 100 elites.', goal: { kind: 'elites', n: 100 }, reward: 5000 },
  { id: 'archmage', name: 'Archmage', icon: 'wizard-staff', text: 'Reach level 25 in one run.', goal: { kind: 'level', level: 25 }, reward: 1500 },
  { id: 'overtime', name: 'Into the Dark', icon: 'extra-time', text: 'Reach wave 30.', goal: { kind: 'wave', wave: 30 }, reward: 800 },
  { id: 'many-faces', name: 'Many Faces', icon: 'swords-emblem', text: 'Own three frames.', goal: { kind: 'frames', n: 3 }, reward: 8000 },
  { id: 'quartermaster', name: 'Quartermaster', icon: 'quiver', text: 'Own every Arsenal notable.', goal: { kind: 'branch', branch: 'arsenal' }, reward: 30000 },
  { id: 'windfall', name: 'Windfall', icon: 'coins-pile', text: 'Bank 5,000 shards from one run.', goal: { kind: 'runShards', n: 5000 }, reward: 2000 },
  { id: 'lone-champion', name: 'Lone Champion', icon: 'archery-target', text: 'Reach wave 20 with a single weapon.', goal: { kind: 'lone', wave: 20 }, reward: 1500 },
  // Secret (§5.4): "???" and a riddle until earned.
  {
    id: 'tinkerer', name: 'Tinkerer', icon: 'vintage-robot', text: 'Defeat a boss with four level-5 weapons and no passives.',
    riddle: 'Four hands, no heart.', after: 'forgeheart', goal: { kind: 'bareArsenal', weapons: 4 }, reward: 20000,
  },
  {
    id: 'unlit', name: 'Unlit', icon: 'eclipse', text: 'Defeat a boss without casting your ultimate.',
    riddle: 'Win the fight with the light held back.', after: 'forgeheart', goal: { kind: 'bossNoUlt' }, reward: 6000,
  },
  {
    id: 'long-night', name: 'The Long Night', icon: 'over-infinity', text: 'Reach wave 40.',
    riddle: 'Hold on twenty waves past the crown.', after: 'forgeheart', goal: { kind: 'wave', wave: 40 }, reward: 15000,
  },
  {
    id: 'untouchable', name: 'Untouchable', icon: 'temporary-shield', text: 'Take no damage before wave 20.',
    riddle: 'Let nothing touch the stone until the boss comes.', after: 'forgeheart', goal: { kind: 'untouched', wave: 20 }, reward: 10000,
  },
];
