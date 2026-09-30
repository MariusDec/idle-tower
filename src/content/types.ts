import type { IconId } from './icons';

/**
 * What every player-facing content entry carries (§12.6): an id, a name, an
 * icon and one line of text of 15 words or fewer (R-rules, §2.2).
 */
export interface ContentEntry {
  readonly id: string;
  readonly name: string;
  readonly icon: IconId;
  readonly text: string;
}

/** A frame: the tower's chassis, chosen before a run (§4.4). */
export interface FrameDef extends ContentEntry {
  readonly startingWeapon: string;
}
