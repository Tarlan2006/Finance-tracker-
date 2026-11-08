import { parseWalletNotification } from '../../../shared/parse-notification';

export interface Draft {
  amount: string;
  name: string;
  source: string;
  ts?: number;
  wallet?: boolean;
  comment?: string;
}

const pendingKey = 'pending-payment';
const recentKey = 'wallet-recent-payments';
const repeatWindow = 120_000;
export const emptyDraft: Draft = { amount: '', name: '', source: 'manual' };

function readStored(key: string): unknown {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); }
  catch { return null; }
}

function store(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* The in-memory draft still works when storage is unavailable. */ }
}

export function pendingPayment(): Draft | undefined {
  const value = readStored(pendingKey) as Draft | null;
  if (value && typeof value.amount === 'string' && typeof value.name === 'string') return value;
}

export function forgetPendingPayment() {
  try { sessionStorage.removeItem(pendingKey); }
  catch { /* Optional draft persistence. */ }
}

function walletText(url: URL): string | undefined {
  const search = url.search.slice(1);
  const marker = /(?:^|&)text(?:=|$)/.exec(search);
  if (!marker) return;
  // The Android link puts text last. Anything after its marker, including
  // ampersands and the fragment, can be part of an unescaped merchant name.
  const raw = search.slice(marker.index + marker[0].length) + url.hash;
  return new URLSearchParams('v=' + raw.replaceAll('&', '%26').replaceAll('+', '%2B')).get('v')!;
}

let recentInMemory: [string, number][] = [];
function isRepeat(hash: string) {
  const now = Date.now();
  const stored = readStored(recentKey);
  const recent = (Array.isArray(stored) ? stored as [string, number][] : recentInMemory)
    .filter(([, at]) => at <= now && now - at < repeatWindow);
  if (recent.some(([seen]) => seen === hash)) return true;
  recentInMemory = [...recent, [hash, now]];
  store(recentKey, recentInMemory);
  return false;
}

export async function readPaymentLink(url: URL): Promise<{ draft: Draft; hash?: string } | undefined> {
  const text = walletText(url);
  if (text !== undefined) {
    const payment = parseWalletNotification(text);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    const hash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    const draft: Draft = payment ? {
      amount: String(payment.amount),
      name: payment.merchant,
      source: 'wallet',
      wallet: true,
      comment: payment.currency === 'KZT' ? undefined : `Валюта платежа: ${payment.currency}`,
    } : { ...emptyDraft, wallet: true };
    return { draft, hash };
  }

  const params = url.searchParams;
  if (!params.has('amount') && !params.has('merchant')) return;
  return { draft: {
    amount: params.get('amount') || '',
    name: params.get('merchant') || '',
    source: params.get('src') || 'manual',
    ts: params.has('ts') ? Number(params.get('ts')) * 1000 : undefined,
  } };
}

export function acceptPaymentLink({ draft, hash }: { draft: Draft; hash?: string }) {
  if (hash && isRepeat(hash)) {
    history.replaceState(history.state, '', location.pathname);
    return false;
  }
  // Persist only the sanitized draft. Card details are discarded by the parser.
  store(pendingKey, draft);
  history.replaceState({ tab: 0, add: true }, '', location.pathname);
  return true;
}
