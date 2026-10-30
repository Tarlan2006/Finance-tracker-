import { useLayoutEffect, useRef, useState } from 'react';
export default function MoneyValue({ value, money }: { value: number | undefined; money: (n: number) => string }) {
  const ref = useRef<HTMLElement>(null), [compact, setCompact] = useState(false), [size, setSize] = useState(20);
  const full = value === undefined ? 'Нет данных' : money(value);
  const short = value === undefined ? full : `${new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)} ₸`;
  useLayoutEffect(() => {
    const node = ref.current; if (!node) return;
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    const update = () => {
      const style = getComputedStyle(node), desired = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.25;
      context.font = `${style.fontWeight} ${desired}px ${style.fontFamily}`;
      const width = node.clientWidth, abbreviated = context.measureText(full).width > width;
      const measured = context.measureText(abbreviated ? short : full).width;
      setCompact(abbreviated); setSize(Math.min(desired, desired * width / Math.max(1, measured)));
    };
    const observer = new ResizeObserver(update); observer.observe(node);
    const font = new MutationObserver(update); font.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] }); update();
    return () => { observer.disconnect(); font.disconnect(); };
  }, [full, short]);
  return <strong ref={ref} title={full} aria-label={full} style={{ fontSize: `${size}px` }}>{compact ? short : full}</strong>;
}
