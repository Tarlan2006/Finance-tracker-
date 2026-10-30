import { clean, parseAmount } from './logic';
export function parseNotification(text: string): { amount: number; merchant: string; kind: 'expense' } | null {
  if (/пополн|зачислен|входящ|вам перев|между сво|на свой|своими счет/i.test(text)) return null;
  const m = text.match(/(\d[\d\s\u00a0]*(?:[,.]\d{1,2})?)\s*(?:₸|тенге|KZT)/i);
  if (!m) return null;
  try { return { amount: parseAmount(m[1]), merchant: clean(text.slice(m.index! + m[0].length).replace(/^[\s—:–-]+/, '')), kind: 'expense' }; } catch { return null; }
}
const words: Record<string, number> = { ноль: 0, один: 1, одна: 1, две: 2, два: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900 };
export function parseVoice(text: string) {
  const digits = text.match(/\d[\d\s]*(?:[,.]\d{1,2})?/);
  if (digits) return { amount: parseAmount(digits[0]), name: clean(text.replace(digits[0], '').replace(/тенге|₸/gi, '')) };
  let total = 0, group = 0;
  const name: string[] = [];
  for (const token of text.toLowerCase().split(/\s+/)) {
    if (token in words) group += words[token];
    else if (/^тысяч/.test(token)) { total += (group || 1) * 1000; group = 0; }
    else if (token !== 'тенге') name.push(token);
  }
  return { amount: parseAmount(total + group), name: clean(name.join(' ')) };
}
