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

  it('keeps trailing zeros when asked, so whole rates read as fractional', () => {
    expect(formatWithOptionalDecimal(5, 1, { keepTrailingZeros: true })).toBe('5.0');
    expect(formatWithOptionalDecimal(0, 1, { keepTrailingZeros: true })).toBe('0.0');
    expect(formatWithOptionalDecimal(2.2, 1, { keepTrailingZeros: true })).toBe('2.2');
    expect(formatWithOptionalDecimal(9.94, 2, { keepTrailingZeros: true })).toBe('9.94');
  });

  it('still uses integers at or above 10 with keepTrailingZeros', () => {
    expect(formatWithOptionalDecimal(10, 1, { keepTrailingZeros: true })).toBe('10');
    expect(formatWithOptionalDecimal(1234, 1, { keepTrailingZeros: true })).toBe('1,234');
  });
});
