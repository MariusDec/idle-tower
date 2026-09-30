export { BuffRegistry, type BuffEntry } from './BuffRegistry';
export { StatAccumulator, type Breakdown, type Contribution, type SourceHandle } from './accumulator';
export {
  emptyStatContext,
  type BlessingInputs,
  type PrestigeInputs,
  type ResearchInputs,
  type StatContext,
  type WaveModifierInputs,
} from './context';
export { STAT_BASES, STAT_CLAMPS, STAT_KEYS, type StatKey, type StatSource } from './keys';
export {
  goldSourceEntries,
  resolveStats,
  type ResolveOptions,
  type ResolveResult,
  type ResolvedStats,
} from './resolve';
