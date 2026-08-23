import { describe, it, expect } from 'vitest';
import { formatWithOptionalDecimal } from '../src/utils/bigNumber';

describe('formatWithOptionalDecimal', () => {
  it('shows one decimal for values under 10', () => {
    expect(formatWithOptionalDecimal(2.2)).toBe('2.2');
    expect(formatWithOptionalDecimal(0.5)).toBe('0.5');
    expect(formatWithOptionalDecimal(9.9)).toBe('9.9');
  });

  it('strips the decimal point for whole numbers under 10', () => {
    expect(formatWithOptionalDecimal(2)).toBe('2');
    expect(formatWithOptionalDecimal(0)).toBe('0');
  });

  it('uses integers for values at or above 10', () => {
    expect(formatWithOptionalDecimal(10)).toBe('10');
    expect(formatWithOptionalDecimal(12.5)).toBe('12');
    expect(formatWithOptionalDecimal(1234)).toBe('1,234');
  });
});
