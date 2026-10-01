import type { FeatDef } from './types';

/**
 * Feats v1 (§5.4): one finite list, each paying shards once. Each points at
 * something worth finding. The Feats tab appears after the first boss, with
 * the ones already earned waiting to be claimed. Secret feats arrive in P7.
 */
export const FEATS: readonly FeatDef[] = [
  { id: 'first-light', name: 'First Light', icon: 'sparkles', text: 'Reach wave 10.', goal: { kind: 'wave', wave: 10 }, reward: 30 },
  { id: 'thousand-cuts', name: 'Thousand Cuts', icon: 'crossed-swords', text: 'Slay 1,000 enemies.', goal: { kind: 'kills', n: 1000 }, reward: 40 },
  { id: 'master-craft', name: 'Master Craft', icon: 'hammer-nails', text: 'Take a weapon to level 5.', goal: { kind: 'maxWeapon' }, reward: 50 },
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
];
