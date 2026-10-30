import { useLayoutEffect, useRef, useState } from 'react';
export default function MoneyValue({ value, money, baseSize = 20, className, testId }: { value: number | undefined; money: (n: number) => string; baseSize?: number; className?: string; testId?: string }) {
  const ref = useRef<HTMLElement>(null), [compact, setCompact] = useState(false), [size, setSize] = useState(20);
  const full = value === undefined ? 'Нет данных' : money(value);
  const short = value === undefined ? full : `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ₸`;
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    // Measure actual DOM typography, including tabular digits. Canvas measures
    // proportional digits and underestimated strings containing "1" at 200%.
    const probe = document.createElement('span');
    Object.assign(probe.style, { position: 'fixed', left: '-9999px', top: '0', visibility: 'hidden', whiteSpace: 'nowrap', width: 'max-content', pointerEvents: 'none' });
    document.body.append(probe);
    const update = () => {
      const style = getComputedStyle(node), desired = parseFloat(getComputedStyle(document.documentElement).fontSize) * baseSize / 16;
      Object.assign(probe.style, { fontWeight: style.fontWeight, fontFamily: style.fontFamily, fontVariantNumeric: style.fontVariantNumeric, letterSpacing: style.letterSpacing, fontSize: `${desired}px` });
      probe.textContent = full;
      const width = Math.max(0, node.clientWidth - 1), abbreviated = probe.getBoundingClientRect().width > width;
      probe.textContent = abbreviated ? short : full;
      const measured = probe.getBoundingClientRect().width;
      setCompact(abbreviated); setSize(Math.min(desired, desired * width / Math.max(1, measured)));
    };
    const observer = new ResizeObserver(update); observer.observe(node);
    const font = new MutationObserver(update); font.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] }); update();
    return () => { observer.disconnect(); font.disconnect(); probe.remove(); };
  }, [full, short, baseSize]);
  return <strong ref={ref} className={className} data-testid={testId} title={full} aria-label={full} style={{ fontSize: `${size}px`, whiteSpace: 'nowrap', lineHeight: 1.2 }}>{compact ? short : full}</strong>;
}
