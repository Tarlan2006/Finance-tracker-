import { describe, expect, it } from 'vitest';
import { csv, expensesFromRows, fingerprint, firstEmptyRow, looksDuplicate, normalize, parseAmount, serialDate, suggestion, today, validateExpense } from '../../shared/logic';
import { parseNotification, parseVoice } from '../../shared/parse-notification';
import type { Expense } from '../../shared/types';
const expense: Expense = { id: '1793332800000-abcdefgh', date: '2026-10-30', amount: 1200, name: '', category: 'еда', comment: '', source: 'manual', row: 2, fp: '2026-10-30|1200|еда' };
describe('суммы и даты', () => {
  it.each([['1 200,50', 1200.5], ['1200+300', 1500], ['0.1+0.2', .3], ['100000000', 100000000]])('%s', (s, n) => expect(parseAmount(s)).toBe(n));
  it.each(['0', '-1', 'NaN', 'Infinity', '100000001', '1.234', '1e3', '', '2+', '1+foo'])('отклоняет %s', v => expect(() => parseAmount(v)).toThrow());
  it('полночь UTC+5', () => expect(today('Asia/Almaty', new Date('2026-10-29T19:30:00Z'))).toBe('2026-10-30'));
  it('пустое название, настоящий календарь', () => { expect(validateExpense(expense, [{ name: 'еда', limit: 1 }], 'Asia/Almaty').name).toBe(''); expect(() => validateExpense({ ...expense, date: '2026-02-30' }, [{ name: 'еда', limit: 1 }], 'Asia/Almaty')).toThrow(); });
});
describe('безопасные строки и подсказки', () => {
  it('пустая строка учитывает A:D, а не F', () => expect(firstEmptyRow([['Дата'], [1, '', 'еда', 2], ['', '', '', '', '', '=FORMULA'], [1]])).toBe(3));
  it('не затирает частично заполненные строки', () => expect(firstEmptyRow([['Дата'], ['', 'имя'], ['', '', '', 0]])).toBe(4));
  it('читает числа формул и serial даты', () => expect(expensesFromRows([[], [serialDate(expense.date), '', 'еда', 2666]])[0]).toMatchObject({ date: expense.date, amount: 2666, name: '' }));
  it('отпечаток', () => expect(fingerprint(expense)).toBe(expense.fp));
  it('нормализация', () => expect(normalize('  Ёжик 42!   ТЕСТ ')).toBe('ежик тест'));
  it('минимум два наблюдения и 60%', () => { const history = [{ ...expense, name: 'Magnum' }, { ...expense, name: 'Magnum' }]; expect(suggestion('Magnum', history).category).toBe('еда'); expect(suggestion('Magnum', history.slice(1)).category).toBe(''); expect(suggestion('', history).category).toBe(''); expect(suggestion('Magnum Astana', history).confidence).toBe(.75); });
  it('дубль без названия', () => expect(looksDuplicate({ ...expense, id: '1793332800001-abcdefgh' }, [expense], 3)).toBe(true));
  it('автодубль вне окна', () => expect(looksDuplicate({ ...expense, source: 'wallet-auto', id: '1793332900000-abcdefgh' }, [expense], 3, 1793333000000)).toBe(false));
  it('CSV BOM, fallback, экранирование формулы', () => { const out = csv([expense, { ...expense, name: '=HYPERLINK("evil")' }]); expect(out.startsWith('\ufeff')).toBe(true); expect(out).toContain('"еда"'); expect(out).toContain("'=HYPERLINK"); });
});
describe('уведомления и речь', () => {
  it.each(['Оплата 1 200,00 ₸ Magnum', '1200 ₸ — Magnum', 'Покупка QR 1 200 KZT: Magnum'])('разбирает %s', t => expect(parseNotification(t)).toEqual({ amount: 1200, merchant: 'Magnum', kind: 'expense' }));
  it.each(['Пополнение 1200 ₸', 'Вам перевели 1200 ₸', 'Перевод между своими счетами 1200 ₸', 'Секретное уведомление'])('игнорирует %s', t => expect(parseNotification(t)).toBeNull());
  it('исходящий перевод', () => expect(parseNotification('Исходящий перевод 1200 ₸ Иван')?.amount).toBe(1200));
  it('голос цифрами', () => expect(parseVoice('такси 1200')).toEqual({ amount: 1200, name: 'такси' }));
  it('голос словами', () => expect(parseVoice('продукты две тысячи пятьсот')).toEqual({ amount: 2500, name: 'продукты' }));
});
