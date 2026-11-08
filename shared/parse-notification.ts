import { clean, parseAmount } from './logic';
export function parseNotification(text: string): { amount: number; merchant: string; kind: 'expense' } | null {
  if (/пополн|зачислен|входящ|вам перев|между сво|на свой|своими счет/i.test(text)) return null;
  const m = text.match(/(\d[\d\s\u00a0]*(?:[,.]\d{1,2})?)\s*(?:₸|тенге|KZT)/i);
  if (!m) return null;
  try { return { amount: parseAmount(m[1]), merchant: clean(text.slice(m.index! + m[0].length).replace(/^[\s—:–-]+/, '')), kind: 'expense' }; } catch { return null; }
}

// Match real currency codes so store identifiers like AST111 stay in the name.
const currencies = (Intl.supportedValuesOf?.('currency') ?? ['KZT', 'USD', 'EUR', 'RUB', 'GBP', 'CNY', 'JPY', 'KRW', 'AED', 'TRY']).join('|');
const walletNumber = String.raw`[+−-]? *\d+(?:[., ]\d+)*`;
const walletAmount = new RegExp(String.raw`(?:^|(?<= ))(?:(?<currency>${currencies}) *(?<prefix>${walletNumber})|(?<suffix>${walletNumber}) *₸)`, 'iu');

export function parseWalletNotification(text: string): { amount: number; merchant: string; currency: string } | null {
  const message = text.trim().replace(/\s+/gu, ' ');
  const match = walletAmount.exec(message);
  if (!match?.groups) return null;
  const { currency: code, prefix, suffix } = match.groups;
  if (prefix && /[\p{L}\p{N}.,]/u.test(message[match.index + match[0].length] ?? '')) return null;
  const digits = (prefix ?? suffix).replace(/^[+−-]? */, '');
  const parts = /^(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+|\d+)([.,]\d{1,2})?$/.exec(digits);
  if (!parts) return null;
  try {
    const amount = parseAmount(parts[1].replace(/[ ,]/g, '') + (parts[2] ?? ''));
    // Wallet puts the card name and masked number after the amount.
    return { amount, currency: code?.toUpperCase() ?? 'KZT', merchant: clean(message.slice(0, match.index)) };
  } catch { return null; }
}
