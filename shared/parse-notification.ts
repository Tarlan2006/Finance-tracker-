import { clean, parseAmount } from './logic';
export function parseNotification(text: string): { amount: number; merchant: string; kind: 'expense' } | null {
  if (/пополн|зачислен|входящ|вам перев|между сво|на свой|своими счет/i.test(text)) return null;
  const m = text.match(/(\d[\d\s\u00a0]*(?:[,.]\d{1,2})?)\s*(?:₸|тенге|KZT)/i);
  if (!m) return null;
  try { return { amount: parseAmount(m[1]), merchant: clean(text.slice(m.index! + m[0].length).replace(/^[\s—:–-]+/, '')), kind: 'expense' }; } catch { return null; }
}
