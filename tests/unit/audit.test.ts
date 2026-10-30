import { describe, expect, it } from 'vitest';
import { clean, fromDateCell, looksDuplicate, nameSuggestions, parseAmount, serialDate, shiftDate, shiftMonth, today } from '../../shared/logic';
import type { Expense } from '../../shared/types';
const e: Expense = { id: '1793382000000-audit000', row: 2, fp: '', date: '2026-10-30', amount: 1000, category: 'еда', name: '', comment: '', source: 'manual' };
describe('audit: dates and validation', () => {
  it.each([
    ['2026-10-30T17:53:00Z', '2026-10-30'], ['2026-10-30T18:30:00Z', '2026-10-30'],
    ['2026-10-30T19:00:00Z', '2026-10-31'], ['2026-10-30T19:30:00Z', '2026-10-31'],
    ['2026-10-31T19:00:00Z', '2026-11-01'], ['2026-12-31T19:00:00Z', '2027-01-01']
  ])('Almaty %s = %s', (instant, date) => expect(today('Asia/Almaty', new Date(instant))).toBe(date));
  it.each(['2026-10-30', '2026-12-31', '2027-01-01', '2024-02-29'])('serial roundtrip %s', date => expect(fromDateCell(serialDate(date))).toBe(date));
  it('calendar boundaries', () => { expect(shiftDate('2027-01-01', -1)).toBe('2026-12-31'); expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29'); expect(shiftMonth('2026-12', 1)).toBe('2027-01'); });
  it.each(['1\u200B200', '١٢٠٠', '１２３', '1e3', 'NaN', 'Infinity', '0', '-1', '100000000.01'])('rejects ambiguous amount %s', value => expect(() => parseAmount(value)).toThrow());
  it('NBSP and narrow NBSP', () => { expect(parseAmount('1\u00a0200,50')).toBe(1200.5); expect(parseAmount('1\u202f200.50')).toBe(1200.5); });
  it('does not split emoji at the 200-character boundary', () => expect(Array.from(clean('😀'.repeat(201)))).toHaveLength(200));
  it.each(['=SUM(A1:A2)', '+1', '-1', '@x', "'literal", '<script>alert(1)</script>', '＝SUM(1)', 'Еда 🍔'])('retains ordinary text %s', value => expect(clean(value)).toBe(value));
  it('names lowercased only in suggestions; compounds excluded, permutation merged', () => {
    const history = ['Покушать', 'покушать', 'магаз покушать', 'покушать магаз', 'кино и покушать', 'покушать и КОМПЫ', 'Кофе', 'Кофе'].map((name, i) => ({ ...e, row: i + 2, name }));
    expect(nameSuggestions(history)).toEqual(['покушать', 'кофе']);
  });
  it('different unnamed categories are not a duplicate', () => expect(looksDuplicate({ ...e, id: '1793382000001-audit000', category: 'такси' }, [e], 3, 1793382000001)).toBe(false));
  it('manual duplicates outside the window do not interrupt another purchase', () => expect(looksDuplicate({ ...e, id: '1793385600000-audit000' }, [e], 3, 1793385600000)).toBe(false));
});
