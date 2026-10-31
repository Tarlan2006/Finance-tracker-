import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useNumber } from '../motion';
import { measureMoney } from '../motion/measure';
export default function MoneyValue({ value, money, baseSize = 20, className, testId }: { value: number | undefined; money: (n: number) => string; baseSize?: number; className?: string; testId?: string }) {
  const ref = useRef<HTMLElement>(null), [compact, setCompact] = useState(false), [size, setSize] = useState(baseSize);
  const number = useRef<HTMLSpanElement>(null);
  const full = value === undefined ? 'Нет данных' : money(value);
  const short = value === undefined ? full : `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ₸`;
  const format = useCallback((n: number) => value === undefined ? 'Нет данных' : compact ? `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n)} ₸` : money(n), [compact, money, value === undefined]);
  useNumber(number, value ?? 0, format);
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    let cancel = () => {};
    const update = () => { cancel(); cancel = measureMoney({ node, full, short, base: baseSize, done: (abbreviated, measuredSize) => { setCompact(abbreviated); setSize(measuredSize); } }); };
    const observer = new ResizeObserver(update); observer.observe(node);
    let rootSize = getComputedStyle(document.documentElement).fontSize;
    const font = new MutationObserver(() => { const next = getComputedStyle(document.documentElement).fontSize; if (next !== rootSize) { rootSize = next; update(); } }); font.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] }); update();
    return () => { observer.disconnect(); font.disconnect(); cancel(); };
  }, [full, short, baseSize]);
  return <strong ref={ref} className={className} data-testid={testId} title={full} aria-label={full} style={{ fontSize: `${size}px`, whiteSpace: 'nowrap', lineHeight: 1.2 }}><span ref={number} aria-hidden="true">{compact ? short : full}</span></strong>;
}
