import type { AnomalyDef, AnomalyId, WeaponId } from './types';

/**
 * Anomalies (plans/late-game/04 §4): one per weapon, each breaking its
 * weapon's rule. Rare, never suggested, never taken for the player; taking
 * one forbids the weapon's evolution and so its fusions. Act 1's four ship
 * first (§4's "what ships first"); the rest wait on P5–P6, so `ANOMALY_OF`
 * is partial until then.
 */
export const ANOMALIES: readonly AnomalyDef[] = [
  {
    id: 'whiteout', name: 'Whiteout', icon: 'snowflake-1', weapon: 'frost-ring',
    text: 'The ring leaves the tower and drifts as a blizzard to the thickest crowd.',
    rule: 'Pulses round the tower become a storm that moves.',
    steps: ['The storm reaches 25% farther.', null, null, null],
  },
  {
    id: 'gyre', name: 'Gyre', icon: 'spiral-arrow', weapon: 'glaives',
    text: 'The blades leave the tower to circle the toughest enemy in range.',
    rule: 'An orbit round the tower becomes one round a foe.',
  },
  {
    id: 'lighthouse', name: 'Lighthouse', icon: 'orbital-rays', weapon: 'sunlance',
    text: 'The beam turns like a lighthouse, burning everything it sweeps across.',
    rule: 'A beam that holds one target now sweeps them all.',
    steps: [null, null, 'The sweep turns 15% faster.', null],
  },
  {
    id: 'creeping-barrage', name: 'Creeping Barrage', icon: 'drum', weapon: 'mortar',
    text: 'Each salvo walks a line of blasts from the fog to the wall.',
    rule: 'Shells aimed at a crowd become a line that walks in.',
    steps: [null, null, '+1 walking line per salvo.', null],
  },
];

export const ANOMALY_BY_ID = Object.fromEntries(ANOMALIES.map((a) => [a.id, a])) as Record<AnomalyId, AnomalyDef>;

/** Each weapon's anomaly, where one is authored (all twelve once P6 ships). */
export const ANOMALY_OF: Partial<Record<WeaponId, AnomalyDef>> = Object.fromEntries(ANOMALIES.map((a) => [a.weapon, a]));
