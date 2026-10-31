export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (!header) return 0;
  if (/^\d+$/.test(header)) return Number(header);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : 0;
}
