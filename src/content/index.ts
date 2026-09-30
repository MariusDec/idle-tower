import { FRAMES } from './frames';
import type { ContentEntry } from './types';

/**
 * Every content table, by name. The lint (`content/lint.ts`) walks this, so a
 * new table is linted the moment it is registered here.
 */
export const CONTENT: Readonly<Record<string, readonly ContentEntry[]>> = {
  frames: FRAMES,
};
